# Step 6 Findings — Split-on-Ambiguous (Rerank-as-Grader)

**Date:** 2026-04-20
**Scope:** new `--split-ambiguous` CLI flag + `splitAmbiguousThreshold` option on `HybridRetriever`. Reuses the existing Cohere rerank-v3.5 call: the bottom fraction of traces by first-pass rerank score are split at sentence boundaries, rescored with a second rerank call, and replaced by their better half ONLY IF the better half outscores the original.
**Spec:** [2026-04-20-step-6-split-on-ambiguous-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-6-split-on-ambiguous-design.md)
**Plan:** [2026-04-20-step-6-split-on-ambiguous.md](../../agentos/docs/superpowers/plans/2026-04-20-step-6-split-on-ambiguous.md)

---

## Verdict: RED

Tier A smoke on LongMemEval-S N=24 triggered the kill criterion. Tier B Phase A N=102 NOT executed per plan §7.4. Remaining Tier A runs (LOCOMO, Oracle) also skipped — the LME-S result was decisive.

| Cell | Configuration | LME-S N=24 unweighted | Δ vs Step 3 hybrid | Kill? |
|---|---|---:|---:|---|
| Hybrid + `--split-ambiguous 0.3` | combined | **58.3%** (14/24) | **-29.2pp** vs 87.5% | YES (threshold 82.5%) |

Single-smoke regression is catastrophic. Multi-session collapses to 0%, temporal to 50%, knowledge-update to 75%. Identical failure pattern to Steps 4 + 5 — destructive modification of retrieval output breaks reader performance.

The "monotonic" guarantee in the design turns out to be monotonic on the WRONG quantity.

---

## Tier A Cell — Hybrid + `--split-ambiguous 0.3` (N=24)

| Category | n | Accuracy | Step 3 Hybrid alone | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | -25pp |
| multi-session | 4 | **0.0%** | 75% | -75pp |
| single-session-assistant | 4 | 75.0% | 100% | -25pp |
| single-session-preference | 4 | 50.0% | 100% | -50pp |
| single-session-user | 4 | 100% | 100% | 0 |
| temporal-reasoning | 4 | 50.0% | 100% | -50pp |
| **Unweighted** | 24 | **58.3%** | 87.5% | **-29.2pp** |

Cost: $0.073 (24 cases). Cost/correct: $0.0052.

Every category except single-session-user regresses. Multi-session collapses completely — the same category Step 3 lifted 11.8pp.

---

## Why the monotonic guarantee failed

The design promised: *a trace's replacement half NEVER decreases the blended score because we only replace when `winningHalfNeural > originalNeural`.*

That guarantee holds only in rerank-score space. In practice:

1. **Rerank score ≠ reader utility.** Cohere `rerank-v3.5` scores by query-doc semantic alignment. A half-chunk focused on the most relevant sentences gets a HIGHER rerank score (higher concentration) but discards the contextual sentences the reader needs to CONSTRUCT an answer.
2. **Half-chunks lose bridging context.** For multi-session questions, the "hero fact" is often stated in one sentence and grounded in surrounding context. Cutting the trace in half may retain the hero sentence (boosting rerank score) while dropping the grounding context (destroying reader utility).
3. **Cognitive score stays the same but the content it validates no longer exists in the retrieved text.** The blended score rises, but the content is less useful — the blend is a mismatched composite.

In effect, Step 6 trusted rerank scores as a universal quality metric. Rerank is good AT WHAT IT DOES — ranking doc-query relevance. It is NOT a general quality metric for reader input.

Step 3's 0.7 cognitive + 0.3 neural blend works because it treats rerank as ONE signal averaged across others. Step 6 promoted rerank score to a decision-maker — which it isn't built to be.

---

## Step 3 vs Step 6: what actually changed

Step 3 Hybrid:
- Retrieves K traces.
- Each trace's full content goes to the reader.
- Rerank only reorders within the returned K.
- Reader has maximum information per trace.

Step 6 Hybrid + Split:
- Retrieves K traces.
- For bottom-30% (3 of 10 traces), content is replaced with a SHORTER half IF the half scores higher on rerank alone.
- Reader has LESS information per replaced trace.

