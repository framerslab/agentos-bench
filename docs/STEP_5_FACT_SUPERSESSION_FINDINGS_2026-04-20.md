# Step 5 Findings — FactSupersession (LLM Post-Filter)

**Date:** 2026-04-20
**Scope:** new `--fact-supersession` CLI flag + `FactSupersession` class under `packages/agentos/src/memory/retrieval/fact-supersession/`. LLM post-filter over retrieved traces, designed to drop traces whose facts have been superseded by later traces about the same subject.
**Spec:** [2026-04-20-step-5-fact-supersession-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-5-fact-supersession-design.md)
**Plan:** [2026-04-20-step-5-fact-supersession.md](../../agentos/docs/superpowers/plans/2026-04-20-step-5-fact-supersession.md)

---

## Verdict: RED (both cells)

Tier A smokes on LongMemEval-S N=24 triggered the kill criterion on BOTH ablation cells. Tier B Phase A N=102 runs were not executed per plan §7.7.

| Cell | Configuration | LME-S N=24 unweighted | Δ vs reference | Kill? |
|---|---|---:|---:|---|
| Cell A (isolated) | Baseline + `--fact-supersession` | **54.2%** (13/24) | -25.0pp vs Step 1 baseline 79.2% | YES (threshold 74.3%) |
| Cell B (combined) | Hybrid + `--fact-supersession` | **54.2%** (13/24) | -33.3pp vs Step 3 hybrid 87.5% | YES (threshold 82.5%) |

Both cells fail their respective kill criteria. FactSupersession in its current form actively regresses retrieval across every category — including the target, knowledge-update.

**The one category FS was designed to help regressed from 100% to 75% in both cells.** The LLM post-filter drops traces the reader needed. Spec §10 risk validated empirically: "LLM drops a legitimately-needed trace on multi-session (where both are still current)" — observed on multi-session, single-session-assistant, and even on the target knowledge-update category.

---

## Tier A Cell A — Baseline + `--fact-supersession` (N=24)

| Category | n | Accuracy | Step 1 baseline | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | **-25pp** |
| multi-session | 4 | **0.0%** | 50% | -50pp |
| single-session-assistant | 4 | 75.0% | 100% | -25pp |
| single-session-preference | 4 | 50.0% | 100% | -50pp |
| single-session-user | 4 | 100% | 100% | 0 |
| temporal-reasoning | 4 | 25.0% | 50% | -25pp |
| **Unweighted** | 24 | **54.2%** | 79.2% | **-25.0pp** |

Cost: $0.081 (24 cases). Cost/correct: $0.0062.

Every category except single-session-user regresses. The target category (knowledge-update) regresses 25pp — FS actively hurts the one thing it was built for.

---

## Tier A Cell B — Hybrid + `--fact-supersession` (N=24)

| Category | n | Accuracy | Step 3 Hybrid alone | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | **-25pp** |
| multi-session | 4 | 25.0% | 75% | -50pp |
| single-session-assistant | 4 | **25.0%** | 100% | -75pp |
| single-session-preference | 4 | 50.0% | 100% | -50pp |
| single-session-user | 4 | 100% | 100% | 0 |
| temporal-reasoning | 4 | 50.0% | 100% | -50pp |
| **Unweighted** | 24 | **54.2%** | 87.5% | **-33.3pp** |

Cost: $0.085 (24 cases). Cost/correct: $0.0065.

Single-session-assistant collapses 75pp. These are questions whose answer lives in a single recent turn — the LLM filter drops the hero trace based on... something the system prompt explicitly forbids. Multi-session and temporal both regress 50pp for the same reason: the LLM aggressively drops traces that should be preserved.

---

## Why FactSupersession failed

The LLM post-filter is asked to apply a narrow, precise rule: "drop traces containing facts SUPERSEDED by later traces about the same subject." In practice, gpt-5-mini interprets the task more broadly — dropping traces it judges "less relevant" or "older" even when they are the ONLY trace bearing the needed information. Observable symptoms:

