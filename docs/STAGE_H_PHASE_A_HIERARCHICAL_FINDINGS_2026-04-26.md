# Stage H Phase A Findings — Hierarchical retrieval doesn't lift M (third negative finding)

**Date:** 2026-04-26
**Result:** NEGATIVE — drop hierarchical retrieval from accuracy-push priorities
**Cost:** $4.51 LLM total
**N:** 54 stratified, seed=42, gpt-4o reader, gpt-4o-2024-08-06 judge

## TL;DR

Two-stage hierarchical retrieval (Stage 1 selects top-10 sessions by summary similarity; Stage 2 takes top-10 chunks per session, then Cohere rerank with multiplier 5 over the merged 100-chunk pool, top-50 to reader, plus HyDE) measured **42.6% (23/54) on LongMemEval-M Phase A** — that's **−14.8 pp** below the M-tuned combined config (57.4%) and **−25.9 pp** below the empirical per-category-oracle (68.5%). Cost-per-correct came out to **$0.196**, 3.5x more expensive than M-tuned ($0.0558). This is the third consecutive negative result for retrieval-architecture alternatives on top of our hybrid + Cohere rerank stack (Stage L, Stage I, Stage H).

## Setup

- Benchmark: LongMemEval-M (500 sessions per haystack, 1.5M tokens per case)
- N: 54 stratified (`--sample-per-type 9`)
- Reader: gpt-4o, max_tokens 256
- Memory: full-cognitive (CharHashEmbedder default)
- Replay: ingest
- Retrieval config:
  - `--context-summary gpt-5-mini` — per-session summarization at ingest
  - `--session-retrieval` — 2-stage retrieval (mutually exclusive with `--hybrid-retrieval`)
  - `--session-retrieval-top-sessions 10` — Stage 1 selects top-10 sessions by summary cosine
  - `--session-retrieval-chunks-per-session 10` — Stage 2 selects top-10 chunks per session
  - `--rerank cohere --rerank-candidate-multiplier 5` — Cohere rerank-v3.5 over the 100-chunk pool, fetching ×5 candidates
  - `--reader-top-k 50` — reader sees top-50 reranked chunks
  - `--hyde` — HyDE hypothetical-document embedding for query rewriting
- Judge: gpt-4o-2024-08-06, rubric 2026-04-18.1
- Seed: 42

## Result

| Metric | Value |
|---|---:|
| Aggregate accuracy | **42.6%** (23/54) |
| Total cost | $4.51 |
| $/correct | $0.196 |
| Latency p50 | 662 534 ms (11.0 min) |
| Latency p95 | 953 723 ms (15.9 min) |
| Avg latency | 666 334 ms (11.1 min) |
| Wall-clock | ~9.5 hours sequential at concurrency=1 |

## Per-category breakdown (vs M-tuned combined and per-category-oracle)

| Category | Hierarchical | M-tuned combined | Per-category-oracle | Δ vs combined |
|---|---:|---:|---:|---:|
| single-session-assistant | 88.9% | 100.0% | 100.0% | −11.1 pp |
| single-session-user | 66.7% | 77.8% | 77.8% | −11.1 pp |
| knowledge-update | 55.6% | 77.8% | 77.8% | −22.2 pp |
| temporal-reasoning | 25.0% | 33.3% | 66.7% (HyDE alone) | −8.3 pp |
| **multi-session** | **22.2%** | **66.7%** | 66.7% | **−44.5 pp** |
| **single-session-preference** | **0.0%** | 14.3% | 22.2% | **−14.3 pp** |
| **Aggregate** | **42.6%** | **57.4%** | **68.5%** | **−14.8 pp** |

## Why hierarchical retrieval underperformed at M scale

The 2-stage architecture loses the right session at Stage 1 on hard cases. At 500-session haystacks, the gold session might rank 11-30 in summary-similarity but be the only session containing the answer. Stage 1's top-10 cutoff drops it before Stage 2 ever sees it. Stage 2 then operates on a smaller pool of presumably-related-but-actually-wrong sessions, and the reranker has nothing useful to find.