The net effect: 3 of 10 retrieved traces now carry less text. If any of those 3 were needed for the answer (they often are — the bottom-30% is not "noise," it's "supporting evidence"), the reader lacks the context to answer correctly.

---

## The 6-step empirical pattern is now undeniable

| Step | Change | Verdict | Pattern |
|---|---|---|---|
| 1 | Infra (CI + judge probe) | GREEN | tooling, not retrieval |
| 2 | SessionRetriever (no rerank) | RED | missing signal |
| 3 | HybridRetriever (BM25 + rerank blend) | **GREEN-soft** | **additive signal** |
| 4 | HyDE (LLM rewrites query) | RED | LLM replaces query |
| 5 | FactSupersession (LLM drops traces) | RED | LLM drops traces |
| 6 | Split-on-Ambiguous (rerank trims traces) | **RED** | **rerank trims content** |

**Rule confirmed 3 ways:** anything that MODIFIES or REMOVES retrieval output on this workload regresses. Only ADDITIVE signal (BM25 alongside dense, rerank as a BLEND component) helps.

The design claimed Step 6 was "additive, not destructive" — but replacing content with a shorter version IS destructive to the reader, even if the rerank score is monotonic. The guarantee was on the wrong quantity.

---

## What ships

- **Code stays.** `HybridRetriever.splitAmbiguousThreshold` option + 3 unit tests + `refineAmbiguous` + `splitAtMidpointSentence` methods + `splitOnAmbiguous` diagnostic schema. Matched-ablation-correct. Opt-in, default-off.
- **Bench wiring:** `--split-ambiguous <n>` CLI flag + cache-key fingerprint + 2 integration tests + RunConfig schema extension.
- **Findings doc (this file).**

Code ships because (a) the infrastructure demonstrates the rerank-as-grader pattern as a general tool (could still apply in other regimes — e.g., open-domain docs where rerank and reader quality are better aligned), (b) the tests pin the monotonic guarantee in rerank-score space, and (c) deletion would lose the matched-ablation setup for future re-measurement on a different benchmark.

---

## What does NOT ship

- No production default flip. `--split-ambiguous` stays opt-in, default-off.
- No `CASE_RUN_SCHEMA_VERSION` bump.
- Tier B runs NOT executed.
- Remaining Tier A runs (LOCOMO, Oracle) NOT executed — one LME-S smoke was sufficient.

---

## Step 6 cost accounting

| Run | USD | Notes |
|---|---:|---|
| Tier A LME-S N=24 Hybrid + Split | $0.073 | single smoke |
| Remaining Tier A (LOCOMO, Oracle) | $0 | skipped per kill |
| Tier B runs | $0 | skipped per kill |
| **Total** | **$0.073** | Well under $3 cap |

---

## 6-step running cost + verdict scoreboard

| Step | Measurement cost | Verdict | Ships? |
|---|---:|---|---|
| 1 | $0.02 | GREEN | infra, always on |
| 2 | $0.30 | RED | opt-in |
| 3 | $0.40 | GREEN-soft | opt-in (production candidate) |
| 4 | $0.15 | RED | opt-in |
| 5 | $0.17 | RED | opt-in |
| 6 | $0.07 | RED | opt-in |
| **Total** | **~$1.11** | | |

Kill-criterion discipline saved roughly $5 across Steps 4-6 that would have otherwise been spent on Tier B runs for known-dead variants.

---

## Conclusion — the rollout's final verdict

**Step 3 HybridRetriever is the only shippable improvement from this 6-step investigation.** Confirmed GREEN-soft at Phase A N=102 with CI-gated 4 of 5 criteria met; strict 95% KU gate fell 1pp short.

Four RED results (Steps 2, 4, 5, 6) all follow one pattern: they modify or remove retrieval output. Steps 4, 5, 6 used progressively smarter mechanisms — query rewriting (Step 4), LLM trace filtering (Step 5), rerank-score-guarded content splitting (Step 6) — and all regressed. The investigation's conclusion:

> **On a signal-dense, specific-value benchmark like LongMemEval-S, retrieval modifications based on any SINGLE quality metric (embedding, LLM judgment, rerank score) will regress. Only ADDITIVE signal (blending multiple independent scores) helps.**

This is a publishable conclusion. The blog post should lead with Step 3's numbers (production-grade gain) and walk through the 4 negative results as empirical evidence for the additive-only pattern.

---

## Commits (Step 6)

agentos core (submodule):
- `42a2bf010` memory: HybridRetriever split-on-ambiguous rerank refinement (monotonic, additive) + 3 unit tests + diagnostic schema extension

Monorepo:
- `8a554a41fc` bench: RunConfig.splitAmbiguous + cache-key fingerprint + integration tests
- `5da78278c4` bench: --split-ambiguous CLI flag + entry.build passthrough
- `9ac14dbcaa` bench: LongMemEvalS threads splitAmbiguousThreshold into HybridRetriever
- `a82b8491d5` bench: Locomo adapter --split-ambiguous propagation

---

## Rollback

Not required. `--split-ambiguous` defaults off. Production retrieval unchanged from Step 3's GREEN-soft default.

If a future operator deletes the infrastructure:
- Revert the 5 commits listed above.
- Remove `splitAmbiguous?` from `RunConfig`.
- Remove `splitAmbiguousThreshold` from `HybridRetrieverOptions`.
- Remove `splitOnAmbiguous` optional field from `CognitiveRetrievalResult.diagnostics`.
- Remove `refineAmbiguous` + `splitAtMidpointSentence` methods on `HybridRetriever`.
- `CASE_RUN_SCHEMA_VERSION` stays `'v8'`.

---

## Recommendation

**The 6-step rollout is complete.** Stop here.

Next action: write the umbrella findings / blog post. The material:
- 1 production-grade gain (Step 3) with CI-backed evidence
- 4 negative results (Steps 2, 4, 5, 6) with controlled ablations and explanations
- 1 methodological win (Step 1 bootstrap CIs + judge-adversarial probe) that made the other 5 verdicts trustworthy

Total investment: ~$1.11 in measurement costs. Six matched-ablation studies. A robust empirical pattern about what works and what doesn't in memory-retrieval stacks on signal-dense benchmarks.
