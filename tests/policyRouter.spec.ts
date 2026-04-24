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
  type RoutingTable,
} from '../src/core/policyRouter.js';

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
  it('downgrades when picked has worse $/correct than cheapest-fits', () => {
    // MS at Tier 2b: cost 0.0336, acc 0.617 → CPC 0.0544
    // MS at Tier 1:  cost 0.0196, acc 0.549 → CPC 0.0357
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
    const brokenTable = {
      preset: 'maximize-accuracy' as const,
      defaultMapping: {
        'single-session-user': 'tier_1_canonical',
      } as Record<string, 'tier_1_canonical' | 'tier_2a_v10' | 'tier_2b_v11'>,
    } as unknown as RoutingTable;
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
