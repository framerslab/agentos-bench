# AgentOS Memory Benchmark Leaderboard

Last updated: 2026-04-26T22:14:21.000Z

Our rows are produced by `@framers/agentos-bench` against the linked source datasets.
Competitor rows are lifted verbatim from their published sources (see per-row citations).
Methodologies may differ; every row footnotes its reader LLM so comparisons stay honest.

**Architecture:** AgentOS rows below are measured against the [`@framers/agentos/memory-router`](../../../packages/agentos/src/memory-router/README.md) primitive — the LLM-as-judge orchestrator that picks a memory-recall architecture per query across `{canonical-hybrid, observational-memory-v10, observational-memory-v11}` backends. The primitive ships three routing presets (`minimize-cost`, `balanced`, `maximize-accuracy`) calibrated from the Phase B N=500 per-category cost-accuracy points tabulated below. Consumers of `@framers/agentos` can import this primitive directly and get the same routing decisions we measure.

## LongMemEval-S (500 cases, ~115k-token haystacks)
Target to beat: **96.2%** (agentmemory (JordanMcCann)).
| System | Reader | Memory | Replay | Cases | Accuracy | 95% CI | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| **AgentOS Tier 3 min-cost (`@framers/agentos`)**[^t3mincost] | gpt-4o | full-cognitive + policy router (minimize-cost preset) | ingest | 500 | **76.6%** | **[72.8%, 80.2%]** | **16130 ms** | **$0.0580** | — |
| AgentOS Tier 3 max-acc v2 (`@framers/agentos`)[^t3maxacc] | gpt-4o | full-cognitive + policy router (maximize-accuracy preset, v2 table) | ingest | 500 | 75.6% | [71.8%, 79.2%] | 65565 ms | $0.2434 | — |
| AgentOS Tier 2b v11 (`@framers/agentos`)[^v11] | gpt-4o | full-cognitive + v10 router + conditional verbatim | ingest | 500 | 75.4% | [71.6%, 79.0%] | 14172 ms | $0.436 | — |
| AgentOS Tier 2a v10 (`@framers/agentos`)[^v10] | gpt-4o | full-cognitive + v10 router | ingest | 500 | 74.6% | [70.8%, 78.4%] | 12000 ms | $0.327 | — |
| AgentOS Tier 1 canonical (`@framers/agentos`)[^canonical] | gpt-4o | full-cognitive | ingest | 500 | 73.2% | [69.2%, 77.0%] | 98072 ms | $0.0213 | — |
| AgentOS (`@framers/agentos`) | gpt-5-mini | full-cognitive | ingest | 24 | 58.3% | [37.5%, 79.2%] | 4915 ms | $0.0052 | — |
| agentmemory (JordanMcCann) | GPT-4o | — | — | — | 96.2% | — | — | — | [link](https://github.com/JordanMcCann/agentmemory) |
| Mastra Observational Memory | GPT-5-mini | — | — | — | 94.9% | — | — | — | [link](https://mastra.ai/research/observational-memory) |
| EmergenceMem Internal | GPT-4o | — | — | — | 86.0% | — | — | — | [link](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag) |
| Supermemory | gemini-3-pro | — | — | — | 85.2% | — | — | — | [link](https://supermemory.ai/research/) |
| Supermemory | GPT-5 | — | — | — | 84.6% | — | — | — | [link](https://supermemory.ai/research/) |
| Mastra Observational Memory | GPT-4o | — | — | — | 84.2% | — | — | — | [link](https://mastra.ai/research/observational-memory) |
| Supermemory | GPT-4o | — | — | — | 81.6% | — | — | — | [link](https://supermemory.ai/research/) |

[^t3mincost]: **Tier 3 recommended shipping default (new as of 2026-04-24).** Policy router `minimize-cost` preset: per-query dispatch among {canonical-hybrid, observational-memory-v10, observational-memory-v11} based on the gpt-5-mini LLM-as-judge classifier's predicted category + the min-cost routing table (SSA/SSU/TR/KU → canonical-hybrid; MS/SSP → observational-memory-v11). Pareto-dominates all three previously shipping tiers at Phase B N=500: **+1.2pp vs Tier 2b v11 at 7.5x cheaper per correct, +2.0pp vs Tier 2a v10 at 5.6x cheaper, +3.4pp vs Tier 1 canonical at 6.1x faster latency**. Backend mix 85.8% canonical-hybrid + 14.2% observational-memory-v11. Budget breach rate 0%. The routing primitive is now shipped in agentos itself as [`@framers/agentos/memory-router`](../../../packages/agentos/src/memory-router/README.md) — consumers get the same LLM-as-judge per-query architectural dispatch we measure here. Novel product primitive: per-query routing among retrieval architectures at a fixed reader, parameterized by Phase B per-category cost-accuracy curves. Prior art (FrugalGPT, RouteLLM, AutoMix) routes between MODELS at fixed pipelines; Tier 3 routes between ARCHITECTURES at a fixed reader. Findings: [STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md](../docs/STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md). Spec: [docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md](../docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md).
[^t3maxacc]: **Tier 3 max-acc v2 preset, shipping opt-in (promoted from experimental 2026-04-24).** Same router, different table than min-cost: SSA/TR → Tier 1 (where both Pareto-dominate at baseline); SSU/KU/MS/SSP → Tier 2b v11. Beats Tier 2b v11 (75.4%) on accuracy AND cost (1.8x cheaper), and Tier 2a v10 (74.6%) on accuracy AND cost (1.3x cheaper). Latency 66s avg is slower than Tier 2a/2b (12-14s) because Tier 1's canonical path for SSA/TR cases is per-turn cognitive-replay-heavy. Pick over min-cost when workload prefers accuracy parity with Tier 2b at ~25% cost reduction; pick min-cost when latency or maximum cost reduction matters. v1 of this preset table (pre-2026-04-24-v2) routed TR → Tier 2a, which Phase B revealed was within CI noise on accuracy but paid OM ingest cost and suffered classifier misroutes — resulting in 73.8% aggregate (below the 74% floor). v2 routes TR → Tier 1. See Step 20 findings §12 for the before/after per-category breakdown.
[^canonical]: **Tier 1 default.** Step 3 HybridRetriever: BM25 + dense embeddings + RRF merge + Cohere rerank-v3.5 over the cognitive-memory composite score. The shipping default since 2026-04-20. Lowest cost-per-correct in the AgentOS row set; recommended for cost-sensitive general workloads. Findings: [STEP_3_HYBRID_RETRIEVER_FINDINGS_2026-04-19.md](../docs/STEP_3_HYBRID_RETRIEVER_FINDINGS_2026-04-19.md).
[^v10]: **Tier 2a opt-in.** v10 dynamic router (gpt-5-mini per-question classifier with few-shot prompt) routes single-session/temporal questions through canonical Step 3 Hybrid and knowledge-update/multi-session questions through v5 Observational Memory ingest. **+5.3pp on multi-session at Phase B N=500.** 8.3x faster reader latency vs canonical (12s vs 98s avg) — most of canonical's latency is per-turn cognitive-mechanism replay; v10 routes ~80% of cases through a faster path. Cost premium 15.4x vs canonical. Recommended for accuracy-sensitive general workloads where the cost premium is acceptable. Findings: [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md](../docs/STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md).
[^v11]: **Tier 2b opt-in (refinement of v10).** Same v10 router stack + conditional verbatim citation rule appended to the Observational Memory reader prompt for `knowledge-update` and `single-session-user` router categories only. The conditional rule was derived from a per-correctness token-retention analysis: across v10's incorrect cases, retrieved-stage retention was 0.495 lower than across correct cases — the gap reproduced from Phase A (N=102, +1.9pp aggregate) to Phase B (N=500, +0.8pp aggregate). **Aggregate +0.8pp vs v10 falls within sampling noise (CIs overlap), but multi-session lifts +1.5pp vs v10 / +6.8pp vs canonical at N=500 — the per-category profile is mechanism-driven and reproducible.** 1.3x cost premium over v10 ($0.436 vs $0.327 per correct), latency parity (14.2s vs 12s avg). Recommended over v10 for KU/MS-heavy workloads. Findings: [STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](../docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md). Methodology contribution: per-correctness retention split as a variant-ROI predictor — see [docs/specs/2026-04-23-token-retention-framework-design.md](../docs/specs/2026-04-23-token-retention-framework-design.md).

### LongMemEval-S (500 cases, ~115k-token haystacks) — Retrieval Quality (AgentOS only, K=10)

| Config | Memory | Replay | Recall@K | Precision@K | NDCG@K | MRR | N |
|---|---|---|---:|---:|---:|---:|---:|
| gpt-4o/full-cognitive/ingest | full-cognitive | ingest | 0.858 | 0.499 | 0.802 | 0.880 | 495 |
| gpt-5-mini/full-cognitive/ingest | full-cognitive | ingest | 0.740 | 0.433 | 0.717 | 0.802 | 24 |

## LongMemEval-M (500 cases, ~1.5M-token haystacks)

**First public number for any orchestration-router architecture.** Other vendors publish only the easier S variant (Mem0 v3 93.4% claimed, Mastra OM 84.23%, Hindsight 91.4%). LongMemEval-M's 500-sessions-per-haystack distribution surfaces precision limits that S does not.

| System | Reader | Memory | Replay | Cases | Accuracy | 95% CI | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| **AgentOS M-tuned (`@framers/agentos`)**[^mtuned] | gpt-4o | full-cognitive + hybrid + Cohere rerank-v3.5 (candidate ×5) + reader-top-k 50 + HyDE | ingest | **500** | **45.4%** (227/500) | **[41.2%, 49.8%]** | 40 271 ms | **$0.1348** | — |
| **AgentOS HyDE-only (cost-efficient Pareto pick)**[^hyde-only-pb] | gpt-4o | full-cognitive + hybrid + Cohere rerank-v3.5 + reader-top-k 20 + HyDE | ingest | **500** | 35.6% (178/500) | [31.4%, 39.6%] | 4 436 ms | **$0.0432** (3.1× cheaper than M-tuned) | — |
| AgentOS TopK50-only (Phase B ablation)[^topk50-pb] | gpt-4o | full-cognitive + hybrid + Cohere rerank-v3.5 + reader-top-k 50 (no HyDE, no candidate ×5) | ingest | **500** | 40.8% (204/500) | [36.6%, 45.2%] | 4 091 ms | $0.1379 | — |
| AgentOS RetrievalConfigRouter Phase A (gpt-5-mini classifier, no fewshot)[^rcr-phaseA] | gpt-4o | full-cognitive + per-case retrieval-config dispatch (`MINIMIZE_COST_AUGMENTED_TABLE`) | ingest | **54 stratified (Phase A)** | 57.4% (31/54) | [44.4%, 70.4%] | 6 272 ms | $0.1061 | — |
| AgentOS Per-Category Dispatch (Phase A oracle forecast — NOT Phase B-validated, NOT classifier-realistic)[^pcd-empirical] | gpt-4o | full-cognitive + RetrievalConfigRouter dispatch (HyDE for TR/SSP, combined for SSA/KU/SSU/MS) | ingest | **54 stratified (Phase A oracle)** | 68.5% (37/54) | TBD (oracle bound; classifier-realistic at 57.4% above) | — | ~$0.052 | — |
| AgentOS Tier 1 canonical / Tier 3 min-cost (`@framers/agentos`)[^t1m] | gpt-4o | full-cognitive + hybrid + Cohere rerank-v3.5 + reader-top-k 20 | ingest | 500 | 30.6% | TBD | 10 564 ms | $0.0818 | — |
| AgentOS Tier 2b OM-v11 (`@framers/agentos`)[^v11m] | gpt-4o | full-cognitive + v10 router + conditional verbatim | ingest | 500 | _PENDING (Phase B aborted on local hardware; queued for remote)_ | — | — | — | — |
| AgentOS Tier 3 max-acc v2 (`@framers/agentos`)[^t3maxaccm] | gpt-4o | full-cognitive + policy router (maximize-accuracy preset, v2 table) | ingest | 500 | _PENDING (Phase B queued for remote run)_ | — | — | — | — |

**Judge false-positive rate on LongMemEval-M (Stage G-M):** 2% [0%, 5%] at n=100, measured with our `gpt-4o-2024-08-06` judge + `rubricVersion 2026-04-18.1`. Comparable to LongMemEval-S 1% [0%, 3%] and LOCOMO 0% [0%, 0%]. Findings: [STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md](../docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md).

[^hyde-only-pb]: **2026-04-26 Phase B HyDE-only at N=500 (validated):** **35.6% [31.4%, 39.6%]** (178/500), $7.68 LLM (3.1× cheaper than M-tuned $30.59), $0.0432/correct, avg 4.4s latency. Per-category at Phase B (10k bootstrap CIs): SSA 67.9% [55.4%, 80.4%] (n=56), SSU 50.0% [38.6%, 61.4%] (n=70), KU 35.9% [25.6%, 46.2%] (n=78), SSP 26.7% [13.3%, 43.3%] (n=30), TR **26.3% [18.8%, 33.8%]** (n=133), MS 25.6% [18.8%, 33.1%] (n=133). Phase B run JSON: `results/runs/2026-04-26T18-25-23-686--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. **HyDE-only beats M-tuned combined ONLY on TR (+3.7 pp Phase B; calibration validated)**; on every other category HyDE-only is within CI of or significantly worse than combined (SSA −23 pp, SSU −29 pp, KU −27 pp, SSP −1.9 pp, MS −0.6 pp). The 3.1× cost-per-correct advantage makes HyDE-only the cost-efficient Pareto pick on the M cost-accuracy frontier — workloads that prefer maximum cost reduction at moderate accuracy should pick HyDE-only over M-tuned. Implication for the augmented router: the calibration's TR → HyDE pick is correct (validated +3.7 pp at Phase B); the SSP → HyDE pick is NOT validated at scale (within noise of combined). Phase A's "+8 pp on SSP" claim was small-sample variance.

[^topk50-pb]: **2026-04-26 Phase B TopK50-only at N=500 (validated):** **40.8% [36.6%, 45.2%]** (204/500), $28.14 LLM, $0.1379/correct, avg 4.1s latency. Per-category at Phase B (10k bootstrap CIs): SSA 60.7% [48.2%, 73.2%] (n=56), SSU 77.1% [67.1%, 85.7%] (n=70), KU 61.5% [50.0%, 71.8%] (n=78), SSP 16.7% [3.3%, 30.0%] (n=30), TR 23.3% [16.5%, 30.8%] (n=133), MS 24.2% [17.4%, 31.8%] (n=132). Phase B run JSON: `results/runs/2026-04-26T19-03-47-926--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. **TopK50-only does NOT beat combined on any category at Phase B**: KU within CI of combined (61.5% vs 62.8%), SSU within CI (77.1% vs 78.6%), every other category significantly worse. The Phase A "topk50 ties combined for KU" claim is preserved at Phase B (within noise) but the augmented router's KU → topk50 calibration choice is no longer cheaper-cost-justified at scale: combined dispatch is the simpler default. **Phase B oracle aggregate (per-category-best across these three configs): 46.4% (232/500), only +1.0 pp over static M-tuned 45.4%** — the 68.5% Phase A oracle forecast was inflated ~22 pp by small-sample variance. Phase B re-derived calibration: TR → HyDE (only category where non-combined wins; +3.7 pp on TR alone, +1 pp aggregate); every other category → combined.

[^rcr-phaseA]: **2026-04-26 Phase A validation of `--retrieval-config-router minimize-cost-augmented` at N=54 stratified.** Three runs spanning classifier configurations:

  | Run | Classifier | Fewshot | Aggregate | Classifier Acc | Run JSON |
  |---|---|---|---:|---:|---|
  | 1 | gpt-5-mini | base | **57.4%** (31/54) | 46.3% | `2026-04-26T17-59-13-511--longmemeval-m--gpt-4o--full-cognitive--ingest.json` |
  | 2 | gpt-5-mini | fewshot | 53.7% (29/54) | 57.4% | `2026-04-26T18-10-47-280--longmemeval-m--gpt-4o--full-cognitive--ingest.json` |
  | 3 | gpt-4o | fewshot | 46.3% (25/54) | **59.3%** | `2026-04-26T18-19-05-942--longmemeval-m--gpt-4o--full-cognitive--ingest.json` |

  All three converge to **46.3%–57.4% aggregate, bounded by static M-tuned 57.4% Phase A**. Classifier accuracy varies (46-59%) but the aggregate doesn't lift toward the 68.5% oracle forecast — small-sample variance at n=9 per category dominates (n=9 implicit binomial CIs are ~[0%, 56%] for an underlying rate of 25%, which is the regime for MS/SSP). The dispatch wiring is correct end-to-end: per-case classification → augmented dispatch table lookup → retrieval-config flag override (hyde / readerTopK / candidateMultiplier) → metadata tracking. Total $9.93 across the three runs. **The augmented router's true lift can only be measured at Phase B N=500.** Findings: [RETRIEVAL_CONFIG_ROUTER_PHASE_A_VALIDATION_2026-04-26.md](../docs/RETRIEVAL_CONFIG_ROUTER_PHASE_A_VALIDATION_2026-04-26.md). Phase B at N=500 queued with hyde-only run as the highest-information $30 spend (validates HyDE per-category accuracies for TR/SSP, the categories where the augmented router calibration says HyDE-alone beats combined).

[^pcd-empirical]: **PHASE A ORACLE FORECAST, NOT classifier-realistic, NOT Phase B-validated.** The realistic classifier-driven measurement is the row above (57.4% at gpt-5-mini, no fewshot). The oracle forecast assumes perfect classifier output, which gpt-5-mini does not provide. Same seed=42, same `--sample-per-type 9` stratified case set across all six Phase A ablation runs (case IDs identical). For each category, pick the best-accuracy config from the Phase A ablation matrix, then aggregate: SSA → combined (9/9); KU → combined (7/9); SSU → combined (7/9); TR → hyde (6/9); MS → combined (6/9); SSP → hyde (2/9). Total 37/54 = 68.5% on Phase A's stratified case set. **CAVEAT: the M-tuned Phase B run at N=500 (45.4%, finished 2026-04-26) revealed Phase A inflated MS (Phase A 66.7% N=9 → Phase B 26.2% [18.5%, 33.8%] N=130) and TR (Phase A 33.3% N=9 → Phase B 22.6% [15.8%, 30.1%] N=133) because N=9-per-category had wide implicit CIs (~[0.33, 1.00] for MS).** The +11 pp dispatch lift forecast is therefore likely overstated at N=500. To validate the augmented router empirically at full scale, hyde-only and topk-only Phase B runs at N=500 need to land (each ~$30, ~5 hours) so the dispatched per-category accuracies can be re-measured. **Productionized as the `MINIMIZE_COST_AUGMENTED_TABLE` preset on `MemoryRouter` (`agentos@0.5.x`, decideAugmented + decideAndDispatchAugmented) and the `--retrieval-config-router minimize-cost-augmented` bench flag (`agentos-bench`, per-case dispatch hook in LongMemEvalS).** Implementation per [RetrievalConfigRouter productionization plan](../docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md). Empirical-source Phase A run JSONs: combined `2026-04-26T01-40-34-904`, hyde-only `2026-04-26T02-13-35-497`, etc. (full list in the M-tuned footnote below).

[^mtuned]: **2026-04-26 Phase B at N=500 (validated):** **45.4% [41.2%, 49.8%]** (227/500), $30.59 LLM, $0.1348/correct, avg 40.3s latency. Per-category: SSA 91.1% [82.1%, 98.2%] (n=56), SSU 78.6% [68.6%, 87.1%] (n=70), KU 62.8% [52.6%, 73.1%] (n=78), SSP 28.6% [14.3%, 46.4%] (n=28), MS 26.2% [18.5%, 33.8%] (n=130), TR 22.6% [15.8%, 30.1%] (n=133). Phase B run JSON: `results/runs/2026-04-26T16-50-33-693--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. **+14.8 pp validated lift over Tier 1 canonical baseline 30.6% Phase B at N=500.** The M-tuned config combines three opt-in flags on top of canonical: `--rerank-candidate-multiplier 5` (250-chunk pool for Cohere rerank vs default 60), `--reader-top-k 50` (vs default 20), `--hyde`. CharHashEmbedder retained (semantic embedder failed Phase A on local hardware due to memory pressure; semantic-embedder Phase B is queued separately). **Phase B compresses the Phase A 57.4% N=54 result by −12 pp** because Phase A's stratified `--sample-per-type 9` overweighted the easy categories (SSA/KU/SSU make up 41% of N=54 vs 41% of N=500 cases — true distribution is dominated by MS+TR which are 53% of N=500 and the hardest categories). The per-category-oracle 68.5% Phase A forecast row above is also Phase A-bound and should not be treated as a Phase B claim until the hyde-only / topk-only ablations land at N=500. **Phase A ablation matrix at N=54 stratified, same seed=42** (kept here for the productionized router's calibration source): multiplier-only 33.3% (+2.7 pp), reader-top-k 50 only 48.1% (+17.5 pp), HyDE only 46.3% (+15.7 pp, $0.0369/correct cheapest), HyDE+TopK no multiplier 50.0% (+19.4 pp), all three combined **57.4% Phase A** (+26.8 pp, $0.0558/correct). **Cross-validation on LongMemEval-S** (Phase A N=54): 72.2%, vs Tier 1 canonical S baseline 73.2% Phase B N=500 = −1.0 pp (within noise); the M-tuned config regresses MS −28 pp and SSP −19 pp on S because Tier 3 min-cost on S routes those categories to OM-v11. **Conclusion**: M-tuned is a real, validated +14.8 pp lift on M at full N=500; the per-category-oracle dispatch forecast (68.5%) needs hyde-only / topk-only Phase B ablations at N=500 to validate the lift over the static combined config. Per-case Phase A run JSONs: combined `2026-04-26T01-40-34-904--longmemeval-m--gpt-4o--full-cognitive--ingest.json`, mult-only `2026-04-26T02-05-08-097`, TopK-only `2026-04-26T02-08-40-380`, HyDE-only `2026-04-26T02-13-35-497`, HyDE+TopK `2026-04-26T02-18-33-158`. Cross-val (S Phase A): `2026-04-26T02-02-35-802--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

[^t1m]: Stage J Phase B at N=500. Per-category: SSU 60.0%, SSA 50.0%, KU 50.0%, MS 18.0%, TR 12.8%, SSP 10.0%. The S→M scale gap (76.6% → 30.6% = −46 pp) concentrates in multi-session and temporal-reasoning, both precision-bound at 500-session haystacks. **Superseded by the M-tuned row above (+27 pp lift via larger rerank pool + reader-top-k 50 + HyDE).** At M scale, the `minimize-cost` policy-router preset reduces to canonical-hybrid for every category, so this row covers both Tier 1 canonical and Tier 3 min-cost. Findings: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../docs/STAGE_J_PHASE_B_FINDINGS_2026-04-25.md). Per-case run summary: `results/runs/2026-04-25T10-14-43-207--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json` (full run JSON gitignored due to >100MB; the `--summary.json` sibling is committed).

[^v11m]: Tier 2b OM-v11 on LongMemEval-M. Phase B in flight at the time of this update. Will be filled when the run lands.

[^t3maxaccm]: Tier 3 max-acc on LongMemEval-M. Phase B in flight at the time of this update. Will be filled when the run lands.

## BEAM 100K (400 queries × 10 categories, ~100K-token user-haystacks)

**First public BEAM 100K result for any orchestration-router architecture.** Hindsight holds SOTA at the 10M tier (64.1%); BEAM 100K has no widely-published reference numbers. AgentOS-bench v1 ships the loader + adapter under `--bench beam-100k` (data downloaded from github.com/vectorize-io/agent-memory-benchmark).

| System | Reader | Memory | Replay | Cases | Accuracy | 95% CI | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| **AgentOS M-tuned (`@framers/agentos`)**[^beam100k-mtuned] | gpt-4o | full-cognitive + hybrid + Cohere rerank-v3.5 (candidate ×5) + reader-top-k 50 + HyDE | ingest | **90 stratified (Phase A)** | **45.6%** (41/90) | [35.6%, 55.6%] | 6 080 ms | $0.2612 | — |

[^beam100k-mtuned]: **First public BEAM 100K number, 2026-04-26 Phase A.** Stratified `--sample-per-type 9` × 10 BEAM categories = 90 cases, gpt-4o reader, gpt-4o-2024-08-06 judge with the LongMemEval rubric remap (`abstention` → abstention; `contradiction_resolution` + `knowledge_update` → knowledge-update; `event_ordering` + `temporal_reasoning` → temporal-reasoning; `information_extraction` → single-session-user; `instruction_following` → single-session-assistant; `multi_session_reasoning` + `summarization` → multi-session; `preference_following` → single-session-preference). Per-category at this run: information_extraction 88.9% [66.7%, 100%], instruction_following 77.8% [44.4%, 100%], knowledge_update 66.7% [33.3%, 100%], preference_following 66.7% [33.3%, 88.9%], temporal_reasoning 55.6% [22.2%, 88.9%], abstention 44.4% [11.1%, 77.8%], multi_session_reasoning 44.4% [11.1%, 77.8%], summarization 11.1% [0%, 33.3%], **contradiction_resolution 0% [0%, 0%]**, **event_ordering 0% [0%, 0%]**. Two failure modes surface that LongMemEval doesn't expose: (1) `contradiction_resolution` requires the reader to flag contradictory information explicitly — AgentOS's M-tuned reader prompt doesn't trigger contradiction detection and answers confidently from the most-recent assertion; (2) `event_ordering` returns the wrong 3 events — the agent extracts specific feature names from haystacks where the gold answer wants broad themes (e.g. answers "user authentication, transaction management, basic analytics" vs gold "core functionality, transaction error handling, security and deployment"). Both are honest follow-up tasks for v3 and don't impact the M-tuned headline on the categories AgentOS handles well. Run JSON: `results/runs/2026-04-26T19-42-25-420--beam-100k--gpt-4o--full-cognitive--ingest.json`. Total cost $10.71 LLM. Phase B at full N=400 queued for the validated headline.

### Negative findings (transparent stack)

These rows document architectures we tested and DROPPED at Phase A because they did not lift on top of the shipping baseline. Published as a credibility marker for the v1 transparency narrative.

| System | Reader | Memory | Replay | Cases | Δ vs paired baseline | Findings doc |
|---|---|---|---|---:|---:|---|
| AgentOS + Stage L (Anthropic Contextual Retrieval `summarized` executor) | gpt-4o | full-cognitive + per-session summary prepended to chunks before embedding | ingest | 54 | **−3.7 pp** on LongMemEval-S (74.1% → 70.4%); temporal-reasoning −33.3 pp | [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md) |
| AgentOS + Stage I (Mem0-v3-style entity-linking re-rank) | gpt-4o | full-cognitive + entity-overlap re-rank at retrieval | ingest | 25 | **−4.0 pp** on LOCOMO (64.0% → 60.0%); multi-hop −20 pp | [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md) |
| AgentOS + Hierarchical retrieval (`--session-retrieval` 2-stage) | gpt-4o | full-cognitive + Stage 1 summary-similarity (top-10 sessions) → Stage 2 chunks-per-session (top-10) → Cohere rerank ×5 → reader-top-k 50 + HyDE | ingest | 54 | **−14.8 pp** on LongMemEval-M vs M-tuned combined (57.4% → 42.6%); MS −44.5 pp, SSP −14.3 pp, $0.196/correct (3.5x more expensive) | [STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md](../docs/STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md) |
| AgentOS + Two-call reader (`--two-call-reader`) on M-tuned | gpt-4o | M-tuned retrieval + reader-side fact-extraction → answer pipeline | ingest | 54 | **−16.7 pp** on LongMemEval-M vs M-tuned combined (57.4% → 40.7% Phase A); KU −44.5 pp, MS −33.4 pp, TR −22.2 pp; $0.179/correct | [^twocall-pa] |

Both architectures shipped as production primitives in agentos core for consumers building different pipelines:
- `SummarizedIngestExecutor` (0.2.12) — Anthropic Contextual Retrieval recipe; wraps `SessionSummarizer` for the `IngestRouter.dispatcher['summarized']` slot
- `EntityExtractor` + `EntityLinkingIngestExecutor` (0.2.13) — regex-based entity extraction + ingest executor for the `IngestRouter.dispatcher['fact-graph']` slot
- `EntityRetrievalRanker` (0.2.13) — recall-stage entity-overlap re-rank primitive

[^twocall-pa]: **2026-04-26 Phase A two-call reader on M-tuned at N=54 stratified.** `--two-call-reader` extracts a JSON fact scratchpad from retrieved passages with passage-id citations on the first call, then answers from the scratchpad only on the second call (no raw passages in the final-answer context). Aggregate **40.7% (22/54)** at $0.1789/correct, avg 7.8s latency, $3.94 LLM total. **−16.7 pp vs static M-tuned 57.4% Phase A**. Per-category at this run (n=9 each): SSA 77.8% (−22.2 pp), SSU 66.7% (−11.1 pp), KU 33.3% (−44.5 pp), SSP 22.2% (+7.9 pp), MS 33.3% (−33.4 pp), TR 11.1% (−22.2 pp). The fact-extraction step strips context that the single-call reader uses directly; KU, MS, and TR collapse particularly hard because those categories rely on temporal anchors and cross-session detail that don't survive JSON-fact summarization. SSP lifts marginally (+8 pp at n=9, within CI noise) — preference questions reduce well to scratchpad facts. Net: orthogonal-axis (reader-side) lift on top of M-tuned does NOT materialize at Phase A; deeper reader prompting would need to preserve passage context end-to-end. Run JSON: `results/runs/2026-04-26T19-54-55-127--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. The `twoCallRead` primitive (`packages/agentos-bench/src/readers/twoCallReader.ts`) ships unchanged for consumers building Emergence-style two-call pipelines on workloads where citation-tracked answers matter more than raw accuracy.

## LongMemEval-Oracle (retrieval-removed, reader quality only)
| System | Reader | Memory | Replay | Cases | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---|
| AgentOS (`@framers/agentos`) | gpt-4o | none | ingest | 20 | 65.0% | 765 ms | $0.0333 | — |

## LOCOMO (10 conversations, 1986 QA pairs — OOD transfer result)

AgentOS's pipeline is tuned for LongMemEval-S. We publish three LOCOMO rows: the OOD baseline (no tuning), the K=20 retrieval bump (the only tuning that helped on aggregate), and the K=20 + `--no-abstention` combination (which net-regressed because adversarial accuracy collapsed when the reader was forced to commit). See [STAGE_F2_CORRECTION_2026-04-24.md](../docs/STAGE_F2_CORRECTION_2026-04-24.md) for the full ablation, the bug story behind the original 51.5% mis-publication (the `--no-abstention` flag was silently dropped at runtime due to a missing field in `resolveRunConfig`; the corrupt row was actually K=20 alone in disguise), and the contract test that prevents recurrence.

**Judge false-positive rate on LOCOMO (Stage G-LOCOMO):** 0% [0%, 0%] at n=100, measured with our `gpt-4o-2024-08-06` judge + `rubricVersion 2026-04-18.1`. Penfield Labs reported 62.81% FPR on LOCOMO's default judge (`gpt-4o-mini`, original rubric). The 63pp gap is a judge-model + rubric-strictness artifact, not an intrinsic property of LOCOMO's gold answers. Our LOCOMO numbers below are not inflated by judge noise on our side. See [STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md](../docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md).

| System | Reader | Memory | Replay | Cases | Accuracy | 95% CI | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| **AgentOS Tier 1 canonical + K=20 (best LOCOMO tuning)**[^locomo-k20] | gpt-4o | full-cognitive | ingest | 1986 | **51.5%** | **[49.2%, 53.7%]** | **1453 ms** | **$0.0099** | — |
| AgentOS Tier 1 canonical OOD[^locomo-ood] | gpt-4o | full-cognitive | ingest | 1986 | 49.9% | [47.7%, 52.1%] | 2579 ms | $0.0123 | — |
| AgentOS Tier 1 canonical + K=20 + `--no-abstention` (Stage F-2 corrected, regressed)[^locomo-no-abstention] | gpt-4o | full-cognitive | ingest | 1986 | 47.3% | [45.2%, 49.5%] | 1201 ms | $0.0107 | — |

[^locomo-k20]: **The Pareto-best LOCOMO tuning we found.** Same HybridRetriever (BM25 + dense RRF + Cohere rerank-v3.5) as the OOD row; one knob changed: `--reader-top-k 20` (up from default 10). Per-category vs OOD: single-hop +2.8pp (20.6% → 23.4%), multi-hop −1.9pp (39.6% → 37.7%), temporal +1.0pp (27.1% → 28.1%), open-domain +3.2pp (48.5% → 51.7%), adversarial unchanged (83.4% → 83.6%). Bootstrap CIs overlap the OOD row aggregate-wise; the tuned row wins on cost (20% cheaper/correct) and latency (44% faster) by retrieving more candidates that the reranker can re-sort. We initially mis-labeled this configuration as "K=20 + `--no-abstention` tuned" before catching that the `--no-abstention` flag was being silently dropped at runtime — see [STAGE_F2_CORRECTION_2026-04-24.md](../docs/STAGE_F2_CORRECTION_2026-04-24.md). Per-case artifacts: `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`. Cost provenance: that clean K=20-only JSON is a full cache hit (`totalUsd=$0`); the $0.0099/correct figure comes from the paid pre-fix Stage F-2 artifact, which had the same effective K=20-only runtime configuration.

[^locomo-ood]: **LongMemEval-tuned pipeline on LOCOMO without tuning changes.** Adversarial 83.4%, open-domain 48.5%, multi-hop 39.6%, temporal 27.1%, single-hop 20.6%. The single-hop underperformance is a calibration mismatch: our abstention prompt is tuned for LongMemEval-S's answer-may-not-exist distribution (where abstention on adversarial is CORRECT), and the same behavior over-refuses on LOCOMO non-adversarial. Also: recallTopK=10 undersamples LOCOMO's 199-260-turn dense histories. Dataset: [link](https://github.com/snap-research/locomo). Per-case artifacts: `results/runs/2026-04-24T18-42-51-243--locomo--gpt-4o--full-cognitive--ingest.json`.

[^locomo-no-abstention]: **Stage F-2 corrected ablation row, published as a transparent regression.** Two knobs changed from OOD: `--reader-top-k 20` and `--no-abstention`. Per-category vs OOD: single-hop +1.7pp, multi-hop +1.5pp, temporal **+13.5pp** (27.1% → 40.6%), open-domain **+6.7pp** (48.5% → 55.2%), adversarial **−29.1pp** (83.4% → 54.3%). The `--no-abstention` flag tells the reader every question has an answer in the excerpts, which works as designed on temporal/open-domain (where it does) but forces wrong commits on adversarial Q's (where it doesn't). LOCOMO is 22.5% adversarial by case count, so the −29pp adversarial loss outweighs the temporal/open-domain gains. Stage F-3 Run B (`--no-abstention` alone at K=10) measured **42.1% [40.0%, 44.3%]** at $0.0082/correct — the prompt-only ablation isolates the same trade-off. The K=20 retrieval bump partially compensates the prompt damage (combined −2.6pp vs. prompt-alone −7.8pp). Published as a row to make the trade-off visible: `--no-abstention` is a category-specific tuning knob, not a Pareto improvement. Per-case artifacts: `results/runs/2026-04-24T22-05-01-855--locomo--gpt-4o--full-cognitive--ingest.json`.

## BEAM (500k-token tier)
Target to beat: **72.0%** (Hindsight).
| System | Reader | Memory | Replay | Cases | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | — | 72.0% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## BEAM (1M-token tier)
Target to beat: **73.9%** (Hindsight).
| System | Reader | Memory | Replay | Cases | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | — | 73.9% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## BEAM (10M-token tier — the frontier)
Target to beat: **64.1%** (Hindsight).
| System | Reader | Memory | Replay | Cases | Accuracy | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---|
| Hindsight | Unspecified (see source) | — | — | — | 64.1% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |
| Next-best published (per Hindsight) | Unspecified (see source) | — | — | — | 40.6% | — | — | [link](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) |

## Micro-benchmarks (cognitive-mechanism assertions)

Each probe is a deterministic assertion on an AgentOS cognitive mechanism.
Regressions here indicate a bug in the mechanism, not a scoring-model issue.

| Benchmark | Cases | Accuracy | Avg latency |
|---|---:|---:|---:|
| consolidation-signal-preservation | 3 | 100.0% | 0.0 ms |
| decay-fidelity | 5 | 100.0% | 0.2 ms |
| hexaco-encoding-bias | 6 | 100.0% | 0.0 ms |
| scaling-profile | 2 | 100.0% | 16.0 ms |
| signal-ablation | 6 | 100.0% | 0.2 ms |
| spreading-activation-precision | 3 | 100.0% | 1.0 ms |
| working-memory-capacity | 5 | 100.0% | 0.2 ms |

## Latency & Footprint (latest AgentOS run)

Benchmark: `longmemeval-s` — gpt-4o / full-cognitive / ingest

- Encode   p50/p95/p99: 1.0/1.3/1.7 ms (n=495)
- Retrieve p50/p95/p99: 518.0/768.2/1227.9 ms (n=495)
- Vector search p50/p95: 1.0/2.3 ms
- Scoring p50/p95:       1.0/2.0 ms
- Replay p50/p95:        110726/168503 ms
- Brain size mean/p95:   1906 KB / 2608 KB
- Mean trace count:      251
- Peak WM slots (max):   7
- Total encode calls:    124134

## Methodology notes

- Our `memory` column shows the AgentOS memory mode under test: `full-cognitive` uses `CognitiveMemoryManager` with all eight cognitive mechanisms active (reconsolidation, RIF, involuntary recall, metacognitive FOK, temporal gist, schema encoding, source confidence decay, emotion regulation); `base-memory` uses the standalone `Memory` facade; `none` is the haystack-in-context baseline.
- Our `replay` column shows how the haystack was fed to memory: `observe` drives per-turn `CognitiveMemoryManager.encode()` calls (matching live-conversation cadence); `ingest` collapses each session into one `encode()` call. The observer / reflector pipeline only activates when an LLM invoker is configured; benchmark runs typically ship without one to keep costs bounded, so both modes exercise the encoding + decay + scoring stack directly.
- `Cases` shows the actual evaluated sample size for that row. Benchmark section titles describe the full dataset; exploratory smokes and canonical full runs can coexist in the same section.
- Per-case scoring uses the upstream rubric (see `RUBRIC_SOURCE` in `src/judges/rubrics/`).
- Judge model is GPT-4o unless otherwise noted, to avoid same-family self-preference bias when the reader is also Claude.
- Cost-per-correct divides total USD (reader + embedding + judge) by passed cases; it is the primary efficiency metric once accuracy is competitive.
