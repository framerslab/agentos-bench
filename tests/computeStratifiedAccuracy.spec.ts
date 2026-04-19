import { describe, it, expect } from 'vitest';
import {
  computeStratifiedAccuracy,
  LONGMEMEVAL_S_PRIORS,
} from '../src/core/metrics/computeStratifiedAccuracy.js';
import type { CaseResult } from '../src/core/IBenchmark.js';

function mkResult(type: string, passed: boolean, score = passed ? 1 : 0): CaseResult {
  return {
    caseId: `c-${Math.random().toString(36).slice(2, 8)}`,
    actualOutput: '',
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    metadata: { caseType: type },
    score,
    passed,
  };
}

describe('LONGMEMEVAL_S_PRIORS', () => {
  it('sums to 1.0 within tolerance', () => {
    const sum = Object.values(LONGMEMEVAL_S_PRIORS).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });

  it('contains all six LongMemEval-S case types', () => {
    expect(Object.keys(LONGMEMEVAL_S_PRIORS).sort()).toEqual([
      'knowledge-update',
      'multi-session',
      'single-session-assistant',
      'single-session-preference',
      'single-session-user',
      'temporal-reasoning',
    ]);
  });
});

describe('computeStratifiedAccuracy', () => {
  it('produces unweightedOverall = passedCases/totalCases', () => {
    const results = [
      mkResult('multi-session', true),
      mkResult('multi-session', false),
      mkResult('temporal-reasoning', true),
    ];
    const out = computeStratifiedAccuracy(results, LONGMEMEVAL_S_PRIORS);
    expect(out.unweightedOverall).toBeCloseTo(2 / 3, 6);
  });

  it('re-normalizes priors over present types only', () => {
    // Only multi-session (0.266) and temporal-reasoning (0.266) are present.
    // Re-normalized: each = 0.5. Both at 100% accuracy → weighted = 1.0.
    const results = [
      mkResult('multi-session', true),
      mkResult('temporal-reasoning', true),
    ];
    const out = computeStratifiedAccuracy(results, LONGMEMEVAL_S_PRIORS);
    expect(out.weightedOverall).toBeCloseTo(1.0, 6);
  });

  it('weightedOverall differs from unweightedOverall when per-type accuracy diverges', () => {
    // multi-session (prior 0.266): 0% (fail)
    // single-session-user (prior 0.140): 100% (pass)
    // Re-normalized priors over present types: multi=0.655, ssu=0.345
    // Weighted = 0.655*0 + 0.345*1 = 0.345
    // Unweighted = 1/2 = 0.5
    const results = [mkResult('multi-session', false), mkResult('single-session-user', true)];
    const out = computeStratifiedAccuracy(results, LONGMEMEVAL_S_PRIORS);
    expect(out.unweightedOverall).toBeCloseTo(0.5, 6);
    expect(out.weightedOverall).toBeCloseTo(0.345, 3);
  });

  it('reports missingTypes (priors types absent from run)', () => {
    const results = [mkResult('multi-session', true)];
    const out = computeStratifiedAccuracy(results, LONGMEMEVAL_S_PRIORS);
    expect(out.missingTypes.sort()).toEqual([
      'knowledge-update',
      'single-session-assistant',
      'single-session-preference',
      'single-session-user',
      'temporal-reasoning',
    ]);
  });

  it('defaults to equal-weight when priors argument is an empty object', () => {
    const results = [mkResult('a', true), mkResult('b', false), mkResult('c', true)];
    const out = computeStratifiedAccuracy(results, {});
    expect(out.weightedOverall).toBeCloseTo(out.unweightedOverall, 6);
  });

  it('returns all-zero output for empty input', () => {
    const out = computeStratifiedAccuracy([], LONGMEMEVAL_S_PRIORS);
    expect(out.unweightedOverall).toBe(0);
    expect(out.weightedOverall).toBe(0);
    expect(out.byType).toEqual({});
  });
});
