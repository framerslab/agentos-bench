---
title: Stage E: Hindsight 4-Network Typed Observer (Design v3)
date: 2026-04-26 (v1), 2026-04-25 revision v2 (bench-vs-core, fusion model pinned), 2026-04-25 revision v3 (rebased after concurrent shipping of Phase 4.1-4.3 + TypedNetworkRetriever; v2 design is now Phase 4.4)
scope: agentos core memory subsystem (typed-network module) + bench wiring + Phase A measurement + Phase 4.4 RRF enhancement
methodology_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md §2 (Hindsight paper, arxiv:2512.12818)
estimated_cost: $321-371 ex-shipping ($30 Phase A + $290 Phase B + $1-5 smoke); $50 optional parallel M-tuned Phase B; $500-800 with cushion
estimated_duration: Phase 4c smoke + Phase A ~1 day each; Phase 4.4 RRF ~2 days; Phase B ~2 days
status: DRAFT v3, awaiting plan approval. Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever SHIPPED in agentos@0.4.0. Phase 4c (smoke) and Phase A (LongMemEval-S N=54) are next. Phase 4.4 (4-way RRF + budget-split prompt blocks) is the explicit follow-up named in the d0ab11c5 commit message.
---

# Stage E: Hindsight 4-Network Typed Observer Design

## 1. Goal

Add a typed-network observer architecture to agentos core that decomposes incoming content into four typed graphs (World, Experience, Opinion, Observation) with bidirectional typed edges, then performs spreading activation across the typed graph at retrieval time and fuses four signals (semantic + BM25 + graph activation + temporal interval overlap) via RRF.

This is the only remaining accuracy-push candidate after Stage L (Anthropic Contextual Retrieval) and Stage I (Mem0-v3-style entity-linking) both measured negative on top of our hybrid + Cohere rerank pipeline. It is a fundamentally different architecture (typed graph traversal across long histories), not a lightweight signal addition.

Reference: arxiv.org/html/2512.12818v1 (Hindsight paper). Open SOTA: 91.4% LongMemEval-S Gemini-3-pro, 89.0% OSS-120B; 89.61% LOCOMO OSS-120B; 64.1% BEAM 10M.

## 2. Architecture (verbatim from the paper, §2.1-§2.3)

### 2.1 Memory unit

```
f = (u, b, t, v, τs, τe, τm, ℓ, c, x)
```

Where:
- `u`, unique ID
- `b`, bank ID (one of W / E / O / S)
- `t`, narrative text
- `v`, embedding vector
- `τs, τe`, occurrence interval (start, end)
- `τm`, mention timestamp
- `ℓ`, fact type (one of W / E / O / S, the bank ID)
- `c`, confidence ∈ [0, 1]
- `x`, auxiliary metadata (entities, participants, source)

### 2.2 Four typed networks

| Bank | Symbol | Definition (verbatim) | Example |
|---|---|---|---|
| World | 𝒲 | "objective facts about the external world" | "The user lives in Berlin" |
| Experience | ℬ | "biographical information…written in the first person" | "I helped the user debug a Docker issue last Tuesday" |
| Opinion | 𝒪 | tuple `(t, c, τ)` = text, confidence ∈[0,1], timestamp | "I think the user prefers TypeScript over Python" with c=0.7 |
| Observation | 𝒮 | "preference-neutral summaries of entities" | "Berlin is a city in Germany" |

The bank assignment is a routing decision made by the LLM extractor (§3 below).

### 2.3 Fact extraction pipeline (verbatim, six steps)

> "decompose[d] into…1) coreference resolution, 2) temporal expression normalization and range extraction, 3) participant attribution, 4) preservation of explicit reasoning, 5) fact type classification, 6) entity extraction."

Output schema per fact:
- narrative text
- normalized temporal information (including ranges as `τs, τe`)
- participants and their roles
- a fact type indicating the target network (W / E / O / S)
- a set of mentioned entities

### 2.4 Retrieval (Four-way fusion)

#### 2.4.1 Spreading activation (verbatim Eq. 12)

```
A(fj, t+1) = max[(fi,fj,w,ℓ)∈E] [A(fi,t) · w · δ · μ(ℓ)]
```

Where:
- `δ ∈ (0, 1)`, decay factor per hop
- `μ(ℓ)`, link-type multiplier (one of: temporal, semantic, entity, causal)

#### 2.4.2 Edge typing and weights

| Link type | Weight formula |
|---|---|
| Temporal | `exp(−Δtij / σt)` (smaller `Δt` → larger weight) |
| Semantic | cosine similarity, gated by `≥ θs` threshold |
| Entity | bidirectional, weight = 1.0 for any shared entity |
| Causal | LLM-extracted from explicit reasoning markers, weight = 1.0 |

#### 2.4.3 Fusion

Reciprocal Rank Fusion (RRF) over four ranked lists:
- Semantic similarity (cosine over embeddings)
- BM25 (lexical)
- Graph spreading activation (per §2.4.1)
- Temporal interval overlap (`(τs, τe)` of fact vs query timestamp)

RRF formula (standard k=60):

```
score(f) = Σ over rankings R of [1 / (k + rank_R(f))]
```

