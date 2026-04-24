import { describe, it, expect } from 'vitest';
import { resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

const base: RunConfig = {
  reader: 'gpt-4o',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
};

describe('resolveRunConfig: Tier 3 policy router passthrough', () => {
  it('passes policyRouter true through', () => {
    const resolved = resolveRunConfig({ ...base, policyRouter: true });
    expect(resolved.policyRouter).toBe(true);
  });

  it('passes policyRouter false/undefined through', () => {
    const resolvedUndef = resolveRunConfig(base);
    expect(resolvedUndef.policyRouter).toBeUndefined();
    const resolvedFalse = resolveRunConfig({ ...base, policyRouter: false });
    expect(resolvedFalse.policyRouter).toBe(false);
  });

  it('passes policyRouterPreset through', () => {
    const resolved = resolveRunConfig({
      ...base,
      policyRouter: true,
      policyRouterPreset: 'minimize-cost',
    });
    expect(resolved.policyRouterPreset).toBe('minimize-cost');
  });

  it('passes policyRouterBudgetPerQuery through', () => {
    const resolved = resolveRunConfig({
      ...base,
      policyRouter: true,
      policyRouterBudgetPerQuery: 0.05,
    });
    expect(resolved.policyRouterBudgetPerQuery).toBe(0.05);
  });

  it('passes policyRouterBudgetMode through', () => {
    const resolved = resolveRunConfig({
      ...base,
      policyRouter: true,
      policyRouterBudgetMode: 'soft',
    });
    expect(resolved.policyRouterBudgetMode).toBe('soft');
  });

  it('all four Tier 3 fields survive resolve together', () => {
    const resolved = resolveRunConfig({
      ...base,
      policyRouter: true,
      policyRouterPreset: 'balanced',
      policyRouterBudgetPerQuery: 0.10,
      policyRouterBudgetMode: 'cheapest-fallback',
    });
    expect(resolved.policyRouter).toBe(true);
    expect(resolved.policyRouterPreset).toBe('balanced');
    expect(resolved.policyRouterBudgetPerQuery).toBe(0.10);
    expect(resolved.policyRouterBudgetMode).toBe('cheapest-fallback');
  });
});
