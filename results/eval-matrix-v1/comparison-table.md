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
| **🔥 M-tuned (rerank-candidate ×5 + reader-top-k 50 + HyDE) — Phase B validated** [^mtuned-m] | 72.2% (cross-val N=54, ~ neutral) | **45.4% [41.2%, 49.8%]** (Phase B N=500) | _PENDING_ | _PENDING_ |
| Per-category dispatch (Phase A forecast — NOT Phase B-validated) [^pcd-m] | _to be measured_ | 68.5% (37/54 Phase A; needs hyde-only/topk-only Phase B ablations to validate) | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | 73.2% [69.2, 77.0] | 30.6% [^t1m] (superseded by M-tuned above) | 51.5% (K=20) [^t1locomo] | DEFERRED v2 |
| Tier 2b OM-v11 | 75.4% [71.6, 79.0] | _PENDING (Phase B aborted on local hardware; queued for remote)_ | _baseline only_ | DEFERRED v2 |
| Tier 3 min-cost (shipping default) | **76.6% [72.8, 80.2]** | _≈ Tier 1 at M scale_ [^t3mincostm] | _baseline only_ | DEFERRED v2 |
| Tier 3 max-acc | 75.6% [71.8, 79.2] | _PENDING (Phase B queued for remote)_ | _baseline only_ | DEFERRED v2 |
| --- |
| Stage L treatment (DROPPED) | 70.4% (−3.7 pp) [^stagel] | n/a | n/a | n/a |
| Stage I treatment (DROPPED) | n/a | n/a | 60.0% (−4.0 pp) [^stagei] | n/a |
| Stage H Hierarchical retrieval (DROPPED) [^stageh] | n/a | 42.6% (−14.8 pp vs M-tuned combined) | n/a | n/a |

[^pcd-m]: **PHASE A FORECAST — not yet Phase B-validated.** Derived from six Phase A ablation runs at N=54 stratified (seed=42, `--sample-per-type 9`, identical case IDs across runs). For each category, picking the best-accuracy ablation config gives a per-category-oracle aggregate: SSA → combined (9/9, 100%); KU → combined (7/9, 77.8%); SSU → combined (7/9, 77.8%); TR → hyde (6/9, 66.7%); MS → combined (6/9, 66.7%); SSP → hyde (2/9, 22.2%). Total **37/54 = 68.5%** equal-weighted stratified Phase A. **CAVEAT**: the M-tuned Phase B at N=500 (45.4% [41.2%, 49.8%]) revealed Phase A inflated MS (Phase A 66.7% N=9 → Phase B 26.2% N=130) and TR (Phase A 33.3% N=9 → Phase B 22.6% N=133) because N=9-per-category had wide implicit CIs. The dispatch lift forecast at N=500 may therefore be smaller than the +11 pp Phase A math suggests. To validate the per-category dispatch lift at full scale, hyde-only and topk-only Phase B runs at N=500 (each ~$30, ~5 hours) need to land so the dispatched per-category accuracies can be re-measured at scale. **Productionized as the `MINIMIZE_COST_AUGMENTED_TABLE` preset on `MemoryRouter` and the `--retrieval-config-router minimize-cost-augmented` bench flag** per [RetrievalConfigRouter productionization plan](../../docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md). Source: Phase A ablation run JSONs `2026-04-26T01-40-34-904--*` through `2026-04-26T03-22-06-857--*`.

