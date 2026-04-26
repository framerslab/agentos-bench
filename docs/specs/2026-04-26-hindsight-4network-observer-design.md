---
title: Stage E: Hindsight 4-Network Typed Observer (Design)
date: 2026-04-26
scope: agentos core memory subsystem (typed-network module) + bench wiring + Phase A measurement
methodology_anchor: SOTA_CITED_EVIDENCE_2026-04-25.md §2 (Hindsight paper, arxiv:2512.12818)
estimated_cost: $500-800 LLM total ($300-500 Phase A ingest at gpt-5-mini observer; $150-300 Phase B reader at gpt-4o)
estimated_duration: 2-3 weeks (was 1-2 in the v2 handoff before SOTA evidence revised the architecture from 3 networks to 4)
status: DRAFT, needs implementation plan + user approval before any LLM spend
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

### 4.1 New module: `packages/agentos/src/memory/retrieval/typed-network/`

The agentos memory subsystem is organized into `core/` (encoding, decay, working memory, prompt), `retrieval/` (graph, store, typed-network), `ingest/` (session summarizer, etc.), `io/` (facade), `archive/`, `mechanisms/`, and `pipeline/`. The new typed-network module sits alongside `retrieval/graph/` (which holds `SpreadingActivation.ts` already) so the Stage E primitives compose with the existing retrieval pipeline.

```
packages/agentos/src/memory/retrieval/typed-network/
├── types.ts                          // Fact type, BankId, TypedEdge, TypedFact
├── TypedNetworkObserver.ts           // LLM-driven 6-step extraction pipeline
├── TypedNetworkStore.ts              // 4-network in-memory + persistence facade
├── TypedSpreadingActivation.ts       // Eq. 12 spreading activation with typed weights
├── FourWayRrf.ts                     // RRF fusion over (semantic, BM25, graph, temporal)
├── TemporalIntervalOverlap.ts        // (τs, τe) overlap as a ranked signal
├── prompts/
│   ├── extraction-prompt.ts          // Verbatim-style 6-step extraction prompt
│   └── extraction-schema.ts          // Zod schema for the LLM's structured output
├── __tests__/
│   ├── types.test.ts                 // Type guards, BankId validation
│   ├── TypedNetworkObserver.test.ts  // Mocked LLM extraction, 6-step output shape
│   ├── TypedNetworkStore.test.ts     // 4-network store CRUD + edge typing
│   ├── TypedSpreadingActivation.test.ts // Eq. 12 numerics + typed-edge multipliers
│   ├── FourWayRrf.test.ts            // RRF math (k=60) + 4-way merge
│   └── TemporalIntervalOverlap.test.ts // Interval-overlap ranking edge cases
└── index.ts                          // Barrel exports
```

### 4.2 Integration points with existing CognitiveMemoryManager

The typed-network module sits alongside the existing cognitive memory subsystem; it does NOT replace it. The integration:

1. **Ingest path**: `CognitiveMemoryManager.encode()` optionally calls `TypedNetworkObserver.observe()` after the standard encode. When the typed-network module is wired (via new optional config), each new MemoryTrace also emits 0+ typed facts that get appended to the appropriate bank.

2. **Retrieval path**: `CognitiveMemoryManager.retrieve()` runs the standard 6-signal scoring AND the new 4-way RRF over typed networks. Final ranking merges the two via a configurable weight (default 0.5 / 0.5 → tunable via Phase A).

3. **Storage**: typed facts persist alongside MemoryTraces in the same vector store + knowledge graph. The typed bank ID becomes a first-class metadata field.

4. **Spreading activation**: existing `SpreadingActivation` becomes a fallback for the untyped graph path; the new `TypedSpreadingActivation` extends it with `μ(ℓ)` link-type multipliers and temporal decay per Eq. 12.

### 4.3 Bench wiring

```
packages/agentos-bench/src/cli.ts
    + add --typed-network [variant]  flag
    + variants: 'minimal' (4-bank routing only)
                'full' (4-bank + spreading + 4-way RRF)
                'production' (full + LLM-driven causal extraction at extraction-time)

packages/agentos-bench/src/cognitive/createCognitiveManager.ts
    + wire typed-network config when --typed-network is set

packages/agentos-bench/src/core/IBenchmark.ts
    + add typedNetwork?: 'minimal' | 'full' | 'production' to RunConfig
    + add 'typedNetwork' to OPTIONAL_RUN_CONFIG_KEYS
    + add to resolveRunConfig propagation
    + add to resolveRunConfigContract.spec.ts SAMPLES (avoid the Phase 0 regression from v1 publication plan)
```

## 5. Phasing

| Phase | Scope | Cost | Duration |
|---|---|---:|---|
| 0 | Spec approval + plan kickoff | $0 | 1 day |
| 1 | TDD `types.ts` + `TypedNetworkStore.ts` + `TemporalIntervalOverlap.ts` (pure code, no LLM) | $0 | 3 days |
| 2 | `TypedNetworkObserver.ts` with mocked LLM in tests; real extraction on a 5-case smoke run | $1 | 2 days |
| 3 | `TypedSpreadingActivation.ts` + `FourWayRrf.ts` (Eq. 12 numerics, RRF math, all unit-tested) | $0 | 2 days |
| 4 | Integration: wire typed-network into `CognitiveMemoryManager`; bench `--typed-network` flag end-to-end | $5 (smoke) | 2 days |
| 5 | Phase A on LongMemEval-S N=54 stratified at `--typed-network minimal` and `--typed-network full` | $20 | 1 day |
| 6 | Decision gate: if Phase A point estimate ≥ 76.6% baseline + 2pp, proceed to Phase B; else iterate or abandon | $0 | discussion only |
| 7 | Phase B at full N=500 on LongMemEval-S, LongMemEval-M, LOCOMO at the surviving variant | $250-400 | 2 days |
| 8 | Findings doc + LEADERBOARD update + spec revision + v2 publication blog post | $0 | 1 day |