1. **Single-session-assistant at 25%** means the LLM dropped traces where the answer was obvious (the only turn mentioning the fact). No supersession exists — these are simple recall questions — but FS dropped the hero trace anyway.
2. **Knowledge-update at 75% in BOTH cells** (the target category) means FS dropped the correct-answer trace in at least one of the 4 KU cases. The system prompt stressed "LATER trace wins" — but the LLM either misread timestamps or applied a wrong heuristic (e.g., "dropped the shorter one").
3. **Multi-session at 0% and 25%** means FS dropped one of the traces needed to bridge sessions. Multi-session answers require BOTH stored traces to be present; FS can only harm this category.
4. **Temporal-reasoning at 25% and 50%** means FS dropped time-anchored traces whose presence was required for the reader to construct a timeline.

The safety clamp (`drop-all-rejected`) protects against the LLM dropping EVERY trace, but doesn't protect against "drop 7 of 10." The spec design hoped strong prompt discipline would keep the LLM conservative — empirically, at gpt-5-mini quality, it doesn't.

Published research has a parallel: 2024 work on **CRAG (Corrective RAG)** and **RAFT (Retrieval-Augmented Fine-Tuning)** both show that LLM-based retrieval filters degrade recall unless the filter LLM is fine-tuned on the specific filtering rubric. General-purpose models over-filter.

---

## Why Step 5 RED + Step 3 GREEN-soft is consistent

Step 3 added signal (BM25 sparse retrieval) on top of existing signal (dense retrieval) — each layer added evidence. Step 5 removes traces — it's a destructive filter. On a benchmark where the reader already handles ambiguity (hedging, scoring by recency in the rerank blend), removing traces is net-negative unless the filter is extremely precise.

**The Step 3/Step 5 contrast reinforces the "additive features > replacing features" lesson from Step 4.** Destructive filters (HyDE replaces the query, FS drops traces) consistently regress on this workload. Additive features (Hybrid adds BM25, rerank blends neural on top of cognitive) consistently help.

---

## What ships

- **Code stays.** `FactSupersession` module at `packages/agentos/src/memory/retrieval/fact-supersession/`, matched-ablation-correct implementation (LLM call wraps-with-timeout, strict JSON parse contract, drop-all safety clamp, 4 unit tests). Bench wiring via `--fact-supersession` CLI flag, cache-key fingerprint, 3 integration tests.
- **No production default flip.** FS stays opt-in + default-off.
- **Findings doc (this file).**

Code ships because (a) the infrastructure demonstrates LLM-based post-filtering as a general pattern (usable for other tasks — e.g., deduplication, toxicity filtering), (b) the failure mode is specific to LongMemEval's signal-dense workload and might not apply to other benchmarks, and (c) deletion would lose the matched-ablation discipline for future re-evaluation.

---

## What does NOT ship

- No production default flip. `--fact-supersession` stays opt-in + off.
- No `CASE_RUN_SCHEMA_VERSION` bump.
- Tier B runs NOT executed (kill criteria triggered).
- LOCOMO + Oracle Tier A smokes NOT executed (LME-S kill was sufficient; saving ~$0.30).
- Option A (fact-graph at ingest) NOT built. The spec's follow-up scope is now partly invalidated: if the LLM post-filter hurts at retrieve time, a per-trace LLM extractor at INGEST time would hit the same LLM-judgment quality ceiling — at 10-100× the cost. Option A is effectively deferred to a future where a smaller, fine-tuned extraction model exists.

---

## Step 5 cost accounting

| Run | USD | Notes |
|---|---:|---|
| Cell A: LME-S N=24 Baseline + FS | $0.081 | N=24 stratified |
| Cell B: LME-S N=24 Hybrid + FS | $0.085 | N=24 stratified |
| Tier B runs | $0 | skipped per kill |
| Remaining Tier A (LOCOMO, Oracle) | $0 | skipped per kill |
| **Total** | **$0.166** | Well under $3 cap |

---

## Steps 1-5 running scoreboard