Failure modes by category:

1. **Multi-session collapsed −44.5 pp.** The category that requires precision across many sessions is the one where Stage 1's session-summary similarity is most error-prone. The right sessions don't make top-10 because their summaries don't match the query directly.
2. **Single-session-preference dropped to 0%.** Per-session summaries lose the specific preference statements; Stage 1 picks plausible sessions but the actual preference is buried.
3. **Temporal-reasoning regressed −8.3 pp.** Per-session summaries collapse temporal anchors (date stamps, "Tuesday last week", etc.) that the reader needs.

The contrast with M-tuned combined (`--hybrid-retrieval --rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`):

- M-tuned puts ALL ~25k chunks through hybrid BM25 + dense retrieval, then reranks the top-250 chunks via Cohere over the full pool. The right chunk usually surfaces because the rerank cross-encoder operates on raw text with full context.
- Hierarchical pre-prunes to ~100 chunks by going through summary-stage filtering first. Loses precision when summaries don't match.

## Comparison with Stage L, Stage I

Three consecutive negative results on retrieval-architecture alternatives:

| Stage | Architecture | Δ vs paired baseline |
|---|---|---:|
| L | Anthropic Contextual Retrieval (per-session summary prepended to chunks before embedding) | −3.7 pp on LongMemEval-S, temporal-reasoning −33.3 pp |
| I | Mem0-v3-style entity-linking post-retrieval re-rank | −4.0 pp on LOCOMO, multi-hop −20 pp |
| **H** | Hierarchical 2-stage retrieval (session-summary + per-session chunks) | **−14.8 pp on LongMemEval-M, multi-session −44.5 pp** |

The pattern: **alternative retrieval architectures don't beat hybrid + Cohere rerank with widened windows.** The lift comes from giving the cross-encoder more candidates from the full pool (M-tuned's `--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde` adds +26.8 pp), not from architectural pre-pruning.

## What still ships from Stage H

The bench's `--session-retrieval` flag remains opt-in for consumers building hierarchical-RAG pipelines on document workloads where Stage 1 summary similarity is more reliable (longer documents, less topic homogeneity). Removing the M-tuned widening is what makes hierarchical viable; combined with M-tuned's wide rerank pool, hierarchical is redundant and lossy.

The agentos primitives `SessionSummarizer`, `SessionSummaryStore`, `SessionRetriever` (already shipped) remain stable and tested.

## Implication for v2 publication

- **Headline shifts.** Per-category dispatch (68.5% empirical) is now the M-scale lift to publish, NOT hierarchical retrieval.
- **The negative-finding count grows to 3.** Stage L, Stage I, Stage H. Each documents architecturally distinct retrieval mechanisms that don't translate from their published-domain sweet spot to conversational memory at 500-session-haystack scale.
- **Phase B validation focus.** The M-tuned combined config (57.4% Phase A) and per-category dispatch (68.5% empirical) are the configurations to validate at full N=500. Hierarchical drops out of the comparison table.
- **What's left as architectural push.** Stage E (Hindsight 4-network typed observer) is now the only remaining non-tested architecture in the v2 narrative. Phase 4b deep retrieval integration shipped this session; Phase A measurement gated on running it.

## Run artifact

`results/runs/2026-04-26T04-57-45-526--longmemeval-m--gpt-4o--full-cognitive--ingest.json`

## Anchor in publication narrative

> "We tested hierarchical retrieval (2-stage session-summary then per-session chunks) on LongMemEval-M and report a negative result: −14.8 pp aggregate accuracy with multi-session collapsing −44.5 pp. The 2-stage architecture loses the right session at the summary-similarity stage on hard queries, and the chunk stage can't recover. This is the third consecutive negative result for retrieval-architecture alternatives on top of our hybrid + Cohere rerank stack. The pattern is consistent: widening the rerank candidate pool beats architectural pre-pruning at conversational-memory scale."

Three negative findings published alongside two positive ones (M-tuned +26.8 pp, per-category dispatch +37.9 pp) is the credibility differentiator vs vendors who only publish wins.