## 3. Why this should lift our shipping baseline

Our 76.6% LongMemEval-S / 51.5% LOCOMO / 30.6% LongMemEval-M baseline is precision-bound on the harder categories. Specifically:

| Category | Tier 3 min-cost @ S | @ M |
|---|---:|---:|
| multi-session | 54.9% | 18.0% (-37pp at scale) |
| temporal-reasoning | 70.2% | 12.8% (-57pp at scale) |

Multi-session and temporal-reasoning collapse at M scale because the right session simply doesn't make the top-20 most of the time. The hybrid + Cohere rerank stack lacks:

1. **Typed graph traversal**: a "what facts are connected to this question's entities?" query. Cohere rerank's cross-encoder operates on raw text; it has no notion of an entity-typed edge.
2. **Temporal interval overlap as a primary signal**: temporal-reasoning collapses because the only temporal signal in our pipeline is timestamps embedded in chunk text. A fact's `(τs, τe)` interval as a first-class retrieval dimension is missing.
3. **Spreading activation across typed edges**: a question about "the deployment from last Tuesday" should activate facts in the World network (the deployment event), Experience network (the assistant's memory of helping), Observation network (what the deployment was about), and Opinion network (the user's stated preferences for deployment style). Today, each is retrieved independently if at all.

Hindsight's open SOTA at OSS-120B (89.0% LongMemEval-S, 89.61% LOCOMO) demonstrates that the architecture lifts on the same benchmarks where our baseline plateaus. Worst case for us: we measure +0pp on LongMemEval-S (our Cohere rerank already does the semantic heavy lifting) but +5-15pp on LongMemEval-M and LOCOMO multi-hop where retrieval precision dominates.

## 4. Architecture map (agentos core)

### 4.1 Module: `packages/agentos/src/memory/retrieval/typed-network/`

The agentos memory subsystem is organized into `core/` (encoding, decay, working memory, prompt), `retrieval/` (graph, store, typed-network), `ingest/` (session summarizer, etc.), `io/` (facade), `archive/`, `mechanisms/`, and `pipeline/`. The typed-network module sits alongside `retrieval/graph/` (which holds the existing untyped `SpreadingActivation.ts`) so the Stage E primitives compose with the existing retrieval pipeline.

```
packages/agentos/src/memory/retrieval/typed-network/
├── types.ts                          # Fact type, BankId, TypedEdge, TypedFact            [SHIPPED]
├── TypedNetworkObserver.ts           # LLM-driven 6-step extraction pipeline              [SHIPPED]
├── TypedNetworkStore.ts              # 4-network in-memory store                          [SHIPPED]
├── TypedSpreadingActivation.ts       # Eq. 12 spreading activation with typed weights     [SHIPPED]
├── TypedNetworkRetriever.ts          # ScoredMemoryTrace[] adapter for canonical pool     [SHIPPED]
├── FourWayRrf.ts                     # RRF fusion over (semantic, BM25, graph, temporal)  [SHIPPED, unused at retrieve until Phase 4.4]
├── TemporalIntervalOverlap.ts        # (τs, τe) overlap as a ranked signal                [SHIPPED, unused at retrieve until Phase 4.4]
├── prompts/
│   ├── extraction-prompt.ts          # Verbatim 6-step extraction prompt                  [SHIPPED]
│   └── extraction-schema.ts          # Zod schema for the LLM's structured output         [SHIPPED]
├── __tests__/
│   ├── types.test.ts                 # 9 tests
│   ├── TypedNetworkObserver.test.ts  # 12 tests (1 added for code-fence stripping)
│   ├── TypedNetworkStore.test.ts     # 11 tests
│   ├── TypedSpreadingActivation.test.ts # 12 tests
│   ├── TypedNetworkRetriever.test.ts # 15 tests (entity extraction + activation ranking)
│   ├── FourWayRrf.test.ts            # 9 tests
│   └── TemporalIntervalOverlap.test.ts # 7 tests
└── index.ts                          # Barrel exports                                     [SHIPPED]

Total: 75/75 typed-network tests passing in agentos@0.4.0 (HEAD `230c6aea`).
```

### 4.2 Integration points with `CognitiveMemoryManager` (SHIPPED Phase 4.1-4.3 + TypedNetworkRetriever)

Integration lives in agentos core, per the durable rule "agentos-bench is benchmarks only; all memory/RAG/retrieval improvements go in agentos core." The bench configures the manager and consumes the manager's typed-network primitives via the `BenchCognitiveHandle` passthrough.

#### 4.2.A Shipped behavior (Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever)

1. **Configuration (Phase 4.1, commit `cac63c2`)**. New optional `typedNetwork?: TypedNetworkConfig` field on `CognitiveMemoryConfig`. When undefined, the manager constructs zero typed-network state and behaves identically to the pre-Stage-E pipeline. When set, the manager owns the subsystem and exposes it through new accessors `getTypedNetworkStore()`, `getTypedNetworkObserver()`, `getTypedNetworkSpreadingActivation()`.

