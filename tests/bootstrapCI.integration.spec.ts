import { describe, it, expect } from 'vitest';
import { attachBootstrapCIs } from '../src/core/BenchmarkRunner.js';
import type { CaseResult, BenchResult } from '../src/core/IBenchmark.js';

function mkCase(passed: boolean, type: string): CaseResult {
  return {
    caseId: `c-${Math.random().toString(36).slice(2, 8)}`,
    actualOutput: 'x',
    latencyMs: 1,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    score: passed ? 1 : 0,
    passed,
    metadata: { caseType: type },
  };
}

describe('attachBootstrapCIs', () => {
  it('attaches accuracy CI to a BenchResult', () => {
    const cases: CaseResult[] = [
      ...Array.from({ length: 8 }, () => mkCase(true, 'typeA')),
      ...Array.from({ length: 2 }, () => mkCase(false, 'typeA')),
      ...Array.from({ length: 6 }, () => mkCase(true, 'typeB')),
      ...Array.from({ length: 4 }, () => mkCase(false, 'typeB')),
    ];
    const base: BenchResult = {
      benchmarkId: 'test',
      benchmarkVersion: '1.0.0',
      config: { reader: 'gpt-4o', memoryMode: 'none', replayMode: 'ingest' },
      totalCases: cases.length,
      passedCases: cases.filter((c) => c.passed).length,
      accuracy: cases.filter((c) => c.passed).length / cases.length,
      avgScore: 0,
      scoreStdDev: 0,
      byType: {
        typeA: { n: 10, accuracy: 0.8, avgScore: 0.8 },
        typeB: { n: 10, accuracy: 0.6, avgScore: 0.6 },
      },
      avgLatencyMs: 1,
      p50LatencyMs: 1,
      p95LatencyMs: 1,
      totalReaderTokens: 0,
      totalUsd: 0,
      costPerCorrect: 0,
      startedAt: '',
      completedAt: '',
      cases,
    };
    const out = attachBootstrapCIs(base, { seed: 42, resamples: 500 });
    expect(out.accuracyCI).toBeDefined();
    expect(out.accuracyCI!.value).toBeCloseTo(0.7, 2);
    expect(out.accuracyCI!.ciLo).toBeLessThanOrEqual(0.7);
    expect(out.accuracyCI!.ciHi).toBeGreaterThanOrEqual(0.7);
    expect(out.byTypeCI).toBeDefined();
    expect(out.byTypeCI!.typeA.value).toBeCloseTo(0.8, 2);
    expect(out.byTypeCI!.typeB.value).toBeCloseTo(0.6, 2);
  });

  it('attaches weighted accuracy CI when stratifiedAccuracy is present', () => {
    const cases: CaseResult[] = [
      ...Array.from({ length: 5 }, () => mkCase(true, 'typeA')),
      ...Array.from({ length: 5 }, () => mkCase(false, 'typeA')),
    ];
    const base: BenchResult = {
      benchmarkId: 'test',
      benchmarkVersion: '1.0.0',
      config: { reader: 'gpt-4o', memoryMode: 'none', replayMode: 'ingest' },
      totalCases: 10,
      passedCases: 5,
      accuracy: 0.5,
      avgScore: 0,
      scoreStdDev: 0,
      byType: { typeA: { n: 10, accuracy: 0.5, avgScore: 0.5 } },
      avgLatencyMs: 1,
      p50LatencyMs: 1,
      p95LatencyMs: 1,
      totalReaderTokens: 0,
      totalUsd: 0,
      costPerCorrect: 0,
      startedAt: '',
      completedAt: '',
      stratifiedAccuracy: {
        byType: { typeA: { n: 10, accuracy: 0.5, prior: 1 } },
        weightedOverall: 0.5,
        unweightedOverall: 0.5,
        missingTypes: [],
      },
      cases,
    };
    const out = attachBootstrapCIs(base, { seed: 42, resamples: 500 });
    expect(out.weightedAccuracyCI).toBeDefined();
    expect(out.weightedAccuracyCI!.value).toBeCloseTo(0.5, 2);
  });

  it('is deterministic with the same seed', () => {
    const cases: CaseResult[] = Array.from({ length: 20 }, (_, i) =>
      mkCase(i % 3 !== 0, i < 10 ? 'typeA' : 'typeB'),
    );
    const base: BenchResult = {
      benchmarkId: 't',
      benchmarkVersion: '1',
      config: { reader: 'gpt-4o', memoryMode: 'none', replayMode: 'ingest' },
      totalCases: 20,
      passedCases: cases.filter((c) => c.passed).length,
      accuracy: cases.filter((c) => c.passed).length / 20,
      avgScore: 0,
      scoreStdDev: 0,
      byType: {},
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
    const a = attachBootstrapCIs(base, { seed: 999, resamples: 1000 });
    const b = attachBootstrapCIs(base, { seed: 999, resamples: 1000 });
    expect(a.accuracyCI!.ciLo).toBeCloseTo(b.accuracyCI!.ciLo, 10);
    expect(a.accuracyCI!.ciHi).toBeCloseTo(b.accuracyCI!.ciHi, 10);
  });
});
