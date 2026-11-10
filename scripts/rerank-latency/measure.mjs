// Latency bench for local cross-encoder rerankers on a small CPU host.
//
// One process per configuration so CPU limits set with taskset hold for the
// whole run. Every result is appended as one JSON line to --out.
//
// Modes:
//   load      load a model (cold or from cache), check ranking on a fixed set,
//             and record what the runtime did (files loaded, forward passes).
//   bench     time rerank calls over a grid of candidate counts and lengths.
//   summarize read every *.jsonl under --dir, write results.json and Markdown.
//
// Implementations:
//   shipped   LocalCrossEncoderReranker from @framers/agentos, called the way a
//             host calls it (initialize, then rerank).
//   direct    AutoTokenizer + AutoModelForSequenceClassification from
//             @huggingface/transformers, one forward pass over all pairs,
//             scores read from the raw logits.
//
// The script must run from a folder whose node_modules holds both packages.

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
const num = (v, d) => (v === undefined ? d : Number(v));

const KEY_BUDGET_MS = num(process.env.KEY_BUDGET_MS, 90000);
const ROW_BUDGET_MS = num(process.env.ROW_BUDGET_MS, 20000);
const WARM_BUDGET_MS = num(process.env.WARM_BUDGET_MS, 10000);
// A non-key row whose first warm-up call takes longer than this is recorded
// from that one call (the model is already warm from the earlier rows).
const BIG_CALL_MS = num(process.env.BIG_CALL_MS, 8000);
const KEY_MIN_CALLS = num(process.env.KEY_MIN_CALLS, 5);
const TIMED_CALLS = num(process.env.TIMED_CALLS, 30);
const WARM_CALLS = num(process.env.WARM_CALLS, 3);

function emit(rec) {
  const line = JSON.stringify({ ...rec, at: new Date().toISOString() });
  console.log(line.length > 4000 ? line.slice(0, 4000) + '...' : line);
  if (OUT) fs.appendFileSync(OUT, line + '\n');
}

// Capture runtime warnings (for example the dtype default notice).
const warnings = [];
const origWarn = console.warn.bind(console);
console.warn = (...a) => {
  warnings.push(a.map((x) => (typeof x === 'string' ? x : String(x?.message ?? x))).join(' ').slice(0, 500));
  origWarn(...a);
};

const MB = (b) => Math.round((b / 1048576) * 10) / 10;
const rssMB = () => MB(process.memoryUsage().rss);
const maxRssMB = () => MB(process.resourceUsage().maxRSS * 1024);
function vmHwmMB() {
  try {
    const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s+(\d+)\s+kB/);
    return m ? MB(Number(m[1]) * 1024) : null;
  } catch { return null; }
}

// CPU affinity of every thread in this process, grouped: shows whether the
// runtime's worker threads stay inside the limit the process was started with.
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
function cgroupInfo() {
  try {
    const line = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').pop();
    const rel = line.split('::')[1] ?? '';
    let eff = null;
    try { eff = fs.readFileSync(path.join('/sys/fs/cgroup', rel, 'cpuset.cpus.effective'), 'utf8').trim(); } catch { /* none */ }
    return { cgroup: rel, cpusetEffective: eff };
  } catch { return null; }
}

function pkgVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch { return null; }
}

function meta() {
  return {
    cpuModel: os.cpus()[0]?.model ?? null,
    cpusListed: os.cpus().length,
    availableParallelism: os.availableParallelism(),
    ...cgroupInfo(),
    siblings: [0, 1, 2, 3].map((i) => {
      try { return fs.readFileSync(`/sys/devices/system/cpu/cpu${i}/topology/thread_siblings_list`, 'utf8').trim(); } catch { return null; }
    }),
    totalMemMB: MB(os.totalmem()),
    node: process.version,
    agentos: pkgVersion('@framers/agentos'),
    transformers: pkgVersion('@huggingface/transformers'),
    onnxruntimeNode: pkgVersion('onnxruntime-node'),
  };
}

