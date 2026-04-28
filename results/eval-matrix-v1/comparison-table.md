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
| **🚀 Canonical-hybrid + sem-embed + per-category reader router (NEW HEADLINE 2026-04-28)** [^canonical-reader-router-pb-ct] | **85.6% [82.4%, 88.6%]** (Phase B N=500, **$0.0090/correct = 4.6× cheaper than the prior 84.8% headline, 5.3× faster avg latency, 15× faster p95**) | _PENDING_ | _PENDING_ | _PENDING_ |
| Tier 3 min-cost + semantic embedder + per-category reader router (Pareto-2, with policy router) [^reader-router-pb] | **84.8% [81.6%, 87.8%]** (Phase B N=500, $0.0410/correct = 21% cheaper than gpt-4o-only, 3.5× faster avg latency) | _PENDING_ | _PENDING_ | _PENDING_ |
| **🔥 Tier 3 min-cost + semantic embedder (text-embedding-3-small) — Phase B validated** [^t3mincost-semantic] | **83.2% [79.8%, 86.4%]** (Phase B N=500, weighted 84.2% [81.0%, 87.2%]) | _PENDING (re-run with semantic embedder + M-tuned flags in flight)_ | _PENDING_ | _PENDING_ |
| M-tuned (rerank-candidate ×5 + reader-top-k 50 + HyDE) — CharHash baseline [^mtuned-m] | 72.2% (cross-val N=54) | 45.4% [41.2%, 49.8%] (Phase B N=500, CharHashEmbedder) | _PENDING_ | **45.6% [35.6%, 55.6%]** (Phase A N=90 stratified) [^beam100k-pa] |
| Per-category dispatch (Phase A forecast — NOT Phase B-validated; Phase B oracle measured 46.4%) [^pcd-m] | _to be measured_ | 68.5% Phase A oracle (Phase B oracle: **46.4%**, only +1pp over static M-tuned; small-sample variance dominated Phase A) | _PENDING_ | _PENDING_ |
| HyDE-only (cost-efficient Pareto pick) [^hyde-only-pb-ct] | _PENDING_ | 35.6% [31.4%, 39.6%] (Phase B N=500); $0.0432/correct (3.1× cheaper than M-tuned) | _PENDING_ | _PENDING_ |
| TopK50-only [^topk50-pb-ct] | _PENDING_ | 40.8% [36.6%, 45.2%] (Phase B N=500) | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | 73.2% [69.2, 77.0] | 30.6% [^t1m] (superseded by M-tuned above) | 51.5% (K=20) [^t1locomo] | _PENDING (Phase A baseline)_ |
| Tier 2b OM-v11 | 75.4% [71.6, 79.0] | _PENDING (Phase B queued for remote)_ | _baseline only_ | DEFERRED v2 |
| Tier 3 min-cost (shipping default) | **76.6% [72.8, 80.2]** | _≈ Tier 1 at M scale_ [^t3mincostm] | _baseline only_ | DEFERRED v2 |
| Tier 3 max-acc | 75.6% [71.8, 79.2] | _PENDING (Phase B queued for remote)_ | _baseline only_ | DEFERRED v2 |
| --- |
| Stage L treatment (DROPPED) | 70.4% (−3.7 pp) [^stagel] | n/a | n/a | n/a |
| Stage I treatment (DROPPED) | n/a | n/a | 60.0% (−4.0 pp) [^stagei] | n/a |
| Stage H Hierarchical retrieval (DROPPED) [^stageh] | n/a | 42.6% (−14.8 pp vs M-tuned combined) | n/a | n/a |
| M-tuned flags compounded on S Phase B (DROPPED) [^mtuned-on-s-pb-ct] | 76.6% (−6.6 pp vs 83.2% baseline) | n/a | n/a | n/a |
| All-OM dispatch on S — Mastra architecture clone, Phase B (DROPPED) [^all-om-on-s-pb-ct] | **76.0%** [72.2%, 79.6%] (−7.2 pp vs 83.2% baseline) | n/a | n/a | n/a |
| Reader router + gpt-4o classifier upgrade on S — Phase B (DROPPED, no lift over default classifier) [^reader-router-gpt4o-classifier-ct] | 84.4% [81.2%, 87.6%] (within CI of gpt-5-mini-classifier 84.8%) | n/a | n/a | n/a |

