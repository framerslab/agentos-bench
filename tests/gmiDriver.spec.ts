/**
 * @file gmiDriver.spec.ts
 * @description `run <benchmark> --driver gmi` end to end with the provider stubbed: the haystack is
 * filed through the agent's own session, only the question reaches the provider, and the case keeps
 * the turn's recall record.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildCli } from '../src/cli.js';
import { BenchmarkRunner, computeCaseRunKeyParts, resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import { readCaseIds } from '../src/core/caseIds.js';
import type { RunConfig } from '../src/core/IBenchmark.js';
import { gmiUpstreamProblem, resetGmiDriver } from '../src/drivers/gmiDriver.js';
import { LongMemEvalJudge, LongMemEvalS, MockReader } from '../src/index.js';
import { startOpenAiStub, type OpenAiStub } from './helpers/openaiStub.js';

/** The installed library's version: the agent answers every driver case, so the cache keys a driver run by it. */
const AGENTOS_VERSION: string = createRequire(import.meta.url)('@framers/agentos/package.json').version;

const CASES = [
  {
    question_id: 'gmi-1',
    question_type: 'single-session-user',
    question: 'What is my coffee order?',
    answer: 'oat flat white',
    question_date: '2026-04-18',
    answer_session_ids: ['s0'],
    haystack_sessions: [
      [
        { role: 'user', content: 'My coffee order is an oat flat white.' },
        { role: 'assistant', content: 'Noted, an oat flat white.' },
      ],
      [
        { role: 'user', content: 'The garden hose needs a new washer.' },
        { role: 'assistant', content: 'A 19 mm washer fits most hoses.' },
      ],
    ],
    haystack_dates: ['2026-04-01', '2026-04-02'],
    haystack_session_ids: ['s0', 's1'],
  },
  {
    question_id: 'gmi-2',
    question_type: 'single-session-assistant',
    question: 'Which ferry did you tell me to take to the island?',
    answer: 'the 7:15 ferry',
    question_date: '2026-04-18',
    haystack_sessions: [
      [
        { role: 'user', content: 'Which ferry should I take to the island on Friday?' },
        { role: 'assistant', content: 'Take the 7:15 ferry to the island; the later one is full.' },
      ],
    ],
    haystack_dates: ['2026-04-03'],
    haystack_session_ids: ['s2'],
  },
];

/** Generous: each case builds an agent, probes its embedder and files its haystack turn by turn. */
const END_TO_END_TIMEOUT_MS = 120_000;

/** The driver's SQLite files under `root`, by name. */
function storeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (/^gmi-.*\.sqlite$/.test(entry.name)) out.push(entry.name);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

