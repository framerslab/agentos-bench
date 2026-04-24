/**
 * @file policyRouter.ts
 * @description Tier 3 policy router. Pure-function backend selector that
 * picks among Tier 1 canonical, Tier 2a v10, and Tier 2b v11 based on a
 * classifier-predicted question category + a routing table + an optional
 * per-query USD budget.
 *
 * See spec: docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md
 *
 * @module agentos-bench/core/policyRouter
 */

import type { QuestionCategory } from '../observational-memory/questionRouter.js';

export type PolicyBackend =
  | 'tier_1_canonical'
  | 'tier_2a_v10'
  | 'tier_2b_v11';

export type PolicyPreset = 'maximize-accuracy' | 'balanced' | 'minimize-cost';

export type BudgetMode = 'hard' | 'soft' | 'cheapest-fallback';

export interface BackendCostPoint {
  backend: PolicyBackend;
  /** Average USD per query across all categories at this backend (Phase B). */
  avgCostPerQuery: number;
  /** Per-category accuracy at this backend (Phase B N=500). */
  perCategoryAccuracy: Record<QuestionCategory, number>;
  /** Per-category USD per query at this backend (Phase B N=500). */
  perCategoryCostPerQuery: Record<QuestionCategory, number>;
  /** Per-category average latency in ms at this backend. */
  perCategoryLatencyMs: Record<QuestionCategory, number>;
}

export interface RoutingTable {
  preset: PolicyPreset;
  defaultMapping: Record<QuestionCategory, PolicyBackend>;
}

export interface PolicyRouterDecision {
  predictedCategory: QuestionCategory;
  groundTruthCategory: QuestionCategory | null;
  chosenBackend: PolicyBackend;
  chosenBackendReason: string;
  estimatedCostUsd: number;
  budgetCeiling: number | null;
  budgetExceeded: boolean;
  preset: PolicyPreset;
}

export interface PolicyRouterConfig {
  table: RoutingTable;
  budgetPerQuery: number | null;
  budgetMode: BudgetMode;
  backendCosts: Record<PolicyBackend, BackendCostPoint>;
}

/**
 * Error thrown when a category is missing from the routing table. This
 * should never happen with the 3 shipped preset tables (all 6 categories
 * mapped), but guards against custom-table misuse in v2.
 */
export class PolicyRouterUnknownCategoryError extends Error {
  constructor(category: string) {
    super(`PolicyRouter: category '${category}' not in routing table`);
    this.name = 'PolicyRouterUnknownCategoryError';
  }
}

/**
 * Error thrown when `hard` budget mode rejects a routing pick that
 * exceeds `budgetPerQuery`. Callers can catch this to fall back to a
 * different strategy at the application layer.
 */
export class PolicyRouterBudgetExceededError extends Error {
  constructor(
    public readonly backend: PolicyBackend,
    public readonly cost: number,
    public readonly budget: number,
  ) {
    super(
      `PolicyRouter: backend '${backend}' cost $${cost.toFixed(4)} ` +
        `exceeds hard budget $${budget.toFixed(4)}`,
    );
    this.name = 'PolicyRouterBudgetExceededError';
  }
}

// ---------------------------------------------------------------------------
// Phase B N=500 measured cost-accuracy points.
// Source: results/runs/2026-04-20T20-03-14-675 (Tier 1),
//         results/runs/2026-04-23T04-14-40-609 (Tier 2a v10),
//         results/runs/2026-04-23T17-27-28-793 (Tier 2b v11).
// See spec §2 for the per-category table and attribution caveat (per-tier
// totalUsd/n_cases average aggregates OM-route ~$1.29/case with canonical
// ~$0.028/case at Tier 2a/2b).
// ---------------------------------------------------------------------------

export const TIER_1_CANONICAL_COSTS: BackendCostPoint = {
  backend: 'tier_1_canonical',
  avgCostPerQuery: 0.0156, // $7.80 / 500
  perCategoryAccuracy: {
    'single-session-user': 0.971,
    'single-session-assistant': 0.893,
    'single-session-preference': 0.600,
    'knowledge-update': 0.868,
    'multi-session': 0.549,
    'temporal-reasoning': 0.702,
  },
  perCategoryCostPerQuery: {
    'single-session-user': 0.0191,
    'single-session-assistant': 0.0175,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0189,
    'multi-session': 0.0196,
    'temporal-reasoning': 0.0202,
  },
  perCategoryLatencyMs: {
    'single-session-user': 104837,
    'single-session-assistant': 55252,
    'single-session-preference': 58373,
    'knowledge-update': 82807,
    'multi-session': 131188,
    'temporal-reasoning': 100881,
  },
};