2. **Ingest (Phase 4.2, commit `a604d86`)**. `CognitiveMemoryManager.encode()`, after the standard MemoryTrace store + graph addNode, calls `TypedNetworkObserver.extract(input, trace.id)` and appends each resulting fact to the manager's `TypedNetworkStore`. Errors are caught, logged via `process.stderr.write`, and do not propagate. Embedder-coherence rule (§4.2.2) is satisfied via the observer's invocation through the manager's existing LLM adapter.

3. **Retrieve MVP (Phase 4.3, commit `d0ab11c5`)**. `CognitiveMemoryManager.retrieve()`, after the existing 6-signal cognitive scoring + reranker pass returns its scored traces, additionally runs (when typedNetwork is configured with variant 'full' AND store has facts):
   - Collect seed entities via `collectStageESeedEntities(query, scored)`: union of (entities mentioned in top-5 scored traces) + (naive proper-noun extraction from the query text, capitalized whitespace tokens)
   - Find seed fact IDs whose entities intersect (case-insensitive) the seed entities
   - `TypedSpreadingActivation.spread(store, seedIds, { maxDepth: config.typedNetwork.maxDepth ?? 3 })`
   - Sort by activation level, take top-10
   - Surface as `result.diagnostics.retrievedTypedFacts: TypedFact[]`
   The `minimal` variant skips the spread and surfaces no facts; encode still routes through the observer.

4. **Bench-side adapter (commit `230c6aea`)**. `TypedNetworkRetriever` wraps the manager's typed-network store + spreading activation, exposing `retrieve(query, options)` returning `ScoredMemoryTrace[]`. `extractQueryEntities` (regex: proper nouns ≥ 3 chars + quoted strings) drives seed selection. `typedFactToScoredTrace` converts each TypedFact into a `ScoredMemoryTrace` shape with: ID `typed-network:<factId>`, content `[<BANK>] <text>` (bank-prefixed for reader hint), `sourceType: 'typed_network'`, tags `['typed-network', 'bank:<bank>']`, `retrievalScore` set from activation level.

5. **Bench-side wiring (uncommitted in working tree, this session)**. `LongMemEvalS:1730-1762` instantiates `TypedNetworkRetriever` from `handle.typedNetworkStore` + `handle.typedNetworkSpreadingActivation`, calls `retrieve(c.question, {topK: retrievalTopK, scope})`, appends typed traces to the canonical retrieval pool with `retrieval.retrieved = [...retrieval.retrieved, ...typedTraces]`. Bench reader sees a single retrieval list with both raw chunks and typed facts, distinguished by content prefix and `sourceType`.

#### 4.2.B Phase 4.4 enhancement (NOT SHIPPED): 4-way RRF + budget-split prompt blocks

Per the d0ab11c5 commit message: "Phase 4.3 IS AN MVP: it does not yet fuse typed-network rankings into the composite trace score. That fusion (4-way RRF + weighted merge with the existing scored list) lands in a follow-up iteration once Phase 4.4 wires the bench reader to consume typed facts directly."

Phase 4.4 adds three pieces:

1. **4-signal ranking inside `manager.retrieve()` (when variant='full')**, replacing today's spreading-only seed-then-spread MVP:
   - Embed query via the manager's `IEmbeddingManager`
   - Cosine similarity vs every typed-fact embedding, producing the `semantic` ranking
   - In-memory BM25 over typed-fact text (lexical), producing the `bm25` ranking
   - `TypedSpreadingActivation.spread()` seeded from top-5 `semantic`, producing the `graphActivation` ranking
   - `rankByTemporalOverlap(facts, queryTimestamp)`, producing the `temporalOverlap` ranking
   - `fourWayRrf({ semantic, bm25, graphActivation, temporalOverlap })` to produce the fused `TypedFact[]`
   The fused list replaces the seed-then-spread MVP as the source of `diagnostics.retrievedTypedFacts`. The `minimal` variant skips spreading + RRF and returns the top-N typed facts by `semantic` ranking only.

2. **Fusion model in the bench reader prompt (token-budget split, NOT score-blend)**. The reader prompt becomes two separate context blocks, `[Memory]` (existing scored traces) and `[Typed memory]` (typed facts via 4-way RRF), each allocated a slice of the manager's memory token budget per `budgetSplit`. The two fractions sum to 1.0; default `{traces: 0.5, typedFacts: 0.5}`. Setting `{traces: 1.0, typedFacts: 0.0}` disables the typed-memory block without disabling extraction (ablation). Setting `{traces: 0.0, typedFacts: 1.0}` is Hindsight-pure. The shipped option-B behavior (typed facts appended to canonical pool by `TypedNetworkRetriever`) coexists as the default until Phase A confirms which path is preferable.

3. **Phase 4.4 rationale for token-budget split over score-blend**. Score-blend (the shipped option B; typed facts treated as additional `ScoredMemoryTrace` entries in the canonical pool) inherits the Stage L + Stage I failure mode (signal-stacking on top of an already-tuned Cohere reranker). Token-budget split preserves both pipelines fully and gives the reader a structural cue (separate `[Typed memory]` block) about which facts are typed vs. raw. The d0ab11c5 commit message explicitly names this as the next iteration.

#### 4.2.C Shared invariants

