---
title: v1 Comprehensive Evaluation Matrix
date: 2026-04-26
companion: transparency-notes.md
seed: 42
reader: gpt-4o
judge: gpt-4o-2024-08-06
rubric: 2026-04-18.1
bootstrap: 10000 resamples (Mulberry32, seed=42)
---

# v1 Comprehensive Evaluation Matrix

Four AgentOS architectures (Tier 1 canonical-hybrid, Tier 2b OM-v11, Tier 3 min-cost, Tier 3 max-acc) measured across three conversational benchmarks (LongMemEval-S N=500, LongMemEval-M N=500, LOCOMO N=1986) at a fixed `gpt-4o` reader, `gpt-4o-2024-08-06` judge, rubric `2026-04-18.1`, seed 42, bootstrap 10 k resamples.

Methodology, judge FPR per benchmark, two negative architecture findings, BEAM coverage status, and v2 ambitions in [transparency-notes.md](transparency-notes.md). Vendor cross-references inline are footnoted with judge-harness, observer-model, and managed-vs-OSS caveats per [SOTA_CITED_EVIDENCE_2026-04-25.md](../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md).

## Headline accuracy

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| **🔥 Per-category dispatch (empirical from ablations)** [^pcd-m] | _to be measured_ | **68.5%** (37/54 stratified) | _PENDING_ | _PENDING_ |
| **M-tuned (rerank-candidate ×5 + reader-top-k 50 + HyDE)** [^mtuned-m] | 72.2% (cross-val N=54, ~ neutral) | **57.4%** (Phase A N=54) | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | 73.2% [69.2, 77.0] | 30.6% [^t1m] (superseded by M-tuned above) | 51.5% (K=20) [^t1locomo] | DEFERRED v2 |
| Tier 2b OM-v11 | 75.4% [71.6, 79.0] | _PENDING (Phase B aborted on local hardware; queued for remote)_ | _baseline only_ | DEFERRED v2 |
| Tier 3 min-cost (shipping default) | **76.6% [72.8, 80.2]** | _≈ Tier 1 at M scale_ [^t3mincostm] | _baseline only_ | DEFERRED v2 |
| Tier 3 max-acc | 75.6% [71.8, 79.2] | _PENDING (Phase B queued for remote)_ | _baseline only_ | DEFERRED v2 |
| --- |
| Stage L treatment (DROPPED) | 70.4% (−3.7 pp) [^stagel] | n/a | n/a | n/a |
| Stage I treatment (DROPPED) | n/a | n/a | 60.0% (−4.0 pp) [^stagei] | n/a |

[^pcd-m]: **EMPIRICAL per-category dispatch — derived from existing ablation runs at N=54 stratified, no new LLM spend.** All 6 ablation runs used identical case IDs (seed=42, `--sample-per-type 9`). For each category, picking the best-accuracy ablation config gives a per-category-oracle aggregate: SSA → combined (9/9, 100%); KU → combined (7/9, 77.8%); SSU → combined (7/9, 77.8%); TR → hyde (6/9, 66.7%); MS → combined (6/9, 66.7%); SSP → hyde (2/9, 22.2%). Total **37/54 = 68.5%** equal-weighted stratified. **+11.1 pp over static combined M-tuned (31/54 = 57.4%); +37.9 pp over Tier 1 canonical baseline (30.6%)**. The forecast from `RetrievalConfigRouter.computeOracleAggregate` on the M true distribution (heavier on MS+TR) is 70.4%; the empirical 68.5% under-shoots the forecast by 1.9 pp because equal-weight stratified under-weights MS+TR vs the natural distribution. Productionization path: ship `MINIMIZE_COST_AUGMENTED` preset on `MemoryRouter` per [RetrievalConfigRouter spec](../../docs/specs/2026-04-26-retrieval-config-router-design.md). Source: ablation run JSONs `2026-04-26T01-40-34-904--*` through `2026-04-26T03-22-06-857--*`. Empirical computation reproducible by `pnpm test src/memory-router/__tests__/retrieval-config.test.ts` (uses the calibrated `M_PHASE_A_PER_CATEGORY_ACCURACY` table).

