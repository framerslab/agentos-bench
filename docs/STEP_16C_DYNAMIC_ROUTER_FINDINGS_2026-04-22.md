# Step 16c Findings — LLM-as-Judge Dynamic Router (baseline + v9 + v10)

**Date:** 2026-04-22 (runs landed late evening / early 2026-04-23 UTC)
**Scope:** Three Tier A experiments testing the v2 (Phase-A-grounded) dynamic router at N=24. Each varies one classifier dimension to isolate the bottleneck:

| Variant | Classifier model | Classifier prompt |
|---|---|---|
| baseline | gpt-5-mini | basic (CLASSIFIER_SYSTEM_PROMPT) |
| v9 | gpt-4o | basic |
| v10 | gpt-5-mini | few-shot (CLASSIFIER_SYSTEM_PROMPT_FEWSHOT) |

**Routing table (v2):** SSU/SSA/SSP/TR → canonical Step 3 HybridRetriever (no OM). KU/MS → v5 OM (gpt-4o observer + scaffold + dual-path). Grounded in v5 Phase A N=102 per-category bests.

---

## 1. Verdict

**RED at Tier A across all three variants.** Aggregate stuck in 62-67% range, none clear the 82% kill gate. Classifier accuracy improves with each variant (37.5% → 50% → 58.3%) but per-category small-N noise dominates the aggregate.

| Metric | baseline | v9 (gpt-4o cls) | **v10 (fewshot cls)** | v5 Tier A | Canonical N=500 |
|---|---:|---:|---:|---:|---:|
| Unweighted | 66.7% | 62.5% | **66.7%** | 79.2% | 73.2% |
| Cost | $12.48 | $9.78 | **$5.86** | $24.30 | $7.80 (N=500) |
| Cost/correct | $0.78 | $0.65 | **$0.37** | $1.28 | $0.021 (N=500) |
| Avg latency | 17s | 11s | **9s** | 46s | 98s |
| Classifier accuracy | 37.5% | 50% | **58.3%** | N/A | N/A |
| Cases routed to OM | 9/24 | 6/24 | 4/24 | 24/24 | 0/500 |

**Kill-gate check (all three variants fail):**
- Unweighted ≥ 82%: FAIL
- Multi-session ≥ 50%: PASS for baseline (50%), FAIL for v9 (25%) + v10 (25%)
- All single-session ≥ 90%: FAIL (SSP 50% across all variants; SSA 75% mostly)

---

## 2. Per-category breakdown

| Category | baseline | v9 | v10 | v5 Tier A | Canonical N=500 |
|---|---:|---:|---:|---:|---:|
| single-session-user | 100% | 100% (n=3, 1 errored) | **100%** | 100% | 97.1% |
| single-session-assistant | 75% | 75% | **75%** | 100% | 89.3% |
| single-session-preference | 50% | 50% | **50%** | 100% | 60.0% |
| knowledge-update | 75% | 75% | **75%** | 75% | 86.8% |
| **multi-session** | **50%** | **25%** | **25%** | 25% | 54.9% |
| temporal-reasoning | 50% | 75% | **75%** | 75% | 70.2% |

The TR improvement v10 vs baseline (50% → 75%) tracks classifier accuracy on TR specifically (TR was correctly classified 4/4 in all three variants — but the per-case pass rate depends on the route-architecture combination).

---

## 3. Classifier confusion analysis

### baseline (gpt-5-mini, basic prompt) — 37.5% accuracy

Major confusion patterns:
- **SSA → SSU (4/4)**: classifier defaulted to SSU; SSA routes to canonical anyway, so route-correct.
- **SSP → SSA (3/4)** + **SSP → MS (1/4)**: 3/4 routed correctly to canonical, 1/4 misrouted to OM.
- **MS → KU (2/4)** + **MS → SSU (1/4)** + **MS → MS (1/4)**: 3/4 routed to OM (correct), 1/4 to canonical (wrong).
- **TR → TR (4/4)**: 100% category-correct.

### v9 (gpt-4o, basic prompt) — 50% accuracy

Improvement on:
- **SSP → SSA (4/4)**: still SSA but consistent; route-correct (canonical).
- **SSA → SSU (2/4) + SSA → SSA (2/4)**: half got SSA right; route-correct either way.
- **MS → MS (2/4)**: classifier correctly identified 2/4 MS questions (vs 1/4 baseline).

