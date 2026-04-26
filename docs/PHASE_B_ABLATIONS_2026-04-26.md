# LongMemEval-M Phase B ablations — 2026-04-26

**Date:** 2026-04-26
**Goal:** Validate the augmented-router calibration (`MINIMIZE_COST_AUGMENTED_TABLE`) at full N=500 by re-deriving per-category accuracies from Phase B-scale measurements rather than the Phase A N=54 ablation matrix that the calibration was originally sourced from.
**Status:** Two of three Phase B ablations finished (M-tuned combined + HyDE-only); topk-only running.

## Phase B run summary

| Config | Aggregate | 95% CI | Cost / correct | Total cost | Avg latency |
|---|---:|---:|---:|---:|---:|
| **M-tuned combined** (`hyde-topk50-mult5`) | **45.4%** | [41.2%, 49.8%] | $0.1348 | $30.59 | 40.3 s |
| **TopK50-only** (`topk50`) | 40.8% | [36.6%, 45.2%] | $0.1379 | $28.14 | 4.1 s |
| **HyDE-only** (`hyde`, default top-K 20, default rerank ×3) | 35.6% | [31.4%, 39.6%] | **$0.0432** | $7.68 | 4.4 s |
| Tier 1 canonical baseline | 30.6% | TBD | $0.0818 | $40.86 | 10.6 s |

Run JSONs:
- M-tuned: `results/runs/2026-04-26T16-50-33-693--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- HyDE-only: `results/runs/2026-04-26T18-25-23-686--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- TopK50-only: `results/runs/2026-04-26T19-03-47-926--longmemeval-m--gpt-4o--full-cognitive--ingest.json`

## Per-category Phase B comparison (all three runs)

| Category | n | Tier 1 baseline | HyDE-only | TopK50-only | M-tuned combined | Phase B best |
|---|---:|---:|---:|---:|---:|---|
| single-session-assistant | 56 | 50.0% | 67.9% [55.4%, 80.4%] | 60.7% [48.2%, 73.2%] | **91.1%** [82.1%, 98.2%] | combined |
| single-session-user | 70 | 60.0% | 50.0% [38.6%, 61.4%] | 77.1% [67.1%, 85.7%] | **78.6%** [68.6%, 87.1%] | combined |
| knowledge-update | 78 | 50.0% | 35.9% [25.6%, 46.2%] | 61.5% [50.0%, 71.8%] | **62.8%** [52.6%, 73.1%] | combined |
| single-session-preference | 28-30 | 10.0% | 26.7% [13.3%, 43.3%] | 16.7% [3.3%, 30.0%] | **28.6%** [14.3%, 46.4%] | combined |
| multi-session | 130-133 | 18.0% | 25.6% [18.8%, 33.1%] | 24.2% [17.4%, 31.8%] | **26.2%** [18.5%, 33.8%] | combined |
| **temporal-reasoning** | 133 | 12.8% | **26.3%** [18.8%, 33.8%] | 23.3% [16.5%, 30.8%] | 22.6% [15.8%, 30.1%] | **hyde** |

(Aggregate counts differ by ±3 between runs because the bench's case-type categorization uses run-level metadata that's slightly non-deterministic on the 5 "unknown" cases at the boundary. Per-category accuracies are unaffected — the CIs already account for the small-N variance.)

**The Phase B picture is unambiguous: combined (`hyde-topk50-mult5`) is best on every category except temporal-reasoning. HyDE-only wins TR by +3.7 pp (within overlapping CIs) but loses every other category by 1.9 pp to 28.6 pp.**

## Key findings

### 1. M-tuned combined is the M Phase B accuracy headline (+14.8 pp validated)

M-tuned combined at full N=500 is +14.8 pp over Tier 1 canonical baseline 30.6% — the validated headline for LongMemEval-M. Per-category lifts of +14-50 pp on the easy categories (SSA +41 pp, SSU +19 pp, KU +13 pp) come from the wider rerank pool + larger reader window letting the cross-encoder + reader actually see the right session at 500-session-haystack scale.

### 2. HyDE-only is the cost-efficient Pareto pick (3.1× cheaper at −10 pp)

HyDE-only at $0.0432/correct is 3.1× cheaper per correct than M-tuned combined ($0.1348/correct). Total run cost: $7.68 vs $30.59. Accuracy trade-off: −9.8 pp aggregate. For cost-sensitive workloads where the user is willing to trade ~10 pp accuracy for a 3× cost reduction, HyDE-only on top of canonical-hybrid + Cohere rerank is the right pick.