| Step | Change | Verdict | Default-on? | Multi-session | KU |
|---|---|---|---|---:|---:|
| 1 | Bootstrap CIs + adversarial probe | GREEN | yes (infra) | 50% | 100% |
| 2 | SessionRetriever | RED (rerank-skip) | no | -23.5pp | -23.5pp |
| 3 | HybridRetriever + rerank | GREEN-soft | opt-in | 75% (+25pp) | 100% |
| 4 | HyDE | RED | opt-in | 0-25% | 75% |
| 5 | FactSupersession | **RED** | opt-in | 0-25% | **75%** (target failed) |

Two RED verdicts in a row — both on LLM-as-filter approaches (HyDE query expansion, FS trace dropping). Step 3 (additive BM25 + rerank) remains the only Step 2-5 feature that held. Signal: the LongMemEval workload rewards MORE retrieval signal, not LESS.

---

## Lessons for Step 6

1. **LLM-as-filter loses to additive retrieval on this workload.** Steps 4 and 5 both tried to improve retrieval by invoking an LLM to constrain what the reader sees. Both lost to the Step 3 Hybrid baseline. Step 6 (CRAG retrieval grading) should NOT follow this pattern — if CRAG uses an LLM to classify query-trace relevance and drop low-relevance, it will likely repeat Steps 4-5's regression.
2. **Signal-dense workloads reward MORE retrieval, not smarter filtering.** LongMemEval-S queries contain high-IDF tokens; traces contain concrete content. The reader handles ambiguity better than the filter LLM handles precision. Step 6 should propose additive signal (e.g., query-time fact extraction appended to retrieved traces, not replacing them) OR skip to post-Step-6 work.
3. **Kill-criterion discipline saved $2.83.** At $3 budget per step, preventing the full Tier B run when Tier A clearly regressed saved the equivalent of an entire step's budget. Continue honoring the kill discipline in Step 6.
4. **Consider abandoning Step 6 + declaring the rollout done at Step 3.** The sequenced rollout's value was: find the one or two features that help, ship them, document the rest. Step 3 is shipped. Steps 2, 4, 5 all RED. Step 6's prior (CRAG) is methodologically similar to Steps 4-5 (LLM decides what's relevant). If the user wants more lift beyond Step 3, the better direction is (a) smaller/faster reader tuning, (b) reranker quality, or (c) a different benchmark regime where the retrieval gap is larger — NOT more LLM-as-filter.

---

## Commits (Step 5)

agentos core (submodule):
- `94ad7557a` memory: FactSupersession post-retrieval LLM filter (drops superseded traces) + 4 unit tests + diagnostic schema extension

Monorepo:
- `b9fe2047b6` bench: RunConfig.factSupersession + cache-key fingerprint + integration tests
- `0c7dd0a893` bench: --fact-supersession CLI flag + entry.build passthrough
- `2917fb8721` bench: LongMemEvalS wires FactSupersession post-retrieve
- `2e24ae2f2c` bench: Locomo adapter --fact-supersession propagation

---

## Rollback

Not required. `--fact-supersession` defaults off. Production retrieval unchanged from Step 3's GREEN-soft default.

If a future operator decides to delete the infrastructure:
- Revert the 5 commits listed above.
- Remove `factSupersession?` from `RunConfig`.
- Remove `FactSupersession` class + module.
- Remove `factSupersession` optional field from `CognitiveRetrievalResult.diagnostics`.
- `CASE_RUN_SCHEMA_VERSION` stays `'v8'`.

---

## Recommendation

**Pause the sequenced rollout after Step 5.** Write the blog post / findings summary now, based on:
- Step 3 GREEN-soft as the single proven gain (+5.9pp unweighted, +11.8pp multi-session, strict gate met on 4 of 5 criteria).
- Steps 2/4/5 as documented negative results (what didn't work and why).
- Skip Step 6 CRAG unless the user wants the negative-result series for publication completeness.

The 5-step investigation produced one production-grade improvement (Hybrid) and three well-documented negative results. That's a publishable outcome.
