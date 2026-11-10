// Speed and quality sweep for small local cross-encoder rerankers on a CPU host.
//
// One implementation only: AutoTokenizer + AutoModelForSequenceClassification
// from @huggingface/transformers, every (query, note) pair encoded as a true
// text pair, one batched forward pass per rerank call, the raw logit as score.
//
// Modes (one process per row; every result is one JSON line appended to --out):
//   hub        print each model repository's ONNX files and licence tag.
//   load       cold-load a model and weights file into --cache.
//   plan       tokenize the bench notes for every (N, cap, max_length) and
//              write the distinct feed shapes to time (--shapes, --panel).
//   bench      time one row: 3 warm-ups, 30 timed calls.
//   quality    rank a fixed synthetic set of 60 queries x 20 notes for every
//              (cap, max_length); also emits the no-rerank baseline.
//   summarize  read every *.jsonl under --dir, write results.json and Markdown.
//
// The script must run from a folder whose node_modules holds the package.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// ---------------------------------------------------------------- arguments
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
}
const MODE = args.mode;
const OUT = args.out ? path.resolve(args.out) : null;
const TIMED_CALLS = Number(process.env.TIMED_CALLS ?? 30);
const WARM_CALLS = Number(process.env.WARM_CALLS ?? 3);

const NS = [8, 12, 20];
const CAPS = [300, 512, 1024];
const MAXLENS = [128, 256, 512];
const PANEL = [[20, 1024, 512], [12, 512, 512], [8, 300, 512]];
// Chunked scoring (outside the requested grid): each capped note is split into
// sentence-packed chunks of at most CHUNK characters, every (query, chunk) pair
// goes into the one batched pass, and a note scores the max over its chunks.
const CHUNKS = [160, 300];
const CHUNK_ML = 128;

