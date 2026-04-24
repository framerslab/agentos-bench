import { describe, it, expect } from 'vitest';
import { computePolicyRouterStats } from '../src/core/metrics/computePolicyRouterStats.js';
import {
  DEFAULT_BACKEND_COSTS,
  MAXIMIZE_ACCURACY_TABLE,
  type PolicyRouterDecision,
} from '../src/core/policyRouter.js';
import type { CaseResult } from '../src/core/IBenchmark.js';

function mkCase(
  caseId: string,
  decision: PolicyRouterDecision | undefined,
  passed: boolean,
): CaseResult {
  return {
    caseId,
    actualOutput: 'x',
    expectedOutput: 'y',
    score: passed ? 1 : 0,
    passed,
    latencyMs: 1000,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0.01,
    metadata: decision ? { policyRouterDecision: decision } : {},
  } as unknown as CaseResult;
}

function mkDecision(
  predictedCategory: PolicyRouterDecision['predictedCategory'],
  groundTruthCategory: PolicyRouterDecision['groundTruthCategory'],
  chosenBackend: PolicyRouterDecision['chosenBackend'],
  budgetExceeded = false,
): PolicyRouterDecision {
  return {
    predictedCategory,
    groundTruthCategory,
    chosenBackend,
    chosenBackendReason: 'test',
    estimatedCostUsd: 0.03,
    budgetCeiling: null,
    budgetExceeded,
    preset: 'maximize-accuracy',
  };
}

describe('computePolicyRouterStats', () => {
  it('returns null when no cases have a decision', () => {
    const result = computePolicyRouterStats({
      cases: [mkCase('a', undefined, false)],
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result).toBe(null);
  });

  it('computes per-backend hit rate over 3 decisions', () => {
    const cases = [
      mkCase('c1', mkDecision('single-session-assistant', 'single-session-assistant', 'tier_1_canonical'), true),
      mkCase('c2', mkDecision('multi-session', 'multi-session', 'tier_2b_v11'), true),
      mkCase('c3', mkDecision('multi-session', 'multi-session', 'tier_2b_v11'), false),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result).not.toBe(null);
    expect(result!.perBackendHitRate.tier_1_canonical).toBeCloseTo(1 / 3, 4);
    expect(result!.perBackendHitRate.tier_2b_v11).toBeCloseTo(2 / 3, 4);
    expect(result!.perBackendHitRate.tier_2a_v10).toBe(0);
  });

  it('computes classifier accuracy on run', () => {
    const cases = [
      mkCase('c1', mkDecision('multi-session', 'multi-session', 'tier_2b_v11'), true),
      mkCase('c2', mkDecision('multi-session', 'knowledge-update', 'tier_2b_v11'), false),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result!.classifierAccuracyOnRun).toBe(0.5);
  });

  it('skips classifier accuracy calculation for null GT cases', () => {
    const cases = [
      mkCase('c1', mkDecision('multi-session', null, 'tier_2b_v11'), true),
      mkCase('c2', mkDecision('multi-session', null, 'tier_2b_v11'), false),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result!.classifierAccuracyOnRun).toBe(0);
  });

  it('computes budget breach rate', () => {
    const cases = [
      mkCase('c1', mkDecision('multi-session', 'multi-session', 'tier_2b_v11', false), true),
      mkCase('c2', mkDecision('multi-session', 'multi-session', 'tier_1_canonical', true), true),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result!.budgetBreachRate).toBe(0.5);
  });

  it('computes oracle counterfactual from shipped cost table', () => {
    const cases = [
      mkCase('c1', mkDecision('single-session-user', 'multi-session', 'tier_1_canonical'), false),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    // GT = multi-session → max-acc table says tier_2b_v11
    // tier_2b_v11 MS accuracy = 0.617
    expect(result!.oracleCounterfactualEstimate.accuracy).toBeCloseTo(0.617, 3);
  });

  it('aggregates per-category backend mix', () => {
    const cases = [
      mkCase('c1', mkDecision('multi-session', 'multi-session', 'tier_2b_v11'), true),
      mkCase('c2', mkDecision('multi-session', 'multi-session', 'tier_1_canonical'), false),
      mkCase('c3', mkDecision('single-session-user', 'single-session-user', 'tier_1_canonical'), true),
    ];
    const result = computePolicyRouterStats({
      cases,
      backendCosts: DEFAULT_BACKEND_COSTS,
      oracleTable: MAXIMIZE_ACCURACY_TABLE.defaultMapping,
    });
    expect(result!.perCategoryBackendMix['multi-session'].tier_2b_v11).toBe(1);
    expect(result!.perCategoryBackendMix['multi-session'].tier_1_canonical).toBe(1);
    expect(result!.perCategoryBackendMix['single-session-user'].tier_1_canonical).toBe(1);
    expect(result!.perCategoryBackendMix['knowledge-update'].tier_2b_v11).toBe(0);
  });
});