// ------------------------------------------------------------ synthetic text
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
const W = {
  when: ['Last spring', 'On Tuesday', 'Two weeks ago', 'Over the holidays', 'Yesterday morning', 'In early March', 'Last weekend', 'After work on Friday', 'Late in the summer', 'On the first cold day'],
  who: ['my sister', 'my neighbor', 'my manager', 'an old friend from school', 'my cousin', 'the new hire on my team', 'my landlord', 'my brother', 'a coworker from the design team', 'my aunt'],
  act: ['drove to the coast', 'repainted the kitchen', 'adopted a gray kitten', 'started a pottery class', 'reviewed the quarterly budget', 'planned a hiking trip', 'fixed the leaking sink', 'moved the team meeting', 'booked a train to the mountains', 'bought a used bicycle', 'cleaned out the garage', 'tried a new noodle place downtown'],
  detail: ['and it rained the whole time', 'which took longer than expected', 'because the old one broke', 'so we could save some money', 'and the dog would not stop barking', 'while the oven was still warm', 'before the deadline on Thursday', 'after a long call about the schedule', 'even though the shop closed early', 'and nobody remembered the map'],
  note: ['I should remember to call back about the invoice.', 'The receipt is in the blue folder on the desk.', 'Next time pack an extra charger and a rain jacket.', 'The vet said the cat needs a check-up in six months.', 'My manager wants the draft by the end of the month.', 'The hotel near the station had free breakfast.', 'The bike needs new brake pads before winter.', 'We agreed to split the cost of the groceries.', 'The plants on the balcony need water twice a week.', 'The project review moved to the second week of the month.'],
};
const pick = (r, a) => a[Math.floor(r() * a.length)];
function sentence(r) {
  return `${pick(r, W.when)} ${pick(r, W.who)} and I ${pick(r, W.act)} ${pick(r, W.detail)}. ${pick(r, W.note)}`;
}
function makeDoc(r, len) {
  let s = '';
  while (s.length < len) s += (s ? ' ' : '') + sentence(r);
  return s.slice(0, len);
}
function makeDocs(n, len, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => makeDoc(r, len));
}
const BENCH_QUERY = 'Which train did I book for the trip to the mountains, and how much did it cost?';

// Fixed ranking check: exactly one text answers the query.
const CHECK_QUERY = 'What is the name of the clinic where my dog got her vaccines last month?';
const CHECK_ANSWER_INDEX = 13;
const CHECK_TEXTS = [
  'My dog loves the long walk along the river path, especially on cool mornings when the ducks are out.',
  'My sister works night shifts at the city hospital and says the emergency room was packed last month.',
  'I need to buy a new bag of dog food; the brand she likes was out of stock at the corner shop.',
  'Last spring my cousin and I drove to the coast and it rained the whole time, so we stayed in and played cards.',
  'The kitchen repaint took two weekends. The blue paint looked gray under the evening light.',
  'My manager moved the quarterly budget review to Thursday, and the draft slides are due the day before.',
  'I adopted a gray kitten from the shelter in March; she sleeps on the radiator most afternoons.',
  'The pottery class meets on Wednesdays. My first bowl cracked in the kiln but the second one held.',
  'We booked a cabin near the lake for the long weekend and split the cost four ways.',
  'The landlord finally fixed the leaking sink after three reminders and a photo of the puddle.',
  'My neighbor lent me a ladder to clean the gutters; I owe him a loaf of banana bread.',
  'The noodle place downtown has a lunch special on weekdays, and the spicy broth is worth it.',
  'I renewed my library card and borrowed two books about sailing for the trip in the summer.',
  'Last month I took my dog Biscuit for her yearly vaccines at a small clinic called Willow Paws Animal Care, on the corner by the bakery. The visit cost ninety dollars and the next booster is due in the spring.',
  'The bike needs new brake pads before winter; the shop quoted forty dollars including labor.',
  'My brother started a new job at a logistics company and says the commute is shorter now.',
  'The plants on the balcony need water twice a week, more often when the weather turns hot.',
  'A coworker from the design team recommended a podcast about city planning and old train lines.',
  'The hotel near the station had free breakfast and a quiet courtyard with a small fountain.',
  'I cleaned out the garage and found my old camping stove, still working after ten years.',
];

