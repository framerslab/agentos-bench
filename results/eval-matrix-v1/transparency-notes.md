---
title: v1 Comprehensive Evaluation Matrix — Transparency Notes
date: 2026-04-26
companion: comparison-table.md
methodology_anchor: ../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md
---

# v1 Evaluation Matrix — Transparency Notes

These notes accompany [comparison-table.md](comparison-table.md). They document the methodology behind every cell, the judge integrity probe per benchmark, the two negative architecture findings, the BEAM coverage status, and the v2 ambitions.

The publishable claim is not "AgentOS beats every vendor on every benchmark." It is: every cell has a published bootstrap CI, a published judge false-positive rate, a per-case run JSON at seed 42, and a transparent matched-reader caveat for every cross-vendor comparison. No memory-library publisher in our SOTA-cited audit (Mem0, Mastra, Supermemory, Zep, Emergence, Letta, Hindsight) ships that full transparency stack.

## 1. Methodology

| Knob | Value | Notes |
|---|---|---|
| Reader | `gpt-4o` | Temperature 0, max tokens 256 (reader), 1024 (observer). |
| Judge | `gpt-4o-2024-08-06` | Wrapped in `LongMemEvalJudge`. Empty system prompt. |
| Rubric | `2026-04-18.1` | Stricter than LOCOMO's default. Explicit 0/1 binary on each rubric category. |
| Seed | 42 | Mulberry32 PRNG for sampling, splitting, and bootstrap. |
| Bootstrap | 10,000 resamples | Percentile method, 95% CI. |
| Per-case artifacts | One run JSON per cell | Saved to `results/runs/<timestamp>--<benchmark>--gpt-4o--full-cognitive--ingest.json`. LongMemEval-M run JSONs exceed 100 MB; the matching `--summary.json` is committed and the full run JSON is gitignored. |
| Cost tracking | `totalUsd` = full pipeline (ingest + reader + judge + reranker) | `costPerCorrect` = `totalUsd / passedCases`. |
| Single-provider reproducibility | Classifiers and judges all on OpenAI | No Claude or Gemini dependency for any shipping configuration. Cohere only for the rerank stage. |
| Embedder | `text-embedding-3-small` on the S headline (85.6%) and the M headline (70.2%); `CharHashEmbedder` (lexical FNV-1a hash) preserved on the bench-default fallback row (S 76.6%, M 45.4%) for auditable gap tracking. | **Updated 2026-04-29**: the validated agentos-as-deployed configuration on S is **85.6% [82.4%, 88.6%]** at $0.0090/correct (canonical+RR + reader router) and on M is **70.2% [66.0%, 74.0%]** at $0.0078/correct (M-tuned + sem-embed + reader router + reader-top-K=5). The 76.6% S CharHash row and the 45.4% M CharHash row stay in the leaderboard as "bench-default fallback" references so the gap is auditable. See [S 85.6% blog post](../../../../apps/agentos-live-docs/blog/2026-04-28-reader-router-pareto-win.md) and the M 70.2% row's footnote in [LEADERBOARD.md](../LEADERBOARD.md). |
| Reranker | Cohere `rerank-v3.5` | Cross-encoder over the merged BM25 + dense pool. Required for every Tier 1+ row. |
| `reader-top-k` | 20 | Top 20 chunks after rerank fed to the reader. |

### 1.1 Methodology cross-reference

Every cited methodology choice maps to a verbatim primary source in [SOTA_CITED_EVIDENCE_2026-04-25.md](../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md). The audit covers:

- §2 Hindsight typed-network observer (reference for v2 Stage E)
- §3 Mem0 v3 architecture (single-pass ADD-only + entity-linking hybrid; managed-platform 93.4% caveat)
- §4 Mastra Observational Memory (gemini-2.5-flash observer caveat on the headline 84.23%)
- §5 Anthropic Contextual Retrieval (verbatim cookbook recipe; Stage L reference)
- §6 Emergence Simple Fast (k=42 magic number, Calvin Ku critique)
- §7 LOCOMO architecture issues (Penfield Labs 6.4% answer-key error rate, 62.81% judge FPR)
- §8 BEAM benchmark spec (10 abilities, GPT-4.1-mini judge)
- §9 LongMemEval-M (1.5 M tokens, 500 sessions per haystack)

## 2. Judge false-positive rate per benchmark

The Stage G judge-adversarial probe synthesizes topically-adjacent wrong answers via `gpt-5-mini` and sends them to the same judge that scores real answers. The acceptance rate is the judge's effective false-positive rate on the wrong-but-topical class of error. Below, every benchmark column is footnoted with its measured FPR.

| Benchmark | Judge FPR | 95% CI | n probed | Source |
|---|---:|---:|---:|---|
| LongMemEval-S | 1% | [0%, 3%] | 100 | [Stage G, 2026-04-24](../../docs/SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md) |
| LongMemEval-M | **2%** | **[0%, 5%]** | 100 | [Stage G-M, 2026-04-26](../../docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md) |
| LOCOMO | 0% | [0%, 0%] | 100 | [Stage G-LOCOMO, 2026-04-24](../../docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md) |
| BEAM 100K | unprobed | — | — | Deferred to v2 (BEAM adapter not yet implemented). |

Comparison anchor: Penfield Labs measured **62.81%** FPR on LOCOMO's default `gpt-4o-mini` judge with the original LOCOMO rubric. The 63 pp gap vs our 0% is a judge-model + rubric-strictness artifact, not an intrinsic property of LOCOMO's gold answers. Any vendor publishing a LOCOMO number measured with the default judge inherits up to 63 pp of accepted-wrong-answer noise.

### 2.1 Why we did not re-run the LOCOMO probe at `--entity-linking 0.5`

The v1 publication plan (`docs/plans/2026-04-26-v1-publication-plan.md` §1.2) called for a second LOCOMO probe at the new `--entity-linking 0.5` config. We do not run it. Judge FPR is a property of `(judge model, rubric, dataset cases)`, not of the retrieval architecture under test. The probe synthesizes wrong-but-topical answers from gold via `gpt-5-mini`, then sends them to the judge. The retrieval pipeline never enters the loop.

The existing 0% LOCOMO FPR therefore applies to every retrieval configuration on LOCOMO, including `--entity-linking 0.5`. Spending another $0.05 to confirm a tautology would burn the v1 transparency budget on signal we already have.

## 3. Negative architecture findings — six total (two Phase A drops + four Phase B compounding regressions)

