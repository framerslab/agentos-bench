---
title: RetrievalConfigRouter — Dynamic Retrieval-Config Selection (Design)
date: 2026-04-26
scope: extend MemoryRouter primitive with retrieval-config variants (HyDE / hierarchical / typed-network) selected per-query via LLM-as-judge classifier; preserve opt-in shipping defaults
methodology_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md, MEMORY_ROUTER.md (existing primitive), STAGE_J_PHASE_B_FINDINGS_2026-04-25.md (the 30.6% LongMemEval-M number that motivates this spec)
estimated_cost: $0 implementation (pure code) + ~$30 Phase A calibration measurements + Phase B costs gated by Phase A signal
estimated_duration: 1-2 weeks (pure code Phase 1-3 + Phase A measurement gate)
status: DRAFT — needs user approval before implementation
---

# RetrievalConfigRouter — Dynamic Retrieval-Config Selection

## 1. Goal

Extend the [`@framers/agentos/memory-router`](../../../packages/agentos/src/memory-router) primitive so its LLM-as-judge classifier picks among **retrieval-config variants** (HyDE-augmented, hierarchical-session, typed-network, canonical-hybrid baseline) per query — not just among retrieval BACKENDS as today.

The shipping default for any consumer who doesn't register augmented variants stays unchanged: canonical-hybrid + observational-memory-v10/v11 routing as today, no static always-on HyDE / hierarchical / typed-network. Augmentation is **opt-in by registration**: a consumer who registers a `canonical-hybrid+hyde` executor in the dispatcher gets it as a routable option; otherwise it's not in the routing table and the classifier never picks it.

The motivation: AgentOS's 30.6% LongMemEval-M Phase B headline ([STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../STAGE_J_PHASE_B_FINDINGS_2026-04-25.md)) is precision-bound on multi-session and temporal-reasoning categories at 500-session-haystack scale. Different retrieval augmentations help different categories: HyDE helps abstract / multi-hop, hierarchical helps multi-session coverage, typed-network (Stage E) helps long-history precision. A static always-on stack is the wrong choice; a classifier-driven dispatcher that picks the cheapest sufficient augmentation per category is the right one.

## 2. Why this is the right architectural step

The MemoryRouter primitive already implements LLM-as-judge dispatch among recall backends. The `minimize-cost` preset routes single-session questions to canonical-hybrid (cheap), multi-session to OM-v11 (expensive but architecturally appropriate). That pattern works because per-category Phase B measurements show different backends dominate different categories.

Same calibration logic applies to retrieval-config variants:

- HyDE adds ~$0.001 per query (one cheap-LLM hypothesis call). It helps multi-hop and abstract queries; it's wasted spend on precise-fact queries.
- Hierarchical session retrieval adds ~$0.005 per query (session-summary stage). It helps multi-session coverage at 500-session haystacks; it's marginal on single-session questions.
- Typed-network retrieval adds ~$0 per query at retrieval time once the typed network is built (the cost is at ingest). It helps long-history precision and multi-session synthesis; it's wasted on simple lookups.

The routing table maps categories to (backend, retrieval-config) pairs. The classifier predicts the category. The dispatcher invokes the right executor.

This is the same pattern as the existing MemoryRouter, extended one axis. Same opt-in discipline (register what you want, the router only picks among registered options). Same calibration discipline (per-category measurements feed the table).

## 3. Architecture

### 3.1 Backend ID extension

The current `MemoryBackendId` type is a flat enum of three values:

```ts
type MemoryBackendId =
  | 'canonical-hybrid'
  | 'observational-memory-v10'
  | 'observational-memory-v11';
```

Extension: introduce a structured `MemoryDispatchKey` that carries both backend and retrieval-config:

```ts
interface MemoryDispatchKey {
  backend: MemoryBackendId;
  retrievalConfig: RetrievalConfigId;
}

type RetrievalConfigId =
  | 'canonical'        // BM25 + dense + Cohere rerank, top-K reader
  | 'hyde'             // canonical + HyDE hypothetical-doc embedding
  | 'hierarchical'     // 2-stage session-summary then per-session chunk retrieval
  | 'typed-network'    // Hindsight 4-network spreading activation + 4-way RRF
  | 'hyde+hierarchical' // composite
  | 'typed-network+hyde'; // composite
```

The dispatcher registry is now keyed by `MemoryDispatchKey` (or an opaque string fingerprint). Consumers register only the (backend, config) combinations they support.

### 3.2 Classifier changes

The current classifier emits a `MemoryQueryCategory` (six categories) without considering augmentation tactics. The extended classifier emits both:

```ts
interface RetrievalRoutingDecision {
  category: MemoryQueryCategory;
  configRecommendation: RetrievalConfigId;
  // ... existing fields
}
```

The classifier prompt is augmented with two sentences:

> Some queries benefit from HyDE (cheap hypothetical-answer rewriting) before retrieval — typically multi-hop and abstract queries. Some benefit from hierarchical session retrieval — typically multi-session synthesis on long histories. Some benefit from typed-network spreading activation — typically long-history precision tasks where the same entity appears across many sessions. Most queries don't need augmentation.
>
> When you classify the category, also recommend a retrieval config: one of `canonical`, `hyde`, `hierarchical`, `typed-network`, or a composite. Default to `canonical` if uncertain.

The classifier output is then a `(category, configRecommendation)` tuple. The routing table can use either or both for the dispatch decision.

### 3.3 Routing-table extension

The current `RoutingTable` is `Record<MemoryQueryCategory, MemoryBackendId>`. The extended table is `Record<MemoryQueryCategory, MemoryDispatchKey>`:

```ts
const MINIMIZE_COST_AUGMENTED_TABLE: RoutingTable = {
  'single-session-user':       { backend: 'canonical-hybrid', retrievalConfig: 'canonical' },
  'single-session-assistant':  { backend: 'canonical-hybrid', retrievalConfig: 'canonical' },
  'single-session-preference': { backend: 'observational-memory-v11', retrievalConfig: 'canonical' },
  'knowledge-update':          { backend: 'canonical-hybrid', retrievalConfig: 'canonical' },
  'multi-session':             { backend: 'observational-memory-v11', retrievalConfig: 'hierarchical' },
  'temporal-reasoning':        { backend: 'canonical-hybrid', retrievalConfig: 'typed-network' },
};
```

Categories that historically over-cost on always-on backends now route to cheaper backends + augmentations that lift the gap. Per-category Phase B measurements drive the assignments — not opinion.

The shipping `MINIMIZE_COST_TABLE` preserves the current routing (no augmentations); the new `MINIMIZE_COST_AUGMENTED_TABLE` is opt-in via `preset: 'minimize-cost-augmented'`.

### 3.4 Dispatcher executor signature

Each retrieval-config variant ships as an executor matching the `IMemoryDispatcher` shape:

```ts
interface IMemoryDispatcher<TTrace> {
  dispatch(key: MemoryDispatchKey, query: string, options: unknown): Promise<TTrace[]>;
}
```

`FunctionMemoryDispatcher` registers per-key executors:

```ts
const dispatcher = new FunctionMemoryDispatcher({
  'canonical-hybrid:canonical': async (q, opts) => myCanonicalHybrid(q, opts),
  'canonical-hybrid:hyde': async (q, opts) => myHybridWithHyde(q, opts),
  'canonical-hybrid:hierarchical': async (q, opts) => myHybridWithHierarchical(q, opts),
  'observational-memory-v11:canonical': async (q, opts) => myOMv11(q, opts),
  'observational-memory-v11:hierarchical': async (q, opts) => myOMv11WithHierarchical(q, opts),
  // ... typed-network variants registered if available
});
```

If the routing table picks a key that has no registered executor, the router falls back to the cheapest registered key for that category (preserves the existing `cheapest-fallback` budget mode behavior).

## 4. Per-category calibration data needed

The routing table is calibration-driven. Phase A measurements at `--sample-per-type 9` (N=54 stratified per benchmark) for each (backend, retrieval-config) cell give per-category cost-accuracy points. The Phase A budget is bounded by the number of registered variants × benchmarks × $5/cell.

For v1 of this spec (LongMemEval-S + LongMemEval-M + LOCOMO):