5. **Spreading activation coexistence**: existing untyped `SpreadingActivation` (`packages/agentos/src/memory/retrieval/graph/SpreadingActivation.ts`) is unchanged. `TypedSpreadingActivation` is a separate primitive. The untyped path runs over the existing `IMemoryGraph`; the typed path runs over the `TypedNetworkStore`. They coexist.

6. **Storage**: typed facts live in the in-memory `TypedNetworkStore`, NOT in the existing `MemoryStore` or knowledge graph. The two pools are independent. Persistence beyond per-session scope is out of scope for v1 per §12.

### 4.2.1 `TypedNetworkConfig`: shipped knob surface + Phase 4.4 additions

#### Shipped (agentos@0.4.0)

```typescript
export interface TypedNetworkConfig {
  /** Variant. minimal: bank routing at encode + facts surfaced via getTypedNetworkStore (no spread).
   *  full: minimal + spreading activation at retrieve, top-10 facts via diagnostics.retrievedTypedFacts. */
  variant: 'minimal' | 'full';
  /** Provider-agnostic LLM adapter for the 6-step extraction prompt. Required. */
  observerLLM: ITypedExtractionLLM;
  /** Reserved for Phase 4.4 fusion weight; currently stored but unused. Default 0.5. */
  weight?: number;
  /** Per-hop decay δ ∈ (0, 1) for spreading activation. Default 0.5. Only used when variant='full'. */
  decay?: number;
  /** Spreading-activation max depth. Default 3. Only used when variant='full'. */
  maxDepth?: number;
}
```

Universal-default rule: typed-network is OFF when this config is undefined. Shipping consumers see zero behavior change.

#### Phase 4.4 additions (NEW, on top of shipped)

```typescript
export interface TypedNetworkConfig {
  // ... fields above ...
  /** Per-edge-kind activation multipliers μ(ℓ). Default {entity:1.0, causal:1.0, temporal:0.7, semantic:0.6}. */
  edgeMultipliers?: Record<EdgeKind, number>;
  /** RRF k constant. Default 60 (Hindsight §2.4.3). */
  rrfK?: number;
  /** Activation cutoff threshold. Default 0.05. */
  activationThreshold?: number;
  /** Token-budget split between traces and typed facts. Fractions sum to 1.0.
   *  Default {traces:0.5, typedFacts:0.5}. Replaces the v3 'weight' scalar. */
  budgetSplit?: { traces: number; typedFacts: number };
  /** Observer extraction max output tokens. Default 4096. */
  extractionMaxTokens?: number;
  /** Observer extraction temperature. Default 0. */
  extractionTemperature?: number;
  /** Phase 4.4 retrieval mode. 'pool-append' (today's option B, default for back-compat)
   *  or 'budget-split' (option A, the d0ab11c5 follow-up). When 'budget-split', the bench
   *  formats typed facts as a separate [Typed memory] reader-prompt block. */
  retrievalMode?: 'pool-append' | 'budget-split';
}
```

Phase 4.4 invariants:
- `retrievalMode: 'pool-append'` (default) preserves shipped behavior. Bench's `TypedNetworkRetriever` keeps appending typed facts to canonical pool.
- `retrievalMode: 'budget-split'` activates 4-way RRF + separate prompt block. Inside `manager.retrieve()` the 4-signal pipeline replaces the seed-then-spread MVP. Bench reader formats `[Typed memory]` block at `budgetSplit.typedFacts * memoryBudget` tokens.
- `weight` (shipped scalar) is deprecated in favor of `budgetSplit` once Phase 4.4 lands. Until Phase 4.4, it's stored but unused.

Every knob has a sensible default; consumers who pass `{variant, observerLLM}` get the shipped pipeline. Phase 4.4 consumers add `{retrievalMode: 'budget-split'}` to opt into the enhancement.

### 4.2.2 Embedder coherence

Typed-fact embeddings MUST be generated via the host manager's existing `IEmbeddingManager`. No separate embedder. Rationale: same provider for trace + typed-fact embeddings keeps cosine similarity scales aligned, removes a configuration footgun, and matches the existing pattern (Cohere reranker, HyDE, prospective memory all inherit the manager's embedder). At the bench, this means `CharHashEmbedder` for shipping configurations and `OpenAIEmbedder` for paired ablations: same as today.

### 4.3 Bench wiring (mostly SHIPPED; Phase 4.4 adds the [Typed memory] formatter)

The bench's responsibility is to pass `typedNetwork` config through to the manager and (in Phase 4.4) format `diagnostics.retrievedTypedFacts` as a `[Typed memory]` reader-prompt block. The handle's `typedNetworkStore` / `typedNetworkObserver` / `typedNetworkSpreadingActivation` fields are now passthrough accessors backed by the manager's instance fields (per [createCognitiveManager.ts:387-401](../../src/cognitive/createCognitiveManager.ts#L387-L401)).

