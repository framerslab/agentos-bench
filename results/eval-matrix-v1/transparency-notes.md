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
| Embedder | `text-embedding-3-small` on the sem-embed rows; `CharHashEmbedder` (lexical FNV-1a hash) preserved on the bench-default fallback row (S 76.6%, M 45.4%) for auditable gap tracking. | The sem-embed + reader-router headline results on S and M came from runs that called Cohere's reranker; they are being re-run without a remote reranker and are left out of these notes until those runs finish. The 76.6% S CharHash row and the 45.4% M CharHash row stay in the leaderboard as "bench-default fallback" references so the gap is auditable. |
| Reranker | Cohere `rerank-v3.5` | Cross-encoder over the merged BM25 + dense pool. Required for every Tier 1+ row. |
| `reader-top-k` | 20 | Top 20 chunks after rerank fed to the reader. |

### 1.1 Methodology cross-reference

Every cited methodology choice maps to a verbatim primary source in [SOTA_CITED_EVIDENCE_2026-04-25.md](../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md). The audit covers:

- §2 Hindsight typed-network observer (reference for v2 Stage E)
- §3 Mem0 v3 architecture (single-pass ADD-only + entity-linking hybrid; managed-platform 94.4% caveat)
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
| LongMemEval-S | 1% | [0%, 3%] | 100 | Stage G, 2026-04-24 |
| LongMemEval-M | **2%** | **[0%, 5%]** | 100 | Stage G-M, 2026-04-26 |
| LOCOMO | 0% | [0%, 0%] | 100 | Stage G-LOCOMO, 2026-04-24 |
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