Total: 13-15 working days, $276-426 LLM ($500-800 with cushion for retries / variant ablations / observer-model sweeps).

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

## 8. Decision gates

| Gate | Criterion | Action if pass / fail |
|---|---|---|
| Phase A → Phase B | LongMemEval-S Phase A point estimate ≥ 78.6% (baseline 76.6% + 2pp tolerance) | Pass: proceed to Phase B; fail: iterate variant choice OR abandon Stage E |
| Phase B → Ship | LongMemEval-S Phase B aggregate ≥ 78.6% with 95% CI lower bound ≥ 76.6% | Pass: ship as new shipping default; fail: ship as opt-in tier with the negative finding documented |
| Ship as default → Update LEADERBOARD | Phase B aggregate beats Tier 3 min-cost on ≥ 3 of 6 categories | Pass: replace Tier 3 min-cost row with Stage E; fail: add as a new tier alongside |

## 9. Open architectural questions (resolve in plan or first iteration)

1. **Storage of typed facts**: extend `IMemoryGraph` interface (add 4 bank methods) OR create separate `ITypedMemoryStore` interface? Lean toward separate, the bank concept is orthogonal to the existing graph traversal. Same backend (SqliteMemoryGraph) implements both.

2. **Confidence on Opinion bank**: the paper specifies `(t, c, τ)` tuple. Where does confidence come from? The LLM extractor outputs a confidence ∈ [0, 1] in the JSON; if absent (W / E / S facts), default to 1.0. Decay over time per `μ(time-since-mention)` or treat as static? Lean static for v1; revisit for v2.

3. **Causal edge extraction**: paper says "LLM-extracted, w=1.0". Does this require a second LLM call, or can the same 6-step extraction also emit causal edges via the `reasoning_markers` field? Lean piggyback for the `minimal` and `full` variants; separate LLM call for `production` variant.

4. **Spreading activation depth**: paper doesn't fix a `maxDepth`. AgentOS's existing `SpreadingActivation` defaults to depth=3. Use the same default for `TypedSpreadingActivation`; ablate in Phase A.

5. **RRF k constant**: paper uses k=60 (standard). Stick with 60 unless Phase A shows meaningful sensitivity.

6. **Per-benchmark routing**: should the typed-network module ship as a 5th `MemoryRouter` backend ID (`'hindsight-typed-network'`)? Or as a primitive used internally by `canonical-hybrid` when configured? Lean separate backend ID, keeps the architectural primitive cleanly opt-in for consumers; keeps the bench measurement clean.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Stage E shows -0pp lift like Stage L + Stage I (well-tuned Cohere rerank already subsumes the typed-graph signal) | Phase A on LongMemEval-S catches this for $30 before any Phase B spend. Document as a third negative result and ship the typed-network module anyway as a production primitive (consumers building Hindsight-style architectures benefit). |
| LLM extraction cost balloons (typed extraction is more expensive than session summarization) | Phase A measures actual per-session ingest cost. If > $0.02 per session at gpt-5-mini, switch to gpt-5-nano observer for Phase B (per SOTA-cited evidence §4.5, Mastra OM uses gemini-2.5-flash for similar cost). |
| The spreading activation graph grows unboundedly across long histories | Cap activation depth at 3, cap activated nodes per query at 50 (matches existing `SpreadingActivation`). Use existing memory archive for cold storage of facts older than 30 days. |
| Confidence on Opinion bank is hard to calibrate (LLM outputs are noisy) | Phase A includes a calibration step: sample 50 Opinion facts from a Phase A run, manually score actual confidence, plot Brier score. If MAE > 0.2, drop confidence as a retrieval signal in v1 and treat all Opinion facts as c=1.0. |
| Bench's CharHashEmbedder is the wrong baseline for measuring this (typed-network may need semantic embeddings to compete) | Run Phase A at BOTH CharHash AND OpenAIEmbedder. The Stage L paired baseline showed CharHash 76.6% vs OpenAIEmbedder 74.1%, character-hash is a stronger baseline for our shipping config. Test both; pick the embedder that wins overall. |

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

DRAFT. Awaiting:

1. User approval of the architecture (4 networks, not 3, the v2 handoff and prior research notes assumed 3)
2. User approval of the $500-800 budget
3. Implementation plan (`2026-04-26-hindsight-4network-observer-plan.md`), separate doc to be authored next

---

## Revision history

- 2026-04-26 v1: initial draft. Architecture upgraded from 3 networks to 4 per SOTA_CITED_EVIDENCE §2.7. Cost upgraded from $400-600 to $500-800. Duration upgraded from 1-2 weeks to 2-3 weeks.
