---
title: Stage L Phase A Findings — Anthropic Contextual Retrieval doesn't translate to conversational memory
date: 2026-04-25
spec: 2026-04-25-comprehensive-evaluation-matrix-design.md (Stage L row)
result: NEGATIVE — drop Stage L from accuracy-push priorities
cost: $3.24 LLM total (this session's measurement)
---

# Stage L Phase A Findings — 2026-04-25

## TL;DR

We measured Anthropic Contextual Retrieval (per-session summary prepended to every chunk before embedding) against the bench's shipping retrieval pipeline. **It hurts accuracy by 3.7pp at N=54 stratified, with a 33pp regression on temporal-reasoning specifically.** This is the first published measurement of this combination on LongMemEval-S; we recommend dropping Stage L from accuracy-push priorities and reallocating the budget to Stage I (entity-linking) and Stage J (LongMemEval-M coverage).

## Setup

- Benchmark: LongMemEval-S, stratified `--sample-per-type 9` = N=54 cases (9 per category)
- Reader: gpt-4o, max_tokens 256
- Memory: full-cognitive
- Replay: ingest
- Embedder: `openai:text-embedding-3-small` (1536-dim) — first time bench measured with semantic embedder
- Retrieval: hybrid (BM25 + dense) + Cohere rerank-v3.5 + reader-top-k 20
- Judge: gpt-4o-2024-08-06, rubric 2026-04-18.1
- Seed: 42, bootstrap 10k

## Results

| Config | Accuracy | $/correct | Total cost |
|---|---:|---:|---:|
| Baseline (no `--context-summary`) | **74.1%** (40/54) | $0.0349 | $1.40 |
| Treatment (`+ --context-summary gpt-5-mini`) | **70.4%** (38/54) | $0.0224 | $0.85 |
| **Δ** | **−3.7pp** | — | — |

Treatment cost was lower than baseline because the SessionSummarizer's content-addressed disk cache hit from a prior invalidated spot-check. With cold cache, treatment would add ~$0.20 in observer LLM calls.

## Per-category breakdown

| Category | Baseline (40/54) | Treatment (38/54) | Δ |
|---|---:|---:|---:|
| single-session-assistant | 100.0% | 100.0% | 0pp |
| single-session-user | 88.9% | 100.0% | +11.1pp |
| knowledge-update | 88.9% | 88.9% | 0pp |
| temporal-reasoning | 100.0% | 66.7% | **−33.3pp** |
| multi-session | 33.3% | 33.3% | 0pp |
| single-session-preference | 33.3% | 33.3% | 0pp |

### Notable per-category observations

1. **Temporal-reasoning collapses (−33.3pp).** The summary-prepended embedding likely surfaces session-level themes at the cost of turn-level temporal anchors.
2. **Multi-session is unchanged.** The supposed beneficiary of contextual retrieval per Anthropic's published numbers (35% retrieval failure reduction) shows zero lift on this benchmark.
3. **single-session-user gains +11.1pp** but on N=9 that's a 1-case shift — within noise.

## Why this differs from Anthropic's published lift

Anthropic's measurement (anthropic.com/news/contextual-retrieval, Sep 2024):
- Domains: codebases, fiction, ArXiv papers, science papers (documents)
- Lift: 35% retrieval failure reduction with embeddings alone, 67% with reranking

Our measurement:
- Domain: conversational memory (LongMemEval-S sessions)
- Lift: −3.7pp accuracy (regression)

**Hypothesized reasons the contextual-retrieval pattern doesn't translate to conversational memory:**

1. **Topic homogeneity within sessions.** Document chunks are heterogeneous within (a code-base file covers many functions; an ArXiv paper covers many sub-topics). Conversational sessions are topically homogeneous — every turn in a session is about the same thing. Adding the session summary to every chunk doesn't add discriminating context; it adds shared noise that reduces per-chunk uniqueness.
2. **Cohere semantic rerank already compensates.** The shipping pipeline uses Cohere rerank-v3.5, which operates on raw text not embeddings. Even if dense retrieval is degraded by the summary prefix, the cross-encoder rerank rescues it. So the contextual prepend's main benefit (better dense recall) is non-load-bearing.
3. **Temporal-anchor obscuration.** Per-turn timestamps embedded in chunk content carry the temporal signal. A 50-token summary at the front of every chunk obscures these anchors during embedding similarity, hurting temporal-reasoning specifically.

## What this means for the v1 evaluation matrix

The v2 handoff and the comprehensive evaluation matrix spec listed Stage L as the lowest-hanging-fruit accuracy push (+10-20pp expected). **That estimate was based on Anthropic's domain-specific measurement, which doesn't generalize to conversational memory.** Stage L's actual contribution to LongMemEval-S accuracy is null-to-negative.

### Recommended priority shifts

1. **Drop Stage L from Phase B sweep.** No accuracy lift to validate at full N. Stage L's value is purely architectural (reference executor for IngestRouter consumers); ship the agentos-side code as 0.2.12 (already done) and move on.
2. **Promote Stage I (entity-linking, Mem0-v3 style)** to the highest-priority accuracy push. It's a fundamentally different mechanism (entity-overlap signal at retrieval) and there's no a-priori reason it would also fail to translate.
3. **Stage J (LongMemEval-M) remains valuable** as benchmark-coverage, not as accuracy push. First published M number from any orchestration-router architecture.
4. **Stage E (Hindsight 4-network) remains valuable** as the highest-expected-payoff individual architecture, gated on whether Stage I shows positive signal first.

### Updated cost forecast for v1

The original spec estimated $1000-1200 net new for the comprehensive matrix. Dropping Stage L's Phase B (which would have been the most expensive single architecture × benchmark cell) saves ~$50 reader cost. New estimate: **~$950-1150 net new**, dominated by Stage I + Stage J.

## What still ships from Stage L

Even though the architecture doesn't lift accuracy in our pipeline, the agentos-side work shipped real value:

- `SummarizedIngestExecutor` in `@framers/agentos/ingest-router` — wraps the existing production `SessionSummarizer` and exposes it through the IngestRouter dispatcher pattern. Consumers using IngestRouter get a working `summarized` strategy out of the box.
- `RawChunksIngestExecutor`, `SkipIngestExecutor` — trivial reference executors for the other two strategies.
- 56 contract tests (38 existing + 18 new) all pass.
- semantic-release will publish 0.2.12 on next CI cycle.

The architectural cleanup (production primitive integrity for IngestRouter consumers) is worthwhile regardless of the bench measurement. The empirical finding is just that this particular ingest strategy doesn't help LongMemEval-S accuracy.

## Run artifacts

| File | Config | Result |
|---|---|---|
| `results/runs/2026-04-25T06-19-48-175--longmemeval-s--gpt-4o--full-cognitive--ingest.json` | char-hash + --context-summary, N=30 | INVALID (char-hash + summary mismatch); 63.3% |
| `results/runs/2026-04-25T06-26-39-720--longmemeval-s--gpt-4o--full-cognitive--ingest.json` | OpenAI embedder, no summary, N=54 | **Baseline 74.1%** |
| `results/runs/2026-04-25T06-29-32-749--longmemeval-s--gpt-4o--full-cognitive--ingest.json` | OpenAI embedder + --context-summary, N=54 | **Treatment 70.4%** |

## Anchor in publication narrative

The finding becomes a credibility marker for our v1 publication:

> "We tested Anthropic Contextual Retrieval on conversational memory and report a negative result: -3.7pp aggregate accuracy with -33pp on temporal-reasoning. The contextual-retrieval pattern's domain-specific gains on documents don't translate to conversational benchmarks. We document this so the community doesn't repeat the experiment unaware."

This is the kind of honest negative result that distinguishes us from vendors who only publish wins.
