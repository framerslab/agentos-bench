/**
 * @file resultStoreNRegression.spec.ts
 * @description Regression test for the summary.json N-regression guard.
 *
 * Prevents a recurrence of the Step 8 incident where a Tier A N=24 smoke
 * silently clobbered the canonical N=500 Phase B row in
 * results/summary.json, rendering 25% as the shipping AgentOS number
 * instead of the actual 73.2%.
 *
 * The guard: ResultStore.updateSummary() MUST NOT overwrite an existing
 * summary entry with a run that has FEWER totalCases. Same-or-larger N
 * is allowed (later-in-time wins at the same tier; larger-N always
 * wins over smaller-N).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ResultStore } from '../src/core/ResultStore.js';
import type { BenchResult, RunConfig } from '../src/core/IBenchmark.js';

function buildResult(overrides: {
  totalCases: number;
  accuracy: number;
  startedAt: string;
}): BenchResult {
  const config: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
  };
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config,
    totalCases: overrides.totalCases,
    passedCases: Math.round(overrides.totalCases * overrides.accuracy),
    accuracy: overrides.accuracy,
    avgScore: overrides.accuracy,
    scoreStdDev: 0,
    byType: {},
    avgLatencyMs: 100,
    p50LatencyMs: 80,
    p95LatencyMs: 120,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt: overrides.startedAt,
    completedAt: overrides.startedAt,
  };
}

describe('ResultStore N-regression guard on summary updates', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'result-store-spec-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('blocks a smaller-N run from overwriting a larger-N row', async () => {
    const store = new ResultStore(tmpDir);
    const canonical = buildResult({
      totalCases: 500,
      accuracy: 0.732,
      startedAt: '2026-04-20T20:03:14.675Z',
    });
    const smoke = buildResult({
      totalCases: 24,
      accuracy: 0.25,
      startedAt: '2026-04-21T05:39:41.488Z',
    });

    // Suppress the guard's console.warn so the test output stays clean.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await store.save(canonical, 'external');
    await store.save(smoke, 'external');

    const summary = await store.readSummary();
    const key = 'longmemeval-s|gpt-4o|full-cognitive|ingest';
    const row = summary.latest[key];

    expect(row).toBeDefined();
    expect(row!.totalCases).toBe(500);
    expect(row!.accuracy).toBeCloseTo(0.732);
    expect(row!.startedAt).toBe('2026-04-20T20:03:14.675Z');

    // Both run files should still be on disk — the guard only blocks
    // the summary update, not the per-run persistence.
    const runs = await store.listRuns();
    expect(runs.length).toBe(2);

    // Guard emitted a warning for the blocked update.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('N-regression');

    warnSpy.mockRestore();
  });

  it('allows a larger-N run to overwrite a smaller-N row', async () => {
    const store = new ResultStore(tmpDir);
    const smoke = buildResult({
      totalCases: 24,
      accuracy: 0.875,
      startedAt: '2026-04-20T10:00:00.000Z',
    });
    const phaseB = buildResult({
      totalCases: 500,
      accuracy: 0.732,
      startedAt: '2026-04-20T20:03:14.675Z',
    });

    await store.save(smoke, 'external');
    await store.save(phaseB, 'external');

    const summary = await store.readSummary();
    const row = summary.latest['longmemeval-s|gpt-4o|full-cognitive|ingest'];
    expect(row!.totalCases).toBe(500);
    expect(row!.accuracy).toBeCloseTo(0.732);
  });

  it('allows a same-N re-run to overwrite the row (later-in-time wins)', async () => {
    const store = new ResultStore(tmpDir);
    const first = buildResult({
      totalCases: 500,
      accuracy: 0.700,
      startedAt: '2026-04-15T12:00:00.000Z',
    });
    const second = buildResult({
      totalCases: 500,
      accuracy: 0.732,
      startedAt: '2026-04-20T20:03:14.675Z',
    });

    await store.save(first, 'external');
    await store.save(second, 'external');

    const summary = await store.readSummary();
    const row = summary.latest['longmemeval-s|gpt-4o|full-cognitive|ingest'];
    expect(row!.totalCases).toBe(500);
    expect(row!.accuracy).toBeCloseTo(0.732);
    expect(row!.startedAt).toBe('2026-04-20T20:03:14.675Z');
  });

  it('populates the row on first write (no existing entry)', async () => {
    const store = new ResultStore(tmpDir);
    const first = buildResult({
      totalCases: 24,
      accuracy: 0.875,
      startedAt: '2026-04-20T10:00:00.000Z',
    });

    await store.save(first, 'external');

    const summary = await store.readSummary();
    const row = summary.latest['longmemeval-s|gpt-4o|full-cognitive|ingest'];
    expect(row).toBeDefined();
    expect(row!.totalCases).toBe(24);
  });
});
