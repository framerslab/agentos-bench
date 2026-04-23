# Step 16b Findings — Tighter Retrieval Top-K=3

**Date:** 2026-04-22
**Scope:** Step 16 architecture (v5 dual-path OM + scaffold + gpt-4o observer + HybridRetriever passages) with `--reader-top-k 3` instead of 10. Hypothesis: shrinking the retrieved-passage surface preserves the multi-session lift while reducing pollution on single-session and temporal categories.

**Baselines:**
- v5 (no retrieval): 79.2% Tier A (SSU/SSA/SSP all 100%, MS 25%, TR 75%, KU 75%).
- Step 16 K=10: 70.8% Tier A (SSU 75%, SSA 100%, SSP 75%, KU 75%, **MS 50%**, TR 50%).

**Kill gates (from spec §4):**
- Unweighted ≥ 82%.
- Multi-session ≥ 50%.
- All single-session ≥ 90%.

---

## 1. Verdict

**RED at Tier A.** 70.8% aggregate (17/24), CI [54.2%, 87.5%]. Identical aggregate to Step 16 K=10 but with a different per-category profile: K=3 recovered single-session-user (+25pp vs K=10) at the cost of multi-session (−25pp vs K=10, back to v5's 25%). Net delta vs v5: −8.4pp.

| Metric | v5 | Step 16 K=10 | **Step 16b K=3** | Δ vs v5 | Δ vs K=10 |
|---|---:|---:|---:|---:|---:|
| Unweighted | 79.2% | 70.8% | **70.8%** | −8.4pp | 0 |
| single-session-user | 100% | 75% | **100%** | 0 | **+25pp** |
| single-session-assistant | 100% | 100% | **100%** | 0 | 0 |
| single-session-preference | 100% | 75% | **75%** | **−25pp** | 0 |
| knowledge-update | 75% | 75% | **75%** | 0 | 0 |
| **multi-session** | **25%** | **50%** | **25%** | **0 (lost the lift)** | **−25pp** |
| temporal-reasoning | 75% | 50% | **50%** | **−25pp** | 0 |
| Tier A cost | $24.30 | $33.67 | **$32.66** | +$8.36 | −$1.01 |
| Avg latency | 46.0s | 55.7s | **56.9s** | +10.9s | +1.2s |

**Kill-gate check:**
- Unweighted ≥ 82%: **FAIL** (70.8%)
- Multi-session ≥ 50%: **FAIL** (25%)
- All single-session ≥ 90%: **FAIL** (SSP at 75%)

All three kill gates failed. Per the plan branch 2c, **Step 16 family is documented as architecturally dominated**: retrieval + OM combined cannot beat v5 alone for the gpt-4o reader at this scale.

---

## 2. Configuration

Run JSON: [results/runs/2026-04-22T23-59-38-121--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T23-59-38-121--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

| Flag | Value |
|---|---|
| `--om-mode` | `dual-path` |
| `--om-reader-scaffold` | on |
| `--om-observer-model` | `gpt-4o` |
| `--om-batch-tokens` | 24000 |
| `--om-with-retrieval` | on |
| `--rerank` | `cohere` |
| `--hybrid-retrieval` | on |
| `--context-summary` | `gpt-5-mini` |
| `--reader-top-k` | **3** (the only change vs Step 16) |

Cost-tracker per case: $1.36/case. Latency p50 51s, p95 75s.

---

## 3. Diagnosis: K-tuning cannot break the retrieval-pollution tradeoff

The hypothesis behind 16b was that K=10 polluted because most of the 10 passages were noise; K=3 would keep the 2-3 highest-relevance passages and drop the rest. That hypothesis is **falsified**.

### 3.1 What we expected vs what happened

| Category | Expected at K=3 | Observed at K=3 | Diagnosis |
|---|---|---|---|
| SSU | recover toward 100% | **100%** | as expected |
| SSP | recover toward 100% | **75%** (still down) | partial recovery; K=3 still surfaces 1-2 distractors |
| TR | recover toward 75% | **50%** (still down) | scaffold's chronology step still breaks on non-dated passages |
| KU | hold at 75% | **75%** | as expected |
| MS | hold at 50% (preserved) | **25%** (lost) | **K=3 doesn't carry enough cross-session passages** |

The MS regression from K=10 → K=3 is the load-bearing finding: **Step 16's multi-session lift came from passage VOLUME, not precision**. Cross-session questions need facts from 2+ separate sessions, each potentially in a different chunk. At K=10 the reader has enough surface area to find both. At K=3 the rerank focuses on the single most-relevant chunk and the second/third may still be from the same session.

### 3.2 The architectural tension

K-tuning trades MS for SSU/SSP/TR one-for-one:

```
K=10:  +MS 25pp, −SSU 25pp, −SSP 25pp, −TR 25pp  →  Σ −8.4pp vs v5
K=3:    0 MS,    0 SSU,     −SSP 25pp, −TR 25pp  →  Σ −8.4pp vs v5
```

Same aggregate. K-tuning is a wash. Both extremes lose ~one case in the same number of categories.

This is consistent with the empirical pattern from Steps 5, 7, 8, 9: **adding LLM-derived or retrieval-derived signal to a reader that already has a working observation log compresses recall**. The reader weights retrieved passages over OM synthesis even when the OM has the right answer (single-session) and lacks enough surface area to bridge sessions when retrieval is starved (multi-session).

### 3.3 Sampling considerations

At Tier A N=24 with 4 cases per category, each case flip is 25pp. The K=3 → K=10 deltas are 1-case flips. The "MS lost the lift" finding is a 1-case flip (1/4 → 1/4 but different specific case correct/wrong). Whether the lift is truly load-bearing at Phase A (n=17 per category, ±12pp CI) is unknown. The aggregate −8.4pp vs v5 is consistent across K=3 and K=10; that's the architectural signal.

### 3.4 Head-to-head vs v5

`pnpm bench compare` against v5 Tier A:
- 4 regressions: 1 SSP, 1 MS, 2 TR (each a case flip from correct → incorrect)
- 2 improvements: 1 MS, 1 TR (case flips the other way)
- Net: −2 cases, −8.4pp

Specific regressions (case IDs from run JSON):
- `71017276` temporal-reasoning: 1.0 → 0.0
- `75832dbd` single-session-preference: 1.0 → 0.0
- `b5ef892d` multi-session: 1.0 → 0.0
- `gpt4_f49edff3` temporal-reasoning: 1.0 → 0.0

---

## 4. What ships from Step 16b

Nothing new. The flag `--reader-top-k` has shipped since Step 1. No new code, no new tests, no new prompts. This was a pure measurement run.

`--om-with-retrieval` from Step 16 stays in the codebase as opt-in default-off. Documented as architecturally dominated by v5 across both K=10 and K=3 endpoints. Future work that wants to combine OM with retrieval needs scoped retrieval (Step 17 OM-guided retrieval) or per-question routing (Step 16c) rather than static stacking.

---

## 5. What's next: pivot away from Step 16 family

Step 16 family is RED at both K=10 and K=3. Three remaining swings:

### 5.1 v7: gpt-5 observer (queued, ~$50 Tier A)

Mastra's published 84.23% at gpt-4o reader uses **gemini-2.5-flash as observer**, not gpt-4o. We've tested gpt-5-mini observer (v1-v4: 75.0%) and gpt-4o observer (v5: 79.2%). Each tier upgrade gave +4pp. **gpt-5 (full) is the natural next rung and we have not tested it.**

Per primary-source verification (mastra.ai/research/observational-memory, Feb 2026), Mastra never tested gpt-5, gpt-5-mini, o1, o3, or o3-mini as observer. The "OpenAI capped at 79%" claim in earlier handoffs is not validated by published evidence.

Flag swap only: `--om-observer-model gpt-5` on top of v5 config. Zero code. ~$50 Tier A (gpt-5 pricing is roughly 2-3x gpt-4o; max-usd cap 80).

If v7 lifts +3-5pp aggregate it lands at 82-84%, neighborhood of Mastra at gpt-4o reader. This is the cheapest swing at closing the Mastra gap without vendor lock-in.

### 5.2 Step 17: OM-guided retrieval (deferred, 4-6 hr code)

Use the OM observation log to identify candidate sessions for the question, then run HybridRetriever scoped to those sessions only. Different from Step 16 because retrieval scope narrows from the full corpus to ~2-5 sessions identified by OM as relevant.

Single-session: OM picks 1 session, retrieval returns chunks from that session only, no cross-session distractors → SSU/SSP/SSA stay at 100%.

Multi-session: OM picks 2-3 sessions, retrieval returns top-K chunks from the union, all chunks are cross-session-relevant → MS lifts without pollution.

Temporal: OM picks the time-anchored sessions, retrieval respects the scaffold's chronology step → TR holds.

Estimated lift: +5-10pp aggregate over v5, primarily from MS recovery without single-session loss.

### 5.3 Step 16c: dynamic router (less compelling now)

Per-question classifier routes between v5 (single-session, temporal) and Step 16 (multi-session). With Step 16 family now RED at both K endpoints, the routing table has no good MS config. Step 16c's ceiling is bounded by v5 + small classification gains. Defer until v7 and Step 17 are explored.

### 5.4 Phase A on v5 (after observer-tier mapping)

Once v7 (and possibly Step 17) Tier A results are in, Phase A N=102 on the winner ($80-120 marginal depending on cache hits). Gates per umbrella §5: paired McNemar p < 0.05 vs canonical, point estimate ≥ 78.2%. Phase B N=500 only on explicit user approval.

---

## 6. Cost

| Experiment | Tier A cost | Cases | Cost/case | Cost/correct |
|---|---:|---:|---:|---:|
| v5 baseline | $24.30 | 24 | $1.01 | $1.28 |
| Step 16 K=10 | $33.67 | 24 | $1.40 | $1.98 |
| **Step 16b K=3** | **$32.66** | **24** | **$1.36** | **$1.92** |

K=3 is roughly the same cost as K=10. Cohere rerank cost scales with the number of candidates passed in (over-fetch is K=30 in both cases); only the final slicing differs. Not a cost-driven choice.

Cumulative session spend through Step 16b: ~$228 (~$195 prior + $33 16b).

---

## 7. Takeaways

### 7.1 K-tuning cannot break the OM+retrieval tradeoff

K=3 and K=10 converge to the same aggregate (70.8%) with different category distributions. Whatever K does, it reshuffles the same aggregate loss across categories. The retrieval-pollution surface and the cross-session passage-volume requirement push in opposite directions; tuning K trades them but doesn't escape.

### 7.2 Multi-session lift in Step 16 was volume, not precision

Cross-session questions need facts from 2+ sessions each in different chunks. Top-3 reranked passages tend to cluster in the most-relevant single session. K=10 surfaces 2-3 cross-session chunks because it casts a wider net; K=3 doesn't.

### 7.3 The Step 16 family is dead in static form

Both K=10 and K=3 are dominated by v5. Future OM+retrieval combinations need either dynamic routing (16c, less compelling now) or scoped retrieval (Step 17, the architectural fix).

### 7.4 The "OpenAI ceiling" is unverified

The handoff inherited the claim that OpenAI is capped at ~79% for OM observer because Mastra reaches 84% with gemini-2.5-flash. Verification via primary source (deep-research, 2026-04-22 session) shows Mastra never tested gpt-5, gpt-5-mini, o1, o3, or o3-mini as observer. v7 (gpt-5 observer) is the cheap swing that may close the Mastra gap entirely without changing architecture or accepting Gemini.

### 7.5 Kill-gate discipline saved a Phase B miss

$33 spent at Tier A to invalidate Step 16b. Ladder to Phase A would have cost ~$80 marginal, Phase B ~$700. The per-Step kill discipline continues to be the load-bearing methodology contribution of this rollout.

---

## 8. Files + run JSON

- Run JSON: [results/runs/2026-04-22T23-59-38-121--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T23-59-38-121--longmemeval-s--gpt-4o--full-cognitive--ingest.json)
- Spec: [docs/specs/2026-04-22-step-16b-tighter-retrieval-topk-design.md](specs/2026-04-22-step-16b-tighter-retrieval-topk-design.md)
- Plan: [docs/plans/2026-04-22-step-16b-plan.md](plans/2026-04-22-step-16b-plan.md)
- Step 16 K=10 reference: [STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md](STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md)
- v5 baseline: [STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md](STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md)

---

End of Step 16b findings.