// --------------------------------------------------------- implementations
function xenovaId(id) { return 'Xenova/' + id.split('/').pop(); }

function walkFiles(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else out.push({ file: path.relative(dir, p), sizeMB: MB(fs.statSync(p).size) });
    }
  };
  rec(dir);
  return out;
}

// Wrap an ONNX session's run() to count forward passes and see the feeds.
function instrumentSession(session) {
  const stats = { runs: 0, first: null, firstLogitPerRun: [] };
  const orig = session.run.bind(session);
  session.run = async (feeds, ...rest) => {
    stats.runs++;
    const out = await orig(feeds, ...rest);
    if (out.logits && stats.firstLogitPerRun.length < 64) stats.firstLogitPerRun.push(Number(out.logits.data[0]));
    if (!stats.first) {
      const feedInfo = {};
      for (const [k, t] of Object.entries(feeds)) {
        const data = Array.from(t.data ?? [], (x) => Number(x));
        feedInfo[k] = { dims: t.dims, sum: data.reduce((a, b) => a + b, 0) };
        if (k === 'input_ids') feedInfo[k].head = data.slice(0, 40);
      }
      const logits = out.logits;
      stats.first = {
        feeds: feedInfo,
        logitsDims: logits?.dims ?? null,
        logitsHead: logits ? Array.from(logits.data).slice(0, 8) : null,
      };
    }
    return out;
  };
  return { stats, restore: () => { session.run = orig; } };
}

async function loadTransformers(cacheDir) {
  const T = await import('@huggingface/transformers');
  if (cacheDir) T.env.cacheDir = cacheDir;
  return T;
}

async function makeShipped(cand, cacheDir) {
  const T = await loadTransformers(cacheDir);
  const mod = await import('@framers/agentos/cognition/rag/reranking');
  const reranker = new mod.LocalCrossEncoderReranker({ providerId: 'local', defaultModelId: cand.id });
  const t0 = performance.now();
  await reranker.initialize();
  const loadMs = performance.now() - t0;
  const rerank = async (query, docs) => {
    const res = await reranker.rerank(
      { query, documents: docs.map((c, i) => ({ id: String(i), content: c })) },
      { providerId: 'local', modelId: cand.id },
    );
    return res;
  };
  return { T, reranker, loadMs, rerank, session: () => reranker.pipeline?.model?.sessions?.model };
}

async function makeDirect(cand, cacheDir) {
  const T = await loadTransformers(cacheDir);
  const events = [];
  const progress_callback = (e) => {
    if (e && (e.status === 'initiate' || e.status === 'done' || e.status === 'download')) {
      events.push({ status: e.status, name: e.name, file: e.file });
    }
  };
  const t0 = performance.now();
  const tokenizer = await T.AutoTokenizer.from_pretrained(cand.id, { progress_callback });
  const opts = { dtype: cand.dtype, progress_callback };
  if (cand.model_file_name) opts.model_file_name = cand.model_file_name;
  const model = await T.AutoModelForSequenceClassification.from_pretrained(cand.id, opts);
  const loadMs = performance.now() - t0;
  const score = async (query, docs) => {
    const inputs = tokenizer(new Array(docs.length).fill(query), {
      text_pair: docs, padding: true, truncation: true, max_length: 512,
    });
    const { logits } = await model(inputs);
    const k = logits.dims[1] ?? 1;
    const data = logits.data;
    const scores = [];
    for (let i = 0; i < docs.length; i++) scores.push(Number(k === 1 ? data[i] : data[i * k + 1]));
    return scores;
  };
  return { T, model, tokenizer, loadMs, score, events, session: () => model.sessions?.model };
}