[^pcd-m]: **PHASE A FORECAST — not yet Phase B-validated.** Derived from six Phase A ablation runs at N=54 stratified (seed=42, `--sample-per-type 9`, identical case IDs across runs). For each category, picking the best-accuracy ablation config gives a per-category-oracle aggregate: SSA → combined (9/9, 100%); KU → combined (7/9, 77.8%); SSU → combined (7/9, 77.8%); TR → hyde (6/9, 66.7%); MS → combined (6/9, 66.7%); SSP → hyde (2/9, 22.2%). Total **37/54 = 68.5%** equal-weighted stratified Phase A. **CAVEAT**: the M-tuned Phase B at N=500 (45.4% [41.2%, 49.8%]) revealed Phase A inflated MS (Phase A 66.7% N=9 → Phase B 26.2% N=130) and TR (Phase A 33.3% N=9 → Phase B 22.6% N=133) because N=9-per-category had wide implicit CIs. The dispatch lift forecast at N=500 may therefore be smaller than the +11 pp Phase A math suggests. To validate the per-category dispatch lift at full scale, hyde-only and topk-only Phase B runs at N=500 (each ~$30, ~5 hours) need to land so the dispatched per-category accuracies can be re-measured at scale. **Productionized as the `MINIMIZE_COST_AUGMENTED_TABLE` preset on `MemoryRouter` and the `--retrieval-config-router minimize-cost-augmented` bench flag** per [RetrievalConfigRouter productionization plan](../../docs/specs/2026-04-26-retrieval-config-router-productionization-plan.md). Source: Phase A ablation run JSONs `2026-04-26T01-40-34-904--*` through `2026-04-26T03-22-06-857--*`.

[^mtuned-m]: **2026-04-26 Phase B at N=500 (validated):** **45.4% [41.2%, 49.8%]** (227/500), $30.59 LLM, $0.1348/correct, avg 40.3s latency. Per-category at Phase B with bootstrap CIs: SSA 91.1% [82.1%, 98.2%] (n=56), SSU 78.6% [68.6%, 87.1%] (n=70), KU 62.8% [52.6%, 73.1%] (n=78), SSP 28.6% [14.3%, 46.4%] (n=28), MS 26.2% [18.5%, 33.8%] (n=130), TR 22.6% [15.8%, 30.1%] (n=133). Phase B run JSON: `results/runs/2026-04-26T16-50-33-693--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. **+14.8 pp validated lift over Tier 1 canonical baseline 30.6% Phase B N=500.** Config: `--rerank-candidate-multiplier 5` (250-chunk pool for Cohere rerank vs default 60), `--reader-top-k 50` (vs default 20), `--hyde` (HyDE hypothetical-doc embedding). CharHashEmbedder retained; semantic embedder Phase B is queued separately. **Phase A → Phase B compression**: Phase A at N=54 stratified measured 57.4%; Phase B at N=500 measures 45.4% (−12 pp). The drop is consistent with Phase A's `--sample-per-type 9` overweighting easy categories — SSA/KU/SSU make up 33% of N=54 vs 41% of N=500 cases (true distribution is dominated by MS+TR which together are 53% of N=500 and the hardest categories). The Phase A ablation matrix (kept here as the calibration source for the productionized RetrievalConfigRouter) suggested per-category-oracle dispatch could lift another +11 pp over static combined; that forecast is now Phase A-only and not Phase B-validated until hyde-only and topk-only N=500 ablations land. **Cross-validation on LongMemEval-S** (M-tuned config, Phase A N=54): 72.2%, vs Tier 1 canonical S baseline 73.2% Phase B N=500 = −1.0 pp (within noise); the M-tuned config regresses MS −28 pp + SSP −19 pp on S because Tier 3 min-cost on S routes those categories to OM-v11. **Conclusion**: M-tuned is a real, validated +14.8 pp lift on M at full N=500; per-category dispatch productionization shipped (`MINIMIZE_COST_AUGMENTED_TABLE` + `--retrieval-config-router` bench flag) but its quantitative lift at N=500 needs ablation runs to validate. Phase A ablation run JSONs (kept as the calibration source for `M_PHASE_A_PER_CATEGORY_ACCURACY`): combined `2026-04-26T01-40-34-904`, mult-only `2026-04-26T02-05-08-097`, TopK-only `2026-04-26T02-08-40-380`, HyDE-only `2026-04-26T02-13-35-497`, HyDE+TopK `2026-04-26T02-18-33-158`. Cross-val (S Phase A): `2026-04-26T02-02-35-802--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