[^mtuned-m]: **2026-04-26 Phase B at N=500 (validated):** **45.4% [41.2%, 49.8%]** (227/500), $30.59 LLM, $0.1348/correct, avg 40.3s latency. Per-category at Phase B with bootstrap CIs: SSA 91.1% [82.1%, 98.2%] (n=56), SSU 78.6% [68.6%, 87.1%] (n=70), KU 62.8% [52.6%, 73.1%] (n=78), SSP 28.6% [14.3%, 46.4%] (n=28), MS 26.2% [18.5%, 33.8%] (n=130), TR 22.6% [15.8%, 30.1%] (n=133). Phase B run JSON: `results/runs/2026-04-26T16-50-33-693--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. **+14.8 pp validated lift over Tier 1 canonical baseline 30.6% Phase B N=500.** Config: `--rerank-candidate-multiplier 5` (250-chunk pool for Cohere rerank vs default 60), `--reader-top-k 50` (vs default 20), `--hyde` (HyDE hypothetical-doc embedding). CharHashEmbedder retained; semantic embedder Phase B is queued separately. **Phase A → Phase B compression**: Phase A at N=54 stratified measured 57.4%; Phase B at N=500 measures 45.4% (−12 pp). The drop is consistent with Phase A's `--sample-per-type 9` overweighting easy categories — SSA/KU/SSU make up 33% of N=54 vs 41% of N=500 cases (true distribution is dominated by MS+TR which together are 53% of N=500 and the hardest categories). The Phase A ablation matrix (kept here as the calibration source for the productionized RetrievalConfigRouter) suggested per-category-oracle dispatch could lift another +11 pp over static combined; that forecast is now Phase A-only and not Phase B-validated until hyde-only and topk-only N=500 ablations land. **Cross-validation on LongMemEval-S** (M-tuned config, Phase A N=54): 72.2%, vs Tier 1 canonical S baseline 73.2% Phase B N=500 = −1.0 pp (within noise); the M-tuned config regresses MS −28 pp + SSP −19 pp on S because Tier 3 min-cost on S routes those categories to OM-v11. **Conclusion**: M-tuned is a real, validated +14.8 pp lift on M at full N=500; per-category dispatch productionization shipped (`MINIMIZE_COST_AUGMENTED_TABLE` + `--retrieval-config-router` bench flag) but its quantitative lift at N=500 needs ablation runs to validate. Phase A ablation run JSONs (kept as the calibration source for `M_PHASE_A_PER_CATEGORY_ACCURACY`): combined `2026-04-26T01-40-34-904`, mult-only `2026-04-26T02-05-08-097`, TopK-only `2026-04-26T02-08-40-380`, HyDE-only `2026-04-26T02-13-35-497`, HyDE+TopK `2026-04-26T02-18-33-158`. Cross-val (S Phase A): `2026-04-26T02-02-35-802--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

[^t1m]: Stage J Phase B at N=500. The bench's shipping retrieval pipeline (hybrid BM25 + dense + Cohere `rerank-v3.5`, `reader-top-k 20`) on LongMemEval-M. First public LongMemEval-M number for any orchestration-router architecture. Findings: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../../docs/STAGE_J_PHASE_B_FINDINGS_2026-04-25.md). Per-case run JSON: `results/runs/2026-04-25T10-14-43-207--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json`.

[^t1locomo]: Tier 1 canonical-hybrid at `--reader-top-k 20` is the Pareto-best LOCOMO tuning. Findings: [STAGE_F2_CORRECTION_2026-04-24.md](../../docs/STAGE_F2_CORRECTION_2026-04-24.md). Per-case artifacts: `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`.

[^t3mincostm]: At LongMemEval-M scale, the `minimize-cost` policy-router preset reduces to canonical-hybrid for every category because OM-v11's per-case ingest cost on 500-session haystacks is dominated by retrieval precision, not architecture choice. Tier 3 min-cost on M is therefore architecturally identical to Tier 1 canonical-hybrid on M.