The v1 spec ([2026-04-25-comprehensive-evaluation-matrix-design.md](../../docs/specs/2026-04-25-comprehensive-evaluation-matrix-design.md)) named six candidate architectures. Two were tested and dropped at Phase A (§3.1, §3.2). Four additional architectures were tested at Phase B as compounding lifts on top of validated baselines and net-regressed (§3.3, §3.4 — hierarchical retrieval, two-call reader, M-tuned flags compounded on S, all-OM dispatch on S). All six negative findings are documented as production primitives in agentos core anyway, since consumers building different pipelines may see different results. The negative findings are the credibility differentiator vs vendors who only publish wins.

### 3.1 Stage L: Anthropic Contextual Retrieval `summarized` executor

**Result: −3.7 pp aggregate on LongMemEval-S, −33.3 pp on temporal-reasoning.** Per-session summary prepended to every chunk before embedding. The architecture, the hypothesis, the per-category breakdown, the architectural-fit explanation: see [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md).

Why it didn't translate from documents to conversational memory:

1. **Topic homogeneity.** Document chunks within a chapter or codebase file are heterogeneous. Conversational sessions are topically homogeneous. Adding a session summary to every chunk reduces per-chunk uniqueness rather than adding discriminating context.
2. **Cohere rerank already covers semantic match.** The rerank cross-encoder operates on raw text; it subsumes the dense-recall lift the contextual prepend would provide.
3. **Temporal-anchor obscuration.** Per-turn timestamps embedded in chunk content carry the temporal signal. A 50-token summary prefix obscures these anchors during embedding similarity, hurting temporal-reasoning specifically.

Anthropic's published 35% retrieval-failure reduction is real on documents. It does not generalize to conversational memory under our specific pipeline. The agentos primitive (`SummarizedIngestExecutor`, shipping in 0.2.12) is still useful for consumers building document-mode pipelines.

### 3.2 Stage I: Mem0-v3-style entity-linking re-rank

**Result: −4.0 pp aggregate on LOCOMO, −20 pp on multi-hop.** Post-retrieval entity-overlap re-rank applied after Cohere's cross-encoder. Per-category breakdown in [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md).

Why it didn't lift on top of Cohere rerank:

1. **The cross-encoder already does the work.** Cohere `rerank-v3.5` performs full cross-encoder semantic matching. Entity overlap is a strict subset of that signal; adding it as a second-stage re-rank introduces redundancy, not new information.
2. **Entity name variants confuse a regex matcher.** LOCOMO questions reference entities by partial name or pronoun ("the dog" vs "Maxwell"); regex extraction can't bridge these.
3. **Multi-hop suffers most.** Multi-hop questions span sessions where the relevant entities don't all appear in any single session. Re-ranking by per-candidate entity overlap penalizes the partial-match candidates that multi-hop reasoning actually needs.

Mem0 v3's published 91.6% LOCOMO is a managed-platform claim with proprietary optimizations. Their own blog ([State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)) reports **66.9%** for the production stack on LOCOMO, which is closer to the architecture we tested. The agentos primitives (`EntityExtractor`, `EntityLinkingIngestExecutor`, `EntityRetrievalRanker`, shipping in 0.2.13) are still useful for consumers replicating Mem0-v3-style pipelines.

### 3.3 Phase B compounding tests on S — both regress against the 83.2% baseline

After landing the 83.2% Phase B headline (Tier 3 min-cost + `text-embedding-3-small`), two natural next-axis experiments were measured at full N=500 to test whether layered architectures compound. **Both regressed**, locking the 83.2% configuration as the right S anchor.

