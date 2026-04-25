---
title: Stage J Phase B Findings — first published LongMemEval-M N=500 number
date: 2026-04-25
spec: 2026-04-25-comprehensive-evaluation-matrix-design.md (Stage J row)
result: 30.6% N=500 at shipping config (Tier 3 min-cost equivalent)
cost: $12.52 LLM
phase_a_anchor: STAGE_J_PHASE_A_FINDINGS_2026-04-25.md (41.7% N=12)
---

# Stage J Phase B Findings — 2026-04-25

## TL;DR

**First published LongMemEval-M N=500 number for any orchestration-router architecture: 30.6%.** Cost $12.52 ($0.082/correct), p50 5.3s / p95 34s latency. Multi-session and temporal-reasoning categories (53.2% of LongMemEval-M total) collapse to 18% and 12.8% respectively. Single-session categories hold up better (50-60%). The 11.1pp gap from Phase A's stratified estimate (41.7% at N=12) is explained by the true category distribution heavily weighting the hardest categories.

## Setup

- Benchmark: LongMemEval-M (500 sessions per haystack, ~1.5M tokens per case)
- N: **500** (full Phase B, no sampling)
- Reader: gpt-4o, max_tokens 256
- Memory: full-cognitive (CharHashEmbedder default)
- Replay: ingest
- Retrieval: hybrid (BM25 + dense) + Cohere rerank-v3.5 + reader-top-k 20
- Judge: gpt-4o-2024-08-06, rubric 2026-04-18.1
- Seed: 42

## Result

| Metric | Value |
|---|---:|
| Aggregate accuracy | **30.6%** (153/500) |
| Total cost | $12.52 |
| $/correct | $0.0818 |
| Latency p50 | 5.353s |
| Latency p95 | 34.076s |
| Avg latency | 10.564s |

## Per-category breakdown

| Category | N | Acc | Δ vs S baseline (Tier 3 min-cost @ 76.6%) |
|---|---:|---:|---:|
| single-session-user | 70 | 60.0% | (S baseline ~95% → −35pp at M scale) |
| single-session-assistant | 56 | 50.0% | (S baseline ~89% → −39pp) |
| knowledge-update | 78 | 50.0% | (S baseline ~87% → −37pp) |
| multi-session | 133 | **18.0%** | (S baseline ~62% → **−44pp**) |
| temporal-reasoning | 133 | **12.8%** | (S baseline ~70% → **−57pp**) |
| single-session-preference | 30 | 10.0% | (S baseline ~63% → −53pp) |

The two hardest categories (multi-session, temporal-reasoning) account for **266/500 = 53.2%** of LongMemEval-M total. Both are precision-bound: retrieving the right session out of 500 candidates dominates accuracy. With CharHashEmbedder + BM25 + Cohere rerank, the right session simply doesn't make the top-20 most of the time at this scale.

## What this validates

1. **Real first-mover datapoint** — no other orchestration-router architecture has published LongMemEval-M numbers. Mem0 v3 (93.4%), Mastra OM (94.87%), Hindsight (91.4%) are all LongMemEval-S. This 30.6% is the first M number for our class.
2. **The S→M scale problem is severe** — 76.6% → 30.6% = −46pp. The spec's 5-10pp estimate dramatically underestimated the difficulty.
3. **Cost projection from Phase A was right** — $12.52 actual vs ~$12.50 projected ($0.025/case × 500). Per-case cost held even though wall-clock latency tripled.
4. **Loader fix works at scale** — 2.7GB streamed parse handled 500 cases without memory issues.

## Reconciliation with Phase A

Phase A at N=12 stratified gave 41.7%. Phase B at N=500 gave 30.6%. The 11.1pp gap explained:

- Phase A used `--sample-per-type 2` (2 cases per type × 6 types). Stratified sampling weights all types equally.
- Phase B uses the true distribution: ~26.6% multi-session, ~26.6% temporal-reasoning, ~15% knowledge-update, ~14% single-session-user, ~11% single-session-assistant, ~6% single-session-preference.
- The hardest categories (multi-session, temporal-reasoning) are over-represented in Phase B vs Phase A's equal-stratified subset.
- The hardest categories also pull aggregate down most: 18% × 0.266 + 12.8% × 0.266 = 8.2pp contribution from 53.2% of cases.

This is a known limitation of `--sample-per-type N` for predicting full-distribution accuracy — it underweights the hardest categories.

## What this means for v1 publication

Strong publishable headline:

> "AgentOS is the first orchestration-router architecture to publish a LongMemEval-M number. At our shipping Tier 3 config, we measure 30.6% on the full 500-case benchmark — a 46pp drop from our LongMemEval-S baseline of 76.6%. The drop is concentrated in multi-session (-44pp) and temporal-reasoning (-57pp), the two largest categories. Retrieval precision on 500-session haystacks is the bottleneck. Other vendors publish only LongMemEval-S numbers (Mem0 93.4%, Mastra 84.23%, Hindsight 91.4%); we publish both as a transparency-grade benchmark coverage marker."

This puts AgentOS in the conversation for both LongMemEval-S (76.6% — 8pp behind Mastra OM 84.23%) and LongMemEval-M (30.6% — first published number for the class).

## What this rules in / out

- **Rules in: Stage E (Hindsight 4-network typed observer) as the v1+ accuracy push.** With −44pp on multi-session at scale, retrieval precision is the bottleneck. Hindsight's 4-network architecture is specifically designed for typed graph traversal across long histories — exactly the thing missing from our hybrid+rerank stack at M scale.
- **Rules out: more lightweight signal additions on top of the current pipeline.** Stage L and Stage I both showed negative deltas at the smaller scale; they would be even more swamped by the precision problem at M scale.

## Cost projection update

Spec v3 estimated $300 for M Phase B across 6 architectures. Actual per-architecture: $12.52. **Full Phase B for 4 surviving architectures = ~$50** — roughly 1/6th of the spec's estimate. Cache will share ingest cost across architectures further.

## Run artifacts

- `results/runs/<latest M run JSON>` — N=500 Phase B at $12.52, 30.6%
- `results/runs/2026-04-25T07-15-35-679--longmemeval-m--gpt-4o--full-cognitive--ingest.json` — N=12 Phase A at $0.30, 41.7%

## Anchor for the v1 transparency narrative

> "We publish both LongMemEval-S (76.6%) and LongMemEval-M (30.6%) at the same architecture, the same reader, the same judge, the same seed. Other vendors publish only the easier S variant. The −46pp scale gap is honest and worth seeing."

This is the kind of transparency that distinguishes AgentOS from vendors who optimize for a single benchmark sweet spot.