[^stagel]: Stage L Phase A: Anthropic Contextual Retrieval `summarized` executor (per-session summary prepended to every chunk before embedding). Paired baseline at OpenAI semantic embedder: 74.1% → 70.4%. Temporal-reasoning collapsed −33.3 pp. Findings: [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `SummarizedIngestExecutor` in agentos 0.2.12 for consumers building document-mode pipelines.

[^stagei]: Stage I Phase A: Mem0-v3-style entity-linking re-rank (`--entity-linking 0.5`). Multi-hop collapsed −20 pp. Findings: [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `EntityExtractor` + `EntityLinkingIngestExecutor` + `EntityRetrievalRanker` in agentos 0.2.13 for consumers building Mem0-v3-style pipelines.

[^stageh]: Stage H Phase A (2026-04-26): Hierarchical 2-stage retrieval (`--session-retrieval --session-retrieval-top-sessions 10 --session-retrieval-chunks-per-session 10` + summaries + Cohere rerank ×5 + reader-top-k 50 + HyDE) on LongMemEval-M N=54 stratified. **42.6%** (23/54) at $0.196/correct, avg latency 11.1 min/case. **−14.8 pp** vs M-tuned combined (57.4%); multi-session collapsed −44.5 pp (22.2% vs combined 66.7%); single-session-preference 0.0% (vs combined 14.3%). Stage 1 summary-similarity drops the gold session for hard queries before Stage 2 can recover. Third negative finding for retrieval-architecture alternatives — pattern: widening the rerank candidate pool beats architectural pre-pruning at conversational-memory scale. Findings: [STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md](../../docs/STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md). Run JSON: `results/runs/2026-04-26T04-57-45-526--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. The agentos primitives (`SessionSummarizer`, `SessionSummaryStore`, `SessionRetriever`) remain shipping for consumers building document-mode hierarchical RAG pipelines where summary similarity is more reliable than at 500-session conversational haystacks.

## Cost-efficiency ($ per correct answer)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| **M-tuned combined (Phase B N=500)** | $0.0833 (cross-val Phase A) | **$0.1348** (Phase B) | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | $0.0213 | $0.0818 | $0.0099 | DEFERRED |
| Tier 2b OM-v11 | $0.4362 | _PENDING_ | n/a | DEFERRED |
| Tier 3 min-cost | **$0.0580** | _≈ Tier 1_ | n/a | DEFERRED |
| Tier 3 max-acc | $0.2434 | _PENDING_ | n/a | DEFERRED |

## M-tuned ablation matrix on LongMemEval-M

Phase B at N=500 validates the all-three combined config; per-flag attribution is from Phase A at N=54 (same seed=42, same judge, CharHashEmbedder retained, all at `--concurrency 1`):

| Config | Stage | Accuracy | Δ vs baseline | $/correct | Total cost | Avg latency |
|---|---|---:|---:|---:|---:|---:|
| Baseline (Tier 1 canonical) | Phase B N=500 | 30.6% | — | $0.0818 | $40.86 | 10 564 ms |
| `--rerank-candidate-multiplier 5` only | Phase A N=54 | 33.3% | +2.7 pp | $0.0416 | $0.75 | 2 291 ms |
| `--reader-top-k 50` only | Phase A N=54 | 48.1% | +17.5 pp | $0.1351 | $3.51 | 3 638 ms |
| `--hyde` only | Phase A N=54 | 46.3% | +15.7 pp | **$0.0369** | $0.92 | 3 546 ms |
| `--hyde --reader-top-k 50` (no multiplier) | Phase A N=54 | 50.0% | +19.4 pp | $0.1390 | $3.75 | 3 869 ms |
| All three combined (M-tuned) | Phase A N=54 | 57.4% | +26.8 pp | $0.0558 | $1.73 | _Phase A_ |
| **All three combined (M-tuned)** | **Phase B N=500** | **45.4% [41.2%, 49.8%]** | **+14.8 pp** | $0.1348 | $30.59 | 40 271 ms |

Phase A → Phase B compression: the all-three combined config dropped −12 pp from N=54 stratified to N=500 because Phase A's `--sample-per-type 9` overweighted easy categories (SSA/KU/SSU were 33% of N=54 vs 41% of N=500; the true distribution is dominated by MS+TR at 53% of N=500). The +14.8 pp Phase B lift is the validated headline; the ablation singletons remain Phase A-only and need Phase B-scale runs to validate per-category dispatch (see [^pcd-m]).

Phase A per-category attribution (kept as the calibration source for the productionized [RetrievalConfigRouter](../../docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md)): multi-session (precision-bound bottleneck) only lifts to 66.7% Phase A with the multiplier — Phase B at N=130 measured 26.2% [18.5%, 33.8%], so the Phase A signal compresses substantially at scale. HyDE alone was Phase A best for SSA (88.9%) and TR (66.7%) — both also Phase A-only. TopK alone was best for KU (77.8%) and SSU (66.7%) — Phase A-only. The 68.5% per-category-oracle Phase A forecast is Phase A-derived end-to-end and explicitly not Phase B-validated.

Cross-validation on LongMemEval-S (M-tuned config, Phase A N=54): 72.2% accuracy, $0.0833/correct, vs Tier 1 canonical S baseline 73.2% Phase B N=500 — within −1.0 pp of baseline (noise at N=54). Per-category mixed; the M-tuned config regresses MS −28 pp + SSP −19 pp on S because Tier 3 min-cost on S routes those categories to OM-v11. **M-tuned config is M-helpful, S-neutral overall, per-category trade-offs differ between scales.** The right shipping integration is per-query LLM-as-judge dispatch (now productionized as `--retrieval-config-router minimize-cost-augmented`).

## Latency (avg, ms)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| Tier 1 canonical-hybrid | 98 072 | 10 564 | 1 453 | DEFERRED |
| **M-tuned combined (Phase B N=500)** | _72.2% cross-val Phase A_ | **40 271** | _PENDING_ | _PENDING_ |
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