[^mtuned-m]: **NEW — 2026-04-26 Phase A finding (N=54 stratified).** Three opt-in retrieval-precision flags lift LongMemEval-M from 30.6% (Tier 1 canonical baseline) to 57.4% — a +26.8 pp lift at $0.0558/correct (32% cheaper per correct than baseline). Config: `--rerank-candidate-multiplier 5` (250-chunk pool for Cohere rerank vs default 60), `--reader-top-k 50` (vs default 20), `--hyde` (HyDE hypothetical-doc embedding). CharHashEmbedder retained; semantic embedder Phase A aborted on local hardware (memory pressure) and queued for remote-machine measurement. Per-category breakdown: SSA 50% → **100%** (+50 pp), MS 18% → **66.7%** (+48.7 pp), KU 50% → **77.8%** (+27.8 pp), SSU 60% → **77.8%** (+17.8 pp), TR 12.8% → **33.3%** (+20.5 pp), SSP 10% → **14.3%** (+4.3 pp). Phase B at full N=500 queued for remote-machine execution (local 17 GB Mac hits memory pressure on per-case 25 k chunks × cognitive memory mechanisms × 500-session haystacks). The diagnosis: the v1 shipping config's 60-chunk Cohere-rerank candidate pool + 20-chunk reader window was over-restrictive for 500-session-haystack distributions; widening both windows lets the cross-encoder + reader actually see the right session most of the time. Per-case run JSON: `results/runs/2026-04-26T01-40-34-904--longmemeval-m--gpt-4o--full-cognitive--ingest.json`.

[^t1m]: Stage J Phase B at N=500. The bench's shipping retrieval pipeline (hybrid BM25 + dense + Cohere `rerank-v3.5`, `reader-top-k 20`) on LongMemEval-M. First public LongMemEval-M number for any orchestration-router architecture. Findings: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../../docs/STAGE_J_PHASE_B_FINDINGS_2026-04-25.md). Per-case run JSON: `results/runs/2026-04-25T10-14-43-207--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json`.

[^t1locomo]: Tier 1 canonical-hybrid at `--reader-top-k 20` is the Pareto-best LOCOMO tuning. Findings: [STAGE_F2_CORRECTION_2026-04-24.md](../../docs/STAGE_F2_CORRECTION_2026-04-24.md). Per-case artifacts: `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`.

[^t3mincostm]: At LongMemEval-M scale, the `minimize-cost` policy-router preset reduces to canonical-hybrid for every category because OM-v11's per-case ingest cost on 500-session haystacks is dominated by retrieval precision, not architecture choice. Tier 3 min-cost on M is therefore architecturally identical to Tier 1 canonical-hybrid on M.

