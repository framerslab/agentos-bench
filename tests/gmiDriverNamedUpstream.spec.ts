/**
 * @file gmiDriverNamedUpstream.spec.ts
 * @description A run built on `BenchmarkRunner` that names a `gmiUpstream` the environment does not point at. The
 * driver sends where `OPENAI_BASE_URL` points, while the run file and the case-run cache name the run's endpoint, so
 * each case is refused before it sends anything, and nothing is cached under the endpoint the run names.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkRunner } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';
import { gmiUpstreamProblem, resetGmiDriver } from '../src/drivers/gmiDriver.js';
import { LongMemEvalJudge, LongMemEvalS, MockReader } from '../src/index.js';
import { startOpenAiStub, type OpenAiStub } from './helpers/openaiStub.js';

const CASES = [
  {
    question_id: 'named-1',
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
    question_id: 'named-2',
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

/** Every cache file under `dir/<namespace>`. */
function cacheFiles(dir: string, namespace: string): string[] {
  const root = path.join(dir, namespace);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

describe('a run that names an upstream the environment does not point at', () => {
  let tmp: string;
  let dataDir: string;
  let resultsDir: string;
  let stub: OpenAiStub;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-gmi-named-'));
    dataDir = path.join(tmp, 'data');
    resultsDir = path.join(tmp, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'longmemeval', 'longmemeval_s.json'), JSON.stringify(CASES));
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

  it(
    'refuses every case before it sends anything, and caches nothing under the named endpoint',
    async () => {
      const judge = new LongMemEvalJudge({
        reader: new MockReader('gpt-4o').on(
          () => true,
          () => ({ text: 'yes', tokensIn: 0, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
        ),
      });
      const runner = new BenchmarkRunner({ dataDir, resultsDir, judge, scratchRoot: path.join(tmp, 'scratch') });
      const result = await runner.run(new LongMemEvalS({ reader: new MockReader('gpt-4o-mini'), variant: 's' }), {
        reader: 'gpt-4o-mini',
        memoryMode: 'full-cognitive',
        replayMode: 'observe',
        concurrency: 1,
        driver: 'gmi',
        gmiUpstream: 'https://api.openai.com/v1',
      } as RunConfig);

      expect(result.config.gmiUpstream).toBe('https://api.openai.com/v1');
      expect(result.cases).toHaveLength(2);
      for (const c of result.cases) {
        expect(c.error).toMatch(/gmiUpstream/);
        expect(c.error).toContain('https://api.openai.com/v1');
        expect(c.error).toContain(stub.url);
        expect(c.passed).toBe(false);
      }
      // Nothing reached the stub the environment names.
      expect(stub.chat).toEqual([]);
      expect(stub.embeddingCalls).toBe(0);
      // A later run against the named endpoint with the same settings finds nothing to be served.
      const cacheDir = path.join(dataDir, 'cache');
      expect(cacheFiles(cacheDir, 'case-run')).toEqual([]);
      expect(cacheFiles(cacheDir, 'case-result')).toEqual([]);
    },
    120_000,
  );
});

// The run file and the cache key record an endpoint as scheme, host, port and path. A query or fragment on the
// variable is not part of that record, so two URLs that differ only there would share one key while the proxy sent
// to each as written: the driver refuses either, in a dry run and in a live run.
describe('an OPENAI_BASE_URL with a query or a fragment', () => {
  it.each([
    'http://127.0.0.1:4010/v1?tenant=a',
    'http://localhost:4010/v1#a',
    'https://api.openai.com/v1?tenant=a',
  ])('is refused: %s', (url) => {
    expect(gmiUpstreamProblem(url, false)).toMatch(/query or a fragment/);
    expect(gmiUpstreamProblem(url, true)).toMatch(/OPENAI_BASE_URL/);
  });
});