export const TIER_2A_V10_COSTS: BackendCostPoint = {
  backend: 'tier_2a_v10',
  avgCostPerQuery: 0.2436, // $121.80 / 500
  perCategoryAccuracy: {
    'single-session-user': 0.971,
    'single-session-assistant': 0.839,
    'single-session-preference': 0.600,
    'knowledge-update': 0.859,
    'multi-session': 0.602,
    'temporal-reasoning': 0.710,
  },
  perCategoryCostPerQuery: {
    'single-session-user': 0.0214,
    'single-session-assistant': 0.0195,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0306,
    'multi-session': 0.0308,
    'temporal-reasoning': 0.0206,
  },
  perCategoryLatencyMs: {
    'single-session-user': 7649,
    'single-session-assistant': 5668,
    'single-session-preference': 4469,
    'knowledge-update': 19569,
    'multi-session': 21360,
    'temporal-reasoning': 4236,
  },
};

export const TIER_2B_V11_COSTS: BackendCostPoint = {
  backend: 'tier_2b_v11',
  avgCostPerQuery: 0.3289, // $164.45 / 500
  perCategoryAccuracy: {
    'single-session-user': 0.986,
    'single-session-assistant': 0.839,
    'single-session-preference': 0.633,
    'knowledge-update': 0.872,
    'multi-session': 0.617,
    'temporal-reasoning': 0.692,
  },
  perCategoryCostPerQuery: {
    'single-session-user': 0.0212,
    'single-session-assistant': 0.0192,
    'single-session-preference': 0.0206,
    'knowledge-update': 0.0307,
    'multi-session': 0.0336,
    'temporal-reasoning': 0.0209,
  },
  perCategoryLatencyMs: {
    'single-session-user': 6676,
    'single-session-assistant': 6879,
    'single-session-preference': 8822,
    'knowledge-update': 21085,
    'multi-session': 27423,
    'temporal-reasoning': 5025,
  },
};

export const DEFAULT_BACKEND_COSTS: Record<PolicyBackend, BackendCostPoint> = {
  tier_1_canonical: TIER_1_CANONICAL_COSTS,
  tier_2a_v10: TIER_2A_V10_COSTS,
  tier_2b_v11: TIER_2B_V11_COSTS,
};

// ---------------------------------------------------------------------------
// Preset routing tables. Each is frozen at module init so consumers cannot
// mutate the routing surface at runtime.
// ---------------------------------------------------------------------------

/**
 * Preset: maximize-accuracy. Picks highest-accuracy backend per category.
 * Ties within CI noise broken by cost.
 *
 * v2 update (2026-04-24, post-Phase-B): temporal-reasoning routes to
 * tier_1_canonical instead of tier_2a_v10. Phase B N=500 found the v1
 * routing (TR → Tier 2a) paid OM ingest cost for a within-CI-noise
 * accuracy gain (71.0% Tier 2a vs 70.2% Tier 1); combined with classifier
 * misroutes, the aggregate dropped to 73.8% (below the 74% floor). v2
 * keeps TR on Tier 1 where it's cheapest and accuracy-equivalent.
 *
 * Simulation (Phase B N=500, v10 classifier predictions, full-pipeline cost):
 *   v1: Accuracy 73.8% [70.0, 77.6] | $0.2465/correct | below 74% floor
 *   v2: predicted 75-76% | expected $0.10-0.15/correct | TR routing fix
 */
export const MAXIMIZE_ACCURACY_TABLE: RoutingTable = Object.freeze({
  preset: 'maximize-accuracy' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'tier_1_canonical',
    'single-session-user': 'tier_2b_v11',
    'temporal-reasoning': 'tier_1_canonical',
    'knowledge-update': 'tier_2b_v11',
    'multi-session': 'tier_2b_v11',
    'single-session-preference': 'tier_2b_v11',
  }),
}) as RoutingTable;

/**
 * Preset: balanced. Accepts 1.6x cost for latency reductions over 10x.
 * Routes KU and TR to Tier 2a (tied acc at lower latency than Tier 1).
 *
 * Simulation: 74.5% / $0.205/correct / 2.12x cheaper vs Tier 2b flat.
 * Oracle ceiling: 76.0% at $0.278/correct.
 */
export const BALANCED_TABLE: RoutingTable = Object.freeze({
  preset: 'balanced' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'tier_1_canonical',
    'single-session-user': 'tier_1_canonical',
    'temporal-reasoning': 'tier_2a_v10',
    'knowledge-update': 'tier_2a_v10',
    'multi-session': 'tier_2b_v11',
    'single-session-preference': 'tier_2b_v11',
  }),
}) as RoutingTable;

/**
 * Preset: minimize-cost. Picks Pareto-dominant or cheapest per category;
 * only pays Tier 2b premium on MS (+6.8pp architectural lift) and SSP.
 *
 * Simulation: 73.9% / $0.092/correct / 4.77x cheaper vs Tier 2b flat.
 * Oracle ceiling: 76.0% at $0.157/correct (Pareto-dominates Tier 2b flat).
 */