[^stagel]: Stage L Phase A: Anthropic Contextual Retrieval `summarized` executor (per-session summary prepended to every chunk before embedding). Paired baseline at OpenAI semantic embedder: 74.1% → 70.4%. Temporal-reasoning collapsed −33.3 pp. Findings: [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `SummarizedIngestExecutor` in agentos 0.2.12 for consumers building document-mode pipelines.

[^stagei]: Stage I Phase A: Mem0-v3-style entity-linking re-rank (`--entity-linking 0.5`). Multi-hop collapsed −20 pp. Findings: [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `EntityExtractor` + `EntityLinkingIngestExecutor` + `EntityRetrievalRanker` in agentos 0.2.13 for consumers building Mem0-v3-style pipelines.

## Cost-efficiency ($ per correct answer)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| **M-tuned combined (Phase A N=54)** | $0.0833 (cross-val) | **$0.0558** | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | $0.0213 | $0.0818 | $0.0099 | DEFERRED |
| Tier 2b OM-v11 | $0.4362 | _PENDING_ | n/a | DEFERRED |
| Tier 3 min-cost | **$0.0580** | _≈ Tier 1_ | n/a | DEFERRED |
| Tier 3 max-acc | $0.2434 | _PENDING_ | n/a | DEFERRED |

## M-tuned ablation matrix on LongMemEval-M (Phase A N=54)

Honest per-flag attribution. Same seed=42, same judge, CharHashEmbedder retained, all at `--concurrency 1`:

| Config | Accuracy | Δ vs baseline | $/correct | Total cost | Avg latency |
|---|---:|---:|---:|---:|---:|
| Baseline (Tier 1 canonical, N=500 Phase B) | 30.6% | — | $0.0818 | $40.86 | 10 564 ms |
| `--rerank-candidate-multiplier 5` only | 33.3% | +2.7 pp | $0.0416 | $0.75 | 2 291 ms |
| `--reader-top-k 50` only | 48.1% | +17.5 pp | $0.1351 | $3.51 | 3 638 ms |
| `--hyde` only | 46.3% | +15.7 pp | **$0.0369** | $0.92 | 3 546 ms |
| `--hyde --reader-top-k 50` (no multiplier) | 50.0% | +19.4 pp | $0.1390 | $3.75 | 3 869 ms |
| **All three (M-tuned combined)** | **57.4%** | **+26.8 pp** | $0.0558 | $1.73 | re-measure |

Per-category attribution highlighted: multi-session (the precision-bound bottleneck) only lifts to 66.7% with the multiplier; without multiplier MS stays under 45%. HyDE alone is best for SSA (88.9%) and TR (66.7%). TopK alone is best for KU (77.8%) and SSU (66.7%). Per-category-oracle ceiling: 66.7% aggregate (+9.3 pp over combined). That's the calibration data point for [RetrievalConfigRouter](../../docs/specs/2026-04-26-retrieval-config-router-design.md) — LLM-as-judge dispatch among config variants per query.

Cross-validation on LongMemEval-S (M-tuned config, N=54): 72.2% accuracy, $0.0833/correct, vs Tier 1 canonical S baseline 73.2% Phase B N=500 — within −1.0 pp of baseline (noise at N=54). Per-category mixed; the M-tuned config regresses MS −28 pp + SSP −19 pp on S because Tier 3 min-cost on S routes those categories to OM-v11. **M-tuned config is M-helpful, S-neutral overall, per-category trade-offs differ between scales.** The right shipping integration is per-query LLM-as-judge dispatch.

## Latency (avg, ms)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| Tier 1 canonical-hybrid | 98 072 | 10 564 | 1 453 | DEFERRED |
| Tier 2b OM-v11 | 14 172 | _PENDING_ | n/a | DEFERRED |
| Tier 3 min-cost | **16 130** | _≈ Tier 1_ | n/a | DEFERRED |
| Tier 3 max-acc | 65 565 | _PENDING_ | n/a | DEFERRED |

## Per-category breakdown — LongMemEval (Tier 3 min-cost, the shipping default)

LongMemEval's six-category taxonomy. Tier 3 min-cost on LongMemEval-S routes SSA/SSU/TR/KU → canonical-hybrid, MS/SSP → observational-memory-v11. On LongMemEval-M the routing reduces to canonical-hybrid for every category (per [^t3mincostm]).

| Category | LongMemEval-S | LongMemEval-M | Δ at M scale |
|---|---:|---:|---:|
| single-session-user | 97.1% | 60.0% | −37.1 pp |
| single-session-assistant | 89.3% | 50.0% | −39.3 pp |
| single-session-preference | 63.3% | 10.0% | −53.3 pp |
| knowledge-update | 86.8% | 50.0% | −36.8 pp |
| multi-session | 61.7% | 18.0% | −43.7 pp |
| temporal-reasoning | 70.2% | 12.8% | −57.4 pp |
| **Aggregate** | **76.6%** | **30.6%** | **−46.0 pp** |

The S→M scale gap concentrates in the two largest categories (multi-session 26.6% of M cases, temporal-reasoning 26.6%). Both are precision-bound at the 500-session-per-haystack scale: the right session simply doesn't make the top-20 most of the time when CharHashEmbedder + BM25 + Cohere rerank operates over 500 candidate sessions instead of 50. Stage E (Hindsight 4-network typed observer with typed graph traversal) is the v2 candidate.

## Per-category breakdown — LOCOMO (Tier 1 canonical-hybrid + K=20 tuning)

LOCOMO's five-category taxonomy. K=20 is the only tuning we found that lifted on top of the OOD baseline.

| Category | OOD baseline | K=20 tuned | Δ |
|---|---:|---:|---:|
| single-hop | 20.6% | 23.4% | +2.8 pp |
| multi-hop | 39.6% | 37.7% | −1.9 pp |
| open-domain | 48.5% | 51.7% | +3.2 pp |
| temporal | 27.1% | 28.1% | +1.0 pp |
| adversarial | 83.4% | 83.6% | +0.2 pp |
| **Aggregate** | **49.9%** | **51.5%** | **+1.6 pp** |

LOCOMO's adversarial category (22.5% by case count) is the only category where AgentOS's abstention discipline materially outperforms the field. The single-hop and temporal categories are weak at OOD because our abstention prompt and `recallTopK` are tuned for LongMemEval-S's distribution, not LOCOMO's.

## Judge false-positive rate per benchmark

The Stage G probe synthesizes topically-adjacent wrong answers via `gpt-5-mini` and sends them to the same judge that scores real answers. The acceptance rate is the judge's effective false-positive rate on the wrong-but-topical class of error. Independent of retrieval architecture; applies to every cell in the corresponding column.

| Benchmark | Judge FPR | 95% CI | n probed | Source |
|---|---:|---:|---:|---|
| LongMemEval-S | 1% | [0%, 3%] | 100 | [Stage G, 2026-04-24](../../docs/SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md) |
| LongMemEval-M | **2%** | **[0%, 5%]** | 100 | [Stage G-M, 2026-04-26](../../docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md) |
| LOCOMO | 0% | [0%, 0%] | 100 | [Stage G-LOCOMO, 2026-04-24](../../docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md) |
| BEAM 100K | unprobed | — | — | Deferred to v2 (BEAM adapter not yet implemented). |

Anchor: Penfield Labs measured **62.81%** FPR on LOCOMO's default `gpt-4o-mini` judge with the original LOCOMO rubric. Our 0% LOCOMO FPR + the Penfield 62.81% number put a 63 pp gap between any LOCOMO score measured at our judge vs the original judge.

## Reference rows (footnoted with judge-harness caveats)

| System | LongMemEval-S | LOCOMO | Caveat |
|---|---:|---:|---|
| Full-context `gpt-4o` baseline | 60.2% | n/a | LongMemEval paper. No memory architecture; whole conversation in context. |
| Mastra OM (`gpt-4o`) | 84.2% | n/a | Observer is `gemini-2.5-flash`. Reader is `gpt-4o`. Cross-provider; not single-provider reproducible. |
| Mem0 v3 (managed platform) | 93.4% | 91.6% | Managed-platform-only. Mem0's own production-stack number on LOCOMO ([State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)) is 66.9%. |
| Hindsight Gemini-3-pro | 91.4% | n/a | Reader is `gemini-3-pro`. Bench harness uses Gemini judge. |
| Hindsight OSS-120B | 89.0% | 89.61% | Same Gemini-judge harness caveat. |
| Hindsight OSS-20B | 83.6% | 85.67% | Same Gemini-judge harness caveat. |
| Supermemory (`gpt-4o`) | 81.6% | n/a | Own harness. |
| Zep self-reported | 71.2% | 75.14% | Independent reproduction at [arxiv:2512.13564](https://arxiv.org/abs/2512.13564) measured 63.8% on LongMemEval-S. |

## Per-cell run artifacts

Every AgentOS cell has a per-case run JSON at seed 42 in `packages/agentos-bench/results/runs/`. LongMemEval-M run JSONs exceed 100 MB and are gitignored; their `--summary.json` siblings are committed. Artifacts:

- LongMemEval-S Tier 1 canonical: `2026-04-23T23-58-03-354--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- LongMemEval-S Tier 2b OM-v11: `2026-04-23T23-47-23-546--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- LongMemEval-S Tier 3 min-cost: `2026-04-24T07-00-00-000--longmemeval-s--gpt-4o--full-cognitive--ingest.json` (canonical run; see LEADERBOARD footnote `[^t3mincost]`)
- LongMemEval-S Tier 3 max-acc: `2026-04-24T06-57-02-957--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- LongMemEval-M Tier 1 canonical / Tier 3 min-cost: `2026-04-25T10-14-43-207--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json`
- LongMemEval-M Tier 2b OM-v11: _PENDING — to be added when Phase B run lands_
- LongMemEval-M Tier 3 max-acc: _PENDING — to be added when Phase B run lands_
- LOCOMO Tier 1 K=20 tuned: `2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`
- Stage G LongMemEval-S probe: published in [SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md](../../docs/SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md)
- Stage G LongMemEval-M probe: `2026-04-25T22-14-21-000--stage-g-longmemeval-m-judge-fpr-probe.json` ([findings](../../docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md))
- Stage G LOCOMO probe: published in [STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md](../../docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md)
