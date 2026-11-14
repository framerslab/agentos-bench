/**
 * @file resultStoreDriverRow.spec.ts
 * @description A `--driver gmi` run records `full-cognitive`/`observe`, the same memory and replay modes as a run on
 * the bench's own path. Its summary row is its own, and the leaderboard and `runs` mark it as the driver's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCli } from '../src/cli.js';
import { ResultStore } from '../src/core/ResultStore.js';
import type { BenchResult, RunConfig } from '../src/core/IBenchmark.js';
import { renderLeaderboard } from '../src/reporting/MarkdownLeaderboard.js';

function buildResult(config: RunConfig, accuracy: number, startedAt: string): BenchResult {
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config,
    totalCases: 2,
    passedCases: Math.round(2 * accuracy),
    accuracy,
    avgScore: accuracy,
    scoreStdDev: 0,
    byType: {},
    avgLatencyMs: 100,
    p50LatencyMs: 80,
    p95LatencyMs: 120,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt,
    completedAt: startedAt,
  };
}

const BENCH_PATH: RunConfig = { reader: 'gpt-4o', memoryMode: 'full-cognitive', replayMode: 'observe' };
const DRIVER: RunConfig = { ...BENCH_PATH, driver: 'gmi' };

describe('a driver run in the summary', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'result-store-driver-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('keeps its own row beside a bench-path run with the same modes and as many cases', async () => {
    const store = new ResultStore(tmp);
    await store.save(buildResult(BENCH_PATH, 0.5, '2026-11-01T10:00:00.000Z'), 'external');
    await store.save(buildResult(DRIVER, 1, '2026-11-02T10:00:00.000Z'), 'external');

    const { latest } = await store.readSummary();
    expect(Object.keys(latest).sort()).toEqual([
      'longmemeval-s|gpt-4o|full-cognitive|observe',
      'longmemeval-s|gpt-4o|full-cognitive|observe|gmi',
    ]);
    expect(latest['longmemeval-s|gpt-4o|full-cognitive|observe']!.accuracy).toBe(0.5);
    expect(latest['longmemeval-s|gpt-4o|full-cognitive|observe']!.driver).toBeUndefined();
    expect(latest['longmemeval-s|gpt-4o|full-cognitive|observe|gmi']!.accuracy).toBe(1);
    expect(latest['longmemeval-s|gpt-4o|full-cognitive|observe|gmi']!.driver).toBe('gmi');
  });

  it('the leaderboard and `runs` mark the driver row, and only that row', async () => {
    const store = new ResultStore(tmp);
    await store.save(buildResult(BENCH_PATH, 0.5, '2026-11-01T10:00:00.000Z'), 'external');
    await store.save(buildResult(DRIVER, 1, '2026-11-02T10:00:00.000Z'), 'external');

    const board = await fs.readFile(await renderLeaderboard({ resultsDir: tmp }), 'utf8');
    const ours = board.split('\n').filter((line) => line.startsWith('| AgentOS'));
    expect(ours).toHaveLength(2);
    const driverRow = ours.find((line) => line.includes('100.0%'))!;
    const benchRow = ours.find((line) => line.includes('50.0%'))!;
    expect(driverRow).toContain('--driver gmi');
    expect(benchRow).not.toContain('gmi');

    const lines: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.join(' '));
    };
    try {
      await buildCli().parseAsync(['node', 'agentos-bench', 'runs', '--results-dir', tmp]);
    } finally {
      console.log = original;
    }
    expect(lines[0]).toMatch(/\bdriver\b/);
    const listed = lines.slice(1);
    expect(listed).toHaveLength(2);
    expect(listed.find((line) => line.includes('100.0%'))).toMatch(/\bgmi\b/);
    expect(listed.find((line) => line.includes('50.0%'))).not.toMatch(/\bgmi\b/);
  });

  // Rows saved before the driver was keyed keep their keys: a bench-path row is found where it always was.
  it('a bench-path run keeps the key it always had', async () => {
    const store = new ResultStore(tmp);
    await store.save(buildResult(BENCH_PATH, 0.5, '2026-11-01T10:00:00.000Z'), 'external');
    await store.save(buildResult(BENCH_PATH, 1, '2026-11-02T10:00:00.000Z'), 'external');
    const { latest } = await store.readSummary();
    expect(Object.keys(latest)).toEqual(['longmemeval-s|gpt-4o|full-cognitive|observe']);
    expect(latest['longmemeval-s|gpt-4o|full-cognitive|observe']!.accuracy).toBe(1);
  });
});
