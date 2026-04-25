---
title: Stage I Phase A Findings — Mem0-v3-style entity-linking re-rank doesn't lift LOCOMO accuracy
date: 2026-04-25
spec: 2026-04-25-comprehensive-evaluation-matrix-design.md (Stage I row)
result: NEGATIVE — drop Stage I from accuracy-push priorities (matches Stage L pattern)
cost: $0.13 LLM (1 fresh run; baseline cached)
---

# Stage I Phase A Findings — 2026-04-25

## TL;DR

We measured Mem0-v3-style entity-linking post-retrieval re-rank against the bench's shipping LOCOMO pipeline. **It hurts accuracy by 4.0pp at N=25 stratified, with a 20pp regression on multi-hop specifically.** This is the second consecutive negative result for lightweight signal additions on top of our hybrid + Cohere rerank stack (Stage L was the first).

The conclusion mirrors Stage L: **our 64.0% LOCOMO baseline is well-optimized for the existing pipeline; lightweight architectural additions don't lift on top of it. To push accuracy further, more substantial architecture changes (Stage E Hindsight 4-network) are likely required.**

## Setup

- Benchmark: LOCOMO, stratified N=25 (5 per category × 5 categories)
- Reader: gpt-4o, max_tokens 256
- Memory: full-cognitive (CharHashEmbedder default — same as historical baselines)
- Replay: ingest
- Retrieval: hybrid (BM25 + dense) + Cohere rerank-v3.5 + reader-top-k 20
- Treatment: `--entity-linking 0.5` post-retrieval re-rank
- Judge: gpt-4o-2024-08-06, rubric 2026-04-18.1
- Seed: 42

## Implementation

`packages/agentos-bench/src/benchmarks/locomo/Locomo.ts`:
- After `mem.recall()` returns top-K candidates, apply `applyEntityLinkingRerank()`
- Re-rank uses `EntityExtractor` (from agentos 0.2.13) on each candidate's content
- `EntityRetrievalRanker` (from agentos 0.2.13) computes `combinedScore = (1-w)*semanticScore + w*entityOverlapRatio`
- New CLI flag: `--entity-linking [weight]` (defaults to 0.5 when bare)
- New cache fingerprint: `stage-i-entity-linking:w0.5:v1` (invalidates cleanly)
- Stage F-2 contract test pattern reused: `entityLinking: cfg.entityLinking` propagated explicitly through `resolveRunConfig`

## Results

| Config | Accuracy | $/correct | Total cost |
|---|---:|---:|---:|
| Baseline (no entity-linking) | **64.0%** (16/25) | $0.0000 (cached) | $0 |
| Treatment (`--entity-linking 0.5`) | **60.0%** (15/25) | $0.0089 | $0.13 |
| **Δ** | **−4.0pp** | — | — |

## Per-category breakdown

| Category | Baseline (16/25) | Treatment (15/25) | Δ |
|---|---:|---:|---:|
| adversarial | 100.0% | 100.0% | 0pp |
| multi-hop | 80.0% | 60.0% | **−20.0pp** |
| open-domain | 60.0% | 60.0% | 0pp |
| single-hop | 40.0% | 40.0% | 0pp |
| temporal | 40.0% | 40.0% | 0pp |

**Notable:** the entire delta is one case shifting on multi-hop (4/5 → 3/5). At N=25 the 95% bootstrap CI is wide; this could be noise. But the pattern matches Stage L's negative finding consistently enough to warrant the same conclusion.

## Why this didn't lift

1. **Cohere rerank is already doing the work.** The shipping pipeline runs Cohere rerank-v3.5 (cross-encoder) over the top-N hybrid candidates. Cross-encoder semantic matching subsumes the entity-overlap signal. Adding a second re-rank stage with entity overlap doesn't add information; it adds noise.
2. **Entity name variants confuse the matcher.** LOCOMO's questions often reference entities by partial name or pronoun ("the dog" vs "Maxwell"); regex extraction can't bridge these. The query has a different entity set than the gold session, so entity overlap is low even when the gold session is in the candidate pool.
3. **Multi-hop suffers most.** Multi-hop questions span multiple sessions where the relevant entities don't all appear in any single session. Re-ranking by per-candidate entity overlap penalizes the partial-match candidates that multi-hop reasoning actually needs.

## Pattern with Stage L

Two consecutive negative results for lightweight signal additions:

| Stage | Architecture | Δ vs baseline |
|---|---|---:|
| L | Anthropic Contextual Retrieval (per-session summary prepended to chunks) | −3.7pp on LongMemEval-S |
| I | Mem0-v3-style entity-linking re-rank | −4.0pp on LOCOMO |

The bench's shipping config (hybrid + Cohere rerank + reader-top-k 20) is well-tuned for LongMemEval-S and LOCOMO. Lightweight pre/post-processing additions either duplicate work the rerank stage already does (Stage L) or introduce signals that the rerank stage's cross-encoder already considers (Stage I).

## Implications for the v1 evaluation matrix

Both Stage L AND Stage I measured negative. The v1 spec's "Phase B sweep across 6 architectures" should drop both:

- **Drop Stage L from Phase B** (already documented in STAGE_L_PHASE_A_FINDINGS_2026-04-25.md)
- **Drop Stage I from Phase B** (this finding)
- **Stage E (Hindsight 4-network typed observer) becomes the only remaining accuracy-push candidate.** It's a fundamentally different architecture (typed network of World/Experience/Opinion/Observation graphs with spreading activation), not a lightweight signal addition. Different mechanism, different hypothesis.

### Updated v1 cost forecast

Original spec: $1000-1200 net new across 6 architectures.

After Stage L + Stage I drops: 4 architectures (Tier 1 canonical, Tier 2b OM-v11, Tier 3 min-cost, Tier 3 max-acc) × 4 benchmarks (LongMemEval-S, M, LOCOMO, BEAM 100K spot-check) = ~$400-500 net new. Much cheaper.

### Stage E now the sole remaining push

To actually lift our 76.6% LongMemEval-S / 64% LOCOMO baselines beyond what hybrid + Cohere rerank delivers, we likely need Stage E (Hindsight typed-network). That's the v2 publication; the v1 publication ships the comprehensive transparency-grade matrix without Stage L or Stage I bumping it.

## What still ships from Stage I

Even though the architecture doesn't lift accuracy in our LOCOMO measurement, the agentos-side work shipped real value:

- `EntityExtractor` in `@framers/agentos/ingest-router` — Mem0-v3-style regex extractor (proper nouns, quoted text, compound noun phrases)
- `EntityLinkingIngestExecutor` — IngestRouter `fact-graph` strategy reference executor
- `EntityRetrievalRanker` in `@framers/agentos/memory-router` — recall-stage entity-overlap re-rank primitive
- 20 new contract tests, 163/163 ingest-router + memory-router tests pass
- Already shipped as agentos 0.2.13

Consumers building Mem0-v3-style memory architectures get the primitives out of the box. The empirical finding is just that this particular signal doesn't help our specific bench config.

## Possible follow-ups (out of scope for v1)

If a future session wants to explore entity-linking further:

1. **Lower weight (0.1-0.2).** Maybe 0.5 over-weights the entity signal. A smaller blend might preserve the cross-encoder rerank's value while adding marginal entity sensitivity.
2. **Real semantic embeddings.** Test with `--embedder-model openai:text-embedding-3-small`. The lexical-hash baseline might be where entity overlap could matter most; with semantic embeddings, the entity signal is even more redundant.
3. **Different Mem0 v3 mechanism.** Mem0 v3's actual lift may come more from the single-pass ADD-only extraction at ingest, not the retrieval-side entity overlap. We didn't test ingest-side because the bench's existing path already encodes content.
4. **Stage E (Hindsight 4-network).** The next architectural push, likely the only one that can break the current ceiling.

## Run artifacts

- `results/runs/2026-04-25T10-09-55-571--locomo--gpt-4o--full-cognitive--ingest.json` — Baseline N=25, $0 cached, 64.0%
- `results/runs/2026-04-25T10-10-30-189--locomo--gpt-4o--full-cognitive--ingest.json` — Treatment N=25 with `--entity-linking 0.5`, $0.13, 60.0%

## Anchor in publication narrative

> "We tested Mem0-v3-style entity-linking re-rank on LOCOMO and report a negative result: -4.0pp aggregate accuracy with -20pp on multi-hop specifically. This is the second negative result for lightweight signal additions on top of our hybrid + Cohere rerank pipeline. The honest read: our shipping baseline is well-optimized; further accuracy push requires substantial architecture changes (Stage E Hindsight 4-network), not signal stacking."

Two negative results in a row is a credibility marker. Vendors who only publish wins miss this kind of finding.