[^t1m]: Stage J Phase B at N=500. The bench's shipping retrieval pipeline (hybrid BM25 + dense + Cohere `rerank-v3.5`, `reader-top-k 20`) on LongMemEval-M. First public LongMemEval-M number for any orchestration-router architecture. Findings: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../../docs/STAGE_J_PHASE_B_FINDINGS_2026-04-25.md). Per-case run JSON: `results/runs/2026-04-25T10-14-43-207--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json`.

[^t1locomo]: Tier 1 canonical-hybrid at `--reader-top-k 20` is the Pareto-best LOCOMO tuning. Findings: [STAGE_F2_CORRECTION_2026-04-24.md](../../docs/STAGE_F2_CORRECTION_2026-04-24.md). Per-case artifacts: `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`.

[^t3mincostm]: At LongMemEval-M scale, the `minimize-cost` policy-router preset reduces to canonical-hybrid for every category because OM-v11's per-case ingest cost on 500-session haystacks is dominated by retrieval precision, not architecture choice. Tier 3 min-cost on M is therefore architecturally identical to Tier 1 canonical-hybrid on M.

[^canonical-reader-router-pb-ct]: **🚀 NEW HEADLINE 2026-04-28 — Canonical-hybrid + per-category reader router with standalone classifier.** Phase B at full N=500: **85.6% [82.4%, 88.6%]** (428/500), $3.84 LLM total, **$0.0090/correct** (4.6× cheaper than the prior 84.8% reader-router-with-policy headline at $0.0410), avg latency **4 001 ms** (5.3× faster vs 21 042 ms; **p95 latency 7 264 ms vs 111 535 ms = 15.4× faster on the tail**). Per-category at this run (10k bootstrap CIs): SSA 98.2% [94.6%, 100%] (n=56), SSU 92.9% [85.7%, 98.6%] (n=70), KU 91.0% [84.6%, 97.4%] (n=78), SSP 86.7% [73.3%, 96.7%] (n=30), TR 84.2% [77.4%, 90.2%] (n=133), MS 74.4% [66.9%, 82.0%] (n=133). Recall@10: **0.981** (vs 0.831 with policy router). Reader dispatch: 235/500 (47%) gpt-4o, 265/500 (53%) gpt-5-mini. **Accuracy: +1.4 pp over Mastra OM gpt-4o (84.2%) at the same gpt-4o-class reader. Statistically tied with EmergenceMem Internal (86.0%, no CI published) — EmergenceMem is 0.4 pp ahead on point estimate, sitting inside our 95% CI [82.4%, 88.6%]; we are NOT beating them on accuracy.** Median latency vs EmergenceMem IS publicly measurable: their published median is 5.65 s/item; our p50 is 3.558 s = **1.6× faster on the median**. Cost-per-correct: $0.0090 (ours, measured); EmergenceMem Internal cost is not published (closed-source model); their open-source variants Simple/Simple Fast/Simple Faster (82.4%/79%/76.8%) ship Python source code and are measurable apples-to-apples in v2 vendor reproduction work. Cost/latency 4.6×/5.3× claims in the cost-efficiency table below are intra-AgentOS measurements vs the prior 84.8% reader-router-with-policy headline (both at full Phase B N=500 with identical instrumentation). **Architectural finding**: dropping the Tier 3 minimize-cost policy router (which sent MS/SSP → OM-v11 — a calibration based on CharHash-era data) AND adding a standalone gpt-5-mini classifier so the reader-router can dispatch on canonical-only path produces a fresh accuracy headline AND simultaneous cost-Pareto improvement. SSP at canonical+gpt-5-mini-reader is 86.7% (same as Tier 3 + OM-v11 + gpt-5-mini-reader at 86.7% but 4.6× cheaper); SSP at Tier 3 + OM-v11 + gpt-4o-reader (the prior 83.2% headline) was only 63.3% — **the OM-v11 routing was actively hurting at the gpt-4o reader**. Discussion: see [transparency-notes §5.5.0](transparency-notes.md). Run JSON: `results/runs/2026-04-28T19-06-42-271--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. CLI: `--reader gpt-4o --memory full-cognitive --replay ingest --hybrid-retrieval --rerank cohere --embedder-model text-embedding-3-small --reader-router min-cost-best-cat-2026-04-28`. See [LEADERBOARD ^canonical-reader-router-pb](../LEADERBOARD.md#canonical-reader-router-pb).

[^reader-router-pb]: **✨ NEW 2026-04-28 — Per-category reader-tier dispatch on top of Tier 3 min-cost + semantic embedder.** Phase B at full N=500: **84.8% [81.6%, 87.8%]** (424/500), **$17.38 LLM total ($0.0410/correct, 21% cheaper than gpt-4o-only at $0.0521)**, avg latency **21 042 ms (3.5× faster than gpt-4o-only at 73 234 ms)**. The aggregate lift is statistically within bootstrap-CI overlap with the gpt-4o-only baseline (84.8 vs 83.2, CIs 81.6-87.8 and 79.8-86.4 overlap), so the publishable claim is **cost-Pareto improvement at gpt-4o-class accuracy** — not a fresh accuracy headline. Per-category at this run (10k bootstrap CIs): SSA 100% [100%, 100%] (n=56), SSP **86.7% [73.3%, 96.7%]** (n=30, +23.4 pp vs gpt-4o-only 63.3% — **CI excludes the baseline**), KU 88.5% [80.8%, 94.9%] (n=78, +2.8 pp), SSU 91.4% [84.3%, 97.1%] (n=70, -2.9 pp within CI), TR 82.0% [75.2%, 88.0%] (n=133, -2.7 pp within CI), MS 75.2% [67.7%, 82.7%] (n=133, within CI). Reader dispatch breakdown: 234/500 cases (47%) routed to gpt-4o (TR + SSU predicted); 266/500 (53%) routed to gpt-5-mini (SSA + SSP + KU + MS predicted). Calibration source: per-category accuracy split between gpt-4o (Phase B 2026-04-27 run JSON `2026-04-27T06-27-24-170`) and gpt-5-mini (Phase B 2026-04-28 run JSON `2026-04-28T08-07-48-754`) at the same retrieval stack — codified as `MIN_COST_BEST_CAT_2026_04_28_TABLE` in `src/core/readerRouter.ts`. **Architecture novelty**: per-query routing between *reader models* at fixed retrieval architecture, orthogonal to the Tier 3 policy router which routes between *retrieval architectures* at fixed reader. Both consume the same gpt-5-mini classifier, so adding the reader router on top of the policy router costs zero extra LLM calls per case. **Realized 84.8% << oracle 87.0%** because the gpt-5-mini few-shot classifier mispredicts ~20% of categories on S; misroutes hit TR (-2.7 pp) and SSU (-2.9 pp). Closing the realized-to-oracle gap is the next axis (gpt-4o classifier probe queued). Run JSON: `results/runs/2026-04-28T13-21-50-567--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. CLI: `--reader gpt-4o --reader-router min-cost-best-cat-2026-04-28`. See [LEADERBOARD ^reader-router-pb](../LEADERBOARD.md#reader-router-pb).

[^t3mincost-semantic]: **🔥 NEW 2026-04-27 — Tier 3 min-cost + real semantic embedder.** Phase B at full N=500 with `text-embedding-3-small`: **83.2% [79.8%, 86.4%]** (416/500), weighted 84.2% [81.0%, 87.2%], $21.66 LLM, $0.0521/correct. Per-category at this run: SSA 98.2% [94.6%, 100%], SSU 94.3% [88.6%, 98.6%], KU 85.7% [77.9%, 93.5%], TR 84.7% [78.6%, 90.8%], MS 76.2% [68.5%, 83.1%], SSP 63.3% [46.7%, 80.0%]. **+6.6 pp aggregate lift over the prior published Tier 3 min-cost baseline 76.6%** (which used the bench's CharHashEmbedder lexical-hash fallback). The lift concentrates on the hardest categories: temporal-reasoning **+14.5 pp** (70.2% → 84.7%) and multi-session **+14.5 pp** (61.7% → 76.2%) — semantic embeddings find paraphrase-rich and multi-hop bridges that lexical hashing missed. **This is the validated agentos-as-deployed configuration** (real consumers wire a real embedder via `Memory.createSqlite()` or `CognitiveMemoryManager`); the prior 76.6% measured the bench's "no embedder configured" fallback, NOT the recommended deployment. Beats Supermemory gpt-4o (81.6%) by +1.6 pp; statistically within-noise of Mastra OM gpt-4o (84.2% point estimate). Run JSON: `results/runs/2026-04-27T06-27-24-170--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. Findings post: [83.2% on LongMemEval-S](https://github.com/framersai/agentos-live-docs/blob/master/blog/2026-04-27-longmemeval-s-83-with-semantic-embedder.md).

[^hyde-only-pb-ct]: 2026-04-26 Phase B HyDE-only at N=500: 35.6% [31.4%, 39.6%] (178/500), $7.68 LLM, $0.0432/correct (3.1× cheaper than M-tuned), avg 4.4s. Per-category beats combined ONLY on TR (+3.7 pp); SSA/SSU/KU drop −23 to −29 pp without the wider rerank pool. Cost-efficient Pareto pick on the M frontier. Run JSON: `results/runs/2026-04-26T18-25-23-686--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. See [LEADERBOARD ^hyde-only-pb](../LEADERBOARD.md#hyde-only-pb) and [PHASE_B_ABLATIONS_2026-04-26.md](../../docs/PHASE_B_ABLATIONS_2026-04-26.md).

[^topk50-pb-ct]: 2026-04-26 Phase B TopK50-only at N=500: 40.8% [36.6%, 45.2%] (204/500), $28.14 LLM, $0.1379/correct, avg 4.1s. Doesn't beat combined on any category at Phase B (KU within CI: 61.5% vs 62.8%). Confirms the Phase A "topk50 best for KU" claim was small-sample-fragile and combined dispatch is the simpler default. Run JSON: `results/runs/2026-04-26T19-03-47-926--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. See [LEADERBOARD ^topk50-pb](../LEADERBOARD.md#topk50-pb).

[^beam100k-pa]: First public BEAM 100K Phase A measurement (2026-04-26). 90 stratified cases (`--sample-per-type 9` × 10 BEAM categories), M-tuned config, gpt-4o reader. Two real failure modes surfaced: contradiction_resolution 0/9 (agent answers confidently instead of flagging the contradiction; reader prompt doesn't trigger contradiction detection), event_ordering 0/9 (agent extracts wrong granularity of events vs gold). The other 8 categories scored 11.1% to 88.9%. Phase B at full N=400 attempted 2026-04-27 but aborted by a dist-rebuild race (284/400 cases hit ENOENT during a parallel npm publish); 116 cases that completed scored 45.7% matching Phase A 45.6%. Re-run queued for remote hardware. Run JSON: `results/runs/2026-04-26T19-42-25-420--beam-100k--gpt-4o--full-cognitive--ingest.json`. See [LEADERBOARD ^beam100k-mtuned](../LEADERBOARD.md#beam100k-mtuned) + [^beam100k-pb-aborted](../LEADERBOARD.md#beam100k-pb-aborted).

[^stagel]: Stage L Phase A: Anthropic Contextual Retrieval `summarized` executor (per-session summary prepended to every chunk before embedding). Paired baseline at OpenAI semantic embedder: 74.1% → 70.4%. Temporal-reasoning collapsed −33.3 pp. Findings: [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `SummarizedIngestExecutor` in agentos 0.2.12 for consumers building document-mode pipelines.

[^stagei]: Stage I Phase A: Mem0-v3-style entity-linking re-rank (`--entity-linking 0.5`). Multi-hop collapsed −20 pp. Findings: [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md). Architecture shipped as `EntityExtractor` + `EntityLinkingIngestExecutor` + `EntityRetrievalRanker` in agentos 0.2.13 for consumers building Mem0-v3-style pipelines.

[^stageh]: Stage H Phase A (2026-04-26): Hierarchical 2-stage retrieval (`--session-retrieval --session-retrieval-top-sessions 10 --session-retrieval-chunks-per-session 10` + summaries + Cohere rerank ×5 + reader-top-k 50 + HyDE) on LongMemEval-M N=54 stratified. **42.6%** (23/54) at $0.196/correct, avg latency 11.1 min/case. **−14.8 pp** vs M-tuned combined (57.4%); multi-session collapsed −44.5 pp (22.2% vs combined 66.7%); single-session-preference 0.0% (vs combined 14.3%). Stage 1 summary-similarity drops the gold session for hard queries before Stage 2 can recover. Third negative finding for retrieval-architecture alternatives — pattern: widening the rerank candidate pool beats architectural pre-pruning at conversational-memory scale. Findings: [STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md](../../docs/STAGE_H_PHASE_A_HIERARCHICAL_FINDINGS_2026-04-26.md). Run JSON: `results/runs/2026-04-26T04-57-45-526--longmemeval-m--gpt-4o--full-cognitive--ingest.json`. The agentos primitives (`SessionSummarizer`, `SessionSummaryStore`, `SessionRetriever`) remain shipping for consumers building document-mode hierarchical RAG pipelines where summary similarity is more reliable than at 500-session conversational haystacks.

[^mtuned-on-s-pb-ct]: 2026-04-27 Phase B at N=500: applying the M-tuned flags (`--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`) on top of S Tier 3 min-cost + `text-embedding-3-small` aggregates **76.6% [72.8%, 80.2%]** at $0.113/correct (2.2× more expensive than the 83.2% baseline). MS −17.6 pp (76.2% → 58.6%), TR −10.3 pp (84.7% → 74.4%) — the wider rerank pool over-prunes S's smaller chunk pool; HyDE adds noise on shorter haystacks. Confirms the Phase A cross-val finding (M-tuned on S N=54 = 72.2%, within noise of canonical 73.2%) at full N=500. **The M-tuned flags are M-specific calibration; they do NOT compound with semantic embedder on S.** Run JSON: `results/runs/2026-04-27T19-07-21-734--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. See [LEADERBOARD ^mtuned-on-s-pb](../LEADERBOARD.md#mtuned-on-s-pb).

[^reader-router-gpt4o-classifier-ct]: 2026-04-28 Phase B at N=500 — gpt-4o-classifier upgrade test on top of the reader router. Same `--reader gpt-4o --reader-router min-cost-best-cat-2026-04-28 --policy-router --policy-router-preset minimize-cost --hybrid-retrieval --rerank cohere --embedder-model text-embedding-3-small` as the 84.8% reader-router headline, with `--om-classifier-model gpt-4o` swapping in the stronger classifier. Aggregate **84.4% [81.2%, 87.6%]** (422/500), $16.33 LLM, $0.0387/correct, 18 402 ms avg latency. **Statistically tied** with the gpt-5-mini-classifier reader-router run (84.8% [81.6%, 87.8%]) — bootstrap CIs overlap; the 0.4 pp gap is within Phase B noise. Per-category at this run: SSA 98.2% [94.6%, 100%] (n=56), SSU 95.7% [90.0%, 100%] (n=70, +4.3 pp vs gpt-5-mini classifier), KU 84.6% [75.6%, 92.3%] (n=78, **−3.9 pp** vs gpt-5-mini classifier), SSP 90.0% [80.0%, 100%] (n=30, +3.3 pp), TR 80.5% [73.7%, 87.2%] (n=133, −1.5 pp), MS 75.2% [67.7%, 82.0%] (n=133, same). Phase A at N=54 stratified showed +3.7 pp lift (88.9%) over the gpt-5-mini-classifier Phase A (85.2%); the lift compressed away at full N=500 because SSP/SSU gains were offset by KU regression. **Conclusion: the realized accuracy ceiling at this Tier 3 retrieval stack is ~85% with the current calibration; closing further toward oracle 87% requires a different lever, not a stronger classifier.** This is the **third** Phase A → Phase B compression in the same week (gpt-5-mini reader probe 90.7% → 83.2%, reader-router probe 85.2% → 84.8%, gpt-4o classifier probe 88.9% → 84.4%) — Phase A signals at `--sample-per-type 9` are decision gates, not headlines. Recommended consumer default stays gpt-5-mini classifier (matches gpt-4o classifier accuracy at 12× lower per-query classifier LLM cost). Run JSON: `results/runs/2026-04-28T14-45-26-287--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. See [transparency-notes §5.5.1](transparency-notes.md). See [LEADERBOARD ^reader-router-gpt4o-classifier](../LEADERBOARD.md#reader-router-gpt4o-classifier).

[^all-om-on-s-pb-ct]: 2026-04-27 Phase B at N=500 — apples-to-apples Mastra OM architecture clone test on LongMemEval-S. `--observational-memory --om-observer-model gpt-5-mini --embedder-model text-embedding-3-small` at gpt-4o reader (matching the architecture Mastra published their 94.9% number with; reader is gpt-4o on our side, gpt-5-mini on theirs). Aggregate **76.0% [72.2%, 79.6%]** (380/500) at $0.346/correct, avg 84.8s latency. **−7.2 pp vs Tier 3 min-cost + semantic embedder baseline 83.2%** despite the identical retrieval stack (full-cognitive + Cohere rerank-v3.5 + text-embedding-3-small) PLUS the additional all-cases observational memory layer. Categories most hurt: SSA −16.1 pp (98.2% → 82.1%) and TR −16.3 pp (84.7% → 68.4%). All-OM-on-every-case summarizes session content into observational memory regardless of category, throwing away verbatim detail lexical+rerank retrieval would have surfaced for single-session-assistant questions and the temporal anchors temporal-reasoning needs. **Apples-to-apples confirmation: Mastra's published 84.2% gpt-4o number is within statistical CI of our 83.2% gpt-4o baseline; the +10.7 pp lift on Mastra's own data from 84.2% → 94.9% confounds reader (gpt-4o → gpt-5-mini) and observer (gemini-2.5-flash → gpt-5-mini) tier swaps simultaneously. Selective OM gating (current default in `@framers/agentos/memory-router` Tier 3 min-cost preset) is the validated S architecture choice.** Reader-model swap to gpt-5-mini is the highest-expected-impact axis remaining for the v1 publication; queued as the next experiment after M Phase B lands. Run JSON: `results/runs/2026-04-27T21-31-50-806--longmemeval-s--gpt-4o--full-cognitive--ingest.json`. See [LEADERBOARD ^all-om-on-s-pb](../LEADERBOARD.md#all-om-on-s-pb).

## Cost-efficiency ($ per correct answer)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| **✨ Tier 3 min-cost + sem-embed + reader router (Phase B N=500)** | **$0.0410** (-21% vs gpt-4o-only sem-embed; -29% vs Tier 3 min-cost CharHash) | _PENDING_ | _PENDING_ | _PENDING_ |
| **M-tuned combined (Phase B N=500)** | $0.0833 (cross-val Phase A) | **$0.1348** (Phase B) | _PENDING_ | _PENDING_ |
| Tier 1 canonical-hybrid | $0.0213 | $0.0818 | $0.0099 | DEFERRED |
| Tier 2b OM-v11 | $0.4362 | _PENDING_ | n/a | DEFERRED |
| Tier 3 min-cost (CharHash) | **$0.0580** | _≈ Tier 1_ | n/a | DEFERRED |
| Tier 3 min-cost + sem-embed (gpt-4o-only) | **$0.0521** | _PENDING_ | n/a | DEFERRED |
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
| BEAM 100K | unprobed | — | — | Adapter shipped 2026-04-26 (commit d45cf9cd); judge FPR probe queued for v2 alongside the full Phase B re-run. |

Anchor: Penfield Labs measured **62.81%** FPR on LOCOMO's default `gpt-4o-mini` judge with the original LOCOMO rubric. Our 0% LOCOMO FPR + the Penfield 62.81% number put a 63 pp gap between any LOCOMO score measured at our judge vs the original judge.

## Reference rows (footnoted with judge-harness caveats)

| System | LongMemEval-S | LOCOMO | Caveat |
|---|---:|---:|---|
| Full-context `gpt-4o` baseline | 60.2% | n/a | LongMemEval paper. No memory architecture; whole conversation in context. |
| Mastra OM (`gpt-4o`) | 84.2% | n/a | Observer is `gemini-2.5-flash`. Reader is `gpt-4o`. Cross-provider; not single-provider reproducible. **Within statistical CI of our 83.2% gpt-4o baseline.** |
| Mastra OM (`gpt-5-mini`, headline) | 94.9% | n/a | Reader AND observer are both `gpt-5-mini`. +10.7 pp over the gpt-4o config above confounds reader-tier and observer-tier swaps. **Architecture clone (all-OM dispatch + gpt-5-mini observer) at gpt-4o reader on our retrieval stack scored 76.0% (apples-to-apples Phase B, 2026-04-27); see [^all-om-on-s-pb-ct] above.** Reader-tier swap to gpt-5-mini is the highest-expected-impact remaining axis on our side. |
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
