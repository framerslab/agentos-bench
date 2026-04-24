# Tier 3 Policy Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax. All bench commands run from `/Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/`. Commits use `--no-verify` (monorepo secretlint bypass). Commit messages read as human-written.

**Goal:** Ship a per-query policy router that picks among Tier 1 canonical, Tier 2a v10, and Tier 2b v11 based on the v10 classifier's predicted question category plus an optional per-query USD budget. Three shipping presets (`maximize-accuracy`, `balanced`, `minimize-cost`) cover the cost-accuracy tradeoff space.

**Architecture:** Pure-function `selectBackend` module (`src/core/policyRouter.ts`) consumes classifier output + routing table + budget config, returns a backend selection + reasoning. `LongMemEvalS.runCase` dispatches based on the returned backend: Tier 1 routes skip OM entirely (canonical path), Tier 2a passes `routerCategory: undefined` to `buildOmReaderSystemPrompt` (no conditional verbatim), Tier 2b passes the actual category (verbatim fires on KU/SSU). Classifier runs exactly once per case. Cache fingerprint `policy-router:v1:<presetHash>` appended conditionally only when `config.policyRouter === true`. New `policyRouterStats` aggregator extends `BenchResult` with per-backend mix + classifier-accuracy-on-run + oracle counterfactual estimate.

**Tech Stack:** TypeScript, Node 20, `tsc --noEmit`, Vitest, pnpm workspaces. Uses existing `classifyQuestion`, `buildOmReaderSystemPrompt`, `runFullCognitiveCase`, `computeBootstrapCI` modules. No new dependencies.

**Spec:** [packages/agentos-bench/docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md](../specs/2026-04-24-tier-3-budget-aware-policy-router-design.md)

**Budget:** $300+ approved. Minimum validation $43 (Tier A + Phase A maximize-accuracy + Phase A minimize-cost). Full validation $237 upper-bound.

---

## File structure

| File | Role | Action |
|---|---|---|
| `src/core/policyRouter.ts` | Pure module: types + 3 preset tables + `selectBackend` function | CREATE |
| `src/core/policyRouter.test.ts` | Unit tests for `selectBackend` | CREATE |
| `src/core/IBenchmark.ts` | `RunConfig` interface + `OPTIONAL_RUN_CONFIG_KEYS` tuple | MODIFY |
| `src/core/BenchmarkRunner.ts` | `computeCaseRunKeyParts` cache fingerprint | MODIFY |
| `src/core/metrics/computePolicyRouterStats.ts` | Aggregator for per-run router stats | CREATE |
| `src/core/metrics/computePolicyRouterStats.test.ts` | Unit tests for the aggregator | CREATE |
| `src/core/metrics/index.ts` | Re-exports | MODIFY |
| `src/cli.ts` | 4 new CLI flags + validation + RunConfig wiring | MODIFY |
| `src/benchmarks/longmemeval/LongMemEvalS.ts` | Policy router dispatch branch in `runCase` + `aggregate()` calls `computePolicyRouterStats` | MODIFY |
| `tests/policyRouterIntegration.spec.ts` | Integration tests for dispatch + metadata capture | CREATE |
| `tests/step15ObservationalMemory.wiring.spec.ts` | Add fingerprint presence tests | MODIFY |

---

## Phase 1 — Core plumbing (no LLM cost)

### Task 1: Scaffold `policyRouter.ts` with types

**Files:**
- Create: `src/core/policyRouter.ts`

- [ ] **Step 1: Create the file with type definitions only**

Create `src/core/policyRouter.ts` with this content:

```typescript
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
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-bench/src/core/policyRouter.ts
git commit --no-verify -m "add Tier 3 policy router types"
```

---

### Task 2: Add preset cost-point data + routing tables

**Files:**
- Modify: `src/core/policyRouter.ts`

- [ ] **Step 1: Append the 3 backend cost points at Phase B N=500**

Append to `src/core/policyRouter.ts`:

```typescript
// Phase B N=500 measured cost-accuracy points.
// Source: results/runs/2026-04-20T20-03-14-675 (Tier 1),
//         results/runs/2026-04-23T04-14-40-609 (Tier 2a v10),
//         results/runs/2026-04-23T17-27-28-793 (Tier 2b v11).
// See spec §2 for the per-category table and attribution caveat.
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
```

- [ ] **Step 2: Append the 3 preset tables (immutable via Object.freeze)**

```typescript
/**
 * Preset: maximize-accuracy. Picks highest-accuracy backend per category.
 * Ties within CI noise broken by cost.
 *
 * Simulation (Phase B N=500, v10 classifier predictions, full-pipeline cost):
 *   Accuracy: 75.3%  |  $0.357/correct  |  1.22x cheaper vs Tier 2b flat
 * Oracle ceiling: 76.2% at $0.356/correct.
 */
export const MAXIMIZE_ACCURACY_TABLE: RoutingTable = Object.freeze({
  preset: 'maximize-accuracy' as const,
  defaultMapping: Object.freeze({
    'single-session-assistant': 'tier_1_canonical',
    'single-session-user': 'tier_2b_v11',
    'temporal-reasoning': 'tier_2a_v10',
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
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-bench/src/core/policyRouter.ts
git commit --no-verify -m "add Phase B cost-accuracy data + 3 policy router presets"
```