Regression on:
- **KU → SSU (2/4)**: 2 KU misrouted to canonical (vs 1/4 baseline). KU at canonical scores marginally lower than at OM per Phase A (86.8% vs 88.2%).

### v10 (gpt-5-mini, few-shot prompt) — 58.3% accuracy

Strong improvement on:
- **SSU → SSU (4/4)**: 100% category-correct (was 2/4 baseline). The fewshot examples disambiguate SSU vs other categories.
- **SSA → SSA (3/4)**: 75% category-correct (was 0/4 baseline, 2/4 v9). The "USER said vs ASSISTANT said" contrastive pairs work.
- **MS → MS (3/4)**: 75% category-correct (was 1/4 baseline). The "combine across sessions" example pairs help.
- **TR → TR (4/4)**: maintained.

Persistent confusion:
- **SSP → SSU (2/4) + SSP → SSA (2/4)**: SSP still confused with single-session siblings. Both route to canonical; route-correct for all 4.
- **KU → SSU (3/4)**: KU still misclassified as SSU (canonical instead of OM). The "evolved across sessions" KU examples in fewshot didn't disambiguate from SSU.

---

## 4. Diagnosis: classifier improves but aggregate stuck

The architectural intuition is right — route-level accuracy is high (83% baseline, 71% v9, 83% v10) because the router only needs to pick canonical-vs-OM, not the precise category. But the aggregate is **bounded by the underlying canonical and OM per-category performance at N=24**, which fluctuates within ±25pp single-case-flip noise.

**Why v9's improved classifier accuracy didn't lift aggregate:** v9's gpt-4o classifier moved 3 KU/MS cases from OM to canonical compared to baseline. Per Phase A, the KU canonical-vs-OM gap is small (86.8% vs 88.2%) — but at N=24 single case flips matter. The "more accurate classifier" routed cases that happened to fail at canonical for this specific sample.

**Why v10's improved classifier accuracy didn't lift aggregate:** same dynamic. v10 routed 5 more cases to canonical than baseline (20 vs 15). If those happen to be hard-for-canonical cases, the aggregate doesn't move.

**The N=24 ceiling:** at this sample size with 4 cases per category, the bench can't distinguish 62.5% from 66.7% (CIs overlap massively). Three iterations at $28+ Tier A spend produced essentially identical aggregate signals. **N=24 has saturated useful signal for static-config Tier A iteration on 16c.**

---

## 5. Cost economics

v10 is dramatically cheaper than the baseline OR v5:

| Variant | Tier A cost | Notes |
|---|---:|---|
| v5 (OM-everywhere) | $24.30 | All 24 cases hit gpt-4o observer |
| baseline 16c | $12.48 | 9/24 cases hit OM, 15/24 canonical |
| v9 (gpt-4o classifier) | $9.78 | 6/24 OM, 17/24 canonical, +classifier cost |
| **v10 (fewshot prompt)** | **$5.86** | **4/24 OM, 20/24 canonical** — minimum-OM routing |

v10 is **76% cheaper than v5** at the same aggregate accuracy as baseline 16c. For production deployment where cost matters (every memory query), v10 is the right config IF v10's per-category profile holds at Phase A.

---

## 6. What ships

### 6.1 Code changes

- `src/observational-memory/questionRouter.ts`: `QuestionCategory`, `RouterConfig`, `classifyQuestion`, `routeQuestion`, `DEFAULT_ROUTE`, `CLASSIFIER_SYSTEM_PROMPT`, `CLASSIFIER_SYSTEM_PROMPT_FEWSHOT`.
- `src/core/IBenchmark.ts`: `omDynamicRouter`, `omClassifierModel`, `omClassifierFewshot` fields on RunConfig.
- `src/core/BenchmarkRunner.ts`: fingerprints `step-16c-router:v2`, `step-16c-classifier:{model}` (when overridden), `step-16c-classifier-fewshot:v1` (when on).
- `src/cli.ts`: `--om-dynamic-router`, `--om-classifier-model <model>`, `--om-classifier-fewshot` flags.
- `src/benchmarks/longmemeval/LongMemEvalS.ts`: pre-OM router decision, branches between canonical and OM paths, threads classifier model + fewshot opt through.

### 6.2 Tests