describe('run --driver gmi', () => {
  let tmp: string;
  let dataDir: string;
  let resultsDir: string;
  let stub: OpenAiStub;
  /** Runs as a question reaches the provider: the one request of a case the replay proxy forwards. */
  let atQuestion: (() => void) | undefined;
  const saved: Record<string, string | undefined> = {};
  const run = (...extra: string[]) =>
    buildCli().parseAsync([
      'node', 'agentos-bench', 'run', 'longmemeval-s', '--driver', 'gmi', '--reader', 'gpt-4o-mini',
      '--embedder-model', 'text-embedding-3-small', '--concurrency', '1', '--data-dir', dataDir,
      '--results-dir', resultsDir, '--dry-run', ...extra,
    ]);
  const onlyRun = async () => {
    const files = await fs.readdir(path.join(resultsDir, 'runs'));
    expect(files).toHaveLength(1);
    return JSON.parse(await fs.readFile(path.join(resultsDir, 'runs', files[0]!), 'utf8'));
  };
  const captureErrors = async (fn: () => Promise<unknown>): Promise<string> => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => {
      errors.push(a.join(' '));
    };
    try {
      await fn();
    } finally {
      console.error = original;
    }
    return errors.join('\n');
  };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-gmi-'));
    dataDir = path.join(tmp, 'data');
    resultsDir = path.join(tmp, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'longmemeval', 'longmemeval_s.json'), JSON.stringify(CASES));
    atQuestion = undefined;
    stub = await startOpenAiStub((chat) => {
      atQuestion?.();
      return JSON.stringify(chat.body.messages).includes('ferry') ? 'The 7:15 ferry.' : 'An oat flat white.';
    });
    for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'COHERE_API_KEY']) saved[name] = process.env[name];
    process.env.OPENAI_API_KEY = 'stub-upstream-key';
    process.env.OPENAI_BASE_URL = stub.url;
    delete process.env.COHERE_API_KEY;
    process.exitCode = 0;
  });
  afterEach(async () => {
    await resetGmiDriver();
    await stub.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(tmp, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it(
    'files the haystack through the session, sends only the question upstream, and keeps the recall record',
    async () => {
      await run('--budget', '1200');
      const result = await onlyRun();
      expect(result.config.driver).toBe('gmi');
      expect(result.config.gmiUpstream).toBe(stub.url);
      expect(result.cases.map((c: { error?: string }) => c.error)).toEqual([undefined, undefined]);
      expect(result.cases.map((c: { actualOutput: string }) => c.actualOutput)).toEqual([
        'An oat flat white.',
        'The 7:15 ferry.',
      ]);
      // Upstream saw one request per case, the question's, under the real key: every haystack turn was answered by
      // the replay proxy.
      expect(stub.chat).toHaveLength(2);
      for (const seen of stub.chat) expect(seen.authorization).toBe('Bearer stub-upstream-key');
      const [coffee, ferry] = stub.chat.map((seen) => JSON.stringify(seen.body.messages));
      expect(coffee).toContain('oat flat white'); // recalled from the user's own turn
      expect(coffee).toContain('Today is 2026-04-18');
      expect(ferry).toContain('7:15'); // recalled from the dataset's assistant turn, which the proxy replayed
      // The history was cleared after each haystack session: memory is the only source.
      expect(stub.chat[0]!.body.messages.filter((m) => m.role === 'assistant')).toEqual([]);
      // The question offers the model no tool: the date in its text is the only clock it has.
      for (const seen of stub.chat) expect(seen.body.tools ?? []).toEqual([]);
      for (const c of result.cases) {
        expect(c.metadata.driver).toBe('gmi');
        expect(c.metadata.agentosVersion).toBe(AGENTOS_VERSION);
        expect(c.metadata.upstream).toBe(stub.url);
        // The driver records recall in `memoryRecall`, not as retrieved sessions: a case with gold sessions gets no
        // retrieval score rather than a zero.
        expect(c.retrievalMetrics ?? null).toBeNull();
        expect(c.metadata.ingest).toMatchObject({ extraModelRequests: 0 });
        expect(c.metadata.memoryRecall.version).toBe('memory-recall-capture/1');
        expect(c.metadata.memoryRecall.budget.requested).toBe(1200);
        const keys = new Set<string>();
        JSON.parse(JSON.stringify(c.metadata.memoryRecall), (k, v) => {
          keys.add(k);
          return v;
        });
        for (const forbidden of ['content', 'text', 'contextText', 'query']) expect(keys.has(forbidden)).toBe(false);
      }
      expect(result.cases[0].metadata.ingest).toMatchObject({ sessions: 2, userTurns: 2, replayedAssistantTurns: 2 });
      expect(stub.embeddingCalls).toBeGreaterThan(0);
    },
    END_TO_END_TIMEOUT_MS,
  );

  it(
    '--case-ids runs only the listed cases and refuses an id the dataset lacks',
    async () => {
      const ids = path.join(tmp, 'ids.json');
      await fs.writeFile(ids, JSON.stringify({ tuning: ['gmi-2'] }));
      // An `openai:`-prefixed embedder id is the same model as the bare one.
      await run('--case-ids', ids, '--embedder-model', 'openai:text-embedding-3-small');
      const picked = await onlyRun();
      expect(picked.cases.map((c: { caseId: string }) => c.caseId)).toEqual(['gmi-2']);
      expect(picked.cases.map((c: { error?: string }) => c.error)).toEqual([undefined]);
      expect(await readCaseIds(ids)).toEqual(['gmi-2']);
      await fs.writeFile(ids, JSON.stringify(['nope']));
      await expect(run('--case-ids', ids)).rejects.toThrow(/nope/);
    },
    END_TO_END_TIMEOUT_MS,
  );

  it("--case-ids picks the cases of a run on the bench's own path too, in the list's order", async () => {
    const ids = path.join(tmp, 'ids.json');
    await fs.writeFile(ids, JSON.stringify(['gmi-2', 'gmi-1']));
    await buildCli().parseAsync([
      'node', 'agentos-bench', 'run', 'longmemeval-s', '--data-dir', dataDir, '--results-dir', resultsDir,
      '--dry-run', '--case-ids', ids,
    ]);
    const result = await onlyRun();
    expect(result.config.driver).toBeUndefined();
    expect(result.cases.map((c: { caseId: string }) => c.caseId)).toEqual(['gmi-2', 'gmi-1']);
    expect(stub.chat).toEqual([]);
  });

  it(
    '--gmi-store sqlite reaches the agent: the question is answered from what the store recalls',
    async () => {
      await run('--gmi-store', 'sqlite');
      const result = await onlyRun();
      expect(result.config.gmiRecall).toEqual({ store: 'sqlite' });
      expect(result.cases.map((c: { error?: string }) => c.error)).toEqual([undefined, undefined]);
      const [coffee, ferry] = stub.chat.map((seen) => JSON.stringify(seen.body.messages));
      expect(coffee).toContain('oat flat white');
      expect(ferry).toContain('7:15');
      for (const c of result.cases) {
        expect(c.metadata.gmiRecall).toEqual({ store: 'sqlite' });
        expect(c.metadata.ingest).toMatchObject({ extraModelRequests: 0 });
        expect(c.metadata.memoryRecall.version).toBe('memory-recall-capture/1');
      }
    },
    END_TO_END_TIMEOUT_MS,
  );

  // Below the CLI the runner takes a scratch root, so the store's files can be read while a case runs.
  it(
    'a sqlite store is one file per case under the scratch directory, removed when the case ends',
    async () => {
      const scratchRoot = path.join(tmp, 'scratch');
      const atEachQuestion: string[][] = [];
      atQuestion = () => {
        atEachQuestion.push(storeFiles(scratchRoot));
      };
      const judge = new LongMemEvalJudge({
        reader: new MockReader('gpt-4o').on(
          () => true,
          () => ({ text: 'yes', tokensIn: 0, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
        ),
      });
      const runner = new BenchmarkRunner({ dataDir, resultsDir, judge, scratchRoot });
      const result = await runner.run(new LongMemEvalS({ reader: new MockReader('gpt-4o-mini'), variant: 's' }), {
        reader: 'gpt-4o-mini',
        memoryMode: 'full-cognitive',
        replayMode: 'observe',
        concurrency: 1,
        driver: 'gmi',
        gmiRecall: { store: 'sqlite' },
      } as RunConfig);
      expect(result.cases.map((c) => c.error)).toEqual([undefined, undefined]);
      expect(result.cases.map((c) => c.metadata?.upstream)).toEqual([stub.url, stub.url]);
      // At each case's question its own file is the only one: the case before it left none behind.
      expect(atEachQuestion).toHaveLength(2);
      expect(atEachQuestion[0]).toHaveLength(1);
      // The file is named by the case's proxy key, whose random part (128 bits) no other process can guess: the key
      // is what lets a request through the proxy to the provider under the real key.
      expect(atEachQuestion[0]![0]).toMatch(/^gmi-bench-gmi-1-[0-9a-f]{32}\.sqlite$/);
      expect(atEachQuestion[1]).toHaveLength(1);
      expect(atEachQuestion[1]![0]).toMatch(/^gmi-bench-gmi-2-[0-9a-f]{32}\.sqlite$/);
    },
    END_TO_END_TIMEOUT_MS,
  );

  it.each([
    [['--reader', 'claude-sonnet-4-6'], 'gpt-'],
    [['--reader-router', 'min-cost-best-cat-2026-04-28'], '--reader-router'],
    [['--rerank', 'cohere'], '--rerank'],
    [['--hybrid-retrieval'], '--hybrid-retrieval'],
    [['--max-usd', '5'], '--case-ids'],
    // Every option of the bench's own retrieval and reading is refused, not only the ones a list remembered.
    [['--ablate-mechanism', 'reconsolidation'], '--ablate-mechanism'],
    [['--ablate-signal', 'recency'], '--ablate-signal'],
    [['--retrieval-k', '50'], '--retrieval-k'],
    [['--profile', 'max-recall'], '--profile'],
    [['--adaptive', 'off'], '--adaptive'],
    [['--no-abstention'], '--no-abstention'],
    [['--om-reader-scaffold'], '--om-reader-scaffold'],
    [['--memory', 'none'], '--memory'],
    [['--replay', 'ingest'], '--replay'],
    // The agent embeds through OpenAI: another provider's model would fail at the first filed turn.
    [['--embedder-model', 'ollama:nomic-embed-text'], '--embedder-model'],
    [['--embedder-model', 'nomic-embed-text'], '--embedder-model'],
  ])('refuses %j with the driver, naming the flag', async (extra, named) => {
    const errors = await captureErrors(() => run(...extra));
    expect(process.exitCode).toBe(2);
    expect(errors).toContain(named);
    expect(stub.chat).toEqual([]);
  });

  it.each([
    [['--driver', 'react'], '--driver'],
    [['--gmi-store', 'redis'], '--gmi-store'],
    [['--budget', 'many'], 'integer'],
    // A budget of 0 tokens would send an empty memory block for every question.
    [['--budget', '0'], 'positive integer'],
  ])('refuses the value in %j', async (extra, named) => {
    await expect(run(...extra)).rejects.toThrow(named);
    expect(stub.chat).toEqual([]);
  });

  it.each([[['--budget', '800']], [['--gmi-store', 'sqlite']]])('refuses %j without the driver', async (extra) => {
    const errors = await captureErrors(() =>
      buildCli().parseAsync([
        'node', 'agentos-bench', 'run', 'longmemeval-s', '--data-dir', dataDir, '--results-dir', resultsDir,
        '--dry-run', ...extra,
      ]),
    );
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('--driver gmi');
  });

  // The probe's synthesizer calls a provider by a fixed URL, and a dry run calls none. The key is unset here so that
  // a run that is not refused fails before any request leaves the process.
  it.each([
    ['with the driver', ['--driver', 'gmi', '--reader', 'gpt-4o-mini']],
    ["on the bench's own path", []],
  ])('refuses --judge-adversarial in a dry run, %s', async (_label, extra) => {
    delete process.env.OPENAI_API_KEY;
    const errors = await captureErrors(() =>
      buildCli().parseAsync([
        'node', 'agentos-bench', 'run', 'longmemeval-s', '--data-dir', dataDir, '--results-dir', resultsDir,
        '--dry-run', '--judge-adversarial', ...extra,
      ]),
    );
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('--judge-adversarial');
    expect(existsSync(path.join(resultsDir, 'runs'))).toBe(false);
  });

  // The preflight aborts before any request, so this live run never reaches a provider.
  it('the cost preflight counts the cases --case-ids lists, not the whole dataset', async () => {
    const ids = path.join(tmp, 'ids.json');
    await fs.writeFile(ids, JSON.stringify(['gmi-2']));
    const logs: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => {
      logs.push(a.join(' '));
    };
    try {
      await captureErrors(() =>
        buildCli().parseAsync([
          'node', 'agentos-bench', 'run', 'longmemeval-s', '--reader', 'gpt-4o', '--data-dir', dataDir,
          '--results-dir', resultsDir, '--case-ids', ids, '--max-usd', '0.000001',
        ]),
      );
    } finally {
      console.log = original;
    }
    expect(process.exitCode).toBe(1);
    expect(logs.join('\n')).toMatch(/Preflight cost estimate: ~\$[0-9.]+ for 1 cases/);
    expect(stub.chat).toEqual([]);
  });

  it(
    "a second run in the process reaches its own upstream, not the first run's",
    async () => {
      const ids = path.join(tmp, 'ids.json');
      await fs.writeFile(ids, JSON.stringify(['gmi-2']));
      await run('--case-ids', ids);
      const second = await startOpenAiStub(() => 'The 7:15 ferry.');
      try {
        process.env.OPENAI_BASE_URL = second.url;
        await run('--case-ids', ids);
        // Each question went to the stub its run names: the replay proxy of the first run was not reused for it,
        // and the first run's cached answer did not stand in for the second's.
        expect(stub.chat).toHaveLength(1);
        expect(second.chat).toHaveLength(1);
        const files = await fs.readdir(path.join(resultsDir, 'runs'));
        const upstreams = await Promise.all(
          files.map(async (f) => JSON.parse(await fs.readFile(path.join(resultsDir, 'runs', f), 'utf8')).config.gmiUpstream),
        );
        expect(upstreams.sort()).toEqual([stub.url, second.url].sort());
      } finally {
        await second.close();
      }
    },
    END_TO_END_TIMEOUT_MS,
  );

  it('refuses --case-ids on a benchmark other than LongMemEval', async () => {
    const errors = await captureErrors(() =>
      buildCli().parseAsync(['node', 'agentos-bench', 'run', 'locomo', '--dry-run', '--case-ids', path.join(tmp, 'ids.json')]),
    );
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('--case-ids');
  });

  it('refuses a benchmark other than LongMemEval', async () => {
    const errors = await captureErrors(() =>
      buildCli().parseAsync(['node', 'agentos-bench', 'run', 'locomo', '--driver', 'gmi', '--reader', 'gpt-4o-mini', '--dry-run']),
    );
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('LongMemEval only');
  });

  it('refuses a run without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    const errors = await captureErrors(() => run());
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('OPENAI_API_KEY');
    expect(stub.chat).toEqual([]);
  });

  it('a dry run refuses to drive the real provider', async () => {
    delete process.env.OPENAI_BASE_URL;
    const errors = await captureErrors(() => run());
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('OPENAI_BASE_URL');
  });

  // The driver sends a question and its memory block upstream: only the provider it names, or a local stub, may
  // receive them.
  it.each([
    'https://api.cohere.com/compatibility/v1',
    'https://api.cohere.ai/v1',
    'https://llm.example.test/v1',
    'http://10.0.0.7:8080/v1',
  ])('refuses the upstream %s, in a dry run and in a live run', async (url) => {
    expect(gmiUpstreamProblem(url, true)).toMatch(/OPENAI_BASE_URL/);
    expect(gmiUpstreamProblem(url, false)).toMatch(/OPENAI_BASE_URL/);
    process.env.OPENAI_BASE_URL = url;
    const errors = await captureErrors(() => run());
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('OPENAI_BASE_URL');
    expect(stub.chat).toEqual([]);
  });

  it('takes the provider itself in a live run and a loopback stub in either', () => {
    expect(gmiUpstreamProblem('https://api.openai.com/v1', false)).toBeNull();
    expect(gmiUpstreamProblem('https://api.openai.com/v1', true)).toMatch(/stub/);
    expect(gmiUpstreamProblem('http://127.0.0.1:4010/v1', true)).toBeNull();
    expect(gmiUpstreamProblem('http://localhost:4010/v1', false)).toBeNull();
    expect(gmiUpstreamProblem('not a url', false)).toMatch(/OPENAI_BASE_URL/);
  });

  // The key and every filed line travel to the provider: never in the clear.
  it('refuses the provider over plain http', async () => {
    expect(gmiUpstreamProblem('http://api.openai.com/v1', false)).toMatch(/https/);
    process.env.OPENAI_BASE_URL = 'http://api.openai.com/v1';
    const errors = await captureErrors(() => run());
    expect(process.exitCode).toBe(2);
    expect(errors).toContain('OPENAI_BASE_URL');
    expect(stub.chat).toEqual([]);
  });
});

describe('the driver in the case-run cache key', () => {
  const key = { benchmarkId: 'longmemeval-s', benchmarkVersion: '1.0.0', caseId: 'c1', judgeModel: 'gpt-4o', judgeRubricVersion: '1' };
  const base = { reader: 'gpt-4o-mini', memoryMode: 'full-cognitive', replayMode: 'observe' } as RunConfig;
  const parts = (cfg: RunConfig) => computeCaseRunKeyParts(cfg as Parameters<typeof computeCaseRunKeyParts>[0], key);

  it('leaves the bench path key unchanged', () => {
    expect(parts(base).runKeyParts.some((p) => String(p).startsWith('driver:'))).toBe(false);
  });

  it('partitions by driver and by recall settings, in both keys', () => {
    const a = parts({ ...base, driver: 'gmi', gmiRecall: { budgetTokens: 600 } } as RunConfig);
    const b = parts({ ...base, driver: 'gmi', gmiRecall: { budgetTokens: 1600 } } as RunConfig);
    for (const p of [a.runKeyParts, a.resultKeyParts]) {
      expect(p.some((x) => String(x).startsWith('driver:gmi:gmi-driver/1:'))).toBe(true);
    }
    expect(a.runKeyParts).not.toEqual(b.runKeyParts);
    expect(a.resultKeyParts).not.toEqual(b.resultKeyParts);
  });

  // The agent answers every driver case, so an answer cached under one release of the library never serves another.
  it('carries the installed agentos version, in both keys', () => {
    const a = parts({ ...base, driver: 'gmi' } as RunConfig);
    for (const p of [a.runKeyParts, a.resultKeyParts]) {
      expect(p.some((x) => String(x).startsWith('driver:gmi:') && String(x).includes(`:agentos@${AGENTOS_VERSION}:`))).toBe(true);
    }
  });

  // A dry run answers from a stub on this machine; its cached answers must never stand in for a live run's.
  it('partitions by the upstream, so a stub run never answers for a live one', () => {
    const stubRun = parts({ ...base, driver: 'gmi', gmiUpstream: 'http://127.0.0.1:4010/v1' } as RunConfig);
    const liveRun = parts({ ...base, driver: 'gmi', gmiUpstream: 'https://api.openai.com/v1' } as RunConfig);
    expect(stubRun.runKeyParts).not.toEqual(liveRun.runKeyParts);
    expect(stubRun.resultKeyParts).not.toEqual(liveRun.resultKeyParts);
  });

  // Two stubs on one machine are told apart by their ports: one stub's answers never serve a run against the other.
  it('partitions two stubs on one host by port', () => {
    const first = parts({ ...base, driver: 'gmi', gmiUpstream: 'http://127.0.0.1:4010/v1' } as RunConfig);
    const second = parts({ ...base, driver: 'gmi', gmiUpstream: 'http://127.0.0.1:4020/v1' } as RunConfig);
    expect(first.runKeyParts).not.toEqual(second.runKeyParts);
    expect(first.resultKeyParts).not.toEqual(second.resultKeyParts);
  });

  // A run built without the CLI names no upstream: the key reads it where the driver will, from the environment.
  it('reads the upstream from the environment when the run names none', () => {
    const saved = process.env.OPENAI_BASE_URL;
    try {
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:4010/v1/';
      const stubRun = resolveRunConfig({ ...base, driver: 'gmi' } as RunConfig);
      process.env.OPENAI_BASE_URL = 'http://127.0.0.1:4020/v1';
      const otherStubRun = resolveRunConfig({ ...base, driver: 'gmi' } as RunConfig);
      delete process.env.OPENAI_BASE_URL;
      const liveRun = resolveRunConfig({ ...base, driver: 'gmi' } as RunConfig);
      expect(stubRun.gmiUpstream).toBe('http://127.0.0.1:4010/v1');
      expect(otherStubRun.gmiUpstream).toBe('http://127.0.0.1:4020/v1');
      expect(liveRun.gmiUpstream).toBe('https://api.openai.com/v1');
      expect(computeCaseRunKeyParts(stubRun, key).runKeyParts).not.toEqual(computeCaseRunKeyParts(liveRun, key).runKeyParts);
      expect(computeCaseRunKeyParts(stubRun, key).runKeyParts).not.toEqual(computeCaseRunKeyParts(otherStubRun, key).runKeyParts);
      // An upstream the run names stands, and a run on the bench's own path gets none.
      expect(resolveRunConfig({ ...base, driver: 'gmi', gmiUpstream: 'http://localhost:4010/v1' } as RunConfig).gmiUpstream).toBe(
        'http://localhost:4010/v1',
      );
      expect(resolveRunConfig(base).gmiUpstream).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = saved;
    }
  });
});