```
packages/agentos-bench/src/cli.ts
    --typed-network [variant]                                                       [SHIPPED]

packages/agentos-bench/src/core/IBenchmark.ts
    RunConfig.typedNetwork: 'minimal' | 'full'                                      [SHIPPED]
    OPTIONAL_RUN_CONFIG_KEYS includes 'typedNetwork'                                [SHIPPED]

packages/agentos-bench/src/core/BenchmarkRunner.ts
    resolveRunConfig propagates typedNetwork                                        [SHIPPED]
    cache fingerprint stage-e-typed-network:<variant>:v1                            [SHIPPED]

packages/agentos-bench/tests/resolveRunConfigContract.spec.ts
    SAMPLES.typedNetwork = 'minimal'                                                [SHIPPED]

packages/agentos-bench/src/cognitive/createCognitiveManager.ts                      [SHIPPED]
    handle.typedNetworkStore / typedNetworkObserver / typedNetworkSpreadingActivation
    are passthrough accessors backed by manager.getTypedNetworkStore() etc.

packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts                   [SHIPPED]
    Ingest: handle.typedNetworkObserver.extract per session in both replay branches
            (the manager-owned observer is invoked through the handle passthrough)
    Retrieve: TypedNetworkRetriever appends top-K typed traces to canonical pool
              (lines 1730-1762)

packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts                   [PHASE 4.4 NEW]
    When config.typedNetwork.retrievalMode === 'budget-split':
    1. Skip the TypedNetworkRetriever pool-append path
    2. Format diagnostics.retrievedTypedFacts as [Typed memory] block at
       budgetSplit.typedFacts * memoryTokenBudget tokens
    3. Truncate the existing [Memory] trace block to budgetSplit.traces *
       memoryTokenBudget tokens

packages/agentos-bench/src/benchmarks/locomo/Locomo.ts                              [DEFERRED to Phase 7]
    Mirror LongMemEvalS shipped + Phase 4.4 changes.
```

## 5. Phasing (v3)

| Phase | Scope | Cost | Duration | Status |
|---|---|---:|---|---|
| 0 | Spec approval + plan kickoff | $0 | 1 day | DONE |
| 1 | TDD primitives: `types.ts` + `TypedNetworkStore.ts` + `TemporalIntervalOverlap.ts` | $0 | 3 days | DONE (`ebdf5654`) |
| 2 | `TypedNetworkObserver.ts` + 6-step prompt + zod schema | $0 | 2 days | DONE (`ee8f4632`) |
| 3 | `TypedSpreadingActivation.ts` + `FourWayRrf.ts` (Eq. 12 + RRF unit-tested) | $0 | 2 days | DONE (`d8678495`) |
| 4.1 | `CognitiveMemoryConfig.typedNetwork` field + manager wiring | $0 | shipped | DONE (`cac63c2`) |
| 4.2 | `manager.encode()` runs typed-network observer | $0 | shipped | DONE (`a604d86`) |
| 4.3 | `manager.retrieve()` MVP: spreading activation, top-10 facts via diagnostics.retrievedTypedFacts | $0 | shipped | DONE (`d0ab11c5`) |
| 4-adapter | `TypedNetworkRetriever`: ScoredMemoryTrace[] adapter for canonical pool | $0 | shipped | DONE (`230c6aea`) |
| 4-bench | Bench LongMemEvalS uses TypedNetworkRetriever to append typed facts to canonical pool | $0 | uncommitted in working tree | DONE (in another session, awaiting their commit) |
| 4c | 5-case smoke run at `--typed-network full` end-to-end against shipped option-B baseline. Verify typed facts extracted, spread non-empty, canonical-pool integration visible in run JSON metadata. | $1-5 | 30 min | TODO (gated on user approval) |
| 4d (parallel, optional) | M-tuned Phase B at LongMemEval-M N=500 (`--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`). Independent of Stage E. Requires Cohere key + remote machine. | $50 | 1 day | OPTIONAL (gated on user approval + Cohere key) |
| 5 | Phase A on LongMemEval-S N=54 stratified at `--typed-network minimal` + `--typed-network full`. Requires Cohere key. | $30 | 1 day | TODO (gated on Phase 4c pass + user approval) |
| 6 | Decision gate: Phase A point estimate ≥ 78.6% (baseline 76.6% + 2pp) → proceed to Phase B; else escalate to Phase 4.4 OR publish negative-result | $0 | 30 min | gate only |
| 4.4 (conditional) | 4-way RRF + budget-split prompt blocks. Activated only if Phase A on shipped option-B negatives, OR if user wants the enhancement regardless. Adds `retrievalMode: 'budget-split'` config knob, replaces seed-then-spread MVP with 4-signal RRF, bench formats `[Typed memory]` block. TDD throughout. | $0 | 2 days | OPTIONAL (gated on Phase 6 outcome) |
| 7 | Phase B at full N=500 on LongMemEval-S + LongMemEval-M + LOCOMO at surviving variant (and surviving retrieval mode). Locomo adapter mirror lands here. | $290 | 2 days | TODO (gated on Phase 6 pass + user approval) |
| 8 | Findings doc + LEADERBOARD update + spec revision + v2 publication blog post | $0 | 1 day | TODO |

Total ex-shipping: 5-7 working days, $321-371 LLM (excluding optional 4d). $500-800 with cushion for Phase 4.4 escalation + variant ablations + observer-model sweeps.

## 6. Six-step extraction prompt (draft)

The LLM extractor (gpt-5-mini for cost; ablate at gpt-4o for quality) processes each new content piece (typically a session) into 0+ typed facts. The prompt:

```
You are an information extractor for a typed memory network. Process the conversation below into structured facts.

For each fact, perform these six steps:

1. COREFERENCE: resolve "he/she/they/it/this/that" to the actual referent.
2. TEMPORAL: normalize times to ISO 8601. Extract ranges as (start, end) when applicable.
3. PARTICIPANTS: list every named participant and their role.
4. REASONING: preserve any explicit reasoning marker (because, since, therefore, etc.) verbatim.
5. FACT TYPE: classify into ONE of:
   - WORLD: objective facts about the external world
   - EXPERIENCE: biographical / first-person events
   - OPINION: claims with confidence < 1.0
   - OBSERVATION: preference-neutral summaries of entities
6. ENTITIES: list every named entity (proper nouns, organizations, places, products).

Output JSON matching this schema:
{
  "facts": [
    {
      "text": "<narrative text after coreference resolution>",
      "bank": "WORLD" | "EXPERIENCE" | "OPINION" | "OBSERVATION",
      "temporal": { "start": "<ISO>", "end": "<ISO>", "mention": "<ISO>" },
      "participants": [{ "name": "<name>", "role": "<role>" }],
      "reasoning_markers": ["<verbatim marker>"],
      "entities": ["<entity>"],
      "confidence": <0..1, default 1.0 for non-OPINION>
    }
  ]
}

CONVERSATION:
<<<
{session_text}
>>>
```

The schema is enforced via `zod` parsing; malformed outputs are retried once with the validation error appended to the prompt.

## 7. Cost projection (detailed)

### Phase A measurement (LongMemEval-S N=54 stratified, both variants)

- Ingest: ~50 sessions per case × 54 cases × ~$0.005 per session at gpt-5-mini = ~$13.50 per variant
- Reader: 54 cases × ~$0.025 per case at gpt-4o = ~$1.40 per variant
- Judge: 54 cases × $0.005 per case = $0.30 per variant
- Total per variant: ~$15. Both variants: ~$30. Phase A budget: $30.

### Phase B measurement (full N=500 on each of 3 benchmarks at the surviving variant)

- LongMemEval-S Phase B: 500 cases × $0.058/correct × ~0.77 acc = $22 (worst case if no improvement; less if we improve)
- LongMemEval-M Phase B: 500 cases × $0.082/correct × ~0.35 acc = $14 (worst case)
- LOCOMO Phase B (N=1986): 1986 cases × ~$0.025/case = $50

Phase B budget: ~$90 reader. Plus Phase B ingest (~$200 for typed extraction across all 3 datasets, cached after first run). Phase B total: ~$290.

### Total

| Line item | Cost |
|---|---:|
| Phase A | $30 |
| Phase B reader | $90 |
| Phase B typed-extraction ingest (cached) | $200 |
| Cushion (retries, variant ablations, observer model sweep) | $180 |
| **Total** | **$500** |

If user wants to also ablate gpt-4o vs gpt-5-mini observer, add ~$200. If user wants to test a third variant (full + LLM-driven causal extraction), add ~$100.

## 8. Decision gates (v3)

| Gate | Criterion | Action if pass / fail |
|---|---|---|
| Phase 4c smoke → Phase A | 5-case smoke at `--typed-network full` produces non-empty `diagnostics.retrievedTypedFacts` with no extraction errors; bench-side TypedNetworkRetriever appends typed facts to canonical pool visible in run JSON | Pass: ask user for $30 Phase A approval; fail: debug shipped Phase 4.3 + TypedNetworkRetriever wiring |
| Phase A → Phase 6 → Phase B or Phase 4.4 | LongMemEval-S Phase A point estimate on either variant (`minimal` or `full`) | ≥ 78.6%: proceed to Phase B at the higher one; +0 to +2pp: ESCALATE to Phase 4.4 (4-way RRF + budget-split) and re-measure on a $30 second Phase A; ≤ baseline: publish 3rd negative result and ship the typed-network primitives as opt-in core (already shipped) |
| Phase 4.4 Phase A re-measure | Same criterion as Phase A above, applied to the 4-way RRF + budget-split path | ≥ 78.6%: proceed to Phase B at this path; fail: publish two negative-result paths (option B + option A), ship both as opt-in primitives |
| Phase B → Ship as opt-in | LongMemEval-S Phase B aggregate ≥ 78.6% with 95% CI lower bound ≥ 76.6% | Pass: ship typed-network (variant + retrievalMode) as opt-in tier in LEADERBOARD; fail: ship as opt-in primitive with negative-finding documentation |
| Opt-in → Flip default | Phase B aggregate AND Pareto-dominates Tier 3 min-cost on ≥ 3 of 6 LongMemEval-S categories AND cost-per-correct ≤ Tier 3 min-cost ($0.0580) | Pass: replace Tier 3 min-cost row in LEADERBOARD; fail: add as new opt-in tier alongside (universal default unchanged) |

Universal-default policy: typed-network is OFF by default until both flip-default criteria pass at Phase B. Today's shipping default (Tier 3 min-cost, 76.6% LongMemEval-S) is unchanged.

## 9. Open architectural questions (resolved or carried forward)

