# Step 13 Findings — Graph Activation Wire-Up (silent sixth signal)

**Date:** 2026-04-21
**Scope:** Activate the silent sixth composite-scoring signal (`graphActivation`, weighted 10% in `RetrievalPriorityScorer` but hardcoded to 0) end-to-end via heuristic entity extraction at ingest (5 regex pattern families, zero LLM) and Anderson spreading activation at retrieve time over entity co-occurrence edges in `SqliteKnowledgeGraph`.
**Spec:** [specs/2026-04-21-step-13-graph-activation-design.md](specs/2026-04-21-step-13-graph-activation-design.md)
**Plan:** [plans/2026-04-21-step-13-graph-activation-plan.md](plans/2026-04-21-step-13-graph-activation-plan.md)
**Baseline:** Step 3 Hybrid canonical at N=500 = 73.2% unweighted (shipping); Step 11 / 12 Observer-Reflector variants at N=24 = 62.5%.
**Kill gate:** unweighted ≥ 77% at Tier A.

---

## Verdict: RED (pattern now n=9)

Tier A smoke at N=24 unweighted **50.0% (12/24)**, CI [29.2%, 70.8%]. Below the 77% kill threshold AND below every prior ADDITIVE-mode variant (Steps 7 / 11 / 12 all at 62.5%). Graph activation in this form introduces more noise than signal.

| Cell | LongMemEval-S N=24 unweighted | Δ vs Step 3 canonical (73.2%) | Δ vs Step 12 (62.5%) | Kill? |
|---|---:|---:|---:|---|
| Hybrid + `--graph-activation` | **50.0%** (12/24) | **−23.2pp** | **−12.5pp** | YES (gate 77%) |

Per-category:

| Category | n | Step 13 | Step 12 canonical (for comparison) | Δ vs Step 12 |
|---|---:|---:|---:|---:|
| single-session-user | 4 | 100.0% | 100.0% | 0.0pp |
| knowledge-update | 4 | 75.0% | 75.0% | 0.0pp |
| single-session-assistant | 3 | 66.7% | 75.0% (n=4) | sample-size shift |
| multi-session | 3 | 33.3% | 25.0% (n=4) | sample-size shift |
| single-session-preference | 3 | 33.3% | 50.0% (n=4) | sample-size shift |
| temporal-reasoning | 4 | 25.0% | 50.0% | **−25.0pp** |
| unknown | 3 | 0.0% | (not in Step 12 sample) | — |

