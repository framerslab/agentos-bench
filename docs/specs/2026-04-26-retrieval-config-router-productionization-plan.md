---
title: RetrievalConfigRouter Productionization, Implementation Plan
date: 2026-04-26
spec: 2026-04-26-retrieval-config-router-design.md
empirical_calibration_source: 2026-04-26 LongMemEval-M Phase A ablation matrix (6 configs × N=54 stratified)
estimated_cost: $0 implementation + ~$16 Phase A validation run
estimated_duration: 3 phases over 1-2 sessions
---

# RetrievalConfigRouter Productionization Plan

## Goal

Wire the calibrated `RetrievalConfigRouter` primitive (already shipped at `packages/agentos/src/memory-router/retrieval-config.ts`) into the production `MemoryRouter` dispatch flow. Currently the calibration tables, selectors, and oracle-aggregate forecasters live in agentos core but no production code path uses them, the router still dispatches on backend only. Productionization extends the dispatch contract so:

1. Real agents using `MemoryRouter` in production get per-category retrieval-config dispatch automatically when they pick the new `minimize-cost-augmented` preset
2. The 68.5% empirical per-category-oracle aggregate (vs 57.4% static M-tuned, +11 pp) becomes available as a real shipping configuration, not just a forecast from existing run JSONs
3. The bench can run a Phase A measurement at the augmented preset and validate the empirical 68.5% with a fresh per-case dispatch run

## Architectural decision: extend MemoryRouter, do not add a sibling primitive

Two design alternatives were considered:

**Design A (chosen): extend `MemoryRouter`'s dispatch key to carry both backend + retrieval-config.** The classifier emits `(category, configRecommendation)`, the routing table maps category → `MemoryDispatchKey { backend, retrievalConfig }`, and the dispatcher's registry keys include both. Backwards-compatible because callers using the existing `MemoryBackendId` keys keep working — those map to `MemoryDispatchKey { backend, retrievalConfig: 'canonical' }` implicitly.

**Design B (rejected): new sibling `RetrievalConfigRouter` orchestrator that wraps `MemoryRouter`.** Cleaner separation, but two routers means two classifier calls per query (~$0.0004 overhead) and two routing tables to keep calibrated. Simpler maintenance to extend the existing primitive.

Picking A.

## Implementation phases

### Phase 1, data plumbing (this session, ~2 hours, $0)

**Goal,** add the types and tables in agentos core that make the augmented dispatch addressable. No behavioral changes; existing consumers see no diff.

**Files to modify or create:**
- Modify, `packages/agentos/src/memory-router/routing-tables.ts`
- Modify, `packages/agentos/src/memory-router/index.ts` (add new exports)
- Create, `packages/agentos/src/memory-router/__tests__/augmented-routing.test.ts`

**Tasks:**

1.1 Add `MemoryDispatchKey` type:
```ts
export interface MemoryDispatchKey {
  backend: MemoryBackendId;
  retrievalConfig: RetrievalConfigId;
}

export const SAFE_FALLBACK_DISPATCH_KEY: MemoryDispatchKey = {
  backend: SAFE_FALLBACK_BACKEND, // 'canonical-hybrid' (existing)
  retrievalConfig: 'canonical',
};
```

1.2 Add `MINIMIZE_COST_AUGMENTED_TABLE` preset, calibrated from M_TUNED_PER_CATEGORY_TABLE:
```ts
export const MINIMIZE_COST_AUGMENTED_TABLE: AugmentedRoutingTable = {
  preset: 'minimize-cost-augmented',
  defaultMapping: {
    'single-session-user':       { backend: 'canonical-hybrid', retrievalConfig: 'hyde-topk50-mult5' },
    'single-session-assistant':  { backend: 'canonical-hybrid', retrievalConfig: 'hyde-topk50-mult5' },
    'single-session-preference': { backend: 'observational-memory-v11', retrievalConfig: 'hyde' },
    'knowledge-update':          { backend: 'canonical-hybrid', retrievalConfig: 'topk50' },
    'multi-session':             { backend: 'observational-memory-v11', retrievalConfig: 'hyde-topk50-mult5' },
    'temporal-reasoning':        { backend: 'canonical-hybrid', retrievalConfig: 'hyde' },
  },
};
```

The mapping merges the LongMemEval-S `MINIMIZE_COST_TABLE` backend choices (SSP, MS → OM-v11; others → canonical) with the LongMemEval-M `M_TUNED_PER_CATEGORY_TABLE` retrieval-config choices (TR → hyde, KU → topk50, etc.). Each (backend, retrievalConfig) pair has empirical justification from at least one Phase A measurement.