Mem0 v3's published 92.5% LOCOMO (top_200 retrieval budget, [Mem0 docs](https://docs.mem0.ai/core-concepts/memory-evaluation)) is a managed-platform claim; Mem0 states those scores include proprietary optimizations not available in the open-source SDK. Mem0's 2025 paper ([arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) reports an LLM-as-a-Judge (J) score of **66.9%** on LOCOMO for the algorithm that paper describes, which Mem0 replaced in April 2026 ([State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)); the two LOCOMO numbers come from different systems and runs. The agentos primitives (`EntityExtractor`, `EntityLinkingIngestExecutor`, `EntityRetrievalRanker`, shipping in 0.2.13) are still useful for consumers replicating Mem0-v3-style pipelines.

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
| Mem0 v3 (managed platform) | 94.4% | Managed platform at a top_200 retrieval budget; Mem0 states it includes proprietary optimizations not in the open-source SDK and does not name the reader (answerer model) or the LongMemEval variant for that run ([Mem0 docs](https://docs.mem0.ai/core-concepts/memory-evaluation)); its open-source harness downloads the S set by default. Mem0 also publishes 94.8% at top_50 and 91.0% for its self-hosted OSS pipeline with GPT-5 as answerer and judge ([memory-benchmarks](https://github.com/mem0ai/memory-benchmarks#results)). |
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

**Productionization**: the calibration table + dispatch ship in agentos-bench at the commit alongside this note. `@framers/agentos/memory-router` exports the same dispatch as `selectReader` with its preset tables, so consumers of `@framers/agentos` can wire per-category reader dispatch directly without rebuilding the bench harness.

### 5.5.0 Canonical-hybrid + standalone classifier

The canonical-hybrid + reader-router configuration (Tier 3 policy router dropped, a standalone gpt-5-mini classifier feeding the reader router) was measured at Phase B on runs that called Cohere's reranker. Its results are being re-run without a remote reranker and are left out of these notes until those runs finish.

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

Six further findings measured on the canonical-hybrid + reader-router base (gpt-4o classifier, text-embedding-3-large, Cohere rerank-v4.0-pro, two S-tuned retrieval routers, gpt-5 on TR/SSU) came from runs that called Cohere's reranker and are left out with that base until the re-run.

Run JSON: `results/runs/2026-04-28T13-21-50-567--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. Source code: [`src/core/readerRouter.ts`](../../src/core/readerRouter.ts), [`tests/readerRouter.spec.ts`](../../tests/readerRouter.spec.ts) (12 unit tests pinning the table), dispatch wired in [`src/benchmarks/longmemeval/LongMemEvalS.ts`](../../src/benchmarks/longmemeval/LongMemEvalS.ts) at the answer-call site. CLI flag: `--reader-router min-cost-best-cat-2026-04-28`.

## 6. v2 ambitions (publication next)

The S and M headline results are being re-run without a remote reranker. The v2 work below is the next push:

1. **Stage E (Hindsight 4-network typed observer)** — full implementation in agentos core, Phase A decision gate at +2 pp baseline, Phase B at full N on LongMemEval-S, LongMemEval-M, LOCOMO. Spec: [2026-04-26-hindsight-4network-observer-design.md](../../docs/specs/2026-04-26-hindsight-4network-observer-design.md). Plan: [2026-04-26-hindsight-4network-observer-plan.md](../../docs/plans/2026-04-26-hindsight-4network-observer-plan.md). Budget $500-800. Duration 2-3 weeks.
2. **K=V+fact key augmentation (LongMemEval paper Table 3)** — index sessions with both raw content (K=V) AND extracted facts (K=fact) at ingest time, dual-key vector lookup. Used in the paper's strongest GPT-4o configurations (round-level Top-10 at 72.0%, session-level Top-5 at 71.4%, round-level Top-5 at 65.7%); we currently use K=V only. Expected +2-4 pp lift on M; queued as the v1.2 M experiment behind the in-flight Chain-of-Note (`--two-call-reader`) probe. Implementation: extend agentos retrieval pipeline to embed both raw chunks and gpt-5-mini fact-extracted summaries, dedupe by metadata pointer at retrieve.
3. **Reader-top-K=5 ablation on M**: run at Phase B N=500 on a configuration that called Cohere's reranker; being re-run without a remote reranker.
4. **Full multi-tier BEAM** — adapter implementation, 100K + 500K + 1M tiers at full N, GPT-4.1-mini judge for direct comparability with Hindsight 64.1% / Honcho 40.6%, plus our `gpt-4o-2024-08-06` judge for the FPR delta. Markmhendrickson's "state integrity breaks at 500K" critique drives the tier choice.
5. ~~**CharHash vs OpenAI embedder ablation**~~ — **DONE 2026-04-27.** The Stage L paired baseline at small N had measured CharHash 76.6% vs OpenAI 74.1%, a misleading signal at that scale. Full Phase B at N=500 inverts: `text-embedding-3-small` lifts to **83.2% [79.8%, 86.4%]** while CharHash stays at 76.6%. The Stage L paired baseline was using a different ingest path that disadvantaged the OpenAI embedder; once you wire it the way real consumers do (via the `--embedder-model` flag → `OpenAIEmbedder` adapter → `CachedEmbedder` wrapper), the +6.6 pp aggregate lift compounds on TR (+14.5 pp) and MS (+14.5 pp). The shipping recommendation and headline are now updated; CharHash stays as the bench-default fallback row for auditability.
6. **Cross-vendor reproductions** — Hindsight's `vectorize-io/agent-memory-benchmark` repo as a parallel harness with the Gemini judge, published with the FPR delta vs our judge.
7. **MemoryArena** — defer to v3 publication. Per the survey, LoCoMo near-perfect systems drop to 40-60% on MemoryArena.

### LongMemEval-M publication landscape (verified 2026-04-29)

Published LongMemEval-M numbers as of 2026-04-29. agentos-bench's own M result is being re-run without a remote reranker and is left out of this table until then.

| System | License | LongMemEval-M | Notes |
|---|---|---:|---|
| LongMemEval paper, strongest GPT-4o (round, Top-10) | open repo | **72.0%** | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| AgentBrain | closed-source SaaS | 71.7% (Test 0) | Requires Brain hosted endpoint, not a usable open-source library |
| LongMemEval paper, GPT-4o session Top-5 | open repo | 71.4% | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| LongMemEval paper, GPT-4o round Top-5 | open repo | 65.7% | Wu et al., ICLR 2025, Table 3, K=V+fact, Stella V5 retriever |
| SelRoute (academic) | open repo | Recall@5 = 0.800 | Retrieval-side metric only, not end-to-end QA accuracy |
| Mem0 v3 | Apache 2.0 | — (not published) | Reports 94.4% with the reader and the variant not named ([Mem0 docs](https://docs.mem0.ai/core-concepts/memory-evaluation)); its open-source harness runs S by default; no M result published |
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
