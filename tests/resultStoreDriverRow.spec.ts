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
import { renderSweepReport } from '../src/reporting/sweepReport.js';

function buildResult(
  config: RunConfig,
  accuracy: number,
  startedAt: string,
  extra: Partial<BenchResult> = {},
): BenchResult {
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config,
    cases: [],
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
    ...extra,
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

  // Two runs that start in the same millisecond with the same reader and modes write two run files, and each row
  // points at its own.
  it('a driver run and a bench-path run that start together keep a run file each', async () => {
    const store = new ResultStore(tmp);
    const startedAt = '2026-11-03T10:00:00.000Z';
    const benchFile = await store.save(buildResult(BENCH_PATH, 0.5, startedAt), 'external');
    const driverFile = await store.save(buildResult(DRIVER, 1, startedAt), 'external');
    expect(driverFile).not.toBe(benchFile);
    expect(await fs.readdir(path.join(tmp, 'runs'))).toHaveLength(2);
    const { latest } = await store.readSummary();
    for (const entry of Object.values(latest)) {
      const saved = JSON.parse(await fs.readFile(path.join(tmp, entry.runFile), 'utf8')) as BenchResult;
      expect(saved.config.driver).toBe(entry.driver);
      expect(saved.accuracy).toBe(entry.accuracy);
    }
  });

  it('the sweep report names the driver in the champion line, the cells table and the footprint label', async () => {
    const store = new ResultStore(tmp);
    const footprint = {
      meanBrainBytes: 2048,
      p95BrainBytes: 4096,
      meanTraceCount: 10,
      maxPeakWorkingMemorySlots: 7,
      totalEncodeCalls: 20,
    };
    await store.save(buildResult(BENCH_PATH, 0.5, '2026-11-01T10:00:00.000Z'), 'external');
    await store.save(buildResult(DRIVER, 1, '2026-11-02T10:00:00.000Z', { memoryFootprint: footprint }), 'external');

    const report = await fs.readFile(await renderSweepReport({ resultsDir: tmp }), 'utf8');
    // The driver row is the champion here: the headline says so.
    expect(report).toMatch(/\*\*Champion cell \(longmemeval-s\):\*\* gpt-4o \/ full-cognitive \/ observe \/ --driver gmi/);
    const cells = report.split('## All cells')[1]!.split('\n\n## ')[0]!;
    expect(cells).toMatch(/\| Driver \|/);
    const rows = cells.split('\n').filter((line) => line.startsWith('| longmemeval-s'));
    expect(rows).toHaveLength(2);
    expect(rows.find((line) => line.includes('100.0%'))).toMatch(/\| gmi \|/);
    expect(rows.find((line) => line.includes('50.0%'))).not.toMatch(/gmi/);
    expect(report).toContain('Benchmark: `longmemeval-s` — gpt-4o / full-cognitive / observe / --driver gmi');
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