1.3 Add `AugmentedRoutingTable` type that wraps the existing `RoutingTable`:
```ts
export interface AugmentedRoutingTable {
  preset: 'minimize-cost-augmented' | 'balanced-augmented' | 'maximize-accuracy-augmented';
  defaultMapping: Record<MemoryQueryCategory, MemoryDispatchKey>;
}
```

1.4 Add pure selector `selectAugmentedDispatch(category, table)`:
```ts
export function selectAugmentedDispatch(
  category: MemoryQueryCategory,
  table: AugmentedRoutingTable,
): MemoryDispatchKey {
  return table.defaultMapping[category] ?? SAFE_FALLBACK_DISPATCH_KEY;
}
```

1.5 Tests, ~10 contract tests:
- `MINIMIZE_COST_AUGMENTED_TABLE` covers every `MemoryQueryCategory`
- Every dispatch key has a valid `MemoryBackendId` + `RetrievalConfigId`
- `selectAugmentedDispatch` returns the calibrated pick for every category
- Falls back to `SAFE_FALLBACK_DISPATCH_KEY` for unknown categories
- Frozen at module load (mutation throws or is silently ignored)

### Phase 2, MemoryRouter integration (next session, ~3 hours, $0)

**Goal,** the existing `MemoryRouter` accepts an `augmentedRoutingTable` option; when set, dispatch returns the structured key. Existing behavior is unchanged when not set.

**Files to modify:**
- `packages/agentos/src/memory-router/classifier.ts`, optional `configRecommendation` field on output
- `packages/agentos/src/memory-router/select-backend.ts`, new `selectDispatchKey` returning `MemoryDispatchKey`
- `packages/agentos/src/memory-router/dispatcher.ts`, support `IMemoryDispatcher.dispatch(key: MemoryDispatchKey, ...)`
- `packages/agentos/src/memory-router/MemoryRouter.ts`, optional `augmentedTable`; new `decideAugmented` + `decideAndDispatchAugmented` methods

**Tasks:**

2.1 Extend `MemoryClassifierResult` with optional `configRecommendation`:
```ts
export interface MemoryClassifierResult {
  category: MemoryQueryCategory;
  configRecommendation?: RetrievalConfigId; // NEW, optional
  // ... existing fields unchanged
}
```

2.2 Update classifier system prompt with one new sentence (only when `useAugmentedClassifier: true` is set):
> "Some queries benefit from retrieval-precision augmentations: HyDE for multi-hop and abstract queries, larger reader windows for multi-session synthesis, larger rerank candidate pools for precision-bound categories. When you classify the category, also recommend a retrieval config: one of `canonical`, `hyde`, `topk50`, `topk50-mult5`, `hyde-topk50`, or `hyde-topk50-mult5`. Default to `canonical` if uncertain."

2.3 New parser branch in `parseClassifierOutput` that handles the structured `(category, configRecommendation)` format.

2.4 Add `selectDispatchKey` to select-backend.ts:
```ts
export function selectDispatchKey(args: {
  category: MemoryQueryCategory;
  table: AugmentedRoutingTable;
  configRecommendation?: RetrievalConfigId;
  budget?: MemoryBudgetPolicy;
  costPoints?: Record<MemoryBackendId, MemoryBackendCostPoint>;
}): { decision: MemoryDispatchKey; reason: string };
```

2.5 Extend `IMemoryDispatcher` to accept `MemoryDispatchKey` (with backwards-compat overload for existing `MemoryBackendId` callers):
```ts
interface IMemoryDispatcher<TTrace, TPayload> {
  dispatch(args: {
    backend: MemoryBackendId;
    retrievalConfig?: RetrievalConfigId;
    query: string;
    payload?: TPayload;
  }): Promise<MemoryDispatchResult<TTrace>>;
}
```

2.6 Extend `FunctionMemoryDispatcher` registry to accept composite keys (`'canonical-hybrid'` for backend-only, `'canonical-hybrid:hyde-topk50-mult5'` for augmented). Look up the composite first, fall back to backend-only if absent.

2.7 New router methods on `MemoryRouter`:
- `decideAugmented(query)` returns `{ classifier, dispatch: { backend, retrievalConfig }, ... }`
- `decideAndDispatchAugmented(query, payload)` runs decide + dispatch with full augmented dispatch

2.8 Tests, ~15 contract tests covering each integration point.

### Phase 3, bench wiring + Phase A validation ($16, 5 hours wall-clock)

**Goal,** the bench can dispatch retrieval-config per case via the augmented router, and we measure the per-category-oracle aggregate empirically (vs the math-from-existing-runs derivation).

