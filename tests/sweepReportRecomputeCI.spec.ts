import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recomputeCIsForResultsDir } from '../src/reporting/sweepReport.js';
import type { BenchResult } from '../src/core/IBenchmark.js';

function mkResult(passedFractions: number[], type: string): BenchResult {
  const cases = passedFractions.map((p, i) => ({
    caseId: `c-${i}`,
    actualOutput: '',
    latencyMs: 1,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    score: p,
    passed: p >= 0.5,
    metadata: { caseType: type },
  }));
  return {
    benchmarkId: 'test',
    benchmarkVersion: '1.0.0',
    config: { reader: 'gpt-4o', memoryMode: 'none', replayMode: 'ingest' },
    totalCases: cases.length,
    passedCases: cases.filter((c) => c.passed).length,
    accuracy: cases.filter((c) => c.passed).length / cases.length,
    avgScore: 0,
    scoreStdDev: 0,
    byType: { [type]: { n: cases.length, accuracy: 0.5, avgScore: 0.5 } },
    avgLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt: '',
    completedAt: '',
    cases,
  };
}

describe('recomputeCIsForResultsDir', () => {
  let resultsDir: string;
  beforeEach(async () => {
    resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'results-recompute-'));
    await fs.mkdir(path.join(resultsDir, 'runs'), { recursive: true });
  });

  it('updates each run JSON with bootstrap CIs in-place', async () => {
    const result = mkResult([1, 1, 1, 0, 1, 0, 1, 1, 1, 0], 'typeA');
    const runPath = path.join(resultsDir, 'runs', 'run-001.json');
    await fs.writeFile(runPath, JSON.stringify(result), 'utf8');

    const touched = await recomputeCIsForResultsDir(resultsDir, {
      seed: 7,
      resamples: 500,
    });
    expect(touched).toBe(1);

    const updated: BenchResult = JSON.parse(await fs.readFile(runPath, 'utf8'));
    expect(updated.accuracyCI).toBeDefined();
    expect(updated.accuracyCI!.value).toBeCloseTo(0.7, 2);
    expect(updated.byTypeCI).toBeDefined();
    expect(updated.byTypeCI!.typeA).toBeDefined();
  });

  it('is idempotent when run twice', async () => {
    const result = mkResult([1, 0, 1, 1, 0, 1], 'typeA');
    const runPath = path.join(resultsDir, 'runs', 'run-002.json');
    await fs.writeFile(runPath, JSON.stringify(result), 'utf8');

    await recomputeCIsForResultsDir(resultsDir, { seed: 1, resamples: 500 });
    const first: BenchResult = JSON.parse(await fs.readFile(runPath, 'utf8'));
    await recomputeCIsForResultsDir(resultsDir, { seed: 1, resamples: 500 });
    const second: BenchResult = JSON.parse(await fs.readFile(runPath, 'utf8'));

    expect(first.accuracyCI!.ciLo).toBeCloseTo(second.accuracyCI!.ciLo, 10);
    expect(first.accuracyCI!.ciHi).toBeCloseTo(second.accuracyCI!.ciHi, 10);
  });

  it('returns 0 when runs directory is empty', async () => {
    const touched = await recomputeCIsForResultsDir(resultsDir);
    expect(touched).toBe(0);
  });
});
