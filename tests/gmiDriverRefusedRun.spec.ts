/**
 * @file gmiDriverRefusedRun.spec.ts
 * @description A driver run the driver would refuse, built on `BenchmarkRunner` without the CLI's checks. The runner
 * refuses it before any case runs, so it writes no run file and no summary row: a run of refused cases scored zero
 * would otherwise replace a real driver row with the same number of cases. Also the read side of the case-result
 * cache: an errored result cached before errored results stopped being cached is scored again, not returned.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkRunner, computeCaseRunKeyParts, resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import { Cache } from '../src/core/Cache.js';
import type { CaseResult, RunConfig } from '../src/core/IBenchmark.js';
import { resetGmiDriver } from '../src/drivers/gmiDriver.js';
import { LongMemEvalJudge, LongMemEvalS, MockReader } from '../src/index.js';
import { startOpenAiStub, type OpenAiStub } from './helpers/openaiStub.js';

const CASES = [
  {
    question_id: 'refused-1',
    question_type: 'single-session-user',
    question: 'What is my coffee order?',
    answer: 'oat flat white',
    question_date: '2026-04-18',
    haystack_sessions: [
      [
        { role: 'user', content: 'My coffee order is an oat flat white.' },
        { role: 'assistant', content: 'Noted, an oat flat white.' },
      ],
    ],
    haystack_dates: ['2026-04-01'],
    haystack_session_ids: ['s0'],
  },
  {
    question_id: 'refused-2',
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
    haystack_session_ids: ['s1'],
  },
];

const PROVIDER = 'https://api.openai.com/v1';
const DRIVER_ROW = 'longmemeval-s|gpt-4o|full-cognitive|observe|gmi';

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

describe('a driver run the driver would refuse', () => {
  let tmp: string;
  let dataDir: string;
  let resultsDir: string;
  let stub: OpenAiStub;
  let summaryBefore: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-gmi-refused-'));
    dataDir = path.join(tmp, 'data');
    resultsDir = path.join(tmp, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'longmemeval', 'longmemeval_s.json'), JSON.stringify(CASES));
    // A real driver run against the provider, on the same two cases, holds the driver's row.
    await fs.mkdir(path.join(resultsDir, 'runs'), { recursive: true });
    summaryBefore = JSON.stringify(
      {
        updatedAt: '2026-11-14T00:00:00.000Z',
        latest: {
          [DRIVER_ROW]: {
            runFile: 'runs/2026-11-14T00-00-00-000--longmemeval-s--gpt-4o--full-cognitive--observe--gmi.json',
            benchmarkId: 'longmemeval-s',
            benchmarkVersion: '1',
            reader: 'gpt-4o',
            memoryMode: 'full-cognitive',
            replayMode: 'observe',
            driver: 'gmi',
            totalCases: 2,
            accuracy: 1,
            avgScore: 1,
            avgLatencyMs: 1000,
            totalUsd: 0.01,
            costPerCorrect: 0.005,
            startedAt: '2026-11-14T00:00:00.000Z',
          },
        },
      },
      null,
      2,
    );
    await fs.writeFile(path.join(resultsDir, 'summary.json'), summaryBefore);
    stub = await startOpenAiStub((chat) =>
      JSON.stringify(chat.body.messages).includes('ferry') ? 'The 7:15 ferry.' : 'An oat flat white.',
    );
    for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL']) saved[name] = process.env[name];
    process.env.OPENAI_API_KEY = 'stub-upstream-key';
    process.env.OPENAI_BASE_URL = stub.url;
  });
  afterEach(async () => {
    await resetGmiDriver();
    await stub.close();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const runner = () =>
    new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({
        reader: new MockReader('gpt-4o').on(
          () => true,
          () => ({ text: 'yes', tokensIn: 0, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
        ),
      }),
      scratchRoot: path.join(tmp, 'scratch'),
    });
  const driverRun = (extra: Partial<RunConfig>) =>
    runner().run(new LongMemEvalS({ reader: new MockReader('gpt-4o'), variant: 's' }), {
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
      concurrency: 1,
      driver: 'gmi',
      ...extra,
    } as RunConfig);

  /** The refused run left the results directory as it found it, cached nothing and sent nothing. */
  const expectNothingRecorded = async () => {
    expect(await fs.readFile(path.join(resultsDir, 'summary.json'), 'utf8')).toBe(summaryBefore);
    expect(filesUnder(resultsDir)).toEqual(['summary.json']);
    expect(filesUnder(path.join(dataDir, 'cache', 'case-run'))).toEqual([]);
    expect(filesUnder(path.join(dataDir, 'cache', 'case-result'))).toEqual([]);
    expect(stub.chat).toEqual([]);
    expect(stub.embeddingCalls).toBe(0);
  };

  it(
    'naming a gmiUpstream the environment does not give: refused, no run file, the driver row kept',
    async () => {
      await expect(driverRun({ gmiUpstream: PROVIDER })).rejects.toThrow(
        new RegExp(`gmiUpstream '${PROVIDER}'.*OPENAI_BASE_URL gives '${stub.url}'`),
      );
      await expectNothingRecorded();
    },
    120_000,
  );

  it(
    'with no OPENAI_API_KEY: refused, no run file, the driver row kept',
    async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(driverRun({})).rejects.toThrow(/--driver gmi: OPENAI_API_KEY is not set/);
      await expectNothingRecorded();
    },
    120_000,
  );

  it(
    'with an embedder that is not OpenAI: refused, no run file, the driver row kept',
    async () => {
      await expect(driverRun({ embedderModel: 'cohere:embed-english-v3.0' })).rejects.toThrow(
        /--driver gmi: --embedder-model must be an OpenAI embedding model/,
      );
      await expectNothingRecorded();
    },
    120_000,
  );

  it(
    'with an OPENAI_BASE_URL the driver will not send to: refused, no run file, the driver row kept',
    async () => {
      process.env.OPENAI_BASE_URL = `${stub.url}?tenant=a`;
      await expect(driverRun({})).rejects.toThrow(/--driver gmi: OPENAI_BASE_URL must not carry a query or a fragment/);
      await expectNothingRecorded();
    },
    120_000,
  );

  // The cache answers a case under the endpoint the run names without sending (gmiDriverNamedUpstream.spec.ts): a run
  // the cache answers in part is still refused whole, since the rest would be refused cases scored zero.
  it(
    'naming an endpoint the cache answers for only some of the cases: refused, nothing sent for the rest',
    async () => {
      const first = await driverRun({ gmiUpstream: stub.url, sampleN: 1 });
      expect(first.cases.map((c) => c.error)).toEqual([undefined]);
      expect(stub.chat).toHaveLength(1);
      const summaryAfterFirst = await fs.readFile(path.join(resultsDir, 'summary.json'), 'utf8');
      const filesAfterFirst = filesUnder(resultsDir);

      const other = await startOpenAiStub(() => 'An answer the named endpoint never gave.');
      try {
        process.env.OPENAI_BASE_URL = other.url;
        await expect(driverRun({ gmiUpstream: stub.url })).rejects.toThrow(/gmiUpstream/);
        expect(other.chat).toEqual([]);
        expect(other.embeddingCalls).toBe(0);
      } finally {
        await other.close();
      }
      expect(stub.chat).toHaveLength(1);
      expect(await fs.readFile(path.join(resultsDir, 'summary.json'), 'utf8')).toBe(summaryAfterFirst);
      expect(filesUnder(resultsDir)).toEqual(filesAfterFirst);
    },
    120_000,
  );

  // An errored run is scored zero and not cached. A cache written before that holds such zeros: the runner scores the
  // case again rather than return one, so the case's next successful run is judged.
  it(
    'scores a case again when the case-result cache holds an errored result for it',
    async () => {
      const config = {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'observe',
        concurrency: 1,
        driver: 'gmi',
        gmiUpstream: stub.url,
        sampleN: 1,
      } as RunConfig;
      const judge = new LongMemEvalJudge({
        reader: new MockReader('gpt-4o').on(
          () => true,
          () => ({ text: 'yes', tokensIn: 0, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
        ),
      });
      const benchmark = new LongMemEvalS({ reader: new MockReader('gpt-4o'), variant: 's' });
      const { resultKeyParts } = computeCaseRunKeyParts(resolveRunConfig(config), {
        benchmarkId: benchmark.id,
        benchmarkVersion: benchmark.version,
        caseId: 'refused-1',
        judgeModel: judge.model,
        judgeRubricVersion: judge.rubricVersion,
      });
      const cache = new Cache(path.join(dataDir, 'cache'));
      const errored: CaseResult = {
        caseId: 'refused-1',
        actualOutput: '',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        usd: 0,
        error: 'x',
        score: 0,
        passed: false,
      };
      await cache.set('case-result', errored, ...resultKeyParts);

      const result = await new BenchmarkRunner({ dataDir, resultsDir, judge, scratchRoot: path.join(tmp, 'scratch') }).run(
        benchmark,
        config,
      );

      expect(stub.chat).toHaveLength(1);
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0]!.error).toBeUndefined();
      expect(result.cases[0]!.actualOutput).toBe('An oat flat white.');
      expect(result.cases[0]!.passed).toBe(true);
      expect(result.cases[0]!.score).toBe(1);
      // The judged result replaces the errored one in the cache.
      expect((await cache.get<CaseResult>('case-result', ...resultKeyParts))?.error).toBeUndefined();
    },
    120_000,
  );
});