function chunkText(text, size) {
  const out = [];
  let cur = '';
  for (let sent of text.split(/(?<=[.!?])\s+/)) {
    while (sent.length > size) { if (cur) { out.push(cur); cur = ''; } out.push(sent.slice(0, size)); sent = sent.slice(size); }
    if (!sent) continue;
    if (cur && cur.length + 1 + sent.length > size) { out.push(cur); cur = sent; } else cur = cur ? cur + ' ' + sent : sent;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function emit(rec) {
  const line = JSON.stringify({ ...rec, at: new Date().toISOString() });
  console.log(line.length > 3000 ? line.slice(0, 3000) + '...' : line);
  if (OUT) fs.appendFileSync(OUT, line + '\n');
}

const warnings = [];
const origWarn = console.warn.bind(console);
console.warn = (...a) => {
  warnings.push(a.map((x) => (typeof x === 'string' ? x : String(x?.message ?? x))).join(' ').slice(0, 400));
  origWarn(...a);
};

const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const rssMB = () => MB(process.memoryUsage().rss);
function procStatus(key) {
  try {
    const m = fs.readFileSync('/proc/self/status', 'utf8').match(new RegExp(`${key}:\\s+(\\d+)\\s+kB`));
    return m ? MB(Number(m[1]) * 1024) : null;
  } catch { return null; }
}
function threadAffinities() {
  try {
    const counts = {};
    for (const tid of fs.readdirSync('/proc/self/task')) {
      const st = fs.readFileSync(`/proc/self/task/${tid}/status`, 'utf8');
      const m = st.match(/Cpus_allowed_list:\s+(\S+)/);
      const k = m ? m[1] : '?';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  } catch { return null; }
}
function cpusetEffective() {
  try {
    const line = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').pop();
    const rel = line.split('::')[1] ?? '';
    let eff = null;
    try { eff = fs.readFileSync(path.join('/sys/fs/cgroup', rel, 'cpuset.cpus.effective'), 'utf8').trim(); } catch { /* none */ }
    return { cgroup: rel, cpusetEffective: eff };
  } catch { return null; }
}
function cpuFlags() {
  try {
    const flags = fs.readFileSync('/proc/cpuinfo', 'utf8').match(/^flags\s*:\s*(.*)$/m)?.[1].split(/\s+/) ?? [];
    return { avx2: flags.includes('avx2'), avx512f: flags.includes('avx512f'), avx512vnni: flags.includes('avx512_vnni'), avxvnni: flags.includes('avx_vnni') };
  } catch { return null; }
}
function pkgVersion(name) {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return null; }
}
function meta() {
  return {
    cpuModel: os.cpus()[0]?.model ?? null,
    cpusListed: os.cpus().length,
    flags: cpuFlags(),
    ...cpusetEffective(),
    totalMemMB: MB(os.totalmem()),
    node: process.version,
    transformers: pkgVersion('@huggingface/transformers'),
    onnxruntimeNode: pkgVersion('onnxruntime-node'),
  };
}

// ------------------------------------------------------------ synthetic set
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
function shuffle(r, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Filler about everyday things none of the queries ask about.
const F = {
  when: ['On Sunday', 'This morning', 'Last night', 'Over the weekend', 'Earlier today', 'On a slow afternoon', 'Before lunch', 'After dinner', 'Late last night', 'Early on Saturday'],
  act: ['made a big pot of lentil soup', 'read three chapters of a mystery novel', 'repotted the basil on the windowsill', 'practiced scales on the old guitar', 'sorted the recycling into bins', 'watched a documentary about deep sea fish', 'baked a loaf of rye bread', 'folded two baskets of laundry', 'wrote a long letter by hand', 'went for a slow walk around the park', 'swept the front steps', 'listened to a podcast about old maps', 'tidied the bookshelf by color', 'tried a new recipe for curry', 'ironed a stack of shirts'],
  detail: ['and it turned out better than expected', 'while it drizzled outside', 'because there was nothing else to do', 'and the house smelled great afterwards', 'though it took most of the hour', 'and I lost track of time', 'with the radio on in the background', 'before the light faded', 'and then took a short nap', 'which felt good after a long week'],
  note: ['The weather has been mild for the season.', 'There is still half a jar of honey in the pantry.', 'The neighbors put up a new fence.', 'The library book is due back soon.', 'I want to try that recipe again with less salt.', 'The kettle has started making a strange noise.', 'The garden needs weeding before the rain.', 'Someone left a kind note on the community board.', 'The streetlights came on early tonight.', 'A new bakery opened two blocks away.'],
};
function filler(r) { return `${pick(r, F.when)} I ${pick(r, F.act)} ${pick(r, F.detail)}. ${pick(r, F.note)}`; }

const NAMES = ['Nora', 'Malik', 'Priya', 'Tomas', 'Elena', 'Jonah', 'Ines', 'Rafael', 'Mei', 'Dmitri', 'Hana', 'Oscar', 'Lena', 'Kofi', 'Sofia'];
const PETS = ['Biscuit', 'Pepper', 'Mango'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Each template takes (r, k) and returns { q, a, near[], old? }:
// q the query, a the one answering sentence, near sentences that share the
// query's words but do not answer, old (recency) the older, superseded fact.
const KINDS = {
  exact: [
    (r, k) => { const p = PETS[k]; const c = ['Willow Paws Animal Care', 'Harbor Street Vet', 'Maple Grove Pet Clinic'][k];
      return { q: `What is the name of the clinic where ${p} got her vaccines?`, a: `${p} got her vaccines at a small clinic called ${c} near the old market.`,
        near: [`${p} hates the car ride and hid under the seat the whole way.`, `${p} needs a new collar because the old one is frayed.`] }; },
    (r, k) => { const n = NAMES[k]; const code = ['4719', '2083', '6352'][k];
      return { q: `What is the code for ${n}'s gym locker?`, a: `${n} set the gym locker code to ${code} so it is easy to remember.`,
        near: [`${n} goes to the gym three times a week after work.`, `The locker room at ${n}'s gym was renovated last month.`] }; },
    (r, k) => { const n = NAMES[3 + k]; const f = ['TR 418', 'KL 2271', 'AV 903'][k];
      return { q: `Which flight number is ${n} taking to the conference?`, a: `${n} booked flight ${f} to the conference, leaving at dawn.`,
        near: [`${n} is presenting a short talk at the conference.`, `The conference hotel is a short walk from the venue, ${n} says.`] }; },
    (r, k) => { const n = NAMES[6 + k]; const d = ['March 14', 'July 2', 'October 27'][k];
      return { q: `On what date is ${n}'s dentist appointment?`, a: `${n}'s dentist appointment is on ${d} at ten in the morning.`,
        near: [`${n} has been meaning to switch to a dentist closer to home.`, `The dentist's office sent ${n} a reminder about flossing.`] }; },
    (r, k) => { const it = ['couch', 'bookcase', 'desk'][k]; const p = ['640', '215', '389'][k];
      return { q: `How much did the new ${it} cost?`, a: `The new ${it} cost ${p} dollars including delivery.`,
        near: [`The new ${it} is a little too big for the room.`, `We measured the doorway twice before the ${it} arrived.`] }; },
  ],
  paraphrase: [
    (r, k) => { const n = NAMES[k];
      return { q: `Where does ${n} work now?`, a: `${n} recently accepted a position at a shipping firm on the east side of town.`,
        near: [`${n} says the work around the house has been piling up.`, `Now that it is spring, ${n} wants to repaint the porch.`] }; },
    (r, k) => { const n = NAMES[3 + k];
      return { q: `What did ${n} use to fix the dripping faucet?`, a: `${n} stopped the leaky tap with a new rubber washer from the hardware store.`,
        near: [`The faucet in ${n}'s guest bathroom is dripping again.`, `${n} still needs to fix the squeaky closet door.`] }; },
    (r, k) => { const n = NAMES[6 + k];
      return { q: `Why is ${n} not driving these days?`, a: `${n}'s license was suspended after a pile of parking tickets went unpaid.`,
        near: [`${n} enjoys driving along the coast road on weekends.`, `These days ${n} is busy with night classes.`] }; },
    (r, k) => { const n = NAMES[9 + k];
      return { q: `How does ${n} get to the office?`, a: `Each morning ${n} cycles along the canal path to reach work.`,
        near: [`${n}'s office has a view of the parking lot.`, `${n} wants a standing desk for the office.`] }; },
    (r, k) => { const n = NAMES[12 + k];
      return { q: `What made ${n} sick last week?`, a: `${n} caught food poisoning from undercooked chicken at a street fair.`,
        near: [`${n} was sick of the rain last week and stayed in.`, `Last week ${n} finally finished the jigsaw puzzle.`] }; },
  ],
  recency: [
    (r, k, d1, d2) => { const n = NAMES[k]; const v = ['555 0142', '555 0187', '555 0119'];
      return { q: `What is ${n}'s current phone number?`, old: `On ${d1} ${n} said the phone number is ${v[k]}.`, a: `On ${d2} ${n} said the phone number is ${v[(k + 1) % 3]}.`, near: [] }; },
    (r, k, d1, d2) => { const n = NAMES[3 + k]; const v = ['Birch Lane', 'Quarry Road', 'Elm Court'];
      return { q: `Where does ${n} live at the moment?`, old: `As of ${d1} ${n} lives on ${v[k]}.`, a: `As of ${d2} ${n} lives on ${v[(k + 1) % 3]}.`, near: [] }; },
    (r, k, d1, d2) => { const v = ['blue-heron-42', 'pine-cone-17', 'river-stone-88'];
      return { q: 'What is the latest wifi password at the cabin?', old: `On ${d1} the cabin wifi password was set to ${v[k]}.`, a: `On ${d2} the cabin wifi password was set to ${v[(k + 1) % 3]}.`, near: [] }; },
    (r, k, d1, d2) => { const n = NAMES[6 + k]; const v = ['7:15', '6:30', '8:45'];
      return { q: `What time does ${n}'s yoga class start these days?`, old: `From ${d1} ${n}'s yoga class starts at ${v[k]}.`, a: `From ${d2} ${n}'s yoga class starts at ${v[(k + 1) % 3]}.`, near: [] }; },
    (r, k, d1, d2) => { const v = ['12,000', '15,500', '9,800'];
      return { q: 'What is the current budget for the kitchen project?', old: `On ${d1} the kitchen project budget was set at ${v[k]} dollars.`, a: `On ${d2} the kitchen project budget was set at ${v[(k + 1) % 3]} dollars.`, near: [] }; },
  ],
  distractor: [
    (r, k) => { const n = NAMES[k]; const t = ['6:30', '7:00', '5:45'][k];
      return { q: `What time does ${n}'s piano recital start?`, a: `${n}'s piano recital starts at ${t} in the main hall.`,
        near: [`${n} practiced piano for the recital every evening this week.`, `The piano recital program lists ${n} third.`, `${n}'s piano teacher said the recital will be recorded.`, `After the recital ${n} wants to get ice cream.`, `${n} is nervous about the piano recital.`, `The recital tickets for ${n}'s family are on the fridge.`] }; },
    (r, k) => { const n = NAMES[3 + k]; const c = ['Lisbon', 'Porto', 'Seville'][k]; const h = ['Hotel Aurora', 'Casa Verde Inn', 'Grand Plaza Hotel'][k];
      return { q: `Which hotel did ${n} book for the wedding in ${c}?`, a: `For the wedding in ${c}, ${n} booked a room at the ${h}.`,
        near: [`${n} is excited about the wedding in ${c} next month.`, `The hotels in ${c} fill up fast in summer.`, `${n} bought a new suit for the wedding.`, `The wedding venue in ${c} is by the river.`, `${n} asked about hotel parking for the trip to ${c}.`, `The wedding invitation for ${n} arrived on thick paper.`] }; },
    (r, k) => { const n = NAMES[6 + k]; const s = ['9', '11', '7'][k];
      return { q: `What size shoes does ${n} wear?`, a: `${n} wears size ${s} shoes.`,
        near: [`${n} bought new running shoes last month.`, `The shoe store downtown had a sale and ${n} went twice.`, `${n}'s shoes were soaked after the walk.`, `${n} needs to polish the black shoes before the dinner.`, `The size of ${n}'s closet makes storing shoes hard.`, `${n} returned shoes that pinched at the toes.`] }; },
    (r, k) => { const n = NAMES[9 + k]; const o = NAMES[(9 + k + 4) % 15];
      return { q: `Who is picking up ${n} from the airport on Friday?`, a: `${o} is picking up ${n} from the airport on Friday.`,
        near: [`${n} lands at the airport on Friday afternoon.`, `The airport parking lot is under construction this week.`, `${n} always forgets something at the airport.`, `On Friday the traffic to the airport is terrible.`, `${n} asked if the airport train runs late on Friday.`, `Picking someone up at the airport takes an hour each way.`] }; },
    (r, k) => { const n = NAMES[12 + k]; const m = ['Clarivex', 'Pollenor', 'Histaril'][k];
      return { q: `What is ${n}'s allergy medication called?`, a: `${n}'s allergy medication is called ${m}.`,
        near: [`${n}'s allergies get worse every spring.`, `The pharmacy called ${n} about a refill.`, `${n} is allergic to cats but loves them anyway.`, `${n} keeps the medication in the kitchen drawer.`, `The doctor told ${n} to avoid cut grass.`, `${n} asked if the allergy season will be long this year.`] }; },
  ],
};
const KIND_NAMES = ['exact', 'paraphrase', 'recency', 'distractor'];

// A note: filler sentences to at least 1,200 characters, with the given
// sentence inserted at a seeded random sentence position.
function noteWith(r, sentence) {
  const parts = [];
  let len = 0;
  while (len < 1200) { const f = filler(r); parts.push(f); len += f.length + 1; }
  if (!sentence) return { text: parts.join(' '), start: -1, end: -1 };
  const pos = Math.floor(r() * (parts.length + 1));
  parts.splice(pos, 0, sentence);
  const text = parts.join(' ');
  const start = text.indexOf(sentence);
  return { text, start, end: start + sentence.length, pos, slots: parts.length };
}

function buildSet() {
  const set = [];
  let qi = 0;
  for (const kind of KIND_NAMES) {
    for (let t = 0; t < 5; t++) {
      for (let k = 0; k < 3; k++) {
        const r = rng(7001 + qi * 131);
        let d1 = null; let d2 = null;
        if (kind === 'recency') {
          const i = Math.floor(r() * 6); const j = i + 1 + Math.floor(r() * 5);
          d1 = `${MONTHS[i]} ${1 + Math.floor(r() * 27)}`; d2 = `${MONTHS[j]} ${1 + Math.floor(r() * 27)}`;
        }
        const tpl = KINDS[kind][t](r, k, d1, d2);
        const notes = [];
        const ans = noteWith(r, tpl.a);
        const others = [];
        if (tpl.old) others.push(noteWith(r, tpl.old));
        for (const s of tpl.near) others.push(noteWith(r, s));
        while (others.length < 19) others.push(noteWith(r, null));
        shuffle(r, others);
        const answerIndex = Math.floor(r() * 20);
        for (let i = 0, o = 0; i < 20; i++) notes.push(i === answerIndex ? ans : others[o++]);
        set.push({ id: qi, kind, template: t, fill: k, query: tpl.q, answerSentence: tpl.a, answerIndex, notes });
        qi++;
      }
    }
  }
  return set;
}

// ------------------------------------------------------------------ model
const WEIGHTS = {
  fp32: { dtype: 'fp32', file: 'model' },
  q8avx2: { dtype: 'fp32', file: 'model_quint8_avx2' },
};
const shortName = (m) => m.split('/').pop().replace('ms-marco-', '');

function sessionOptionsFor(opts, cores) {
  if (opts === 'default') return null;
  if (opts === 'threads') return { intraOpNumThreads: cores, interOpNumThreads: 1 };
  if (opts === 'threads-nospin') return {
    intraOpNumThreads: cores, interOpNumThreads: 1,
    extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
  };
  throw new Error('unknown opts ' + opts);
}

async function loadModel(modelId, weights, cacheDir, sessionOptions) {
  const T = await import('@huggingface/transformers');
  T.env.cacheDir = cacheDir;
  const events = [];
  const progress_callback = (e) => { if (e && (e.status === 'initiate' || e.status === 'done')) events.push(`${e.status}:${e.file}`); };
  const w = WEIGHTS[weights];
  const t0 = performance.now();
  const tokenizer = await T.AutoTokenizer.from_pretrained(modelId, { progress_callback });
  const opts = { dtype: w.dtype, model_file_name: w.file, progress_callback };
  if (sessionOptions) opts.session_options = sessionOptions;
  const model = await T.AutoModelForSequenceClassification.from_pretrained(modelId, opts);
  const loadMs = performance.now() - t0;
  const session = model.sessions?.model;
  const inputNames = session?.inputNames ?? ['input_ids', 'attention_mask', 'token_type_ids'];
  const sep = tokenizer.sep_token_id;
  const pad = tokenizer.pad_token_id ?? 0;

  // Encode each (query, note) as a true pair; past max_length cut the note's
  // tail and keep the final separator; pad the batch to its longest row.
  function encode(query, docs, maxLength) {
    const rows = docs.map((d) => {
      const e = tokenizer(query, { text_pair: d });
      let ids = Array.from(e.input_ids.data, Number);
      let tt = Array.from((e.token_type_ids ?? e.input_ids).data, Number);
      if (!e.token_type_ids) tt = tt.map(() => 0);
      const natural = ids.length;
      if (ids.length > maxLength) {
        ids = ids.slice(0, maxLength - 1).concat([sep]);
        tt = tt.slice(0, maxLength - 1).concat([1]);
      }
      return { ids, tt, natural };
    });
    const L = Math.max(...rows.map((x) => x.ids.length));
    const n = rows.length;
    const ids = new BigInt64Array(n * L).fill(BigInt(pad));
    const mask = new BigInt64Array(n * L);
    const tts = new BigInt64Array(n * L);
    rows.forEach((x, i) => {
      for (let j = 0; j < x.ids.length; j++) { ids[i * L + j] = BigInt(x.ids[j]); mask[i * L + j] = 1n; tts[i * L + j] = BigInt(x.tt[j]); }
    });
    const feeds = {
      input_ids: new T.Tensor('int64', ids, [n, L]),
      attention_mask: new T.Tensor('int64', mask, [n, L]),
      token_type_ids: new T.Tensor('int64', tts, [n, L]),
    };
    const used = {};
    for (const k of inputNames) used[k] = feeds[k];
    return { feeds: used, padded: L, naturalMax: Math.max(...rows.map((x) => x.natural)), truncated: rows.filter((x) => x.natural > maxLength).length };
  }
  async function score(query, docs, maxLength) {
    const enc = encode(query, docs, maxLength);
    const { logits } = await model(enc.feeds);
    const k = logits.dims[1] ?? 1;
    const scores = [];
    for (let i = 0; i < docs.length; i++) scores.push(Number(k === 1 ? logits.data[i] : logits.data[i * k + 1]));
    return { scores, padded: enc.padded, naturalMax: enc.naturalMax, truncated: enc.truncated };
  }
  async function scoreChunked(query, docs, chunk, maxLength) {
    const owner = []; const pieces = [];
    docs.forEach((d, i) => { for (const c of chunkText(d, chunk)) { owner.push(i); pieces.push(c); } });
    const r = await score(query, pieces, maxLength);
    const scores = docs.map(() => -Infinity);
    r.scores.forEach((s, j) => { if (s > scores[owner[j]]) scores[owner[j]] = s; });
    return { scores, padded: r.padded, pairs: pieces.length, naturalMax: r.naturalMax, truncated: r.truncated };
  }
  function pairLength(query, doc) { return tokenizer(query, { text_pair: doc }).input_ids.dims.at(-1); }
  return { T, tokenizer, model, loadMs, events, inputNames, encode, score, scoreChunked, pairLength };
}

function onnxFilesIn(cacheDir, modelId) {
  const d = path.join(cacheDir, modelId, 'onnx');
  try { return fs.readdirSync(d).filter((f) => f.endsWith('.onnx')).map((f) => ({ file: `onnx/${f}`, sizeMB: MB(fs.statSync(path.join(d, f)).size) })); } catch { return []; }
}

// The bench query and notes: query 0 of the quality set (an exact-fact query,
// its answer among the first notes), first N notes, each cut to the cap.
function benchInput(set, N, cap) {
  const q = set[0];
  const order = [q.answerIndex, ...q.notes.map((_, i) => i).filter((i) => i !== q.answerIndex)];
  return { query: q.query, docs: order.slice(0, N).map((i) => q.notes[i].text.slice(0, cap)) };
}

// ------------------------------------------------------------------- modes
async function modeHub() {
  for (const m of String(args.models).split(',')) {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${m}`);
      const j = await res.json();
      const onnx = (j.siblings ?? []).map((s) => s.rfilename).filter((f) => f.startsWith('onnx/'));
      const licence = (j.tags ?? []).filter((t) => t.startsWith('license:'));
      emit({ type: 'hub', model: m, status: res.status, licence, onnx, sha: j.sha ?? null, lastModified: j.lastModified ?? null });
    } catch (e) {
      emit({ type: 'hub', model: m, error: String(e).slice(0, 300) });
    }
  }
}

async function modeLoad() {
  const base = { type: 'load', job: args.job, model: args.model, weights: args.weights, meta: meta() };
  const cacheDir = path.resolve(args.cache);
  const rssBefore = rssMB();
  const m = await loadModel(args.model, args.weights, cacheDir, null);
  const set = buildSet();
  const q = set[0];
  const { scores } = await m.score(q.query, q.notes.map((n) => n.text.slice(0, 1024)), 512);
  const rank = 1 + scores.filter((s, i) => i !== q.answerIndex && s >= scores[q.answerIndex]).length;
  emit({ ...base, phase: args.phase, loadMs: Math.round(m.loadMs), rssBeforeMB: rssBefore, rssAfterLoadMB: rssMB(), files: m.events, onnxFiles: onnxFilesIn(cacheDir, args.model), inputNames: m.inputNames, checkRank: rank, warnings });
}

async function modePlan() {
  const cacheDir = path.resolve(args.cache);
  const m = await loadModel(args.model, args.weights, cacheDir, null);
  const set = buildSet();
  const rows = [];
  for (const N of NS) for (const cap of CAPS) for (const ml of MAXLENS) {
    const { query, docs } = benchInput(set, N, cap);
    const enc = m.encode(query, docs, ml);
    rows.push({ N, cap, ml, padded: enc.padded, naturalMax: enc.naturalMax, truncated: enc.truncated });
  }
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.N}x${r.padded}`;
    if (!seen.has(k)) seen.set(k, r);
    r.timedAs = `${seen.get(k).N}/${seen.get(k).cap}/${seen.get(k).ml}`;
  }
  emit({ type: 'plan', job: args.job, model: args.model, rows });
  fs.writeFileSync(path.resolve(args.shapes), [...seen.values()].map((r) => `${r.N} ${r.cap} ${r.ml}`).join('\n') + '\n');
  const panel = PANEL.map(([N, cap, ml]) => rows.find((r) => r.N === N && r.cap === cap && r.ml === ml).timedAs.split('/').join(' '));
  fs.writeFileSync(path.resolve(args.panel), [...new Set(panel)].join('\n') + '\n');
  if (args.chunks) {
    const lines = [];
    const crow = [];
    for (const N of NS) for (const chunk of CHUNKS) {
      const { query, docs } = benchInput(set, N, 1024);
      const pieces = docs.flatMap((d) => chunkText(d, chunk));
      const enc = m.encode(query, pieces, CHUNK_ML);
      crow.push({ N, cap: 1024, chunk, ml: CHUNK_ML, pairs: pieces.length, padded: enc.padded });
      lines.push(`${N} 1024 ${CHUNK_ML} ${chunk}`);
    }
    emit({ type: 'plan-chunks', job: args.job, model: args.model, rows: crow });
    fs.writeFileSync(path.resolve(args.chunks), lines.join('\n') + '\n');
  }
}

function pct(sorted, p) {
  const k = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(k, sorted.length - 1)];
}

async function modeBench() {
  const cores = Number(args.cores);
  const N = Number(args.N); const cap = Number(args.cap); const ml = Number(args.ml);
  const chunk = args.chunk ? Number(args.chunk) : null;
  const so = sessionOptionsFor(args.opts, cores);
  const base = { type: 'bench', job: args.job, tag: args.tag ?? 'grid', model: args.model, weights: args.weights, coreSet: args.coreset, cpus: args.cpus, cores, opts: args.opts, sessionOptions: so, N, cap, ml, chunk, meta: meta() };
  const cacheDir = path.resolve(args.cache);
  const m = await loadModel(args.model, args.weights, cacheDir, so);
  const rssAfterLoad = rssMB();
  const set = buildSet();
  const { query, docs } = benchInput(set, N, cap);
  const call = () => (chunk ? m.scoreChunked(query, docs, chunk, ml) : m.score(query, docs, ml));
  const warm = [];
  let padded = null; let pairs = docs.length;
  for (let i = 0; i < WARM_CALLS; i++) {
    const t = performance.now();
    const r = await call();
    warm.push(Math.round(performance.now() - t));
    padded = r.padded; pairs = r.pairs ?? docs.length;
  }
  const threads = threadAffinities();
  const times = [];
  const cpu0 = process.cpuUsage();
  for (let i = 0; i < TIMED_CALLS; i++) {
    const t = performance.now();
    await call();
    times.push(performance.now() - t);
  }
  const cpu = process.cpuUsage(cpu0);
  const sorted = [...times].sort((a, b) => a - b);
  const r1 = (x) => Math.round(x * 10) / 10;
  emit({
    ...base, files: m.events, onnxFiles: onnxFilesIn(cacheDir, args.model), loadMs: Math.round(m.loadMs), padded, pairs,
    warmMs: warm, n: times.length, p50: r1(pct(sorted, 50)), p95: r1(pct(sorted, 95)), max: r1(sorted.at(-1)),
    cpuSecPerCall: Math.round(((cpu.user + cpu.system) / 1e6 / times.length) * 1000) / 1000,
    threads, threadCount: threads ? Object.values(threads).reduce((a, b) => a + b, 0) : null,
    rssAfterLoadMB: rssAfterLoad, rssPeakMB: procStatus('VmHWM'), warnings,
  });
}

function metrics(ranks) {
  const n = ranks.length;
  return {
    n,
    r1: Math.round((ranks.filter((x) => x === 1).length / n) * 1000) / 1000,
    r3: Math.round((ranks.filter((x) => x <= 3).length / n) * 1000) / 1000,
    mrr: Math.round((ranks.reduce((a, x) => a + 1 / x, 0) / n) * 1000) / 1000,
  };
}
function summarizeRanks(set, ranks) {
  const out = { overall: metrics(ranks) };
  for (const k of KIND_NAMES) out[k] = metrics(set.map((q, i) => (q.kind === k ? ranks[i] : null)).filter((x) => x !== null));
  return out;
}

async function modeQuality() {
  const base = { type: 'quality', job: args.job, model: args.model, weights: args.weights, meta: meta() };
  const set = buildSet();
  // No rerank: candidates in input order (answer position seeded uniformly).
  emit({ type: 'quality-baseline', job: args.job, label: 'no rerank (input order)', ...summarizeRanks(set, set.map((q) => q.answerIndex + 1)), answerPositions: set.map((q) => q.answerIndex) });
  const cacheDir = path.resolve(args.cache);
  const m = await loadModel(args.model, args.weights, cacheDir, null);
  for (const cap of CAPS) for (const ml of MAXLENS) {
    const ranks = []; const per = [];
    let inCap = 0; let inLen = 0; let paddedMax = 0; let truncatedPairs = 0;
    for (const q of set) {
      const docs = q.notes.map((n) => n.text.slice(0, cap));
      const { scores, padded, truncated } = await m.score(q.query, docs, ml);
      paddedMax = Math.max(paddedMax, padded); truncatedPairs += truncated;
      const a = scores[q.answerIndex];
      const rank = 1 + scores.filter((s, i) => i !== q.answerIndex && s >= a).length;
      ranks.push(rank);
      const ans = q.notes[q.answerIndex];
      const capOk = ans.end <= cap;
      if (capOk) inCap++;
      const lenOk = capOk && m.pairLength(q.query, ans.text.slice(0, ans.end)) <= ml - 0;
      if (lenOk) inLen++;
      per.push({ id: q.id, kind: q.kind, rank, capOk, lenOk });
    }
    emit({ ...base, cap, ml, ...summarizeRanks(set, ranks), answerInsideCap: inCap / set.length, answerInsideMaxLength: inLen / set.length, paddedMax, truncatedPairs, perQuery: per, onnxFiles: onnxFilesIn(cacheDir, args.model) });
  }
  for (const cap of [512, 1024]) for (const chunk of CHUNKS) {
    const ranks = []; let pairs = 0; let paddedMax = 0;
    for (const q of set) {
      const docs = q.notes.map((n) => n.text.slice(0, cap));
      const r = await m.scoreChunked(q.query, docs, chunk, CHUNK_ML);
      pairs += r.pairs; paddedMax = Math.max(paddedMax, r.padded);
      const a = r.scores[q.answerIndex];
      ranks.push(1 + r.scores.filter((s, i) => i !== q.answerIndex && s >= a).length);
    }
    const inCap = set.filter((q) => q.notes[q.answerIndex].end <= cap).length / set.length;
    emit({ ...base, cap, ml: CHUNK_ML, chunk, ...summarizeRanks(set, ranks), answerInsideCap: inCap, meanPairs: pairs / set.length, paddedMax });
  }
  // The same set ranked with every answer sentence kept inside the text
  // (the quality ceiling of the model on this set).
  const ranks = [];
  for (const q of set) {
    const docs = q.notes.map((n, i) => (i === q.answerIndex ? q.answerSentence + ' ' + n.text.slice(0, 900) : n.text.slice(0, 1024)));
    const { scores } = await m.score(q.query, docs, 512);
    const a = scores[q.answerIndex];
    ranks.push(1 + scores.filter((s, i) => i !== q.answerIndex && s >= a).length);
  }
  emit({ ...base, cap: 'answer first', ml: 512, ...summarizeRanks(set, ranks) });
}

// --------------------------------------------------------------- summarize
function modeSummarize() {
  const dir = path.resolve(args.dir);
  const recs = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) for (const line of fs.readFileSync(p, 'utf8').split('\n')) { if (line.trim()) try { recs.push(JSON.parse(line)); } catch { /* skip */ } }
    }
  };
  walk(dir);
  if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(recs, null, 1));
  const cpuShort = (s) => (s ?? '').replace(/\(R\)|\(TM\)| CPU| Processor|\s+\d+-Core/g, '').replace(/ @.*$/, '').trim();
  const wfile = (w) => (w === 'q8avx2' ? 'onnx/model_quint8_avx2.onnx' : 'onnx/model.onnx');
  let md = '';

  const hub = recs.filter((r) => r.type === 'hub');
  if (hub.length) {
    md += '## Model repositories (Hugging Face hub API)\n\n| model | licence tag | ONNX files | revision |\n|---|---|---|---|\n';
    const seen = new Set();
    for (const h of hub) { if (seen.has(h.model)) continue; seen.add(h.model); md += `| ${h.model} | ${(h.licence ?? []).join(', ')} | ${(h.onnx ?? []).join(' ')} | ${(h.sha ?? '').slice(0, 10)} |\n`; }
  }

  const jobs = new Map();
  for (const r of recs) if (r.meta && !jobs.has(r.job)) jobs.set(r.job, r);
  const cpusets = new Map();
  for (const r of recs) if (r.type === 'bench' && r.coreSet) cpusets.set(`${r.job}|${r.coreSet}`, r.cpus);
  md += '\n## Runners\n\n| job | CPU | AVX2 | AVX-512 | CPU sets (1 / 2 logical / 2 physical) | node | transformers | onnxruntime-node |\n|---|---|---|---|---|---|---|---|\n';
  for (const [j, r] of jobs) {
    const m = r.meta;
    const sets = ['c1', 'c2l', 'c2p'].map((c) => cpusets.get(`${j}|${c}`) ?? '-').join(' / ');
    md += `| ${j} | ${m.cpuModel} | ${m.flags?.avx2 ? 'yes' : 'no'} | ${m.flags?.avx512f ? 'yes' : 'no'} | ${sets} | ${m.node} | ${m.transformers} | ${m.onnxruntimeNode} |\n`;
  }

  const loads = recs.filter((r) => r.type === 'load');
  if (loads.length) {
    md += '\n## Loads\n\n| job | model | weights file loaded | files on disk | phase | load ms | RSS after load MB | check rank | inputs |\n|---|---|---|---|---|---|---|---|---|\n';
    for (const r of loads) md += `| ${r.job} | ${shortName(r.model)} | ${(r.files ?? []).filter((f) => f.includes('.onnx')).map((f) => f.replace(/^\w+:/, '')).filter((v, i, a) => a.indexOf(v) === i).join(' ')} | ${(r.onnxFiles ?? []).map((f) => `${f.file} (${f.sizeMB} MB)`).join(', ')} | ${r.phase} | ${r.loadMs} | ${r.rssAfterLoadMB} | ${r.checkRank} | ${(r.inputNames ?? []).join(', ')} |\n`;
  }

  // Speed: expand every planned (N, cap, ml) to the row that timed its feed shape.
  const plans = new Map();
  for (const p of recs.filter((r) => r.type === 'plan')) plans.set(`${p.job}`, p.rows);
  const bench = recs.filter((r) => r.type === 'bench' && r.p95 != null);
  const fails = recs.filter((r) => r.type === 'process-exit' || r.type === 'fatal');
  const key = (r) => `${r.job}|${r.tag}|${r.coreSet}|${r.opts}|${r.N}/${r.cap}/${r.ml}`;
  const byKey = new Map(bench.map((r) => [key(r), r]));
  const speed = [];
  for (const r of bench.filter((b) => b.tag === 'grid')) {
    const rows = plans.get(r.job) ?? [];
    const mine = rows.filter((x) => x.timedAs === `${r.N}/${r.cap}/${r.ml}`);
    for (const x of (mine.length ? mine : [{ N: r.N, cap: r.cap, ml: r.ml, timedAs: `${r.N}/${r.cap}/${r.ml}` }])) speed.push({ ...r, N: x.N, cap: x.cap, ml: x.ml, timedAs: x.timedAs, shared: x.timedAs !== `${x.N}/${x.cap}/${x.ml}` });
  }
  for (const r of bench.filter((b) => b.tag === 'chunk')) speed.push({ ...r, shared: false });
  const coreOrder = { c1: 0, c2l: 1, c2p: 2 };
  const coreLabel = { c1: '1', c2l: '2 logical', c2p: '2 physical' };
  speed.sort((a, b) => a.model.localeCompare(b.model) || a.weights.localeCompare(b.weights) || coreOrder[a.coreSet] - coreOrder[b.coreSet] || a.opts.localeCompare(b.opts) || (a.chunk ?? 0) - (b.chunk ?? 0) || a.N - b.N || a.cap - b.cap || a.ml - b.ml);
  md += '\n## Speed (direct batched; p50/p95/max over 30 timed calls after 3 warm-ups)\n\n';
  md += 'Rows marked `=` share a feed shape (N x padded length) with the row named in "timed as" and carry its timing.\n\n';
  md += '| model | weights file | CPU | cores (CPUs) | session options | N | cap | chunk | pairs | max_length | padded len | p50 ms | p95 ms | max ms | CPU-s/call | threads | load ms | RSS load / peak MB | timed as |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const r of speed) md += `| ${shortName(r.model)} | ${wfile(r.weights)} | ${cpuShort(r.meta?.cpuModel)} | ${coreLabel[r.coreSet]} (${r.cpus}) | ${r.opts} | ${r.N} | ${r.cap} | ${r.chunk ?? '-'} | ${r.pairs ?? r.N} | ${r.ml} | ${r.padded} | ${r.p50} | ${r.p95} | ${r.max} | ${r.cpuSecPerCall} | ${r.threadCount} | ${r.loadMs} | ${r.rssAfterLoadMB} / ${r.rssPeakMB} | ${r.shared ? '= ' + r.timedAs : ''} |\n`;

  const panel = bench.filter((b) => b.tag === 'panel' || b.tag === 'grid');
  const panelRows = bench.filter((b) => b.tag === 'panel');
  if (panelRows.length) {
    md += '\n## Session options panel (same runner, same feed; p95 ms, CPU-s/call)\n\n| model | weights | cores | N/cap/ml | padded | default | threads (intra=cores, inter=1) | threads + spinning off |\n|---|---|---|---|---|---|---|---|\n';
    const groups = new Map();
    for (const r of panel) {
      const g = `${r.job}|${r.coreSet}|${r.N}/${r.cap}/${r.ml}`;
      if (!groups.has(g)) groups.set(g, {});
      groups.get(g)[r.opts] = r;
    }
    for (const [g, o] of groups) {
      if (!o.threads) continue;
      const any = o.threads;
      const cell = (x) => (x ? `${x.p95} (${x.cpuSecPerCall})` : '-');
      md += `| ${shortName(any.model)} | ${any.weights} | ${coreLabel[any.coreSet]} | ${any.N}/${any.cap}/${any.ml} | ${any.padded} | ${cell(o.default)} | ${cell(o.threads)} | ${cell(o['threads-nospin'])} |\n`;
    }
  }

  const anchors = bench.filter((b) => b.tag === 'anchor');
  if (anchors.length) {
    md += '\n## Anchor row per runner (MiniLM-L6, model_quint8_avx2, N 20, cap 1,024, max_length 512, 2 logical cores, default options)\n\n| job | CPU | p50 ms | p95 ms | CPU-s/call |\n|---|---|---|---|---|\n';
    for (const a of anchors) md += `| ${a.job} | ${cpuShort(a.meta?.cpuModel)} | ${a.p50} | ${a.p95} | ${a.cpuSecPerCall} |\n`;
  }

  // Quality.
  const q = recs.filter((r) => r.type === 'quality');
  const baseline = recs.find((r) => r.type === 'quality-baseline');
  const f3 = (m) => (m ? `${m.r1} / ${m.r3} / ${m.mrr}` : '-');
  md += '\n## Quality (60 synthetic queries x 20 notes; recall@1 / recall@3 / MRR)\n\n';
  md += '| model | weights file | cap | chunk | max_length | R@1 | R@3 | MRR | exact | paraphrase | recency | distractor | answer inside cap | answer inside max_length |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  if (baseline) md += `| no rerank (input order) | - | - | - | - | ${baseline.overall.r1} | ${baseline.overall.r3} | ${baseline.overall.mrr} | ${f3(baseline.exact)} | ${f3(baseline.paraphrase)} | ${f3(baseline.recency)} | ${f3(baseline.distractor)} | - | - |\n`;
  q.sort((a, b) => a.model.localeCompare(b.model) || a.weights.localeCompare(b.weights) || (a.chunk ?? 0) - (b.chunk ?? 0) || String(a.cap).localeCompare(String(b.cap)) || a.ml - b.ml);
  for (const r of q) md += `| ${shortName(r.model)} | ${wfile(r.weights)} | ${r.cap} | ${r.chunk ?? '-'} | ${r.ml} | ${r.overall.r1} | ${r.overall.r3} | ${r.overall.mrr} | ${f3(r.exact)} | ${f3(r.paraphrase)} | ${f3(r.recency)} | ${f3(r.distractor)} | ${r.answerInsideCap != null ? Math.round(r.answerInsideCap * 100) + '%' : '-'} | ${r.answerInsideMaxLength != null ? Math.round(r.answerInsideMaxLength * 100) + '%' : '-'} |\n`;

  // Shortlist: speed rows joined with quality at the same (model, weights, cap, ml).
  const qual = new Map(q.filter((r) => typeof r.cap === 'number').map((r) => [`${r.model}|${r.weights}|${r.cap}|${r.ml}|${r.chunk ?? ''}`, r]));
  const short = (coreSet, line) => speed.filter((r) => r.coreSet === coreSet && r.p95 <= line)
    .map((r) => ({ r, qq: qual.get(`${r.model}|${r.weights}|${r.cap}|${r.ml}|${r.chunk ?? ''}`) }))
    .filter((x) => x.qq)
    .sort((a, b) => b.qq.overall.mrr - a.qq.overall.mrr || b.qq.overall.r1 - a.qq.overall.r1 || a.r.p95 - b.r.p95);
  const shortTable = (title, list) => {
    md += `\n## ${title}\n\n| model | weights file | session options | N | cap | chunk | max_length | p95 ms | CPU-s/call | R@1 | R@3 | MRR | CPU |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const { r, qq } of list.slice(0, 40)) md += `| ${shortName(r.model)} | ${wfile(r.weights)} | ${r.opts} | ${r.N} | ${r.cap} | ${r.chunk ?? '-'} | ${r.ml} | ${r.p95} | ${r.cpuSecPerCall} | ${qq.overall.r1} | ${qq.overall.r3} | ${qq.overall.mrr} | ${cpuShort(r.meta?.cpuModel)} |\n`;
  };
  shortTable('Shortlist: p95 <= 300 ms at 2 logical cores, ranked by quality', short('c2l', 300));
  shortTable('Shortlist: p95 <= 800 ms at 1 core, ranked by quality', short('c1', 800));

  if (fails.length) {
    md += '\n## Process failures\n\n';
    for (const f of fails) md += `- ${f.job ?? ''} ${f.args ?? f.mode ?? ''} rc ${f.rc ?? ''} ${(f.error ?? '').split('\n')[0].slice(0, 200)}\n`;
  }
  if (args.md) fs.writeFileSync(path.resolve(args.md), md);
  console.log(md.slice(0, 60000));
}

const main = { hub: modeHub, load: modeLoad, plan: modePlan, bench: modeBench, quality: modeQuality, summarize: modeSummarize }[MODE];
if (!main) { console.error('usage: --mode hub|load|plan|bench|quality|summarize'); process.exit(2); }
try {
  await main();
} catch (e) {
  emit({ type: 'fatal', mode: MODE, job: args.job, model: args.model, weights: args.weights, cores: args.cores, error: String(e?.stack ?? e).slice(0, 2000) });
  process.exitCode = 1;
}