| Variant | Phase A budget | Expected lift target |
|---|---:|---|
| `canonical-hybrid:canonical` | $0 (cached from existing measurements) | baseline |
| `canonical-hybrid:hyde` | ~$15 (3 benchmarks × $5) | +5-10pp on multi-hop / temporal-reasoning |
| `canonical-hybrid:hierarchical` | ~$30 (3 × $10, includes session-summary one-time cost) | +10-15pp on multi-session at M scale |
| `canonical-hybrid:typed-network` | ~$30 (3 × $10, includes typed-extraction ingest) | +5-10pp on multi-session + temporal-reasoning |
| `observational-memory-v11:canonical` | $0 (cached) | baseline |
| `observational-memory-v11:hierarchical` | ~$50 (OM ingest + hierarchical, 3 × ~$17) | +5-10pp on MS at M scale (hypothesis: hierarchical augments OM-v11's session-level signal) |
| Composite cells (HyDE + hierarchical, typed-network + HyDE) | ~$50 | TBD per Phase A signal |

Total Phase A: ~$175. Phase B for surviving variants: ~$200-400. Total: $375-575.

## 5. Decision gates

| Gate | Criterion | Action |
|---|---|---|
| Variant survives Phase A | Phase A point estimate ≥ baseline + 2pp on its target category | Promote to Phase B at full N |
| Variant ships as default | Phase B aggregate beats current Tier 3 min-cost on ≥ 2 of 6 categories AND $/correct stays within 2x of baseline | Add to `minimize-cost-augmented` table |
| Variant ships as opt-in only | Phase B beats baseline on ≥ 1 category but exceeds 2x cost OR has a documented stability concern | Documented as available variant; not in default table |
| Variant dropped | Phase B fails to beat baseline on any category | Documented as a third negative finding alongside Stage L + Stage I |

The decision-gate discipline matches the existing v1 spec.

## 6. Why this preserves the opt-in invariant

The user's recent direction: "make sure stuff like HyDE remains optional and opt-in by default and other stuff as needed for weaker metrics ... done dynamically with LLM as judge in the rag orchestrator selection."

This spec preserves opt-in three ways:

1. **Default routing table doesn't change.** The current `MINIMIZE_COST_TABLE` ships with no augmentations. The new `MINIMIZE_COST_AUGMENTED_TABLE` is selected only by passing `preset: 'minimize-cost-augmented'` (or by passing a custom routing table).
2. **Dispatcher registration is the gating mechanism.** A consumer who doesn't register any HyDE-augmented executor will never have one picked, even if the routing table says to. The router downgrades to the cheapest registered alternative (existing `cheapest-fallback` semantics).
3. **Augmentation suggestion is informational.** The classifier emits a `configRecommendation` field; the routing table can ignore it. Consumers can use the recommendation as a hint without binding to it.

## 7. Out of scope (explicitly)

- Static always-on retrieval augmentation. This spec is the inverse — augmentations are picked per-query.
- ReadRouter dispatch over reader-strategy + reader-model variants. That's the analogous extension on the read stage; out of scope for this spec.
- Cross-vendor HyDE / hierarchical / typed-network reproductions. v2 publication concern.
- Re-classifying queries within a single session (sticky decisions on conversational continuity). v3 concern.

## 8. Anchors + dependencies

- Methodology source: [SOTA_CITED_EVIDENCE_2026-04-25.md](../SOTA_CITED_EVIDENCE_2026-04-25.md) — primary-source-cited foundation for HyDE / hierarchical / typed-network architectures.
- Existing primitive to extend: [packages/agentos/src/memory-router/](../../../../packages/agentos/src/memory-router) — current `MemoryRouter` + `LLMMemoryClassifier` + `FunctionMemoryDispatcher`.
- Stage E spec: [2026-04-26-hindsight-4network-observer-design.md](2026-04-26-hindsight-4network-observer-design.md) — typed-network executor that this router can dispatch to.
- v1 publication context: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../STAGE_J_PHASE_B_FINDINGS_2026-04-25.md) — the 30.6% LongMemEval-M number that motivates dynamic retrieval-config selection.
- Existing Adaptive Memory Router: [packages/agentos/src/memory-router/adaptive.ts](../../../../packages/agentos/src/memory-router/adaptive.ts) — the calibration-data-driven extension that this spec builds on.

## 9. Open architectural questions

1. **Dispatch key as string vs structured object.** The simpler implementation uses `string` keys like `'canonical-hybrid:hyde'` (colon-separated). The structured `MemoryDispatchKey` is cleaner for consumer code. **Recommend:** ship both — the structured object for the routing table, the colon-separated string for the dispatcher registry key. The router does the round-trip internally.
2. **Where does HyDE invocation live.** Options: (a) in the executor for each `*+hyde` variant (more boilerplate, simpler interface), (b) in a wrapping decorator the consumer applies to any dispatcher (less boilerplate, more invasive). **Recommend:** start with (a); the wrapping decorator can be a follow-up if duplication becomes painful.
3. **Classifier prompt growth.** Adding the augmentation-recommendation step to the classifier prompt grows the per-query token cost slightly (~50 tokens). **Recommend:** measure the FPR change at the augmented prompt before shipping; if FPR rises, split into a second classifier call only when augmented dispatch is enabled.
4. **Fallback rule when registered executors don't cover the routing-table choice.** Current MemoryRouter `cheapest-fallback` semantics. **Recommend:** preserve.

## 10. Success criteria

This spec is successful if:

1. The augmented router ships in agentos core within 1-2 weeks of approval.
2. At least one augmentation variant beats the baseline on ≥ 1 category at Phase B and ships in `MINIMIZE_COST_AUGMENTED_TABLE`.
3. Per-category Phase B measurements are documented with bootstrap CIs and per-case run JSONs at seed=42.
4. The shipping default (`minimize-cost` preset, no augmentations) is unchanged — every existing consumer's pipeline still works without modification.
5. The new opt-in path (registering augmented executors + selecting `minimize-cost-augmented` preset) is documented with a code example in `MEMORY_ROUTER.md`.

## 11. Status

DRAFT. Awaiting user approval of:

1. The architecture (extend MemoryRouter dispatch key vs new sibling primitive).
2. The Phase A calibration budget (~$175).
3. The variant set to test in v1 (HyDE / hierarchical / typed-network and 2 composites, vs broader sweep).
4. The augmented-classifier-prompt design (single-call with both outputs, vs two separate classifier calls).

Implementation plan to follow once approved.