// Candidates per variant, tried in order on the cold load.
function candidates(variant, model) {
  if (variant === 'shipped') return [
    { id: model, note: 'given id' },
    { id: xenovaId(model), note: 'Xenova conversion' },
  ];
  if (variant === 'direct-fp32') return [
    { id: model, dtype: 'fp32', note: 'given id' },
    { id: xenovaId(model), dtype: 'fp32', note: 'Xenova conversion' },
  ];
  if (variant === 'direct-q8') return [
    { id: model, dtype: 'q8', note: 'given id, dtype q8' },
    { id: model, dtype: 'fp32', model_file_name: 'model_quint8_avx2', note: "given id, the repository's own quantized file onnx/model_quint8_avx2.onnx" },
    { id: xenovaId(model), dtype: 'q8', note: 'Xenova conversion, dtype q8' },
  ];
  throw new Error('unknown variant ' + variant);
}

async function build(variant, cand, cacheDir) {
  return variant === 'shipped' ? makeShipped(cand, cacheDir) : makeDirect(cand, cacheDir);
}

// Uniform call: returns scores aligned with the input docs.
async function callScores(variant, impl, query, docs) {
  if (variant === 'shipped') {
    const res = await impl.rerank(query, docs);
    const scores = new Array(docs.length);
    for (const r of res.results) scores[Number(r.id)] = r.relevanceScore;
    return { scores, order: res.results.map((r) => Number(r.id)) };
  }
  const scores = await impl.score(query, docs);
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  return { scores, order };
}

function scoreStats(scores) {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return {
    min, max,
    distinctExact: new Set(scores).size,
    distinct4dp: new Set(scores.map((s) => s.toFixed(4))).size,
  };
}