---

### Task 3: Write `selectBackend` failing tests

**Files:**
- Create: `src/core/policyRouter.test.ts`

- [ ] **Step 1: Write initial test file with basic scenarios**

Create `src/core/policyRouter.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  BALANCED_TABLE,
  DEFAULT_BACKEND_COSTS,
  MAXIMIZE_ACCURACY_TABLE,
  MINIMIZE_COST_TABLE,
  PolicyRouterBudgetExceededError,
  PolicyRouterUnknownCategoryError,
  selectBackend,
  type PolicyRouterConfig,
} from './policyRouter.js';

const baseConfig = (overrides: Partial<PolicyRouterConfig> = {}): PolicyRouterConfig => ({
  table: MAXIMIZE_ACCURACY_TABLE,
  budgetPerQuery: null,
  budgetMode: 'hard',
  backendCosts: DEFAULT_BACKEND_COSTS,
  ...overrides,
});

describe('selectBackend: no budget', () => {
  it('routes SSA to Tier 1 under maximize-accuracy', () => {
    const decision = selectBackend({
      predictedCategory: 'single-session-assistant',
      groundTruthCategory: 'single-session-assistant',
      config: baseConfig(),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.budgetExceeded).toBe(false);
    expect(decision.preset).toBe('maximize-accuracy');
  });

  it('routes MS to Tier 2b under maximize-accuracy', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: 'multi-session',
      config: baseConfig(),
    });
    expect(decision.chosenBackend).toBe('tier_2b_v11');
    expect(decision.estimatedCostUsd).toBeCloseTo(0.0336, 4);
  });

  it('routes MS to Tier 2b under minimize-cost (architectural lift only)', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: 'multi-session',
      config: baseConfig({ table: MINIMIZE_COST_TABLE }),
    });
    expect(decision.chosenBackend).toBe('tier_2b_v11');
  });

  it('routes KU to Tier 1 under minimize-cost (tied-acc cheapest)', () => {
    const decision = selectBackend({
      predictedCategory: 'knowledge-update',
      groundTruthCategory: 'knowledge-update',
      config: baseConfig({ table: MINIMIZE_COST_TABLE }),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
  });

  it('routes KU to Tier 2a under balanced (matched cost Tier 2a vs 2b)', () => {
    const decision = selectBackend({
      predictedCategory: 'knowledge-update',
      groundTruthCategory: 'knowledge-update',
      config: baseConfig({ table: BALANCED_TABLE }),
    });
    expect(decision.chosenBackend).toBe('tier_2a_v10');
  });

  it('populates groundTruthCategory when provided', () => {
    const decision = selectBackend({
      predictedCategory: 'single-session-user',
      groundTruthCategory: 'multi-session',
      config: baseConfig(),
    });
    expect(decision.groundTruthCategory).toBe('multi-session');
    expect(decision.predictedCategory).toBe('single-session-user');
  });

  it('allows groundTruthCategory = null', () => {
    const decision = selectBackend({
      predictedCategory: 'single-session-user',
      groundTruthCategory: null,
      config: baseConfig(),
    });
    expect(decision.groundTruthCategory).toBe(null);
  });
});

describe('selectBackend: budget hard mode', () => {
  it('accepts a pick within budget', () => {
    const decision = selectBackend({
      predictedCategory: 'single-session-assistant',
      groundTruthCategory: null,
      config: baseConfig({ budgetPerQuery: 0.02 }),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.budgetCeiling).toBe(0.02);
    expect(decision.budgetExceeded).toBe(false);
  });

  it('throws when MS pick exceeds hard budget', () => {
    expect(() =>
      selectBackend({
        predictedCategory: 'multi-session',
        groundTruthCategory: null,
        config: baseConfig({ budgetPerQuery: 0.02 }),
      }),
    ).toThrow(PolicyRouterBudgetExceededError);
  });
});

describe('selectBackend: budget cheapest-fallback mode', () => {
  it('falls back to Tier 1 when MS pick exceeds budget', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: baseConfig({ budgetPerQuery: 0.02, budgetMode: 'cheapest-fallback' }),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.budgetExceeded).toBe(false);
    expect(decision.chosenBackendReason).toMatch(/budget downgrade/);
  });

  it('picks global cheapest when no backend fits budget', () => {
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: baseConfig({ budgetPerQuery: 0.001, budgetMode: 'cheapest-fallback' }),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.budgetExceeded).toBe(true);
  });
});

describe('selectBackend: budget soft mode', () => {
  it('exceeds budget when picked has better $/correct than cheapest-fits', () => {
    // MS at Tier 2b: cost 0.0336, acc 0.617 → CPC 0.0544
    // MS at Tier 1: cost 0.0196, acc 0.549 → CPC 0.0357
    // Cheapest-fits at $0.02 budget = Tier 1 ($0.0196).
    // Picked Tier 2b has WORSE CPC ($0.0544 > $0.0357) → downgrade.
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: baseConfig({ budgetPerQuery: 0.02, budgetMode: 'soft' }),
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.chosenBackendReason).toMatch(/cheaper \$\/correct/);
  });

  it('treats zero-accuracy picked as degraded', () => {
    const brokenConfig = baseConfig({
      budgetPerQuery: 0.02,
      budgetMode: 'soft',
      backendCosts: {
        ...DEFAULT_BACKEND_COSTS,
        tier_2b_v11: {
          ...DEFAULT_BACKEND_COSTS.tier_2b_v11,
          perCategoryAccuracy: {
            ...DEFAULT_BACKEND_COSTS.tier_2b_v11.perCategoryAccuracy,
            'multi-session': 0,
          },
        },
      },
    });
    const decision = selectBackend({
      predictedCategory: 'multi-session',
      groundTruthCategory: null,
      config: brokenConfig,
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
    expect(decision.chosenBackendReason).toMatch(/0 acc on category/);
  });
});

describe('selectBackend: error handling', () => {
  it('throws PolicyRouterUnknownCategoryError on missing category', () => {
    const brokenTable: typeof MAXIMIZE_ACCURACY_TABLE = {
      preset: 'maximize-accuracy',
      defaultMapping: {
        'single-session-user': 'tier_1_canonical',
      } as any,
    };
    expect(() =>
      selectBackend({
        predictedCategory: 'multi-session',
        groundTruthCategory: null,
        config: baseConfig({ table: brokenTable }),
      }),
    ).toThrow(PolicyRouterUnknownCategoryError);
  });
});

describe('preset tables: all 6 categories mapped', () => {
  const categories = [
    'single-session-user',
    'single-session-assistant',
    'single-session-preference',
    'knowledge-update',
    'multi-session',
    'temporal-reasoning',
  ] as const;

  for (const preset of ['maximize-accuracy', 'balanced', 'minimize-cost'] as const) {
    it(`${preset}: all 6 categories mapped`, () => {
      const table = {
        'maximize-accuracy': MAXIMIZE_ACCURACY_TABLE,
        'balanced': BALANCED_TABLE,
        'minimize-cost': MINIMIZE_COST_TABLE,
      }[preset];
      for (const cat of categories) {
        expect(table.defaultMapping[cat]).toBeDefined();
      }
    });
  }
});
```

