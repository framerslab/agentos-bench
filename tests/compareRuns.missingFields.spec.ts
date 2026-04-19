import { describe, it, expect } from 'vitest';
import { compareRuns, formatComparisonMarkdown } from '../src/core/compareRuns.js';
import type { BenchResult } from '../src/core/IBenchmark.js';

/**
 * Build a minimally-valid BenchResult. `overrides` injects or shadows
 * any field, including the optional v2 metric fields.
 */
function baseRun(overrides: Partial<BenchResult> = {}): BenchResult {
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config: { reader: 'gpt-4o', memoryMode: 'full-cognitive', replayMode: 'ingest' },
    totalCases: 10,
    passedCases: 7,
    accuracy: 0.7,
    avgScore: 0.7,
    scoreStdDev: 0.1,
    byType: {},
    avgLatencyMs: 1000,
    p50LatencyMs: 900,
    p95LatencyMs: 1500,
    totalReaderTokens: 10000,
    totalUsd: 0.1,
    costPerCorrect: 0.014,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    cases: [],
    ...overrides,
  };
}

describe('compareRuns v2-field tolerance', () => {
  it('does not throw when both runs lack v2 metric fields', () => {
    expect(() => compareRuns(baseRun(), baseRun({ accuracy: 0.8, passedCases: 8 }))).not.toThrow();
  });

  it('does not throw when one run has retrievalMetrics and the other does not', () => {
    const baseline = baseRun();
    const challenger = baseRun({
      accuracy: 0.8,
      passedCases: 8,
      retrievalMetrics: {
        meanRecallAtK: 0.8,
        meanPrecisionAtK: 0.3,
        meanNdcgAtK: 0.75,
        meanMrr: 0.7,
        k: 10,
        sampleSize: 10,
      },
    });
    expect(() => compareRuns(baseline, challenger)).not.toThrow();
  });

  it('does not throw when one run has stratifiedAccuracy and the other does not', () => {
    const baseline = baseRun();
    const challenger = baseRun({
      stratifiedAccuracy: {
        byType: {},
        weightedOverall: 0.75,
        unweightedOverall: 0.8,
        missingTypes: [],
      },
      accuracy: 0.8,
      passedCases: 8,
    });
    expect(() => compareRuns(baseline, challenger)).not.toThrow();
  });

  it('does not throw when one run has latencyBreakdown and the other does not', () => {
    const baseline = baseRun();
    const challenger = baseRun({
      accuracy: 0.8,
      passedCases: 8,
      latencyBreakdown: {
        encode:       { p50: 10, p95: 20, p99: 30, n: 100 },
        retrieve:     { p50: 50, p95: 100, p99: 200, n: 10 },
        vectorSearch: { p50: 5, p95: 10, p99: 20, n: 10 },
        scoring:      { p50: 2, p95: 5, p99: 10, n: 10 },
        replay:       { p50: 1000, p95: 2000, p99: 3000, n: 10 },
      },
    });
    expect(() => compareRuns(baseline, challenger)).not.toThrow();
  });

  it('formatComparisonMarkdown renders a pre-v2 vs post-v2 pair without errors', () => {
    const baseline = baseRun();
    const challenger = baseRun({
      accuracy: 0.9,
      passedCases: 9,
      retrievalMetrics: {
        meanRecallAtK: 0.8,
        meanPrecisionAtK: 0.3,
        meanNdcgAtK: 0.75,
        meanMrr: 0.7,
        k: 10,
        sampleSize: 10,
      },
      stratifiedAccuracy: {
        byType: {},
        weightedOverall: 0.88,
        unweightedOverall: 0.9,
        missingTypes: [],
      },
    });
    const out = formatComparisonMarkdown(compareRuns(baseline, challenger));
    expect(typeof out).toBe('string');
    expect(out).toContain('comparison');
  });

  it('headline winner still derives from accuracy regardless of v2 fields', () => {
    const baseline = baseRun({ accuracy: 0.7 });
    const challenger = baseRun({ accuracy: 0.9, passedCases: 9 });
    const diff = compareRuns(baseline, challenger);
    expect(diff.winner).toBe('challenger');
    expect(diff.deltaAccuracy).toBeCloseTo(0.2, 6);
  });
});
