/**
 * @file computePairedMcNemar.spec.ts
 * @description Regression tests for paired McNemar significance helper.
 * Pins: b/c counts on paired cases, degenerate b+c=0 → p=1 non-significant,
 * unmatched caseId skipping, Yates continuity correction at small b+c,
 * significance declaration at p<0.05 on obvious disparities.
 */

import { describe, it, expect } from 'vitest';
import { computePairedMcNemar } from '../src/core/metrics/computePairedMcNemar.js';
import type { BenchResult, CaseResult } from '../src/core/IBenchmark.js';

function caseOf(caseId: string, pass: 0 | 1): CaseResult {
  return {
    caseId,
    actualOutput: pass ? 'right' : 'wrong',
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    score: pass,
    passed: pass === 1,
  };
}

function build(cases: Array<{ caseId: string; pass: 0 | 1 }>): BenchResult {
  const passed = cases.filter((c) => c.pass === 1).length;
  return {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: '1.0.0',
    config: { reader: 'gpt-4o', memoryMode: 'full-cognitive', replayMode: 'ingest' },
    totalCases: cases.length,
    passedCases: passed,
    accuracy: cases.length > 0 ? passed / cases.length : 0,
    avgScore: cases.length > 0 ? passed / cases.length : 0,
    scoreStdDev: 0,
    byType: {},
    avgLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    totalReaderTokens: 0,
    totalUsd: 0,
    costPerCorrect: 0,
    startedAt: '2026-04-21T00:00:00.000Z',
    completedAt: '2026-04-21T00:00:00.000Z',
    cases: cases.map((c) => caseOf(c.caseId, c.pass)),
  };
}

describe('computePairedMcNemar', () => {
  it('reports b and c correctly on fully-paired cases', () => {
    const a = build([
      { caseId: '1', pass: 1 },
      { caseId: '2', pass: 1 },
      { caseId: '3', pass: 0 },
      { caseId: '4', pass: 0 },
    ]);
    const b = build([
      { caseId: '1', pass: 1 },
      { caseId: '2', pass: 0 },
      { caseId: '3', pass: 1 },
      { caseId: '4', pass: 0 },
    ]);

    const result = computePairedMcNemar(a, b);
    expect(result.totalPaired).toBe(4);
    expect(result.bCount).toBe(1); // case 2: A=correct, B=wrong
    expect(result.cCount).toBe(1); // case 3: A=wrong, B=correct
  });

  it('returns significant=false when bCount+cCount is zero (degenerate)', () => {
    const a = build([{ caseId: '1', pass: 1 }]);
    const b = build([{ caseId: '1', pass: 1 }]);
    const result = computePairedMcNemar(a, b);
    expect(result.bCount).toBe(0);
    expect(result.cCount).toBe(0);
    expect(result.statistic).toBe(0);
    expect(result.pValue).toBe(1);
    expect(result.significant).toBe(false);
  });

  it('skips caseIds not present in both runs', () => {
    const a = build([
      { caseId: '1', pass: 1 },
      { caseId: '2', pass: 1 },
    ]);
    const b = build([
      { caseId: '1', pass: 0 },
      { caseId: '3', pass: 0 },
    ]);
    const result = computePairedMcNemar(a, b);
    expect(result.totalPaired).toBe(1);
  });

  it('applies Yates continuity correction for small b+c', () => {
    // With b=2, c=0: chi2_with_yates = (|2-0|-1)^2 / (2+0) = 1/2 = 0.5
    const a = build([
      { caseId: '1', pass: 1 },
      { caseId: '2', pass: 1 },
    ]);
    const b = build([
      { caseId: '1', pass: 0 },
      { caseId: '2', pass: 0 },
    ]);
    const result = computePairedMcNemar(a, b);
    expect(result.bCount).toBe(2);
    expect(result.cCount).toBe(0);
    expect(result.statistic).toBeCloseTo(0.5, 3);
  });

  it('declares significance at p<0.05 on obvious disparities', () => {
    // b=10, c=0: chi2_with_yates = (|10-0|-1)^2 / 10 = 81/10 = 8.1
    // p(chi2_df=1 > 8.1) < 0.005
    const aCases = Array.from({ length: 10 }, (_, i) => ({ caseId: `${i}`, pass: 1 as const }));
    const bCases = Array.from({ length: 10 }, (_, i) => ({ caseId: `${i}`, pass: 0 as const }));
    const a = build(aCases);
    const b = build(bCases);
    const result = computePairedMcNemar(a, b);
    expect(result.bCount).toBe(10);
    expect(result.cCount).toBe(0);
    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });
});