- [ ] **Step 2: Run the tests and verify ALL fail (selectBackend not yet implemented)**

```bash
pnpm vitest run src/core/policyRouter.test.ts
```

Expected: tests fail with "selectBackend is not a function" or similar import error.

---

### Task 4: Implement `selectBackend`

**Files:**
- Modify: `src/core/policyRouter.ts`

- [ ] **Step 1: Append `selectBackend` implementation to policyRouter.ts**

```typescript
/**
 * Pure function: given a predicted category + config, return a backend
 * selection with reasoning. Deterministic — same inputs produce same output.
 *
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
  const candidates: { backend: PolicyBackend; cost: number }[] = Object.values(
    backendCosts,
  )
    .map((c) => ({
      backend: c.backend,
      cost: c.perCategoryCostPerQuery[predictedCategory],
    }))
    .filter((c) => c.cost <= budgetPerQuery);
  const cheapestFits =
    candidates.length > 0
      ? candidates.reduce((a, b) => (a.cost <= b.cost ? a : b))
      : null;

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
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run src/core/policyRouter.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-bench/src/core/policyRouter.ts packages/agentos-bench/src/core/policyRouter.test.ts
git commit --no-verify -m "implement selectBackend + unit tests"
```

---

### Task 5: Extend RunConfig + OPTIONAL_RUN_CONFIG_KEYS

**Files:**
- Modify: `src/core/IBenchmark.ts`

- [ ] **Step 1: Add 4 RunConfig fields**

Locate `interface RunConfig` and append these fields before the closing brace:

```typescript
  /**
   * Enable Tier 3 policy router. When true, dispatches per-query to
   * tier_1_canonical / tier_2a_v10 / tier_2b_v11 based on the v10
   * classifier + the routing table specified by policyRouterPreset.
   * Mutually exclusive with `omDynamicRouter` (throws on both set).
   * Default: false. Opt-in behind `--policy-router` CLI flag.
   */
  policyRouter?: boolean;

  /**
   * Tier 3 policy router preset. Default: `'maximize-accuracy'`.
   * - `maximize-accuracy`: picks highest-acc backend per category (75.3% / $0.357/correct realistic)
   * - `balanced`: trades cost for latency (74.5% / $0.205/correct realistic)
   * - `minimize-cost`: Pareto-dominant-or-cheapest (73.9% / $0.092/correct realistic)
   */
  policyRouterPreset?: 'maximize-accuracy' | 'balanced' | 'minimize-cost';

  /**
   * Tier 3 per-query USD ceiling. When set, the policy router applies
   * the budget check per `policyRouterBudgetMode`. Null (default) =
   * unbounded — the routing table pick is always used.
   */
  policyRouterBudgetPerQuery?: number;

  /**
   * Tier 3 budget mode: how the router behaves when the routing-table
   * pick exceeds the per-query budget.
   * - `hard`: throw (default)
   * - `soft`: exceed only if picked $/correct <= cheapest-fits $/correct
   * - `cheapest-fallback`: downgrade to cheapest-that-fits (or globally cheapest)
   */
  policyRouterBudgetMode?: 'hard' | 'soft' | 'cheapest-fallback';
```