1. **Storage of typed facts**: RESOLVED. Separate `TypedNetworkStore` (in-memory, per-session in v1). NOT extended on `IMemoryGraph`. Persistence beyond per-session scope is out of scope for v1 (see §12); a SQL-backed implementation is a v2 follow-up if Stage E ships.

2. **Confidence on Opinion bank**: RESOLVED. LLM extractor emits `confidence ∈ [0, 1]`; defaults to 1.0 for non-Opinion facts. Static (no time decay) in v1. Phase A includes a calibration probe: sample 50 Opinion facts post-extraction, manually score actual confidence, compute Brier score / MAE. If MAE > 0.2 in Phase A, drop confidence as a retrieval signal in v1 and treat all Opinion facts as c=1.0 (per §10 risk #4).

3. **Causal edge extraction**: RESOLVED for v1. Piggyback on the 6-step extraction's `reasoning_markers` field for `minimal` and `full` variants. Separate LLM call for the `production` variant: out of scope for v1 per §12.

4. **Spreading activation depth**: RESOLVED. Default `maxDepth=3` (matches existing untyped `SpreadingActivation`). Configurable via `TypedNetworkConfig.spreadingDepth`. Phase A may include a depth=2 vs depth=3 ablation if budget allows.

5. **RRF k constant**: RESOLVED. Default `k=60` per Hindsight §2.4.3 standard literature. Configurable via `TypedNetworkConfig.rrfK` for power users. No Phase A ablation in v1.

6. **Per-benchmark routing**: RESOLVED. Typed-network is NOT a 5th `MemoryRouter` backend. It's a `CognitiveMemoryConfig.typedNetwork` knob on the existing `CognitiveMemoryManager`, available to ALL backends (canonical-hybrid, observational-memory-v10, observational-memory-v11). When enabled, every backend benefits from the typed-fact context block. This keeps the orthogonal-feature semantics that match how Cohere reranker, HyDE, and prospective memory integrate today.

7. **Fusion model (NEW, RESOLVED)**: token-budget split (option A in design notes), default `{traces: 0.5, typedFacts: 0.5}`, configurable via `TypedNetworkConfig.budgetSplit`. Reader prompt gets two separate context blocks. Score-blend (option B) and replace (option C) explicitly rejected per §4.2 reasoning.

8. **Embedder choice (NEW, RESOLVED)**: typed-fact embeddings inherit the host manager's `IEmbeddingManager`. Single source. Removes a configuration footgun; matches the existing pattern.

9. **Bench-vs-core integration (NEW, RESOLVED)**: agentos core, not bench. The currently-shipped bench-side ingest wiring at `LongMemEvalS:2237-2252` and `:2367-2382` is removed in Phase 4a as a relocation refactor.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Stage E shows -0pp lift like Stage L + Stage I (well-tuned Cohere rerank already subsumes the typed-graph signal) | Phase A on LongMemEval-S catches this for $30 before any Phase B spend. Document as a third negative result and ship the typed-network module anyway as a production primitive (consumers building Hindsight-style architectures benefit). |
| LLM extraction cost balloons (typed extraction is more expensive than session summarization) | Phase A measures actual per-session ingest cost. If > $0.02 per session at gpt-5-mini, switch to gpt-5-nano observer for Phase B (per SOTA-cited evidence §4.5, Mastra OM uses gemini-2.5-flash for similar cost). |
| The spreading activation graph grows unboundedly across long histories | Cap activation depth at 3, cap activated nodes per query at 50 (matches existing `SpreadingActivation`). Use existing memory archive for cold storage of facts older than 30 days. |
| Confidence on Opinion bank is hard to calibrate (LLM outputs are noisy) | Phase A includes a calibration step: sample 50 Opinion facts from a Phase A run, manually score actual confidence, plot Brier score. If MAE > 0.2, drop confidence as a retrieval signal in v1 and treat all Opinion facts as c=1.0. |
| Bench's CharHashEmbedder is the wrong baseline for measuring this (typed-network may need semantic embeddings to compete) | Typed-fact embeddings inherit the host manager's embedder per §4.2.2. Phase A primary measurement runs at CharHash (the shipping config). If point estimate < 78.6% on the `full` variant, run a paired ablation at `OpenAIEmbedder` (~$10 add-on). The Stage L paired baseline showed CharHash 76.6% vs OpenAIEmbedder 74.1% on the existing pipeline; character-hash is a stronger baseline for our shipping config, so swapping embedders is a backup, not the primary plan. |
| Universal-default-OFF policy lets typed-network ship as opt-in primitive even if Phase A negatives | Documented as the policy in §8 decision gates. Negative-result-with-shipped-primitive matches the Stage L (`SummarizedIngestExecutor`) and Stage I (`EntityExtractor`/`EntityLinkingIngestExecutor`/`EntityRetrievalRanker`) precedent already established in v1 publication §3. |

## 11. Anchors + dependencies

- Methodology source: SOTA_CITED_EVIDENCE_2026-04-25.md §2 (Hindsight paper detailed extraction)
- Existing primitive to extend: `packages/agentos/src/memory/retrieval/graph/SpreadingActivation.ts` (note: spec v1 had this at `memory/graph/`; corrected to `memory/retrieval/graph/` per actual repo layout)
- Existing primitive to integrate with: `packages/agentos/src/memory/CognitiveMemoryManager.ts`
- Reference open-source code (architecturally informative but uses Gemini judge, do NOT copy verbatim numbers): github.com/vectorize-io/agent-memory-benchmark
- Hindsight paper: arxiv.org/html/2512.12818v1
- Vendor-bias caveat to publish: Hindsight's headline 91.4% uses Gemini-3-pro; their open benchmark uses Gemini judge. Apples-to-apples for our gpt-4o reader is OSS-20B 83.6% / OSS-120B 89.0%.

## 12. Out of scope (explicitly)

- Multi-tier BEAM (100K, 500K, 1M, 10M), defer to v2 spec, paired with this Stage E
- MemoryArena adapter, defer to v3
- Cross-vendor reproduction via Hindsight's `vectorize-io/agent-memory-benchmark` (Gemini judge incompatibility, separate spec needed if pursued)
- HEXACO modulation of Opinion confidence (interesting research question; not load-bearing for the bench number)
- Causal edge extraction as a separate LLM call (`production` variant out of scope for v1; bundled into the 6-step prompt for `full` variant)
- Persistence beyond the bench's per-case scope (typed facts live in-memory per case; production persistence is a follow-up if Stage E ships)

## 13. Success criteria

1. Plan ships within 3 weeks of design approval
2. Every cell in any Phase B has a per-case run JSON at seed=42
3. Typed-network module ships in agentos core with ≥ 60 contract tests
4. Phase A decision gate either greenlights Phase B or documents why (negative result published)
5. v2 publication blog post drafts within 1 week of Phase B completion
6. Total LLM spend ≤ $800
7. No subagents used (per user preference)

## 14. Status

DRAFT v3. Phases 1-3, 4.1, 4.2, 4.3, plus the TypedNetworkRetriever adapter SHIPPED in agentos@0.4.0 (HEAD `230c6aea`, 75/75 typed-network tests green). Bench-side LongMemEvalS integration uncommitted in working tree from another concurrent session. Bench full test suite 515/515 passing.

Awaiting:

1. User review + approval of v3 architectural framing (option B shipped as default, option A as opt-in Phase 4.4 enhancement)
2. User review of the companion plan (`2026-04-26-hindsight-4network-observer-plan.md` v3)
3. Other concurrent session committing bench-side LongMemEvalS + LEADERBOARD + comparison-table changes
4. Phase 4c smoke approval ($1-5)
5. Phase A approval ($30) once Phase 4c smoke passes
6. Cohere API key. Available in `apps/wilds-ai/.env.local` (verified 2026-04-25); smoke command should source that file via `set -a && source apps/wilds-ai/.env.local && set +a`.
7. Phase 6 outcome decides whether Phase 4.4 (option A: 4-way RRF + budget-split) is the next escalation OR Phase B is the next ship

---

## Revision history

- 2026-04-26 v1: initial draft. Architecture upgraded from 3 networks to 4 per SOTA_CITED_EVIDENCE §2.7. Cost upgraded from $400-600 to $500-800. Duration upgraded from 1-2 weeks to 2-3 weeks.
- 2026-04-25 v2 (revised in next session): bench-vs-core integration corrected (typed-network lives in `CognitiveMemoryManager` core, not bench adapter), per durable rule "agentos-bench is benchmarks only: all memory/RAG/retrieval improvements go in agentos core". Fusion model pinned to token-budget split with default `{traces: 0.5, typedFacts: 0.5}` (rejecting score-blend and replace alternatives with reasoning). `TypedNetworkConfig` knob surface explicitly defined (§4.2.1, 9 tunable parameters). Embedder coherence rule added (§4.2.2). Phase 4 split into 4a (relocation refactor), 4b (retrieval-side wiring), 4c (smoke), 4d (parallel M-tuned).
- 2026-04-25 v3 (rebased same session, after discovery that another concurrent session shipped Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever to agentos@0.4.0): v2's Phase 4a (relocation refactor) is moot, the other session implemented core integration via passthrough handle accessors. v2's Phase 4b (4-way RRF + budget-split prompt blocks) is repositioned as Phase 4.4 (the explicit follow-up named in the d0ab11c5 commit message). Phase 4.4 is opt-in (`retrievalMode: 'budget-split'`) and gated on Phase 6 outcome: if Phase A on shipped option B (`retrievalMode: 'pool-append'`) passes ≥ 78.6%, Phase B ships option B; if it fails ≥ +2pp lift, ESCALATE to Phase 4.4 + re-measure Phase A. The shipped TypedNetworkConfig (variant + weight + observerLLM + decay + maxDepth) is documented as the default knob surface; Phase 4.4 additions (edgeMultipliers, rrfK, activationThreshold, budgetSplit, extractionMaxTokens, extractionTemperature, retrievalMode) are documented as the enhancement layer. §4.2 split into Shipped (4.2.A) + Phase 4.4 (4.2.B) + Shared invariants (4.2.C). §5 phasing rebuilt to reflect SHIPPED Phase 4.1-4.3 + TypedNetworkRetriever + bench WIP. §8 decision gates restructured to make Phase 4.4 conditional on Phase 6 outcome.
