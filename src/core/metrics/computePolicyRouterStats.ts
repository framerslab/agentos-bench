/**
 * @file computePolicyRouterStats.ts
 * @description Aggregator over a run's CaseResult[] when Tier 3 policy
 * router was enabled. Reads `metadata.policyRouterDecision` per case,
 * computes per-backend mix, classifier accuracy on the run, budget breach
 * rate, and the oracle counterfactual estimate from the shipped cost-
 * accuracy table at {@link ../policyRouter.ts}.
 *
 * See spec: docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md §6
 *
 * @module agentos-bench/core/metrics/computePolicyRouterStats
 */

import type { CaseResult } from '../IBenchmark.js';
import type {
  BackendCostPoint,
  PolicyBackend,
  PolicyRouterDecision,
} from '../policyRouter.js';
import type { QuestionCategory } from '../../observational-memory/questionRouter.js';

export interface PolicyRouterStats {
  /** Share of decisions per chosen backend. Sums to 1.0 across the three keys. */
  perBackendHitRate: Record<PolicyBackend, number>;
  /** Per-predicted-category × chosen-backend count matrix. */
  perCategoryBackendMix: Record<QuestionCategory, Record<PolicyBackend, number>>;
  /**
   * Classifier ground-truth accuracy on this run (predicted == GT).
   * Computed only over decisions where `groundTruthCategory !== null`.
   */
  classifierAccuracyOnRun: number;
  /** Fraction of decisions where `budgetExceeded === true`. */
  budgetBreachRate: number;
  /** Mean `decision.estimatedCostUsd` across all decisions. */
  avgCostPerQuery: number;
  /**
   * Oracle counterfactual estimate using the shipped cost-accuracy table.
   * Replaces `predictedCategory` with `groundTruthCategory` per decision,
   * looks up the corresponding backend's per-category accuracy from the
   * shipped table. NOT a measurement — the per-backend accuracies come
   * from prior Phase B N=500 runs. See spec §6.
   */
  oracleCounterfactualEstimate: {
    accuracy: number;
    costPerCorrect: number;
  };
}

export function computePolicyRouterStats(args: {
  cases: CaseResult[];
  backendCosts: Record<PolicyBackend, BackendCostPoint>;
  /** Preset-specific routing table to compute oracle counterfactual. */
  oracleTable: Record<QuestionCategory, PolicyBackend>;
}): PolicyRouterStats | null {
  const { cases, backendCosts, oracleTable } = args;

  const decisions: PolicyRouterDecision[] = cases
    .map((c) => {
      const md = (c.metadata ?? {}) as Record<string, unknown>;
      return md.policyRouterDecision as PolicyRouterDecision | undefined;
    })
    .filter((d): d is PolicyRouterDecision => d !== undefined);

  if (decisions.length === 0) return null;

  const perBackendCount: Record<PolicyBackend, number> = {
    tier_1_canonical: 0,
    tier_2a_v10: 0,
    tier_2b_v11: 0,
  };
  const perCategoryBackendMix: Record<QuestionCategory, Record<PolicyBackend, number>> = {
    'single-session-user': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
    'single-session-assistant': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
    'single-session-preference': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
    'knowledge-update': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
    'multi-session': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
    'temporal-reasoning': { tier_1_canonical: 0, tier_2a_v10: 0, tier_2b_v11: 0 },
  };

  let classifierCorrect = 0;
  let classifierTotalWithGT = 0;
  let breaches = 0;
  let totalCost = 0;

  // Oracle counterfactual: for each decision with groundTruthCategory, look
  // up the backend the oracle table picks given GT, then the backend's
  // per-GT-category accuracy and cost. Aggregate as weighted averages.
  let oracleCorrectExpected = 0;
  let oracleCostSum = 0;
  let oracleN = 0;

  for (const d of decisions) {
    perBackendCount[d.chosenBackend] += 1;
    perCategoryBackendMix[d.predictedCategory][d.chosenBackend] += 1;
    if (d.groundTruthCategory) {
      classifierTotalWithGT += 1;
      if (d.predictedCategory === d.groundTruthCategory) {
        classifierCorrect += 1;
      }
      const oracleBackend = oracleTable[d.groundTruthCategory];
      const oracleAcc =
        backendCosts[oracleBackend].perCategoryAccuracy[d.groundTruthCategory];
      const oracleCost =
        backendCosts[oracleBackend].perCategoryCostPerQuery[d.groundTruthCategory];
      oracleCorrectExpected += oracleAcc;
      oracleCostSum += oracleCost;
      oracleN += 1;
    }
    if (d.budgetExceeded) breaches += 1;
    totalCost += d.estimatedCostUsd;
  }

  const n = decisions.length;
  const perBackendHitRate: Record<PolicyBackend, number> = {
    tier_1_canonical: perBackendCount.tier_1_canonical / n,
    tier_2a_v10: perBackendCount.tier_2a_v10 / n,
    tier_2b_v11: perBackendCount.tier_2b_v11 / n,
  };

  const oracleAcc = oracleN > 0 ? oracleCorrectExpected / oracleN : 0;
  const oracleCostAvg = oracleN > 0 ? oracleCostSum / oracleN : 0;
  const oracleCPC = oracleAcc > 0 ? oracleCostAvg / oracleAcc : 0;

  return {
    perBackendHitRate,
    perCategoryBackendMix,
    classifierAccuracyOnRun:
      classifierTotalWithGT > 0 ? classifierCorrect / classifierTotalWithGT : 0,
    budgetBreachRate: breaches / n,
    avgCostPerQuery: totalCost / n,
    oracleCounterfactualEstimate: {
      accuracy: oracleAcc,
      costPerCorrect: oracleCPC,
    },
  };
}