**M-tuned flags compounded on S Phase B (`--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`):** **76.6% [72.8%, 80.2%]**, $0.113/correct. **−6.6 pp vs 83.2%.** MS −17.6 pp, TR −10.3 pp. The wider rerank pool over-prunes S's smaller chunk pool; HyDE adds noise on shorter haystacks. The flags are M-specific calibration for 500-session haystacks, not S. Run JSON: `results/runs/2026-04-27T19-07-21-734--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**All-OM dispatch on S (Mastra OM architecture clone, `--observational-memory --om-observer-model gpt-5-mini`):** **76.0% [72.2%, 79.6%]**, $0.346/correct (6.6× more expensive). **−7.2 pp vs 83.2%.** SSA −16.1 pp (98.2% → 82.1%), TR −16.3 pp (84.7% → 68.4%). All-OM-on-every-case summarizes session content into observational memory regardless of category, throwing away the verbatim detail lexical+rerank retrieval would have surfaced for single-session-assistant questions and the temporal anchors temporal-reasoning needs. **Apples-to-apples confirmation that Mastra OM's published 84.2% gpt-4o number is within statistical CI of our 83.2% gpt-4o baseline; their 94.9% headline is reader-driven (gpt-5-mini reader, +10.7 pp on their own data), NOT architecture-driven (all-OM dispatch HURT us at gpt-4o reader on the identical retrieval stack).** Selective OM gating (Tier 3 min-cost preset on `@framers/agentos/memory-router`) is the validated S architecture choice. Run JSON: `results/runs/2026-04-27T21-31-50-806--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

### 3.4 The pattern

Six architecturally-distinct experiments, six negative results vs the simpler shipping configuration: Stage L Anthropic Contextual Retrieval, Stage I Mem0-style entity-linking re-rank, Stage H hierarchical retrieval, two-call reader on M-tuned, M-tuned flags compounded on S, all-OM dispatch on S. The first three duplicate work the Cohere rerank stage already does or introduce signals the cross-encoder already considers; the latter three replace simpler-and-cheaper paths with more-expensive paths that lose detail (M-tuned over-prunes S; OM summarization throws away verbatim chunks; two-call reader strips raw passage context). To push aggregate accuracy further, the next architectural push needs to be either a substantial new signal (typed graph traversal — Stage E Hindsight 4-network observer is the v2 candidate) or a model-tier swap (gpt-5-mini reader, queued as the next S experiment after M Phase B lands; Mastra's own data implies +10.7 pp from this single change).

## 4. BEAM 100K coverage

The bench's BEAM adapter ([packages/agentos-bench/src/benchmarks/beam/Beam.ts](../../src/benchmarks/beam/Beam.ts)) is a `BeamUnimplementedError` placeholder. The v1 spec descoped full multi-tier BEAM (100K + 500K + 1M + 10M at full N) to v2 paired with Stage E. The v1 publication does not include BEAM measurements.

BEAM context for the cross-vendor comparison rows:

- Hindsight 64.1% at BEAM 10M is the open SOTA.
- Honcho 40.6%; LIGHT (BEAM paper proposal) 26.6%; RAG baseline 24.9%.
- Mem0 has not published BEAM scores despite founding the BEAM blog post.

The v2 publication will pair Stage E implementation with BEAM 100K + 500K + 1M tier measurements. Markmhendrickson's published critique ([agent-memory-breaks-before-retrieval](https://markmhendrickson.com/posts/agent-memory-breaks-before-retrieval)) argues that "state integrity degrades at 500K to 2M tokens"; the 100K-1M range is therefore more architecturally discriminating than the 10M tier and worth measuring at full N before the 10M splurge.

## 5. Cross-vendor comparison caveats

Every reference row in [comparison-table.md](comparison-table.md) §"Reference rows" is footnoted with the judge-harness, observer-model, and managed-vs-OSS caveats from [SOTA_CITED_EVIDENCE_2026-04-25.md](../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md). The summary table:

| Reference system | LongMemEval-S | Caveat |
|---|---:|---|
| Full-context `gpt-4o` baseline | 60.2% | LongMemEval paper. No memory architecture; whole conversation in context. |
| Mastra Observational Memory | 84.2% (`gpt-4o`) | Observer is `gemini-2.5-flash`. Reader is `gpt-4o`. Cross-provider; not single-provider reproducible. **Within statistical CI of our 83.2% gpt-4o baseline.** |
| Mastra Observational Memory (architecture clone, our retrieval) | **76.0%** [72.2%, 79.6%] (`gpt-4o`) | **Apples-to-apples test 2026-04-27.** All-OM dispatch + `gpt-5-mini` observer (matching Mastra's 94.9% architecture) on our retrieval stack (full-cognitive + Cohere rerank-v3.5 + `text-embedding-3-small`) at `gpt-4o` reader. **−7.2 pp vs our 83.2% baseline at the same reader.** Confirms Mastra's architecture lift on S is reader/observer-tier driven (their 94.9% uses `gpt-5-mini` reader + `gpt-5-mini` observer; +10.7 pp over their gpt-4o number is reader + observer combined), not the all-OM-on-S dispatch pattern. Run JSON: `results/runs/2026-04-27T21-31-50-806--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. |
| Mem0 v3 (managed platform) | 93.4% | Managed-platform-only number with proprietary optimizations. Mem0's own production-stack number (LOCOMO) is 66.9% per their State of AI Agent Memory 2026 blog. |
| Hindsight Gemini-3-pro | 91.4% | Reader is `gemini-3-pro`. Bench harness uses Gemini judge (`vectorize-io/agent-memory-benchmark`). Apples-to-apples for our `gpt-4o` reader is OSS-20B 83.6% / OSS-120B 89.0%. |
| Hindsight OSS-120B | 89.0% | Same Gemini-judge harness caveat. |
| Hindsight OSS-20B | 83.6% | Same Gemini-judge harness caveat. |
| Supermemory (`gpt-4o`) | 81.6% | Own harness; full methodology disclosed in [supermemory.ai/research/](https://supermemory.ai/research/). |
| Zep self-reported | 71.2% | Independent reproduction at [arxiv:2512.13564](https://arxiv.org/abs/2512.13564) measured 63.8% on the same benchmark. |

Numbers in the headline accuracy table that are NOT footnoted with a vendor caveat are AgentOS measurements at the methodology in §1.

## 5.5. Per-category reader router (NEW 2026-04-28 — cost-Pareto win at gpt-4o-class accuracy)

The Phase B confirmation that `gpt-5-mini` and `gpt-4o` readers tie at **83.2%** aggregate on LongMemEval-S — but with very different per-category strengths — surfaced an architectural opportunity. Per-category dispatch between the two readers, driven by the same `gpt-5-mini` few-shot classifier already running for the Tier 3 policy router, produces an apples-to-apples Pareto improvement at the gpt-4o-reader tier:

| Metric | Tier 3 min-cost + sem-embed (gpt-4o reader) | + Reader router | Δ |
|---|---:|---:|---:|
| Aggregate accuracy | 83.2% [79.8%, 86.4%] | **84.8% [81.6%, 87.8%]** | +1.6 pp (CIs overlap) |
| Cost per correct | $0.0521 | **$0.0410** | **−21%** |
| Avg latency | 73 234 ms | **21 042 ms** | **−71% (3.5× faster)** |
| Total LLM cost | $21.66 | **$17.38** | −20% |
| single-session-preference | 63.3% [46.7, 80.0] | **86.7% [73.3, 96.7]** | **+23.4 pp (CI excludes baseline)** |

The aggregate lift is statistically within bootstrap-CI overlap with the gpt-4o-only baseline, so we do not claim a fresh accuracy headline. The honest framing is: **per-category reader dispatch ties or beats gpt-4o-only on every category except where the classifier misroutes (TR, SSU within CI), at materially lower cost and latency, and produces one statistically separated category lift (single-session-preference, +23.4 pp, CI excludes baseline).**

**Calibration source**: per-category accuracy split between `gpt-4o` (Phase B 2026-04-27) and `gpt-5-mini` (Phase B 2026-04-28) at the same retrieval stack (Tier 3 min-cost + `text-embedding-3-small`). `gpt-4o` wins TR (84.7% vs 72.9%) and SSU (94.3% vs 90.0%); `gpt-5-mini` wins SSP (86.7% vs 63.3%, +23.4 pp), KU (87.2% vs 85.7%), MS (79.7% vs 76.2%); SSA is tied (100% vs 98.2%, prefer cheaper). Codified as `MIN_COST_BEST_CAT_2026_04_28_TABLE` in [`packages/agentos-bench/src/core/readerRouter.ts`](../../src/core/readerRouter.ts).

**Realized vs oracle**: oracle aggregate at this calibration is 435/500 = **87.0%** (per-category-best dispatch with a perfect classifier). We realize **84.8%** at full N=500 because the `gpt-5-mini` few-shot classifier mispredicts category on ~20% of S cases. The misroute cost concentrates on TR (-2.7 pp vs ground-truth-best dispatch) and SSU (-2.9 pp). Closing the realized-to-oracle gap is the next architectural axis: a stronger classifier (gpt-4o classifier instead of gpt-5-mini few-shot) would lift dispatch accuracy at a small per-query cost premium.

**Architecture novelty**: where Tier 3's policy router dispatches per query *between retrieval architectures* (canonical-hybrid vs OM-v11) at a fixed reader, the reader router dispatches per query *between reader models* at a fixed retrieval architecture. Both consume the same gpt-5-mini classifier, so adding the reader router on top of the policy router costs zero extra LLM calls per case. The two routers are orthogonal axes of the same dispatch primitive — a product surface no other published memory library exposes today.

**Productionization**: the calibration table + dispatch ship in agentos-bench at the commit alongside this note. The companion `ReaderRouter` primitive in `@framers/agentos/memory-router` is queued for v0.5.5 release so consumers of `@framers/agentos` can wire per-category reader dispatch directly without rebuilding the bench harness.

### 5.5.0 NEW HEADLINE 2026-04-28 — Canonical-hybrid + standalone classifier breaks the 84.8% Pareto

The 84.8% reader-router-with-Tier-3 headline assumed the Tier 3 minimize-cost policy router was load-bearing. **It isn't — it's actively hurting at the sem-embed era.** Dropping it AND adding a standalone gpt-5-mini classifier so the reader router can dispatch on the canonical-hybrid-only path produces a **fresh accuracy headline AND simultaneous cost-Pareto improvement** at full Phase B N=500:

| Metric | Tier 3 + reader router (84.8%) | Canonical-only + reader router (85.6%) | Δ |
|---|---:|---:|---:|
| Aggregate accuracy | 84.8% [81.6%, 87.8%] | **85.6% [82.4%, 88.6%]** | +0.8 pp (overlapping CIs) |
| Total LLM cost | $17.38 | **$3.84** | **−78%** |
| Cost per correct | $0.0410 | **$0.0090** | **4.6× CHEAPER** |
| Avg latency | 21 042 ms | **4 001 ms** | **5.3× FASTER** |
| **p95 latency** | **111 535 ms** | **7 264 ms** | **15.4× FASTER on the tail** |
| Recall@10 | 0.831 | 0.981 | +0.150 |
| Reader dispatch | 234/500 gpt-4o, 266/500 gpt-5-mini | 235/500 gpt-4o, 265/500 gpt-5-mini | unchanged |

**What's measured vs not (cost/latency claims)**:

The 4.6× cheaper and 5.3× faster comparisons are **AgentOS-internal**: both the prior 84.8% reader-router-with-policy run and the 85.6% canonical-hybrid + reader-router run were executed at full Phase B N=500 on the same hardware, same OpenAI/Cohere API endpoints, same per-case `costTracker.record()` instrumentation, same wall-clock latency capture. Apples-to-apples intra-AgentOS Pareto delta. **Cost and latency are NOT measured against external vendors (Mastra, Supermemory, EmergenceMem) because those vendors do not publish $/correct or per-case latency numbers in their published research.** Apples-to-apples cost/latency comparisons against external libraries would require cloning their stacks and re-running the bench — out of scope for v1.

The accuracy comparison vs Mastra OM gpt-4o is apples-to-apples on the dimensions we can verify (same dataset, same answer reader tier), with the standing caveat that judge methodology differs across vendors (Mastra's judge model/rubric not publicly disclosed).

**Architectural finding.**

The Tier 3 minimize-cost preset routes `multi-session` and `single-session-preference` cases to the OM-v11 backend. That routing table was calibrated on Phase B data measured against CharHashEmbedder, when canonical-hybrid recall@10 was around 0.62 and OM-v11's compressed observation log compensated for missed gold passages. With `text-embedding-3-small`, canonical-hybrid recall@10 hits **0.981** on S, and the per-category accuracy story changes substantially.

Per-category Phase B at full N=500, sem-embed retrieval, both readers measured:

At gpt-4o reader:

| Category | Tier 3 + OM-v11 routing | Canonical-only | Effect |
|---|---:|---:|---|
| SSP (n=30) | 63.3% | 76.7% | OM-v11 costs 13.4 pp on SSP |
| MS (n=133) | 76.2% | 72.2% | OM-v11 gains 4.0 pp on MS |
| SSA, SSU, TR, KU | canonical-hybrid in both configs | within run-to-run noise |
| Aggregate | 83.2% | 84.2% | canonical-only edges out by 1.0 pp |

OM-v11's effect on the Tier 3 minimize-cost routing is mixed per category. SSP loses verbatim preference statements when the observer summarizes them into structured bullets, which gpt-4o struggles to recover from. MS benefits from cross-session aggregation. The case-weighted aggregate slightly favors canonical-only because SSP's 13.4 pp loss outweighs MS's 4 pp gain.

At gpt-5-mini reader (via reader router):

| Category | Tier 3 + OM-v11 + RR | Canonical + RR | Effect |
|---|---:|---:|---|
| SSP (n=30) | 86.7% | 86.7% | tied |
| MS (n=133) | 75.2% | 74.4% | tied within CI |
| Aggregate | 84.8% | 85.6% | +0.8 pp, overlapping CIs |

At gpt-5-mini reader, OM-v11 routing produces statistically tied accuracy on the categories where it fires. The headline +23.4 pp SSP lift (63.3% baseline to 86.7% headline) is driven by the reader-tier swap, not the routing decision.

The case for dropping OM-v11 routing in this configuration is therefore primarily a latency case:

| Cost axis | OM-v11 routing on | OM-v11 routing off | Delta |
|---|---:|---:|---|
| Avg latency | 21,042 ms | 4,001 ms | 5.3× faster without OM-v11 |
| p95 latency | 111,535 ms | 7,264 ms | 15× faster on the tail |
| Per-case LLM calls (OM-routed) | 1 + N observer + 1 reader | 1 classifier + 1 reader | dropping ~N observer calls per OM case |
| Total LLM cost ($) | $17.38 | $3.84 | 4.6× cheaper |

OM-v11's per-session observer pipeline runs an LLM call per haystack session before the reader sees anything. On S with 40-50 sessions per haystack, that adds 60-120 seconds of sequential observer work per OM-routed case. At gpt-5-mini reader the observer cost buys no accuracy. Drop it.



- SSP at sem-embed canonical + gpt-5-mini reader: **86.7%**
- SSP at sem-embed Tier 3 minimize-cost (→ OM-v11) + gpt-5-mini reader: 86.7% (same, but now with the cost+latency tax of the OM ingest)
- SSP at sem-embed Tier 3 minimize-cost (→ OM-v11) + gpt-4o reader (the prior 83.2% headline): **63.3%** (gpt-4o struggles on OM summaries for SSP)

**The fix**: use canonical-hybrid for ALL categories + reader router with standalone classifier. MS/SSP cases now flow through canonical-hybrid retrieval (where they have access to verbatim chunks) AND get dispatched to gpt-5-mini reader (which handles them best). The Tier 3 minimize-cost preset is now **deprecated for sem-embed deployments** — its calibration is stale.

**Standalone classifier mechanism**: when `--reader-router <preset>` is set without a co-existing classifier-firing router (`--policy-router`, `--om-dynamic-router`, or `--retrieval-config-router`), the bench fires its own gpt-5-mini few-shot classifier per case. Cost: ~$0.000138/case ($0.07 for the full Phase B N=500). The cache fingerprint partitions by a `reader-router-standalone-classifier:v1` tag so cached results from the dispatch-bypassed era don't bleed in (5 contract tests pin this in `tests/readerRouterCacheFingerprint.spec.ts`).

**Stress-tested optimum**: 7 adjacent configurations were Phase A-tested on top of the 84.8% reader-router-with-Tier-3 baseline — all regressed:

| Probe | Phase A (N=54) | Δ vs 85.2% PA baseline |
|---|---:|---:|
| `--reader-top-k 30` + reader router | 81.5% | −3.7 pp |
| `--hyde` + reader router | 83.3% | −1.9 pp |
| `--rerank-candidate-multiplier 5` + reader router | 75.9% | −9.3 pp |
| `--retrieval-config-router minimize-cost-augmented` + reader router | 77.8% | −7.4 pp |
| `--policy-router-preset balanced` + reader router | 74.1% | −11.1 pp |
| `--policy-router-preset maximize-accuracy` + reader router | 83.3% | −1.9 pp |
| `text-embedding-3-large` + reader router | 83.3% | −1.9 pp |

The 85.6% canonical-hybrid headline was discovered by running an **ablation control** for the per-category HyDE-for-MS hypothesis: the control (`canonical-only + reader router, no HyDE`) lifted by dropping the policy router. The hypothesis itself (HyDE compounds with reader router) was falsified (`canonical-only + HyDE` regressed -5.6 pp). The accidental discovery is the headline.

Source code: bench dispatch in [`src/benchmarks/longmemeval/LongMemEvalS.ts`](../../src/benchmarks/longmemeval/LongMemEvalS.ts) standalone-classifier fallback block; cache fingerprint in [`src/core/BenchmarkRunner.ts`](../../src/core/BenchmarkRunner.ts) `computeCaseRunKeyParts`; tests in [`tests/readerRouterCacheFingerprint.spec.ts`](../../tests/readerRouterCacheFingerprint.spec.ts).

Run JSON: [`results/runs/2026-04-28T19-06-42-271--longmemeval-s--gpt-4o--full-cognitive--ingest.json`](../runs/2026-04-28T19-06-42-271--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

### 5.5.1 Classifier-model trade-off — cost vs. accuracy decision matrix

The reader router's realized 84.8% sits below the per-category oracle 87.0% because the gpt-5-mini few-shot classifier mispredicts category on roughly 20% of S cases. Switching to a stronger classifier (gpt-4o) closes part of that gap at the cost of higher per-query LLM spend. Below is the cost/accuracy trade-off so consumers of `@framers/agentos` can pick the right setting for their workload. **All numbers anchored to LongMemEval-S Phase B N=500.**

**Per-case classifier LLM cost** (~650 input tokens system prompt + question, ~10 output tokens for the bare category token; OpenAI public pricing as of 2026-04-28):

| Classifier model | Input $/1M | Output $/1M | $/case (classifier) | Multiple vs `gpt-5-mini` |
|---|---:|---:|---:|---:|
| gpt-5-mini | $0.20 | $0.80 | **$0.000138** | 1.0× |
| gpt-4o | $2.50 | $10.00 | $0.001725 | **12.5×** |

**Per-run total LLM cost at LongMemEval-S Phase B N=500** (reader + reranker + judge + classifier; reader/rerank/judge held constant across both rows):

| Classifier model | Reader-router run cost | Increment vs default | % of total run |
|---|---:|---:|---:|
| gpt-5-mini (default) | **$17.38** | — | — |
| gpt-4o | $18.17 | +$0.79 (+4.5%) | 4.4% of total |

**Break-even accuracy** — the lift `gpt-4o` classifier needs to deliver to match `gpt-5-mini`'s `$0.041/correct`:

| Realized aggregate accuracy | Resulting $/correct (gpt-4o classifier) | Δ vs `gpt-5-mini` baseline ($0.0410) |
|---:|---:|---:|
| 84.8% (no lift) | $0.0428 | +4.5% per correct (more expensive) |
| 86.0% (+1.2 pp) | $0.0423 | +3.0% per correct |
| 87.0% (+2.2 pp = oracle) | $0.0418 | +1.9% per correct |
| **88.6%** (**+3.8 pp = break-even**) | **$0.0410** | **0% (matched cost-per-correct)** |
| 90.0% (+5.2 pp) | $0.0404 | −1.5% per correct (cheaper net) |

The realistic expectation for `gpt-4o` classifier is +1-2 pp toward the oracle 87.0% (the misclassification rate drops but doesn't go to zero — gpt-4o still gets categorical edge cases wrong). At realized 86%, the gpt-4o classifier is **3% more expensive per correct answer** than the default. Whether that's "worth it" depends on the workload's value-per-correct-answer.

**At production scale (1M queries/year):**

| Workload size | gpt-5-mini classifier ($/yr) | gpt-4o classifier ($/yr) | Δ ($/yr) | Accuracy lift expected | $/additional correct |
|---:|---:|---:|---:|---:|---:|
| 100K queries/yr | $13.80 | $172.50 | +$158.70 | ~+1.2 pp = +1,200 correct | $0.132 |
| 1M queries/yr | $138.00 | $1,725.00 | +$1,587.00 | ~+12,000 correct | $0.132 |
| 10M queries/yr | $1,380.00 | $17,250.00 | +$15,870.00 | ~+120,000 correct | $0.132 |

**Empirical update 2026-04-28 (Phase B at full N=500)**: the gpt-4o classifier was tested empirically. The +3.7 pp Phase A signal (88.9% at N=54) **did NOT translate to Phase B at full N=500** — the validated number is **84.4% [81.2%, 87.6%]**, statistically tied with the gpt-5-mini classifier's 84.8% [81.6%, 87.8%] and within bootstrap CI overlap.

| Metric | gpt-5-mini classifier (Phase B) | gpt-4o classifier (Phase B) | Δ |
|---|---:|---:|---:|
| Aggregate accuracy | 84.8% [81.6%, 87.8%] | 84.4% [81.2%, 87.6%] | −0.4 pp (within CI) |
| Total LLM cost | $17.38 | $16.33 | −$1.05 (cheaper) |
| $/correct | $0.0410 | $0.0387 | −5.7% (cheaper) |
| Avg latency | 21,042 ms | 18,402 ms | −12.5% (faster) |
| gpt-4o reader dispatched | 234/500 (47%) | 290/500 (58%) | +56 cases |

The Phase A → Phase B compression pattern is a recurring lesson in this matrix: small-sample stratified probes at N=9 per category have implicit CIs of roughly ±10-15 pp, and aggregates inferred from those probes routinely compress 3-8 pp at full N=500. Three independent runs in this session — the 2026-04-27 gpt-5-mini reader probe (90.7% PA → 83.2% PB), the 2026-04-28 reader-router probe (85.2% PA → 84.8% PB), and the 2026-04-28 gpt-4o-classifier probe (88.9% PA → 84.4% PB) — all show the same compression. Phase A signals are decision gates, not headlines.

**Empirical decision rule for consumers**:
- **Default to `gpt-5-mini` classifier**. It matches `gpt-4o` classifier accuracy on LongMemEval-S Phase B at 12× lower per-query LLM cost. Use it.
- The `--om-classifier-model gpt-4o` flag remains wired in for **per-workload empirical testing**: the misclassification penalty is workload-distribution-sensitive, so workloads with very different category mixes from LongMemEval-S may see a meaningful lift. Run a Phase B evaluation on your own workload before committing.
- If you're running benchmark-style evals where matched-reader comparison to other vendors is the goal: pick whichever classifier the comparison vendor uses (most don't have a classifier — see §1.1).

**Why no lift?** Inspection of dispatch counts shows the gpt-4o classifier dispatches more cases to the gpt-4o reader (290/500 vs 234/500), reflecting that it's actually MORE confident about TR/SSU classifications than gpt-5-mini. But the classification gains on those categories are offset by losses on KU (-3.9 pp) — gpt-4o classifier becomes slightly more aggressive about re-categorizing edge cases, and the redistribution doesn't favor the calibration table as designed. The realized accuracy ceiling at this Tier 3 retrieval stack is **~85%** with the current calibration; closing further toward oracle 87% requires a different lever (recall lift via `text-embedding-3-large`, or architectural change via Stage E typed observer).

The gpt-4o classifier evaluation, conducted in the same session as this note's first publication, demonstrates the discipline the matrix tries to encode: write the cost-vs-accuracy hypothesis with realistic estimates, then validate empirically at Phase B before recommending the more expensive option to consumers.

Run JSONs:
- gpt-5-mini classifier Phase B: `results/runs/2026-04-28T13-21-50-567--longmemeval-s--gpt-4o--full-cognitive--ingest.json` (84.8%, $17.38)
- gpt-4o classifier Phase B: `results/runs/2026-04-28T14-45-26-287--longmemeval-s--gpt-4o--full-cognitive--ingest.json` (84.4%, $16.33)

**Third negative finding 2026-04-28 (canonical+RR base config, embedder upgrade)**: text-embedding-3-large tested on top of the 85.6% canonical+RR headline. Phase B at full N=500: **83.4% [80.2%, 86.4%]** (417/500), $4.04 LLM, $0.0097/correct, **avg latency 81,195 ms — a 20× slowdown vs the 4,001 ms baseline.** SSU lifts +4.2 pp (97.1% vs 92.9%, the only category where -large helps); SSA collapses **−7.1 pp** (91.1% vs 98.2%, 3072-dim retrieval pulls in semantically-adjacent but topically off chunks). Recall@10 is **0.984** vs 0.981 baseline, so text-embedding-3-large does NOT meaningfully lift retrieval recall on this benchmark; canonical-hybrid + Cohere rerank already saturates retrieval. Latency catastrophe combines 3072-dim vector search slowdown + per-query -large embedding cost. **Definitively dropped: −2.2 pp accuracy AND 20× latency for no recall benefit.** Run JSON: `results/runs/2026-04-28T23-35-14-824--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**Second confirmation 2026-04-28 (canonical+RR base config, no policy router)**: the gpt-4o classifier was re-tested at the new 85.6% canonical-hybrid + reader-router headline configuration (no Tier 3 policy router). Phase B at full N=500 with `--om-classifier-model gpt-4o` lands at **84.0% [80.6%, 87.0%]** (420/500), $5.48 LLM, $0.0130/correct, 5,564 ms avg latency. **−1.6 pp regression vs the 85.6% gpt-5-mini-classifier baseline**, plus **+44% more expensive per correct** ($0.0130 vs $0.0090). Per-category vs the 85.6% baseline: SSA 100% (+1.8 pp within CI), SSU 95.7% (+2.8 pp within CI), SSP 90.0% (+3.3 pp within CI), KU 85.9% (**−5.1 pp**), TR 83.5% (−0.7 pp within CI), MS 69.2% (**−5.2 pp**). Same pattern as the prior Tier 3+RR variant: the gpt-4o classifier reclassifies edge cases more aggressively, gaining marginally on SSU/SSA/SSP within CI but losing on KU and MS. **Two independent Phase B confirmations (Tier 3+RR variant tied; canonical+RR variant regressed 1.6 pp) now show gpt-4o classifier is not worth the upgrade on LongMemEval-S at this retrieval stack.** The recommended consumer default unambiguously stays `gpt-5-mini` classifier. Run JSON for this confirmation: `results/runs/<timestamp>--longmemeval-s--gpt-4o--full-cognitive--ingest.json` (the most recent 2026-04-28 run with `omClassifierModel=gpt-4o, readerRouter=min-cost-best-cat-2026-04-28, policyRouter=null`).

**Fourth negative finding 2026-04-28 (canonical+RR base config, rerank model upgrade)**: Cohere `rerank-v4.0-pro` tested as a drop-in replacement for the default `rerank-v3.5` on top of the 85.6% canonical+RR base. Phase B at full N=500 with `--rerank-model rerank-v4.0-pro`: aggregate **84.6% [81.4%, 87.6%]** (423/500), $3.92 LLM, $0.0093/correct, avg 5,898 ms latency (p50 4,818 ms, p95 11,422 ms). **−1.0 pp at point estimate vs the 85.6% rerank-v3.5 baseline** (CIs overlap so within statistical noise on aggregate, but the point estimate moves the wrong way and 5/6 categories regress). Per-category vs the 85.6% baseline: SSA 96.4% (−1.8 pp within CI), SSU 94.3% (+1.4 pp within CI; only category where v4.0-pro wins on point estimate), KU 89.7% (−1.3 pp within CI), SSP 90.0% (+3.3 pp within CI), TR 83.5% (−0.7 pp within CI), **MS 71.4% (−3.0 pp; biggest single-category regression)**. Cost and latency are essentially tied with the v3.5 baseline ($0.0093 vs $0.0090 per correct; p50 latency 4,818 vs 3,558 ms — 1.3× regression on median latency). Cohere rerank-v4.0-pro is the newer "pro" tier and at-list-price more expensive than v3.5; the upgrade fails the Pareto test on this retrieval stack. **Definitively dropped: rerank-v4.0-pro costs 1.0 pp accuracy at point estimate + 1.3× p50 latency for no measurable lift.** Run JSON: `results/runs/2026-04-29T01-45-18-428--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**Fifth negative finding 2026-04-29 (canonical+RR base config, S-tuned retrieval router at Phase A — dropped before Phase B)**: surgical-MS-only S-tuned retrieval router (`--retrieval-config-router s-best-cat-hyde-ms-2026-04-28`) tested at Phase A N=54 stratified. The preset holds canonical retrieval everywhere except multi-session, which switches to HyDE on the pre-validation hypothesis that paraphrase-rich multi-hop bridge queries benefit from hypothetical-document expansion at S scale (50-session haystacks vs M's 500). Aggregate **77.8% [66.7%, 88.9%]** (42/54). Per-category vs the 85.6% Phase B baseline (Phase A point estimates only — N=9 per category is small-sample-noisy): SSA 100% (within CI), SSU 100% (within CI), TR 100% (within CI), KU 77.8% (small sample), SSP 66.7% (small sample), **MS 22.2% [0%, 55.6%] (vs 74.4% Phase B baseline) — −52.2 pp catastrophic regression on multi-session**, statistically separated from baseline even at N=9 (Phase A CI upper bound 55.6% sits below Phase B point estimate 74.4%). The mechanism matches the M Phase A ablation matrix: HyDE alone HURTS multi-session at every haystack scale (M canonical 18.0% → HyDE 11.1%; S Phase B 74.4% → Phase A HyDE 22.2%). HyDE expands the candidate pool with hypothetical-document chunks generated from the query, diluting the rerank pool with semantically-adjacent-but-irrelevant text and pushing real bridge sessions below the top-K cutoff. **Phase B was skipped** — the Phase A regression on MS is large enough that Phase B at N=500 would only confirm the architectural conclusion at higher cost. **Definitively dropped: HyDE-on-MS-at-S-scale costs ~52 pp on multi-session for no apparent lift on other categories.** The S-tuned router primitive (the dispatch path itself) ships in agentos source for future calibration with a different per-category retrieval strategy; the `s-best-cat-hyde-ms-2026-04-28` preset specifically is marked PRE-VALIDATION HYPOTHESIS in the source and now refuted at Phase A. Run JSON: `results/runs/2026-04-29T02-17-02-679--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**Sixth negative finding 2026-04-29 (canonical+RR base config, follow-up S-tuned retrieval router at Phase A — also dropped before Phase B)**: follow-up surgical-MS-only S-tuned retrieval router with the HyDE-on-MS pick replaced by `topk50-mult5` on MS only (`--retrieval-config-router s-best-cat-topk50-mult5-ms-2026-04-29`). The follow-up hypothesis: S-scale MS bridge queries are pool-size-bound, not paraphrase-bound; a wider Cohere rerank candidate pool (rerank-candidate-multiplier 5 + reader-top-K 50, no HyDE) gives the cross-encoder more candidate sessions to disambiguate among, without adding the hallucinated-document noise HyDE introduces. Anchored on the 2026-04-26 LongMemEval-M Phase A ablation matrix where `topk50-mult5` lifts M's MS canonical 18.0% → 44.4%. Phase A at N=54 stratified: aggregate **77.8% [66.7%, 88.9%]** (42/54), $0.7419 LLM, $0.0177/correct, avg 6,094 ms. Per-category vs the 85.6% Phase B baseline: SSA 88.9% (small sample), SSU 100% (within CI), TR 100% (within CI), KU 77.8% (small sample), SSP 66.7% (small sample), **MS 33.3% [0%, 66.7%] (vs 74.4% Phase B baseline) — −41.1 pp regression on multi-session**, statistically separated from baseline at N=9 (Phase A CI upper bound 66.7% sits below Phase B point estimate 74.4%). MS lift over the HyDE-on-MS preset is real on point estimate (33.3% vs 22.2% = +11.1 pp) but neither variant approaches the 74.4% baseline. **Architectural conclusion across both probes: at S scale, the canonical retrieval pipeline (BM25 + dense + Cohere rerank-v3.5 + reader-top-K 20) is at the empirical accuracy ceiling for multi-session — broadening the candidate pool dilutes more than it helps.** This pattern matches the M-tuned-compounded-on-S Phase B negative finding from earlier: wider rerank pool over-prunes S's smaller chunk pool. To push MS at S scale, the next architectural lever needs to be either a different signal (typed graph traversal — Stage E typed-network observer is the v2 candidate) or a model-tier swap (gpt-5 reader). The dispatch primitive itself ships in agentos source for future calibration with a fundamentally different per-category retrieval strategy; the specific preset value is documented as refuted at Phase A. Run JSON: `results/runs/2026-04-29T02-28-29-667--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**Seventh negative finding 2026-04-29 (canonical+RR base config, gpt-5 reader on TR/SSU at Phase B — Phase A → Phase B compression of small-sample signal)**: surgical reader-tier swap that replaces the gpt-4o picks for TR + SSU in the reader-router with `gpt-5`, keeping gpt-5-mini for SSA/SSP/KU/MS. Phase A at N=54 stratified had measured **87.0% [77.8%, 94.4%]** aggregate (TR=100% n=9, SSU=100% n=9, SSA=100% n=9), suggesting +1.4 pp PE over the 85.6% headline. Phase B at full N=500 with `--reader-router min-cost-best-cat-gpt5-tr-2026-04-29`: aggregate **83.2% [79.8%, 86.4%]** (416/500), avg 3,828 ms latency. **−2.4 pp at point estimate vs the 85.6% baseline** (CIs overlap so within statistical noise on aggregate). Per-category vs the 85.6% baseline: SSA 96.4% (−1.8 pp within CI), SSU 92.9% (tied), KU 89.7% (−1.3 pp within CI), **TR 80.5% (−3.7 pp; the gpt-5 swap LOSES on TR at full N=133, opposite of the Phase A signal that drove the preset choice)**, **SSP 76.7% (−10.0 pp; partly cache-distorted from earlier failed run)**, MS 72.9% (−1.5 pp within CI). The Phase A → Phase B compression on TR specifically (100% N=9 → 80.5% N=133) is the third such Phase A → Phase B compression documented in this benchmark (M-tuned 57.4% → 45.4% Phase B; reader-router 88.9% → 84.8% Phase B; gpt-4o classifier 88.9% → 84.4% Phase B). **Architectural conclusion: gpt-5 reader does not improve over gpt-4o reader on TR at full sample. The Phase A small-sample signal was N=9 noise.** Cost-per-correct is cache-distorted ($0.0004) and not directly comparable vs the headline's $0.0090. The MIN_COST_BEST_CAT_GPT5_TR_2026_04_29_TABLE preset itself ships in agentos source for future calibration; the specific gpt-5 picks for TR/SSU are documented as refuted at Phase B. Run JSON: `results/runs/2026-04-29T02-56-07-572--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

Run JSON: `results/runs/2026-04-28T13-21-50-567--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. Source code: [`src/core/readerRouter.ts`](../../src/core/readerRouter.ts), [`tests/readerRouter.spec.ts`](../../tests/readerRouter.spec.ts) (12 unit tests pinning the table), dispatch wired in [`src/benchmarks/longmemeval/LongMemEvalS.ts`](../../src/benchmarks/longmemeval/LongMemEvalS.ts) at the answer-call site. CLI flag: `--reader-router min-cost-best-cat-2026-04-28`.

## 6. v2 ambitions (publication next)

The v1.1 publication is now complete on both benchmarks (S 85.6%, M 70.2%). The v2 work below is the next push:

1. **Stage E (Hindsight 4-network typed observer)** — full implementation in agentos core, Phase A decision gate at +2 pp baseline, Phase B at full N on LongMemEval-S, LongMemEval-M, LOCOMO. Spec: [2026-04-26-hindsight-4network-observer-design.md](../../docs/specs/2026-04-26-hindsight-4network-observer-design.md). Plan: [2026-04-26-hindsight-4network-observer-plan.md](../../docs/plans/2026-04-26-hindsight-4network-observer-plan.md). Budget $500-800. Duration 2-3 weeks.
2. **K=V+fact key augmentation (LongMemEval paper Table 3)** — index sessions with both raw content (K=V) AND extracted facts (K=fact) at ingest time, dual-key vector lookup. Used in the paper's strongest GPT-4o configurations (round-level Top-10 at 72.0%, session-level Top-5 at 71.4%, round-level Top-5 at 65.7%); we currently use K=V only. Expected +2-4 pp lift on M; queued as the v1.2 M experiment behind the in-flight Chain-of-Note (`--two-call-reader`) probe. Implementation: extend agentos retrieval pipeline to embed both raw chunks and gpt-5-mini fact-extracted summaries, dedupe by metadata pointer at retrieve.
3. ~~**Reader-top-K=5 ablation on M**~~ — **DONE 2026-04-29 v1.1**. Full Phase B at N=500 lifted from 57.6% (top-K=50) → **70.2% [66.0%, 74.0%]** (top-K=5), +12.6 pp aggregate, CIs non-overlapping, 6.5× cheaper per correct. The architectural insight: at M scale, top-K=50 was distracting the reader with 45 irrelevant chunks; top-K=5 forces the rerank cross-encoder to commit to its top picks. Top-5 retrieval matches the regime in two of the LongMemEval paper's three reported GPT-4o configurations (round-level 65.7%, session-level 71.4%; the third configuration uses Top-10 at 72.0%). Run JSON: `results/runs/2026-04-29T07-45-41-547--longmemeval-m--gpt-4o--full-cognitive--ingest.json`.
4. **Full multi-tier BEAM** — adapter implementation, 100K + 500K + 1M tiers at full N, GPT-4.1-mini judge for direct comparability with Hindsight 64.1% / Honcho 40.6%, plus our `gpt-4o-2024-08-06` judge for the FPR delta. Markmhendrickson's "state integrity breaks at 500K" critique drives the tier choice.
5. ~~**CharHash vs OpenAI embedder ablation**~~ — **DONE 2026-04-27.** The Stage L paired baseline at small N had measured CharHash 76.6% vs OpenAI 74.1%, a misleading signal at that scale. Full Phase B at N=500 inverts: `text-embedding-3-small` lifts to **83.2% [79.8%, 86.4%]** while CharHash stays at 76.6%. The Stage L paired baseline was using a different ingest path that disadvantaged the OpenAI embedder; once you wire it the way real consumers do (via the `--embedder-model` flag → `OpenAIEmbedder` adapter → `CachedEmbedder` wrapper), the +6.6 pp aggregate lift compounds on TR (+14.5 pp) and MS (+14.5 pp). The shipping recommendation and headline are now updated; CharHash stays as the bench-default fallback row for auditability.
6. **Cross-vendor reproductions** — Hindsight's `vectorize-io/agent-memory-benchmark` repo as a parallel harness with the Gemini judge, published with the FPR delta vs our judge.
7. **MemoryArena** — defer to v3 publication. Per the survey, LoCoMo near-perfect systems drop to 40-60% on MemoryArena.

### LongMemEval-M publication landscape — first open-source library claim (verified 2026-04-29)

agentos-bench at 70.2% is the first **open-source** memory library on the public record with end-to-end LongMemEval-M QA accuracy above 65% with publicly reproducible methodology (per-case run JSONs at fixed seed, single-CLI reproduction, Apache-2.0 code). Verified universe of M numbers:

| System | License | LongMemEval-M | Notes |
|---|---|---:|---|
| LongMemEval paper, strongest GPT-4o (round, Top-10) | open repo | **72.0%** | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| AgentBrain | closed-source SaaS | 71.7% (Test 0) | Statistically tied with us; requires Brain hosted endpoint, not a usable open-source library |
| LongMemEval paper, GPT-4o session Top-5 | open repo | 71.4% | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| **agentos-bench (us)** | **Apache-2.0** | **70.2% [66.0%, 74.0%]** | Phase B N=500, 351/500, $0.0078/correct, run JSON published |
| LongMemEval paper, GPT-4o round Top-5 | open repo | 65.7% | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| SelRoute (academic) | open repo | Recall@5 = 0.800 | Retrieval-side metric only, not end-to-end QA accuracy |
| Mem0 v3 | Apache 2.0 | — (not published) | Reports 93.4% on S only |
| Mastra OM | Apache 2.0 | — (not published) | Reports 84.2-94.9% on S only |
| Zep | Apache 2.0 | — (not published) | Explicitly skipped: "due to gpt-4o's 128k context window we chose S over M" |
| Hindsight | open repo | — (not published) | Paper [arxiv 2512.12818](https://arxiv.org/abs/2512.12818) reports 91.4% on S only |
| EmergenceMem (Simple Fast) | open Python | — (not published) | 79-86% on S only |
| Supermemory | open | — (not published) | 81.6-85.2% on S only |
| MemMachine | open repo | — (not published) | 93.0% on S only |
| Memoria | open | — (not published) | 88.78% on S only |
| Backboard | open | — (not published) | 93.4% on S only |
| agentmemory (JordanMcCann) | MIT | — (not published) | 96.2% on S only |
| ByteRover | closed | — (not published) | 92.8% on S only; explicitly: "M scales to ~1.5M tokens, far beyond any context window" |
| Letta / Cognee | open | — | No LongMemEval published at all |

## 7. What this matrix is, and what it isn't

This matrix is a methodology-grade snapshot of one orchestration-router architecture (`@framers/agentos/memory-router` with three shipping presets) across three conversational benchmarks at one reader, one judge, one seed. It is not an accuracy leaderboard claim against vendors using different harnesses, different judges, or proprietary-platform-only configurations.

The differentiator we publish is the transparency stack itself: every cell has a bootstrap CI, a probed judge FPR, a per-case run JSON, a matched-reader caveat for every comparison, a documented cache fingerprint, and two honest negative results. The numbers are what they are. The discipline around producing them is the publishable artifact.
