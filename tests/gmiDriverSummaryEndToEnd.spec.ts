/**
 * @file gmiDriverSummaryEndToEnd.spec.ts
 * @description `run longmemeval-s` on the bench's own path and `run longmemeval-s --driver gmi`, both through the CLI
 * into one results directory, with the provider stubbed. The two runs record the same reader, memory mode and replay
 * mode, so only the driver tells their summary rows apart: `summary.json` keeps one row each, and `leaderboard` and
 * `runs` built from that directory mark the driver's row and only that row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCli } from '../src/cli.js';
import type { BenchResult } from '../src/core/IBenchmark.js';
import { ResultStore } from '../src/core/ResultStore.js';
import { resetGmiDriver } from '../src/drivers/gmiDriver.js';
import { startOpenAiStub, type OpenAiStub } from './helpers/openaiStub.js';

const CASES = [
  {
    question_id: 'row-1',
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
    question_id: 'row-2',
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

const BENCH_KEY = 'longmemeval-s|gpt-4o-mini|full-cognitive|observe';
const DRIVER_KEY = `${BENCH_KEY}|gmi`;

describe('a bench-path run and a driver run saved into one results directory', () => {
  let tmp: string;
  let dataDir: string;
  let resultsDir: string;
  let stub: OpenAiStub;
  const saved: Record<string, string | undefined> = {};

  const cli = (...args: string[]) => buildCli().parseAsync(['node', 'agentos-bench', ...args]);
  const captureLog = async (fn: () => Promise<unknown>): Promise<string[]> => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.join(' '));
    };
    try {
      await fn();
    } finally {
      console.log = original;
    }
    return lines;
  };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-gmi-rows-'));
    dataDir = path.join(tmp, 'data');
    resultsDir = path.join(tmp, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'longmemeval', 'longmemeval_s.json'), JSON.stringify(CASES));
    stub = await startOpenAiStub((chat) =>
      JSON.stringify(chat.body.messages).includes('ferry') ? 'The 7:15 ferry.' : 'An oat flat white.',
    );
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
    'keeps two summary rows and two run files, and the leaderboard and `runs` mark only the driver row',
    async () => {
      // The bench's own path, in a dry run: the mock reader answers and nothing reaches the stub.
      await cli(
        'run', 'longmemeval-s', '--reader', 'gpt-4o-mini', '--memory', 'full-cognitive', '--replay', 'observe',
        '--concurrency', '1', '--data-dir', dataDir, '--results-dir', resultsDir, '--dry-run',
      );
      expect(stub.chat).toEqual([]);
      // The driver, in a dry run against the stub: the agent answers each question through it.
      await cli(
        'run', 'longmemeval-s', '--driver', 'gmi', '--reader', 'gpt-4o-mini', '--embedder-model',
        'text-embedding-3-small', '--concurrency', '1', '--data-dir', dataDir, '--results-dir', resultsDir, '--dry-run',
      );
      expect(process.exitCode).toBe(0);
      expect(stub.chat).toHaveLength(2);

      // Two run files, one a run: the driver's name ends in its driver, the bench path's does not.
      const runFiles = (await fs.readdir(path.join(resultsDir, 'runs'))).sort();
      expect(runFiles).toHaveLength(2);
      expect(runFiles.filter((f) => f.endsWith('--gmi.json'))).toHaveLength(1);

      const { latest } = await new ResultStore(resultsDir).readSummary();
      expect(Object.keys(latest).sort()).toEqual([BENCH_KEY, DRIVER_KEY]);
      expect(latest[BENCH_KEY]!.driver).toBeUndefined();
      expect(latest[DRIVER_KEY]!.driver).toBe('gmi');
      // Each row points at its own run, and that run is the one its key names.
      for (const [key, entry] of Object.entries(latest)) {
        const run = JSON.parse(await fs.readFile(path.join(resultsDir, entry.runFile), 'utf8')) as BenchResult;
        expect(run.config.driver).toBe(key === DRIVER_KEY ? 'gmi' : undefined);
        expect(run.config.memoryMode).toBe('full-cognitive');
        expect(run.config.replayMode).toBe('observe');
        expect(run.cases.map((c) => c.error)).toEqual([undefined, undefined]);
      }
      expect(latest[DRIVER_KEY]!.runFile).not.toBe(latest[BENCH_KEY]!.runFile);

      // `leaderboard`, as a person runs it, over that directory.
      await captureLog(() => cli('leaderboard', '--results-dir', resultsDir));
      const board = await fs.readFile(path.join(resultsDir, 'LEADERBOARD.md'), 'utf8');
      const ours = board.split('\n').filter((line) => line.startsWith('| AgentOS'));
      expect(ours).toHaveLength(2);
      expect(ours.filter((line) => line.includes('--driver gmi'))).toHaveLength(1);
      expect(ours.filter((line) => !line.includes('gmi'))).toHaveLength(1);

      // `runs` lists both, with the driver in its own column on the driver's row alone.
      const listed = await captureLog(() => cli('runs', '--results-dir', resultsDir));
      expect(listed[0]).toMatch(/\bdriver\b/);
      const rows = listed.slice(1);
      expect(rows).toHaveLength(2);
      expect(rows.filter((line) => /\bgmi\b/.test(line))).toHaveLength(1);
      expect(rows.find((line) => /\bgmi\b/.test(line))).toContain('--gmi.json');
    },
    120_000,
  );
});