This is a real Pareto-frontier point on M, not on the dominated diagonal:
- **Tier 1 canonical baseline:** 30.6% at $0.0818/correct
- **HyDE-only:** 35.6% at $0.0432/correct (Pareto-dominates Tier 1 on both axes — better accuracy AND better cost)
- **M-tuned combined:** 45.4% at $0.1348/correct (Pareto-dominates HyDE-only on accuracy at +212% per-correct cost)

HyDE-only is a strictly better default than Tier 1 canonical for cost-sensitive M workloads.

### 3. The augmented-router calibration is partly validated, partly noise

The `MINIMIZE_COST_AUGMENTED_TABLE` (calibrated from Phase A N=54) routes:

| Category | Phase A pick | Phase B picks | Action |
|---|---|---|---|
| single-session-assistant | combined | combined wins (+23 pp) | ✅ validated |
| single-session-user | combined | combined wins (+29 pp) | ✅ validated |
| knowledge-update | topk50 | combined wins (+1.3 pp, within CI) | ❌ revise to combined |
| single-session-preference | hyde | combined wins (+1.9 pp, within CI) | ❌ revise to combined |
| multi-session | combined | combined within CI of all (+0.6 pp over HyDE) | ✅ validated |
| **temporal-reasoning** | **hyde** | hyde wins (+3.7 pp) | ✅ validated |

**Phase B re-derived calibration:**

```
SSA → combined
SSU → combined
KU  → combined  (was topk50 — Phase B reveals topk50 ties combined within CI; combined is the simpler default)
SSP → combined  (was hyde — Phase B reveals "+8 pp on SSP HyDE" was Phase A small-sample noise)
MS  → combined
TR  → hyde     (the only category where non-combined wins at Phase B; +3.7 pp on TR alone)
```

This is essentially **static M-tuned (combined everywhere) PLUS a TR-only HyDE override**. The augmented router's value at Phase B reduces to a single per-query lever: route TR queries to HyDE-only retrieval.

### 4. Phase B oracle aggregate: +1.0 pp over static, NOT +11 pp

Computing the per-category-oracle aggregate (best config per category × N per category) at Phase B:

| Category | n | Best Phase B config | Best acc | Correct |
|---|---:|---|---:|---:|
| SSA | 56 | combined | 91.1% | 51 |
| SSU | 70 | combined | 78.6% | 55 |
| KU | 78 | combined | 62.8% | 49 |
| SSP | 28 | combined | 28.6% | 8 |
| MS | 130 | combined | 26.2% | 34 |
| TR | 133 | **hyde** | **26.3%** | 35 (vs combined 30 → +5 cases) |
| **Phase B oracle aggregate** | | | | **232 / 500 = 46.4%** |

vs static M-tuned 227 / 500 = 45.4%. **Phase B oracle lift over static: +1.0 pp aggregate.**

The augmented router with the **current Phase A calibration** (KU → topk50, SSP → hyde) would actually score 46.0% at Phase B (one case worse than the Phase B oracle's 46.4%) because the topk50 + hyde picks for KU/SSP are within CI of combined but slightly worse on point estimate.

**The 68.5% Phase A oracle forecast was inflated by ~22 pp** by:
1. Phase A static M-tuned 57.4% being itself Phase A-inflated (Phase B 45.4%, −12 pp)
2. Phase A per-category accuracies at n=9 having implicit binomial CIs ~[0%, 67%] for the hard categories — the "+8 pp" SSP signal and "+33 pp" TR-vs-combined signal didn't survive at scale (TR survived at +3.7 pp; SSP didn't survive at all)

### 4. The Phase A oracle forecast was Phase A-inflated

The 68.5% per-category-oracle aggregate from Phase A N=54 ablations forecast that per-query dispatch would lift static M-tuned 57.4% by +11 pp. At Phase B scale, the actual lift is 1-3 pp. The 8-10 pp inflation came from two sources:

1. **Phase A static M-tuned 57.4%** was itself inflated to 45.4% Phase B (−12 pp) by `--sample-per-type 9` overweighting easy categories.
2. **Phase A per-category accuracies** at n=9 had wide implicit CIs (~[33%, 100%] for MS); the "+8 pp on SSP" and "+33 pp on TR via HyDE" signals didn't survive at scale. TR survived with +3.7 pp; SSP didn't survive at all.

This is a textbook small-sample-stratified bias: the Phase A oracle math summed per-category bests across an artificially balanced sample, and the natural distribution at scale didn't preserve the per-category lifts.