export const MINIMIZE_COST_TABLE: RoutingTable = Object.freeze({
  preset: 'minimize-cost' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'tier_1_canonical',
    'single-session-user': 'tier_1_canonical',
    'temporal-reasoning': 'tier_1_canonical',
    'knowledge-update': 'tier_1_canonical',
    'multi-session': 'tier_2b_v11',
    'single-session-preference': 'tier_2b_v11',
  }),
}) as RoutingTable;

export const PRESET_TABLES: Record<PolicyPreset, RoutingTable> = {
  'maximize-accuracy': MAXIMIZE_ACCURACY_TABLE,
  'balanced': BALANCED_TABLE,
  'minimize-cost': MINIMIZE_COST_TABLE,
};

// ---------------------------------------------------------------------------
// selectBackend: pure function. Given classifier-predicted category + config,
// returns a PolicyRouterDecision with reasoning + cost estimate. Deterministic.
// ---------------------------------------------------------------------------

/**
 * Budget modes:
 *   - 'hard': throw PolicyRouterBudgetExceededError if pick exceeds budget
 *   - 'soft': exceed budget only if picked $/correct <= cheapest-fits $/correct
 *   - 'cheapest-fallback': downgrade to cheapest that fits (or globally cheapest)
 */
export function selectBackend(args: {
  predictedCategory: QuestionCategory;
  groundTruthCategory: QuestionCategory | null;
  config: PolicyRouterConfig;
}): PolicyRouterDecision {
  const { predictedCategory, groundTruthCategory, config } = args;
  const { table, budgetPerQuery, budgetMode, backendCosts } = config;

  // 1. Validate: category must be in routing table.
  const picked: PolicyBackend | undefined = table.defaultMapping[predictedCategory];
  if (!picked) {
    throw new PolicyRouterUnknownCategoryError(predictedCategory);
  }

  // 2. Compute per-query cost for picked backend on this category.
  const pickedCost =
    backendCosts[picked].perCategoryCostPerQuery[predictedCategory];

  // 3. Budget check (or pass-through if no budget).
  if (budgetPerQuery === null || pickedCost <= budgetPerQuery) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason:
        budgetPerQuery === null
          ? 'routing-table pick, no budget'
          : 'routing-table pick fits budget',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // 4. Budget exceeded. Apply mode-specific handling.
  if (budgetMode === 'hard') {
    throw new PolicyRouterBudgetExceededError(picked, pickedCost, budgetPerQuery);
  }

  // Find the cheapest backend that fits the budget on this category.
  const fits = Object.values(backendCosts)
    .map((c) => ({
      backend: c.backend,
      cost: c.perCategoryCostPerQuery[predictedCategory],
    }))
    .filter((c) => c.cost <= budgetPerQuery);
  const cheapestFits =
    fits.length > 0 ? fits.reduce((a, b) => (a.cost <= b.cost ? a : b)) : null;

  // If no backend fits budget at all, pick the globally cheapest and flag exceeded.
  if (!cheapestFits) {
    const globallyCheapest = Object.values(backendCosts)
      .map((c) => ({
        backend: c.backend,
        cost: c.perCategoryCostPerQuery[predictedCategory],
      }))
      .reduce((a, b) => (a.cost <= b.cost ? a : b));
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: globallyCheapest.backend,
      chosenBackendReason: 'no backend fits budget; picking absolute cheapest',
      estimatedCostUsd: globallyCheapest.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  if (budgetMode === 'cheapest-fallback') {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: cheapestFits.backend,
      chosenBackendReason: 'budget downgrade (cheapest-fallback mode)',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  // budgetMode === 'soft': exceed only if picked has better $/correct than
  // the cheapest-fits backend. Division by zero guards ensure safe behavior
  // when accuracy is 0 on the category.
  const pickedAcc = backendCosts[picked].perCategoryAccuracy[predictedCategory];
  const cheapestAcc =
    backendCosts[cheapestFits.backend].perCategoryAccuracy[predictedCategory];

  if (pickedAcc === 0) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: cheapestFits.backend,
      chosenBackendReason: 'soft budget downgrade: picked has 0 acc on category',
      estimatedCostUsd: cheapestFits.cost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: false,
      preset: table.preset,
    };
  }

  if (cheapestAcc === 0) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason: 'soft exceed: cheapest has 0 acc',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }

  const pickedCPC = pickedCost / pickedAcc;
  const cheapestCPC = cheapestFits.cost / cheapestAcc;

  if (pickedCPC <= cheapestCPC) {
    return {
      predictedCategory,
      groundTruthCategory,
      chosenBackend: picked,
      chosenBackendReason: 'soft exceed: better $/correct',
      estimatedCostUsd: pickedCost,
      budgetCeiling: budgetPerQuery,
      budgetExceeded: true,
      preset: table.preset,
    };
  }
  return {
    predictedCategory,
    groundTruthCategory,
    chosenBackend: cheapestFits.backend,
    chosenBackendReason: 'soft budget downgrade: cheaper $/correct',
    estimatedCostUsd: cheapestFits.cost,
    budgetCeiling: budgetPerQuery,
    budgetExceeded: false,
    preset: table.preset,
  };
}