**Files to modify:**
- `packages/agentos-bench/src/cli.ts`, new `--retrieval-config-router <preset>` flag
- `packages/agentos-bench/src/core/IBenchmark.ts`, `retrievalConfigRouter` in RunConfig + OPTIONAL_RUN_CONFIG_KEYS
- `packages/agentos-bench/src/core/BenchmarkRunner.ts`, propagate + cache fingerprint
- `packages/agentos-bench/tests/resolveRunConfigContract.spec.ts`, SAMPLES entry
- `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`, per-case dispatch refactor

**Tasks:**

3.1 Add CLI flag with preset validation.

3.2 RunConfig threading + cache fingerprint `stage-rcr:<preset>:v1`.

3.3 Per-case dispatch refactor in `runFullCognitiveCase`:
- When `ctx.config.retrievalConfigRouter === 'minimize-cost-augmented'`:
  - Build a per-case `MemoryRouter` with augmented table
  - Classify the case's question, get `MemoryDispatchKey`
  - Apply the resulting `RetrievalConfigSpec` flags (hyde, rerankCandidateMultiplier, readerTopK) for THIS case's retrieval pipeline, overriding the run-level config
  - Track per-case dispatch decisions in run JSON metadata for reproducibility

3.4 Phase A validation: `pnpm exec tsx src/cli.ts run longmemeval-m --retrieval-config-router minimize-cost-augmented --reader gpt-4o --memory full-cognitive --replay ingest --rerank cohere --hybrid-retrieval --concurrency 1 --sample-per-type 9`

Expected: ~68% accuracy (matches empirical 68.5%) at ~$5-7 LLM (mostly cached because most cases reuse ablation-run results when their dispatched config matches an ablation we already ran). If not cached, ~$10-15 N=54 cost.

3.5 Phase B at full N=500: ~$16, ~5 hours. Publishes the validated 68% with bootstrap CI.

## Decision gates

| Gate | Criterion | Action |
|---|---|---|
| Phase 1 ships | All Phase 1 tests pass; no regression on existing memory-router tests | Merge; Phase 2 unblocked |
| Phase 2 ships | Phase 2 tests pass; existing consumers' dispatch behavior unchanged | Merge; Phase 3 unblocked |
| Phase 3 Phase A passes | Empirical aggregate ≥ 65% on M N=54 (forecast 68.5%, allow 3.5 pp tolerance for N=54 noise) | Proceed to Phase B at full N |
| Phase 3 Phase B ships | Bootstrap CI on M aggregate at N=500 | Update LEADERBOARD with validated `MINIMIZE_COST_AUGMENTED` row |

## Calibration sources

The `MINIMIZE_COST_AUGMENTED_TABLE` mapping is data-driven from these run JSONs:

| Source | What it calibrates |
|---|---|
| `2026-04-26T01-40-34-904--longmemeval-m--ingest.json` (combined M-tuned, 57.4%) | `hyde-topk50-mult5` per-category accuracies |
| `2026-04-26T02-13-35-497--longmemeval-m--ingest.json` (HyDE only, 46.3%) | `hyde` per-category accuracies (best for TR + SSP) |
| `2026-04-26T02-08-40-380--longmemeval-m--ingest.json` (TopK only, 48.1%) | `topk50` per-category accuracies (best for KU) |
| LongMemEval-S Phase B N=500 (existing, MEMORY_ROUTER.md table) | Backend-choice per category (SSP, MS to OM-v11, others to canonical) |

The mapping mixes both axes: backend from S calibration, retrieval-config from M calibration. The combined preset is data-justified at every category.

## Risks

| Risk | Mitigation |
|---|---|
| Per-case dispatch refactor in `runFullCognitiveCase` is invasive | Keep existing static-config path as default; new `--retrieval-config-router` flag opts in |
| Augmented classifier prompt drifts the existing classifier's category prediction | Phase 2 tests pin existing classifier behavior; new prompt only when `useAugmentedClassifier: true` |
| Phase A validation undershoots the 68.5% forecast | N=54 has wide CI; document any ±5 pp delta as noise. Phase B at N=500 tightens. |
| Backend OM-v11 dispatch on M is expensive (OM ingest at 500 sessions per case) | Augmented preset routes only SSP + MS to OM-v11. Phase A budget ~$15-20 with OM ingest amortized over those cases. |

## Out of scope

- LOCOMO calibration of the augmented table (M-only initially; LOCOMO calibration in v3 alongside Stage E)
- BEAM augmented dispatch (BEAM adapter still placeholder; addressed in v3)
- Multi-tier augmented presets (`balanced-augmented`, `maximize-accuracy-augmented`); v3 work
- Backwards-compatible classifier output for OLD callers that emit only `category`; existing unaugmented router preserves the old shape, augmented router uses the new shape

## Status

DRAFT. Phase 1 starts immediately upon spec approval, in parallel with the running M-tuned Phase B at N=500 (no code conflict, no memory pressure).