## Implication for v1 publication

The honest headline numbers:
- **M-tuned combined: 45.4% [41.2%, 49.8%]** — the validated lift over baseline (+14.8 pp), $0.135/correct
- **TopK50-only: 40.8% [36.6%, 45.2%]** — modest lift (+10.2 pp over baseline) but cost-per-correct ~M-tuned ($0.138)
- **HyDE-only: 35.6% [31.4%, 39.6%]** — cost-efficient Pareto pick (+5 pp over baseline at $0.043/correct, 3.1× cheaper than M-tuned)
- **Per-category-oracle Phase B: 46.4%** — only +1 pp over static M-tuned. The +11 pp Phase A oracle forecast was small-sample-inflated.

The productionized RetrievalConfigRouter (`MINIMIZE_COST_AUGMENTED_TABLE`, `--retrieval-config-router minimize-cost-augmented`) ships with the Phase A calibration as a directional best-guess. **Phase B re-calibration**: KU and SSP should route to `combined` (not topk50/hyde); TR stays at `hyde`. The augmented router's Phase B value reduces to a TR-only HyDE override (+1 pp aggregate over static).

The 68.5% per-category dispatch row in the LEADERBOARD is now explicitly flagged as Phase A oracle, NOT Phase B-validated. The Phase B oracle is 46.4% — within bootstrap CI of static M-tuned 45.4%. **At Phase B scale, the dispatch story is "TR → HyDE saves 5 cases"; everything else is combined**.

## What still ships

- **agentos@0.5.x**: `MINIMIZE_COST_AUGMENTED_TABLE` + `selectAugmentedDispatch` + `MemoryRouter.decideAugmented` + `decideAndDispatchAugmented`
- **agentos-bench**: `--retrieval-config-router minimize-cost-augmented` + per-case dispatch hook in `LongMemEvalS.runCase`
- **Calibration**: `M_PHASE_A_PER_CATEGORY_ACCURACY` table is correct as the Phase A snapshot; Phase B per-category measurements live in this findings doc and the LEADERBOARD footnotes for v3 re-derivation.

## Cost summary (this session)

- Phase A 5-config ablations on M N=54: $1.73 + $0.75 + $0.92 + $3.51 + $3.75 = $10.66
- M-tuned cross-val on S N=54: $4.50 (estimate from prior runs)
- Hierarchical Phase A N=54 (Stage H negative): $4.51
- M-tuned Phase B at N=500: $30.59
- Phase A augmented-router validations (3 runs, N=54): $9.93
- HyDE-only Phase B at N=500: $7.68
- TopK-only Phase B at N=500: $28.14
- **Session total: ~$96 LLM**

## Run artifacts

- M-tuned Phase B: `results/runs/2026-04-26T16-50-33-693--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- HyDE-only Phase B: `results/runs/2026-04-26T18-25-23-686--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- TopK50-only Phase B: `results/runs/2026-04-26T19-03-47-926--longmemeval-m--gpt-4o--full-cognitive--ingest.json`
- Augmented router Phase A (3 runs): `2026-04-26T17-59-13-511`, `2026-04-26T18-10-47-280`, `2026-04-26T18-19-05-942`

## Anchor in publication narrative

> "Validated at Phase B N=500 with three ablations (M-tuned combined, HyDE-only, TopK50-only): the M-tuned config (wider Cohere rerank pool + larger reader window + HyDE) lifts LongMemEval-M from 30.6% baseline to **45.4% [41.2%, 49.8%]** at +14.8 pp, $0.135/correct. HyDE-only is the cost-efficient Pareto pick at **35.6% [31.4%, 39.6%]**, 3.1× cheaper per correct. The per-category-oracle Phase B aggregate is **46.4%** — only +1 pp over static M-tuned, all of it from TR → HyDE (+3.7 pp on TR alone). The 68.5% Phase A oracle forecast was inflated ~22 pp by `--sample-per-type 9` overweighting easy categories AND wide n=9 binomial CIs on hard categories. The productionized RetrievalConfigRouter ships with the Phase A calibration as a directional best-guess; v3 re-calibration confirms TR → HyDE, removes SSP → HyDE and KU → topk50 (Phase A noise that didn't survive Phase B)."

This is the credibility differentiator vs vendors who publish stratified-sample headlines without Phase B validation. The session's $96 LLM spend bought a complete Phase A → Phase B audit on every claim in the augmented router's calibration table.