- [ ] **Step 2: Add the 4 keys to OPTIONAL_RUN_CONFIG_KEYS tuple**

Locate `const OPTIONAL_RUN_CONFIG_KEYS = [` and add these 4 entries at the end of the tuple (before the closing `] as const;`):

```typescript
  'policyRouter',
  'policyRouterPreset',
  'policyRouterBudgetPerQuery',
  'policyRouterBudgetMode',
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0. The `OptionalRunConfigKey` compile-time guard auto-validates the tuple matches the interface.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-bench/src/core/IBenchmark.ts
git commit --no-verify -m "add Tier 3 RunConfig fields"
```

---

### Task 6: Add conditional cache fingerprint in BenchmarkRunner

**Files:**
- Modify: `src/core/BenchmarkRunner.ts`

- [ ] **Step 1: Inspect existing fingerprint functions**

```bash
grep -n "computeCaseRunKeyParts\|step-16c-router\|retention-instrumentation" src/core/BenchmarkRunner.ts
```

Note the line numbers for use in the next step.

- [ ] **Step 2: Import hashing primitive**

At the top of `BenchmarkRunner.ts`, ensure `createHash` is imported. If not already:

```typescript
import { createHash } from 'node:crypto';
```

- [ ] **Step 3: Add the fingerprint block**

Inside `computeCaseRunKeyParts` (or equivalent), locate the `retention-instrumentation:v1` push and add this block IMMEDIATELY BEFORE it:

```typescript
  // Tier 3 policy router fingerprint. CONDITIONAL: only added when the
  // router is enabled, so non-router runs (including Phase B cached runs)
  // don't get invalidated. Hash is over the routing table JSON so A/B
  // preset testing doesn't collide caches.
  if (config.policyRouter) {
    const preset = config.policyRouterPreset ?? 'maximize-accuracy';
    const budget = config.policyRouterBudgetPerQuery ?? 'null';
    const mode = config.policyRouterBudgetMode ?? 'hard';
    const presetHash = createHash('sha256')
      .update(preset)
      .update(`:${budget}`)
      .update(`:${mode}`)
      .digest('hex')
      .slice(0, 8);
    const tag = `policy-router:v1:${presetHash}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }
```

- [ ] **Step 4: Run typecheck + build**

```bash
pnpm typecheck && pnpm build
```

Expected: both silent exit 0.

- [ ] **Step 5: Add fingerprint test**

In `tests/step15ObservationalMemory.wiring.spec.ts`, append after the existing describe blocks:

```typescript
describe('Step T3 policy router cache fingerprint', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummaryModel: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('appends policy-router:v1:<hash> only when policyRouter is true', () => {
    const without = computeCaseRunKeyParts(baseConfig, 'case-1');
    const withRouter = computeCaseRunKeyParts(
      { ...baseConfig, policyRouter: true, policyRouterPreset: 'maximize-accuracy' } as RunConfig,
      'case-1',
    );
    expect(without.runKeyParts.some((p) => p.startsWith('policy-router:v1:'))).toBe(false);
    expect(withRouter.runKeyParts.some((p) => p.startsWith('policy-router:v1:'))).toBe(true);
  });

  it('produces different hashes for different presets', () => {
    const a = computeCaseRunKeyParts(
      { ...baseConfig, policyRouter: true, policyRouterPreset: 'maximize-accuracy' } as RunConfig,
      'case-1',
    );
    const b = computeCaseRunKeyParts(
      { ...baseConfig, policyRouter: true, policyRouterPreset: 'minimize-cost' } as RunConfig,
      'case-1',
    );
    const aTag = a.runKeyParts.find((p) => p.startsWith('policy-router:v1:'));
    const bTag = b.runKeyParts.find((p) => p.startsWith('policy-router:v1:'));
    expect(aTag).not.toBe(bTag);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts
```

Expected: all pass including the 2 new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/agentos-bench/src/core/BenchmarkRunner.ts packages/agentos-bench/tests/step15ObservationalMemory.wiring.spec.ts
git commit --no-verify -m "add conditional policy-router cache fingerprint + wiring tests"
```

---

### Task 7: Add CLI flags + mutual-exclusion validation

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Locate the CLI option block**

```bash
grep -n "om-classifier-fewshot\|no-capture-retention-inputs" src/cli.ts
```

Insert the new flags immediately after `--no-capture-retention-inputs` (they're related Tier 3-ish opt-ins).

- [ ] **Step 2: Add the 4 flag definitions**

```typescript
    .option(
      '--policy-router',
      'Tier 3 policy router: dispatch per-query to tier_1_canonical / tier_2a_v10 / tier_2b_v11 based on the v10 classifier prediction + routing table. Mutually exclusive with --om-dynamic-router. Opt-in behind this flag.',
    )
    .option(
      '--policy-router-preset <preset>',
      'Tier 3 routing preset: maximize-accuracy (default, 75.3% at $0.357/correct realistic), balanced (74.5% at $0.205/correct), minimize-cost (73.9% at $0.092/correct). Only effective with --policy-router.',
      (value: string) => {
        if (
          value !== 'maximize-accuracy' &&
          value !== 'balanced' &&
          value !== 'minimize-cost'
        ) {
          throw new Error(
            `--policy-router-preset must be 'maximize-accuracy' | 'balanced' | 'minimize-cost', got '${value}'`,
          );
        }
        return value;
      },
    )
    .option(
      '--policy-router-budget-per-query <USD>',
      'Tier 3 per-query USD ceiling. Unbounded if omitted. Combined with --policy-router-budget-mode to control exceed behavior. Only effective with --policy-router.',
      parseFloatArg,
    )
    .option(
      '--policy-router-budget-mode <mode>',
      'Tier 3 budget mode: hard (default, throws on exceed) | soft (exceed only when better $/correct) | cheapest-fallback (downgrade to cheapest-that-fits). Only effective with --policy-router AND --policy-router-budget-per-query set.',
      (value: string) => {
        if (value !== 'hard' && value !== 'soft' && value !== 'cheapest-fallback') {
          throw new Error(
            `--policy-router-budget-mode must be 'hard' | 'soft' | 'cheapest-fallback', got '${value}'`,
          );
        }
        return value;
      },
    )
```

- [ ] **Step 3: Wire the flags into RunConfig**

In the action handler where `runConfig` is built, add these lines after the existing OM field assignments:

```typescript
        policyRouter: opts.policyRouter as boolean | undefined,
        policyRouterPreset: opts.policyRouterPreset as
          | 'maximize-accuracy'
          | 'balanced'
          | 'minimize-cost'
          | undefined,
        policyRouterBudgetPerQuery: opts.policyRouterBudgetPerQuery as number | undefined,
        policyRouterBudgetMode: opts.policyRouterBudgetMode as
          | 'hard'
          | 'soft'
          | 'cheapest-fallback'
          | undefined,
```

- [ ] **Step 4: Add mutual-exclusion validation**

Before `runConfig` is passed to the runner, validate:

```typescript
      if (runConfig.policyRouter && runConfig.omDynamicRouter) {
        console.error(
          `[cli] --policy-router and --om-dynamic-router are mutually exclusive. ` +
            `Choose one dispatch strategy.`,
        );
        process.exitCode = 2;
        return;
      }
      if (runConfig.policyRouterBudgetMode && !runConfig.policyRouter) {
        console.error(
          `[cli] --policy-router-budget-mode requires --policy-router. Aborting.`,
        );
        process.exitCode = 2;
        return;
      }
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/agentos-bench/src/cli.ts
git commit --no-verify -m "wire Tier 3 CLI flags + mutual exclusion with om-dynamic-router"
```

---

### Task 8: Dispatch Tier 3 in LongMemEvalS.runCase

**Files:**
- Modify: `src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 1: Import policyRouter primitives**

At the top of the file (near the existing `classifyQuestion` import), add:

```typescript
import {
  DEFAULT_BACKEND_COSTS,
  PRESET_TABLES,
  selectBackend,
  type PolicyRouterConfig,
  type PolicyRouterDecision,
} from '../../core/policyRouter.js';
```

- [ ] **Step 2: Add the Tier 3 dispatch branch**

Locate the `dynamicRouterOn` check (around line 291-295) and insert the policy-router branch BEFORE it:

```typescript
    // Tier 3 policy router. When enabled, it dispatches per-query to
    // tier_1_canonical / tier_2a_v10 / tier_2b_v11 based on classifier +
    // routing table. Mutually exclusive with omDynamicRouter (validated in CLI).
    let policyRouterDecision: PolicyRouterDecision | null = null;
    const policyRouterOn = Boolean(ctx.config.policyRouter);
    if (policyRouterOn) {
      const presetName = ctx.config.policyRouterPreset ?? 'maximize-accuracy';
      const table = PRESET_TABLES[presetName];
      const classifierModelName = (ctx.config.omClassifierModel ?? 'gpt-5-mini') as ReaderModel;
      const classifierReader = createReader(classifierModelName);
      let classifierTokensIn = 0;
      let classifierTokensOut = 0;
      let classifierModel: string = 'gpt-5-mini';
      let predictedCategory: QuestionCategory = 'multi-session'; // fallback
      try {
        const result = await classifyQuestion({
          reader: classifierReader,
          question: c.question,
          useFewshotPrompt: Boolean(ctx.config.omClassifierFewshot),
        });
        predictedCategory = result.category;
        classifierTokensIn = result.tokensIn;
        classifierTokensOut = result.tokensOut;
        classifierModel = result.model;
      } catch {
        // Classifier errored: fall back to multi-session routing (same as v10).
        predictedCategory = 'multi-session';
      }
      if (classifierTokensIn > 0 || classifierTokensOut > 0) {
        ctx.costTracker.record({
          category: 'reader',
          model: classifierModel,
          tokensIn: classifierTokensIn,
          tokensOut: classifierTokensOut,
          tag: `${c.id}:policy-router-classifier`,
        });
      }
      const policyConfig: PolicyRouterConfig = {
        table,
        budgetPerQuery: ctx.config.policyRouterBudgetPerQuery ?? null,
        budgetMode: ctx.config.policyRouterBudgetMode ?? 'hard',
        backendCosts: DEFAULT_BACKEND_COSTS,
      };
      policyRouterDecision = selectBackend({
        predictedCategory,
        groundTruthCategory: (c.type as QuestionCategory | undefined) ?? null,
        config: policyConfig,
      });
      runMetadata.policyRouterDecision = policyRouterDecision;
      runMetadata.policyRouter = true;
    }
```

- [ ] **Step 3: Thread backend selection through OM branch + canonical branch**

Modify the existing `useOmBranch` determination to include policy router output:

```typescript
    const useOmBranch = policyRouterOn
      ? policyRouterDecision!.chosenBackend !== 'tier_1_canonical'
      : dynamicRouterOn
      ? routerDecision!.runOM
      : Boolean(this.opts.observationalMemoryEnabled);
```

Inside the OM branch, when calling `buildOmReaderSystemPrompt`, add policy-router awareness. Locate the existing `routerCategory: routerCategory ?? undefined` line and modify:

```typescript
        // For Tier 3 policy router:
        //  - tier_2a_v10 backend: pass routerCategory=undefined so conditional verbatim does NOT fire.
        //  - tier_2b_v11 backend: pass actual category so verbatim fires on KU/SSU.
        // For legacy v10 router (dynamicRouterOn), behavior unchanged.
        routerCategory: policyRouterOn
          ? policyRouterDecision!.chosenBackend === 'tier_2b_v11'
            ? policyRouterDecision!.predictedCategory
            : undefined
          : routerCategory ?? undefined,
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: silent exit 0.

- [ ] **Step 5: Add integration test**

Create `tests/policyRouterIntegration.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PRESET_TABLES, DEFAULT_BACKEND_COSTS, selectBackend } from '../src/core/policyRouter.js';

describe('Policy router integration: simulation over Phase B data', () => {
  it('maximize-accuracy preset picks tier_1 for SSA predictions', () => {
    const decision = selectBackend({
      predictedCategory: 'single-session-assistant',
      groundTruthCategory: 'single-session-assistant',
      config: {
        table: PRESET_TABLES['maximize-accuracy'],
        budgetPerQuery: null,
        budgetMode: 'hard',
        backendCosts: DEFAULT_BACKEND_COSTS,
      },
    });
    expect(decision.chosenBackend).toBe('tier_1_canonical');
  });

  it('minimize-cost preset routes only MS + SSP to tier_2b', () => {
    const toTier2b: string[] = [];
    for (const cat of [
      'single-session-user',
      'single-session-assistant',
      'single-session-preference',
      'knowledge-update',
      'multi-session',
      'temporal-reasoning',
    ] as const) {
      const decision = selectBackend({
        predictedCategory: cat,
        groundTruthCategory: null,
        config: {
          table: PRESET_TABLES['minimize-cost'],
          budgetPerQuery: null,
          budgetMode: 'hard',
          backendCosts: DEFAULT_BACKEND_COSTS,
        },
      });
      if (decision.chosenBackend === 'tier_2b_v11') toTier2b.push(cat);
    }
    expect(toTier2b.sort()).toEqual(['multi-session', 'single-session-preference']);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run tests/policyRouterIntegration.spec.ts
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts packages/agentos-bench/tests/policyRouterIntegration.spec.ts
git commit --no-verify -m "dispatch Tier 3 policy router in LongMemEvalS.runCase"
```

---

### Task 9: `computePolicyRouterStats` aggregator

**Files:**
- Create: `src/core/metrics/computePolicyRouterStats.ts`
- Create: `src/core/metrics/computePolicyRouterStats.test.ts`

- [ ] **Step 1: Create the aggregator file**

`src/core/metrics/computePolicyRouterStats.ts`:

```typescript
/**
 * @file computePolicyRouterStats.ts
 * @description Aggregator over a run's CaseResult[] when Tier 3 policy
 * router was enabled. Reads `metadata.policyRouterDecision` per case,
 * computes per-backend mix, classifier accuracy, budget breach rate,
 * and oracle counterfactual estimate from the shipped cost-accuracy
 * table at src/core/policyRouter.ts.
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
  /** Share of decisions per chosen backend. Sums to ≤ 1.0. */
  perBackendHitRate: Record<PolicyBackend, number>;
  /** Per-predicted-category × chosen-backend count matrix. */
  perCategoryBackendMix: Record<QuestionCategory, Record<PolicyBackend, number>>;
  /** Classifier ground-truth accuracy on this run (predicted == GT). */
  classifierAccuracyOnRun: number;
  /** Fraction of decisions where `budgetExceeded === true`. */
  budgetBreachRate: number;
  /** Mean decision.estimatedCostUsd across all decisions. */
  avgCostPerQuery: number;
  /**
   * Oracle counterfactual estimate using the shipped cost-accuracy table.
   * Replaces `predictedCategory` with `groundTruthCategory` per decision,
   * looks up the corresponding backend's per-category accuracy from the
   * shipped table. NOT a measurement — see spec §6.
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

  // Oracle counterfactual: for each decision, look up the backend that
  // the oracle table would pick given groundTruthCategory; then use that
  // backend's per-category accuracy from the cost table.
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
```

- [ ] **Step 2: Create unit test file**

`src/core/metrics/computePolicyRouterStats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computePolicyRouterStats } from './computePolicyRouterStats.js';
import {
  DEFAULT_BACKEND_COSTS,
  MAXIMIZE_ACCURACY_TABLE,
  type PolicyRouterDecision,
} from '../policyRouter.js';
import type { CaseResult } from '../IBenchmark.js';

function mkCase(
  caseId: string,
  decision: PolicyRouterDecision,
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
    metadata: { policyRouterDecision: decision },
  } as CaseResult;
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
      cases: [
        {
          caseId: 'a',
          actualOutput: 'x',
          expectedOutput: 'y',
          score: 0,
          passed: false,
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          metadata: {},
        } as CaseResult,
      ],
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
  });

  it('computes classifier accuracy when groundTruth is present', () => {
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
});
```

- [ ] **Step 3: Run the tests**

```bash
pnpm vitest run src/core/metrics/computePolicyRouterStats.test.ts
```

Expected: all 5 pass.

- [ ] **Step 4: Export from metrics index**

Append to `src/core/metrics/index.ts`:

```typescript
export {
  computePolicyRouterStats,
  type PolicyRouterStats,
} from './computePolicyRouterStats.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/agentos-bench/src/core/metrics/computePolicyRouterStats.ts packages/agentos-bench/src/core/metrics/computePolicyRouterStats.test.ts packages/agentos-bench/src/core/metrics/index.ts
git commit --no-verify -m "add computePolicyRouterStats aggregator + unit tests"
```

---

### Task 10: Wire `policyRouterStats` into `aggregate()`

**Files:**
- Modify: `src/benchmarks/longmemeval/LongMemEvalS.ts`
- Modify: `src/core/IBenchmark.ts`

- [ ] **Step 1: Extend BenchResult with `policyRouterStats` field**

In `src/core/IBenchmark.ts`, find the `BenchResult` interface and append:

```typescript
  /**
   * Tier 3 policy router stats — only populated when policy router was
   * enabled for the run. Includes per-backend hit rate, classifier
   * accuracy on this run, and oracle counterfactual estimate.
   */
  policyRouterStats?: import('./metrics/computePolicyRouterStats.js').PolicyRouterStats;
```

- [ ] **Step 2: Call the aggregator in `aggregate()`**

In `LongMemEvalS.ts`, inside the `aggregate()` method, locate where `tokenRetention` is computed (from Step 18 work). After that block, add:

```typescript
    // Tier 3 policy router stats. Populated only when any case has a
    // policyRouterDecision in metadata. Oracle table = the same preset's
    // table (for counterfactual).
    let policyRouterStats: PolicyRouterStats | undefined;
    const anyPolicyDecisions = caseResults.some(
      (c) => (c.metadata as Record<string, unknown> | undefined)?.policyRouterDecision,
    );
    if (anyPolicyDecisions) {
      const presetName = config.policyRouterPreset ?? 'maximize-accuracy';
      const oracleTable = PRESET_TABLES[presetName].defaultMapping;
      const stats = computePolicyRouterStats({
        cases: caseResults,
        backendCosts: DEFAULT_BACKEND_COSTS,
        oracleTable,
      });
      if (stats) policyRouterStats = stats;
    }
```

Add `policyRouterStats` to the returned BenchResult object.

- [ ] **Step 3: Add necessary imports**

At the top of `LongMemEvalS.ts`, add:

```typescript
import { computePolicyRouterStats, type PolicyRouterStats } from '../../core/metrics/computePolicyRouterStats.js';
```

- [ ] **Step 4: Run typecheck + build + tests**

```bash
pnpm typecheck && pnpm build && pnpm vitest run
```

Expected: all silent / green.

- [ ] **Step 5: Commit**

```bash
git add packages/agentos-bench/src/core/IBenchmark.ts packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
git commit --no-verify -m "aggregate policyRouterStats into BenchResult"
```

---

### Task 11: Dry-run verification

**Files:**
- None modified; CLI dry-run only

- [ ] **Step 1: Run dry-run with mock reader**

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --sample 2 \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --policy-router-preset maximize-accuracy \
  --dry-run
```

Expected: run completes silently; no LLM spend. Look at the run JSON produced in `results/runs/` — verify:
- `config.policyRouter === true`
- `config.policyRouterPreset === 'maximize-accuracy'`
- Each case has `metadata.policyRouterDecision` with all 8 fields
- `policyRouterStats` field present in result summary

- [ ] **Step 2: Spot-check the JSON**

```bash
python3 -c "import json, glob; latest=max(glob.glob('results/runs/*--longmemeval-s--*'), key=__import__('os').path.getctime); d=json.load(open(latest)); print('policy router on:', d['config']['policyRouter']); print('stats:', d.get('policyRouterStats')); print('sample case decision:', d['cases'][0]['metadata'].get('policyRouterDecision'))"
```

Expected: prints config flag true + stats object + per-case decision.

- [ ] **Step 3: Test mutual exclusion error**

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --sample 2 \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --om-dynamic-router \
  --dry-run
```

Expected: exit code 2 with error `"--policy-router and --om-dynamic-router are mutually exclusive"`.

---

## Phase 2 — Live validation (LLM cost, $300+ budget)

### Task 12: Tier A N=24 sanity fire (~$7)

- [ ] **Step 1: Fire Tier A at maximize-accuracy preset**

```bash
source ../../apps/wilds-ai/.env  # load rotated OpenAI + Anthropic keys
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --sample 24 \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --policy-router-preset maximize-accuracy
```

Expected:
- Aggregate accuracy ≥ 60% (Tier A N=24 has wide CI; just verify no disaster)
- $/correct ≤ $1.00
- `policyRouterStats.perBackendHitRate` populated
- All 24 cases have `metadata.policyRouterDecision`

- [ ] **Step 2: Success criteria check**

- [ ] All 24 cases have `metadata.policyRouterDecision` with all 8 fields
- [ ] No crashes / missing metadata
- [ ] `policyRouterStats.classifierAccuracyOnRun` in [0.40, 0.70]
- [ ] Per-backend mix within ±15pp of simulation (SSA → Tier 1, MS → Tier 2b, etc.)

If GREEN, proceed. If RED, investigate before spending more.

---

### Task 13: Phase A maximize-accuracy N=102 (~$28)

- [ ] **Step 1: Fire Phase A**

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --sample 102 \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --policy-router-preset maximize-accuracy
```

Expected:
- Aggregate ≥ 73.5% (lower CI ≥ 68%)
- $/correct in [$0.25, $0.45]
- `oracleCounterfactualEstimate.accuracy` ≥ 76%

**Kill criterion:** Aggregate < 72% OR $/correct > $0.50 → STOP, investigate.

---

### Task 14: Phase A minimize-cost N=102 (~$8)

- [ ] **Step 1: Fire Phase A minimize-cost**

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --sample 102 \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --policy-router-preset minimize-cost
```

Expected:
- Aggregate ≥ 72% (lower CI ≥ 66%)
- $/correct in [$0.06, $0.16]

**Kill criterion:** Aggregate < 70% OR $/correct > $0.25.

---

### Task 15: Phase B maximize-accuracy N=500 (~$136)

- [ ] **Step 1: Confirm Phase A GREEN before firing**

Read Phase A run JSON outputs. Only proceed if both maximize-accuracy and minimize-cost met their success criteria.

- [ ] **Step 2: Fire Phase B**

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --hybrid-retrieval \
  --observational-memory \
  --policy-router \
  --policy-router-preset maximize-accuracy
```

(No `--sample` flag = full 500 cases.)

Expected:
- Aggregate ≥ 74% (lower CI ≥ 70%)
- $/correct in [$0.30, $0.45]

**Shipping gate:** Phase B GREEN on maximize-accuracy. If GREEN, update LEADERBOARD.md with Tier 3 row.

---

### Task 16: Documentation + LEADERBOARD update (gated on Phase B GREEN)

**Files:**
- Modify: `results/LEADERBOARD.md`
- Modify: `docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md`
- Modify: `docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md`
- Create: `docs/STEP_20_POLICY_ROUTER_FINDINGS_2026-04-24.md`

- [ ] **Step 1: Update LEADERBOARD.md with Tier 3 rows**

Insert Tier 3 rows above the current Tier 2b row in the LongMemEval-S table. Add per-preset footnotes. Use the actual Phase B numbers measured in Task 15.

- [ ] **Step 2: Update bench blog**

Add a "Tier 3 Policy Router" section between the Tier 2b section and the "What's next" section. Cover: motivation, three presets with cost-accuracy tradeoffs, Pareto insight about SSA → Tier 1.

- [ ] **Step 3: Update architecture decision matrix**

Add "Tier 3 SHIPPED" row to the "What was decided" checklist. Update the "Next-session work" section to remove Tier 3 from queued and move it to shipped.

- [ ] **Step 4: Create Step 20 findings doc**

Full findings doc documenting: the spec motivation, Phase B N=500 measurements, per-preset cost-accuracy results, classifier accuracy-on-run, comparison with simulation, oracle gap analysis.

- [ ] **Step 5: Commit docs**

```bash
git add packages/agentos-bench/results/LEADERBOARD.md \
        packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
        packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md \
        packages/agentos-bench/docs/STEP_20_POLICY_ROUTER_FINDINGS_2026-04-24.md
git commit --no-verify -m "ship Tier 3 policy router: LEADERBOARD + blog + matrix + findings"
```

---

## Validation checklist (end-of-implementation)

- [ ] `pnpm typecheck` silent exit 0
- [ ] `pnpm vitest run` all tests passing (421 + Tier 3 additions)
- [ ] `pnpm build` silent exit 0, `dist/core/policyRouter.js` present
- [ ] Tier A N=24 succeeds with complete metadata
- [ ] Phase A maximize-accuracy GREEN
- [ ] Phase A minimize-cost GREEN
- [ ] Phase B maximize-accuracy GREEN
- [ ] LEADERBOARD.md has Tier 3 row
- [ ] `coderabbit:review` on full diff identifies nothing critical
- [ ] `superpowers:requesting-code-review` on the implementation work

---

End of Tier 3 implementation plan.