// --------------------------------------------------------------- mode: load
async function modeLoad() {
  const variant = args.variant;
  const model = args.model;
  const phase = args.phase; // cold | cache
  const cacheRoot = path.resolve(args.cache);
  const chosenFile = path.join(cacheRoot, `chosen-${variant}.json`);
  const base = { type: 'load', variant, model, phase, cores: Number(args.cores), job: args.job, meta: meta() };

  let cands = candidates(variant, model);
  let startIdx = 0;
  if (phase === 'cache') {
    if (!fs.existsSync(chosenFile)) { emit({ ...base, error: 'no candidate loaded in the cold phase' }); return; }
    const chosen = JSON.parse(fs.readFileSync(chosenFile, 'utf8'));
    cands = [chosen.cand];
    startIdx = chosen.idx;
  }

  const attempts = [];
  for (let j = 0; j < cands.length; j++) {
    const cand = cands[j];
    const idx = phase === 'cache' ? startIdx : j;
    const cacheDir = path.join(cacheRoot, `${variant}-c${idx}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    const wStart = warnings.length;
    const rssBefore = rssMB();
    const tImport = performance.now();
    let impl;
    try {
      impl = await build(variant, cand, cacheDir);
    } catch (e) {
      attempts.push({ cand, error: String(e?.stack ?? e).slice(0, 1500), warnings: warnings.slice(wStart) });
      continue;
    }
    const totalMs = performance.now() - tImport;
    const files = walkFiles(cacheDir).filter((f) => !f.file.endsWith('.json') || f.file.includes('config'));
    const onnxFiles = walkFiles(cacheDir).filter((f) => f.file.endsWith('.onnx'));
    if (phase === 'cold') fs.writeFileSync(chosenFile, JSON.stringify({ idx, cand }));

    // Ranking check on the fixed set, with the session instrumented.
    let instrument = null;
    const sess = impl.session?.();
    let inst = null;
    if (sess && typeof sess.run === 'function') inst = instrumentSession(sess);
    let pipeCalls = 0; let pipeSample = null; let restorePipe = null;
    if (variant === 'shipped' && impl.reranker?.pipeline) {
      const origPipe = impl.reranker.pipeline;
      impl.reranker.pipeline = async (...a) => {
        pipeCalls++;
        const r = await origPipe(...a);
        if (!pipeSample) pipeSample = { arg0: typeof a[0] === 'string' ? a[0].slice(0, 300) : JSON.stringify(a[0]).slice(0, 300), options: a[1] ?? null, output: r };
        return r;
      };
      restorePipe = () => { impl.reranker.pipeline = origPipe; };
    }
    let check = null;
    try {
      const { scores, order } = await callScores(variant, impl, CHECK_QUERY, CHECK_TEXTS);
      check = {
        answerRank: order.indexOf(CHECK_ANSWER_INDEX) + 1,
        top3: order.slice(0, 3),
        ...scoreStats(scores),
        scores: scores.map((s) => Number(s.toFixed(6))),
      };
    } catch (e) {
      check = { error: String(e?.stack ?? e).slice(0, 1500) };
    }
    instrument = {
      forwardPassesPerCall: inst ? inst.stats.runs : null,
      // Shipped: one forward pass per document, so these are the raw logits per
      // document in input order, before the pipeline's softmax.
      rawLogitPerForward: inst ? inst.stats.firstLogitPerRun.map((x) => Number(x.toFixed(4))) : null,
      rankFromRawLogits: inst && variant === 'shipped' && inst.stats.firstLogitPerRun.length === CHECK_TEXTS.length
        ? inst.stats.firstLogitPerRun.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]).indexOf(CHECK_ANSWER_INDEX) + 1
        : null,
      firstForward: inst ? inst.stats.first : null,
      pipelineCallsPerRerank: variant === 'shipped' ? pipeCalls : null,
      pipelineSample: pipeSample,
      documents: CHECK_TEXTS.length,
    };
    inst?.restore();
    restorePipe?.();

    emit({
      ...base,
      cand, candIndex: idx, attempts,
      loadMs: Math.round(impl.loadMs), totalMs: Math.round(totalMs),
      rssBeforeMB: rssBefore, rssAfterLoadMB: rssMB(),
      threadsAfterLoad: threadAffinities(),
      onnxFiles, files: impl.events ? [...new Set(impl.events.map((e) => `${e.status}:${e.name}/${e.file}`))] : files.map((f) => f.file),
      warnings: warnings.slice(wStart),
      check, instrument,
    });
    return;
  }
  emit({ ...base, error: 'every candidate failed to load', attempts });
}

// -------------------------------------------------------------- mode: bench
function pct(sorted, p) {
  if (!sorted.length) return null;
  const k = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(k, sorted.length - 1)];
}

async function modeBench() {
  const variant = args.variant;
  const model = args.model;
  const cacheRoot = path.resolve(args.cache);
  const chosenFile = path.join(cacheRoot, `chosen-${variant}.json`);
  const base = { type: 'bench', variant, model, cores: Number(args.cores), job: args.job, tag: args.tag ?? null, meta: meta() };
  if (!fs.existsSync(chosenFile)) { emit({ ...base, error: 'no candidate loaded in the cold phase' }); return; }
  const { idx, cand } = JSON.parse(fs.readFileSync(chosenFile, 'utf8'));
  const cacheDir = path.join(cacheRoot, `${variant}-c${idx}`);
  const impl = await build(variant, cand, cacheDir);
  const rssAfterLoad = rssMB();
  const onnxFiles = walkFiles(cacheDir).filter((f) => f.file.endsWith('.onnx'));

  const shapes = [[20, 1024]];
  if (args.shapes !== 'key') {
    for (const n of [8, 20, 30]) for (const l of [300, 1024, 2000]) if (!(n === 20 && l === 1024)) shapes.push([n, l]);
  }
  let threadsSeen = null;

  for (const [n, l] of shapes) {
    const isKey = n === 20 && l === 1024;
    const docs = makeDocs(n, l, 1000 + n * 7 + l);
    // Warm-up: up to WARM_CALLS, stop early past the warm budget (at least one).
    const warmTimes = [];
    const wStart = performance.now();
    for (let i = 0; i < WARM_CALLS; i++) {
      const t = performance.now();
      await callScores(variant, impl, BENCH_QUERY, docs);
      warmTimes.push(performance.now() - t);
      if (!threadsSeen) threadsSeen = threadAffinities();
      if (performance.now() - wStart > WARM_BUDGET_MS) break;
      if (!isKey && warmTimes[0] > BIG_CALL_MS) break;
    }
    const budget = isKey ? KEY_BUDGET_MS : ROW_BUDGET_MS;
    const minCalls = isKey ? KEY_MIN_CALLS : 1;
    const times = [];
    let cpu0 = process.cpuUsage();
    const tStart = performance.now();
    let rssMax = rssMB();
    let fromWarmCall = false;
    if (!isKey && warmTimes[0] > BIG_CALL_MS) {
      // Re-time the single call so CPU time is measured with it.
      fromWarmCall = true;
      cpu0 = process.cpuUsage();
      const t = performance.now();
      await callScores(variant, impl, BENCH_QUERY, docs);
      times.push(performance.now() - t);
    }
    for (let i = 0; i < TIMED_CALLS && !fromWarmCall; i++) {
      const t = performance.now();
      await callScores(variant, impl, BENCH_QUERY, docs);
      times.push(performance.now() - t);
      rssMax = Math.max(rssMax, rssMB());
      if (times.length >= minCalls && performance.now() - tStart > budget) break;
    }
    const cpu = process.cpuUsage(cpu0);
    const sorted = [...times].sort((a, b) => a - b);
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    emit({
      ...base,
      cand, onnxFiles,
      N: n, L: l, key: isKey,
      warmCalls: warmTimes.length, warmMs: warmTimes.map(r1),
      n: times.length, cutByBudget: times.length < TIMED_CALLS, singleCallRow: fromWarmCall,
      p50: r1(pct(sorted, 50)), p95: r1(pct(sorted, 95)), max: r1(sorted[sorted.length - 1]),
      mean: r1(times.reduce((a, b) => a + b, 0) / times.length),
      cpuSecPerCall: Math.round(((cpu.user + cpu.system) / 1e6 / times.length) * 1000) / 1000,
      threads: threadsSeen,
      rssAfterLoadMB: rssAfterLoad, rssSampledMaxMB: rssMax, rssPeakMB: maxRssMB(), vmHwmMB: vmHwmMB(),
    });
  }
}

// ---------------------------------------------------------- mode: summarize
function modeSummarize() {
  const dir = path.resolve(args.dir);
  const recs = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try { recs.push(JSON.parse(line)); } catch { /* skip */ }
        }
      }
    }
  };
  walk(dir);
  if (args.json) fs.writeFileSync(path.resolve(args.json), JSON.stringify(recs, null, 1));
  const short = (m) => m.split('/').pop();
  const label = (r) => {
    if (r.variant === 'shipped') return 'shipped';
    if (r.tag === 'ref') return 'direct-fp32 (same-runner reference in the shipped job)';
    if (r.tag === 'panel') return `panel: ${r.variant}${r.cand?.model_file_name ? ' (' + r.cand.model_file_name + ')' : ''}${r.cand?.id?.startsWith('Xenova/') ? ' (Xenova)' : ''}`;
    const c = r.cand ?? {};
    return `${r.variant}${c.model_file_name ? ' (' + c.model_file_name + ')' : ''}${c.id && c.id.startsWith('Xenova/') ? ' (Xenova)' : ''}`;
  };
  let md = '';
  const jobs = new Map();
  for (const r of recs) if (r.meta && !jobs.has(r.job)) jobs.set(r.job, r.meta);
  md += '## Runners\n\n| job | CPU | listed CPUs | memory MB | node | agentos | transformers | onnxruntime-node |\n|---|---|---|---|---|---|---|---|\n';
  for (const [j, m] of jobs) md += `| ${j} | ${m.cpuModel} | ${m.cpusListed} | ${m.totalMemMB} | ${m.node} | ${m.agentos} | ${m.transformers} | ${m.onnxruntimeNode} |\n`;

  const bench = recs.filter((r) => r.type === 'bench' && r.N);
  const variants = [...new Set(bench.map(label))];
  for (const v of variants) {
    md += `\n## ${v}\n\n| model | CPU | cores | N | chars | n | p50 ms | p95 ms | max ms | CPU s/call | RSS after load MB | RSS peak MB |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
    const rows = bench.filter((r) => label(r) === v).sort((a, b) =>
      a.model.localeCompare(b.model) || a.cores - b.cores || a.N - b.N || a.L - b.L);
    for (const r of rows) md += `| ${short(r.cand?.id ?? r.model)} | ${(r.meta?.cpuModel ?? '').replace(/ Processor| \d+-Core/g, '')} | ${r.cores} | ${r.N} | ${r.L} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | ${r.cpuSecPerCall} | ${r.rssAfterLoadMB} | ${r.rssPeakMB} |\n`;
  }
  const loads = recs.filter((r) => r.type === 'load');
  md += '\n## Loads and ranking check\n\n| variant | model loaded | file(s) | cores | phase | load ms | RSS after load MB | answer rank (of 20) | score min | score max | distinct scores | forward passes per call | error |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const r of loads.sort((a, b) => a.variant.localeCompare(b.variant) || a.model.localeCompare(b.model) || a.cores - b.cores || a.phase.localeCompare(b.phase))) {
    const c = r.check ?? {};
    const files = (r.onnxFiles ?? []).map((f) => `${f.file} (${f.sizeMB} MB)`).join(', ');
    md += `| ${label(r)} | ${r.cand?.id ?? r.model} | ${files} | ${r.cores} | ${r.phase} | ${r.loadMs ?? ''} | ${r.rssAfterLoadMB ?? ''} | ${c.answerRank ?? ''} | ${c.min ?? ''} | ${c.max ?? ''} | ${c.distinctExact ?? ''} | ${r.instrument?.forwardPassesPerCall ?? ''} | ${(r.error ?? c.error ?? '').toString().slice(0, 120).replace(/\|/g, '/').replace(/\n/g, ' ')} |\n`;
  }
  const failed = loads.flatMap((r) => (r.attempts ?? []).map((a) => ({ v: r.variant, id: a.cand.id, dtype: a.cand.dtype, err: a.error })));
  if (failed.length) {
    md += '\n## Failed load attempts\n\n';
    const seen = new Set();
    for (const f of failed) {
      const k = `${f.v}|${f.id}|${f.dtype}`;
      if (seen.has(k)) continue; seen.add(k);
      md += `- ${f.v} ${f.id} dtype ${f.dtype ?? 'default'}: \`${f.err.split('\n')[0].slice(0, 300)}\`\n`;
    }
  }
  if (args.md) fs.writeFileSync(path.resolve(args.md), md);
  console.log(md);
}

const main = { load: modeLoad, bench: modeBench, summarize: modeSummarize }[MODE];
if (!main) { console.error('usage: --mode load|bench|summarize'); process.exit(2); }
try {
  await main();
} catch (e) {
  emit({ type: 'fatal', mode: MODE, variant: args.variant, model: args.model, cores: Number(args.cores), job: args.job, error: String(e?.stack ?? e).slice(0, 2000) });
  process.exitCode = 1;
}