Bootstrap 95% CI: **[29.2%, 70.8%]**. Cost: **$0.42 total, $0.035 per correct** (higher than Step 12's $0.098/correct because fewer correct answers).

Canonical run: [results/runs/2026-04-21T22-55-58-213--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-21T22-55-58-213--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

---

## What the stage metrics show (the mechanism DID work)

| Stage | Step 12 (baseline) | Step 13 | Δ |
|---|---:|---:|---:|
| dense | 0.347 | 0.352 | +0.005 |
| sparse | 0.882 | **0.917** | **+0.035** |
| merged | 0.774 | **0.801** | **+0.027** |
| reranked | 0.740 | 0.634 | **−0.106** |
| final | 0.740 | 0.745 | +0.005 |

Graph activation is working as designed at the **upstream** stages: sparse recall rose +3.5pp, merged recall rose +2.7pp. More relevant candidates are entering the top-K pool.

But the **rerank stage drops −10.6pp** of gold-session recall. The Cohere `rerank-v3.5` model is being thrown off by the reordered candidate set: graph-activation boosts candidates that share query entities, but some of those are entity-coincidental without being topically relevant, and rerank responds by dropping gold candidates whose BM25/dense score is now relatively lower.

Net: final recall ends up roughly unchanged (+0.005pp), so the reader sees an almost identical top-K. But the reader's conversion rate drops:

| | Gold in top-K | Correct answers | Reader conversion |
|---|---:|---:|---:|
| Step 12 | 17.8 (0.740 × 24) | 15/24 (62.5%) | 83% |
| Step 13 | 17.9 (0.745 × 24) | 12/24 (50.0%) | 67% |

**Reader conversion dropped 16pp despite equivalent gold-session coverage.** The reader is getting confused by reordered context where entity-coincidental candidates appear near gold.

---

## Root cause analysis

### What works mechanically

- Heuristic extractor populates `trace.entities` reliably (17/17 unit tests pass; real run shows non-empty entities).
- Slug-ID derivation + KG entity-node upsert is idempotent (no duplicate nodes).
- `related_to:co_occurs` bidirectional relations created per pair of entities in a trace.
- `spreadActivation` seeded from query entities produces non-zero activation scores.
- Sparse-side recall increases, confirming the activation signal composes with BM25 via the 6-signal scoring formula.

### What fails empirically

Three compounding effects push accuracy down:

**1. Entity-coincidence is not topical relevance.** Regex extraction surfaces all capitalized words, dates, currency, and numeric-with-units tokens. Many of these co-occur across sessions for uninteresting reasons (e.g., every session mentioning "Monday" gets linked). The graph fills with noisy edges that activate candidates for the wrong reasons.

**2. Rerank disagrees with activation-boosted scoring.** The Cohere rerank model evaluates topical relevance independently. When activation boosts candidates whose query-entity match is coincidental, rerank correctly ranks them low. But the 0.7 cognitive + 0.3 neural blend still propagates the inflated cognitive score into the final order, pushing genuinely-relevant-but-entity-poor candidates out.

**3. Temporal-reasoning is especially vulnerable.** Temporal questions ("when did X happen", "what happened before Y") reference dates + proper nouns. Graph activation inflates the score of any trace mentioning the same date or entity, even when the temporal relation is wrong. Category dropped 25pp.

### Why the prediction set was half-right

| Prediction from spec §3.3 | Result |
|---|---|
| A: Unweighted ≥ 77% at Tier A | **FAIL** — 50.0% |
| B: Multi-session lifts ≥ +5pp | **Ambiguous** — +8pp point estimate but n=3 vs n=4 sample-size confound |
| C: No category regresses > 3pp | **FAIL** — temporal-reasoning −25pp |

Prediction C is the decisive falsification: graph activation stole from the weakest-signal categories to possibly help multi-session. Classic "noise amplification" anti-pattern.

---

## Pattern update: n=9 confirmed

| Step | Mechanism | Verdict | Teaches |
|---|---|---|---|
| 2 | SessionRetriever without rerank | RED | rerank is non-negotiable |
| 4 | HyDE query rewrite | RED | LLM query paraphrase erases specific-value tokens |
| 5 | LLM post-retrieval filter | RED | reader > LLM filter on precision/recall tradeoff |
| 6 | Rerank-score-guided content trim | RED | rerank score ≠ reader utility |
| 7 | Observer/Reflector additive overlay | RED | reflection traces don't surface via dense alone |
| 8 | Observer/Reflector replacement | RED | summaries erase specific tokens |
| 9 | Fact-graph tuple extraction | RED | synthetic traces displace real chunks |
| 11 | Tuned reflector prompt | NULL | prompt tuning alone doesn't close the gap |
| 12 | BM25 parity sweep for reflection traces | NULL | BM25 visibility alone doesn't either |
| **13** | **Heuristic graph activation (entity co-occurrence)** | **RED** | **additive non-LLM signal STILL regresses when the signal source is noisy enough to confuse rerank** |

**The n=8 pattern was: "LLM-mediated retrieval content regresses."** Step 13 falsifies a stronger version of that claim — it shows even a zero-LLM additive signal can regress if the signal distinguishes the wrong thing. The corrected pattern: **"Adding scoring signals to the hybrid retrieval stack regresses on specific-value LongMemEval-S UNLESS the signal is tightly aligned with the benchmark's query distribution."** Graph activation over shared-entity co-occurrence is too loose a correspondence.

---

## What ships (infrastructure shipping regardless of the RED verdict)

Durable value independent of accuracy outcome:

- **`HeuristicEntityExtractor`** at [packages/agentos/src/memory/retrieval/graph/extraction/HeuristicEntityExtractor.ts](../../agentos/src/memory/retrieval/graph/extraction/HeuristicEntityExtractor.ts). 5 regex pattern families + slug-id derivation. 17 unit tests. Exported from `@framers/agentos/memory`.
- **Silent-sixth-signal fix.** `MemoryStore.encode` now threads `trace.entities` (slugified) to `recordMemory.entityIds`. Previously this array was silently dropped at the KG boundary. Strict improvement for any downstream consumer already populating `trace.entities`.
- **`MemoryStoreConfig.enableGraphActivation`** + `CognitiveMemoryConfig.enableGraphActivation` — feature-gate flag for the full pipeline. Default false; no behavior change for existing consumers.
- **`ingestEntityGraph`** private method in MemoryStore — idempotent entity-node + co-occurrence-edge upsert at encode time.
- **Query-time spreading activation** integration — at `MemoryStore.query` when the flag is on, extracts query entities, seeds `spreadActivation` from matching entity nodes, computes per-candidate activation, fills the previously-zero `graphActivation` slot in the scoring composite.
- **Bench `--graph-activation` flag** + `RunConfig.graphActivation` + `step-13-graph-activation:v1` cache fingerprint + 7 wiring tests.

**Nothing shipped is a regression surface for pre-Step-13 code.** Every change is behind `enableGraphActivation: false` (default). Tier 1 canonical at 73.2% is untouched.

---

## What does NOT ship

- **No production default flip.** Tier 1 Hybrid remains the shipping default.
- **No Phase A run.** Kill criterion triggered at Tier A (50% < 77% gate).
- **No signal-weight tuning.** The default `graphActivation: 0.10` weight is a reasonable starting point; we're not tuning it down in this spec because the mechanism fundamentally introduces noise, not signal deficit.
- **No LOCOMO Tier A run.** Skipped per plan §9 out-of-scope.

---

## Cost accounting

| Attempt | Description | Duration | Cost |
|---|---|---:|---:|
| v1 | Step 13 Tier A canonical | 98 min (concurrency=2) | **$0.42** |

Under the $7 spec cap. The deeper architectural change (agentos-core + bench + build + release) came free from an LLM-cost perspective — the signal itself is zero-LLM (regex + Anderson BFS).

---

## Recommendations

### Close the graph-activation line for LongMemEval-S specifically

The mechanism is correctly implemented; the benchmark's query distribution doesn't reward additive signals that hinge on entity co-occurrence. Graph activation may still GREEN on benchmarks with different query shapes (e.g., entity-centric QA, multi-hop reasoning over knowledge bases, document-entity retrieval). For LongMemEval-S, the n=9 pattern holds: **stop adding new composite-scoring signals, start exploring reader-side and architectural-shape-shift experiments.**

### Next candidate: Step 14 — two-call reader (Emergence AI pattern)

Emergence AI publishes 86% at gpt-4o using a reader-side split: first call extracts relevant facts from top-K retrieved traces into a structured scratchpad, second call answers from the scratchpad only. Closes the biggest single competitor gap (73.2% → possibly 80%+ at gpt-4o). Budget: $20-40 Tier A + Phase A + Phase B.

This is a **reader-side** experiment that doesn't touch memory architecture. The n=9 pattern is about retrieval-layer additions; two-call reader operates on what the reader already sees.

### Alternative: accept + publish

Nine consecutive RED/null experiments on retrieval-stack additions is a publishable finding in itself. The methodology (matched ablation + bootstrap CIs + kill criterion + evidence-provenance + silent-sixth-signal audit) is stronger than the frontier number. Write the blog for publication at 73.2% + the n=9 story + the agentos-architecture audit as the structural contribution.

### Weight-tuning follow-up (low priority)

A variant setting `graphActivation: 0.05` (half the default) would test whether the signal is useful if its voice is quieter. My read: not worth it. The mechanism is noisy, not under-weighted.

---

## Commits

### agentos submodule

- `796467cbf` feat(memory): heuristic entity extraction + graph activation wire-up
- `d568b6223` feat(memory): thread enableGraphActivation through CognitiveMemoryConfig

### monorepo (bench)

(Pending sign-off; to be committed as 3 logical groups: code + tests, submodule-pointer bump, findings + integration.)

---

## Rollback

Not required. All changes strictly additive + feature-gated behind default-off flags. Tier 1 shipping default unchanged. To revert:

- Remove `--graph-activation` CLI flag.
- Remove `RunConfig.graphActivation` + cache fingerprint.
- Remove `enableGraphActivation` propagation in `createCognitiveManager`.
- Remove agentos commits via standard revert (feat → chore: revert).

---

End of Step 13 findings.