- `tests/observationalMemory.unit.spec.ts`: 11 new tests (3 classifier basic + 3 fewshot + 2 prompt-variant + 3 router).
- `tests/step15ObservationalMemory.wiring.spec.ts`: 8 new tests (5 router fingerprint + 3 classifier model fingerprint).
- All 357+ tests pass. Typecheck clean.

### 6.3 Operational artifacts

- `step-16c-router:v2` fingerprint isolates 16c cache buckets from prior steps.
- `step-16c-classifier:{model}` and `step-16c-classifier-fewshot:v1` tags enable cache-correct iteration on classifier dimensions.

---

## 7. What's next

### 7.1 Recommended: v11 (gpt-4o classifier + fewshot prompt)

Combines v9's better classifier model with v10's better prompt. Cheap test (~$15 Tier A). May push classifier accuracy to 65-75%. If it lifts aggregate above the noise floor (>72%), ladder to Phase A on v11.

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory --om-dynamic-router \
  --om-classifier-model gpt-4o --om-classifier-fewshot \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-observer-model gpt-4o --om-reader-scaffold \
  --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --max-usd 30
```

### 7.2 Alternative: Phase A on v10 directly (~$50-60 marginal)

v10 is the cheapest, best-classifier variant. Phase A would resolve the noise question. If 16c v10 lands ~73-75% at Phase A, that's tied with canonical. If ~78%+, that's a real architectural win.

### 7.3 Alternative: Step 17 (OM-guided retrieval, 4-6 hr code + ~$60)

The Step 16 family being RED suggested OM+retrieval can't be naively combined. Step 17 narrows retrieval to OM-identified candidate sessions only. Different from Step 16 because retrieval scope is bounded by OM. Could be the architectural fix that escapes the canonical ceiling.

### 7.4 Honest stopping point

If v11 doesn't clear the 72% Tier A signal, the rollout has exhausted the cheap-iteration space at gpt-4o reader. Two paths remain:
1. **Ship canonical (73.2% N=500) as Tier 1 + v5/v10 16c as Tier 2 opt-in.** Document the rollout. Move on.
2. **Invest in Step 17** as the next architectural swing.

---

## 8. Cost summary (this rollout)

| Experiment | Tier A cost | Cumulative |
|---|---:|---:|
| 16c baseline (gpt-5-mini, basic) | $12.48 | $12.48 |
| 16c v9 (gpt-4o classifier) | $9.78 | $22.26 |
| 16c v10 (gpt-5-mini, fewshot) | $5.86 | $28.12 |

Total 16c spend: ~$28. Within the cheapest Tier A iteration tier of the rollout.

---

## 9. Takeaways

### 9.1 Per-question routing works at the route level

Route accuracy 71-83% across all variants. The architectural idea — classify once, route to per-category-best — is sound.

### 9.2 N=24 saturates classifier-iteration signal

Three classifier variants spent ~$28 producing essentially identical aggregates. Future 16c iterations should ladder to Phase A directly.

### 9.3 Few-shot classifier prompt is a free Pareto improvement

v10 vs baseline: same aggregate, half the cost, better classifier accuracy. Few-shot disambiguating examples are strictly better than the basic prompt for this task.

### 9.4 gpt-4o classifier doesn't dominate gpt-5-mini

v10 (gpt-5-mini + fewshot) beat v9 (gpt-4o + basic) on classifier accuracy. The prompt variant matters more than the model class for this classification task. Confirms the prompt-engineering principle: well-crafted few-shot examples on a smaller model often beat zero-shot on a larger model.

### 9.5 The 16c family hasn't cleared the kill gate

At Tier A N=24, no 16c variant clears 82% unweighted. The architectural ceiling at Tier A appears to be ~67% for this routing approach. Phase A is required to know whether the ceiling rises or stays bounded.

---

## 10. Files + run JSONs

- baseline run: `results/runs/2026-04-23T02-32-14-184--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v9 run (gpt-4o classifier): `results/runs/2026-04-23T03-36-18-083--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- v10 run (fewshot): `results/runs/2026-04-23T03-39-58-051--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Spec v2: [docs/specs/2026-04-22-step-16c-llm-judge-router-design.md](specs/2026-04-22-step-16c-llm-judge-router-design.md)
- Plan v2: [docs/plans/2026-04-22-step-16c-plan.md](plans/2026-04-22-step-16c-plan.md)
- Source: [src/observational-memory/questionRouter.ts](../src/observational-memory/questionRouter.ts)

---

End of Step 16c findings.
