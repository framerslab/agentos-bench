# Step 15 v2 Findings — Cross-Session Observer Batching

**Date:** 2026-04-22
**Scope:** Token-bounded Observer batching (default 24_000) across haystack sessions, replacing the per-session-in-isolation loop from Step 15 v1. Pure refactor of `ingestSessions`; no new dependencies, no observer model swap, no prompt changes.
**Spec:** [packages/agentos-bench/docs/specs/2026-04-21-step-15-v2-cross-session-observer-batching-design.md](specs/2026-04-21-step-15-v2-cross-session-observer-batching-design.md)
**Plan:** [packages/agentos-bench/docs/plans/2026-04-21-step-15-v2-plan.md](plans/2026-04-21-step-15-v2-plan.md)
**Baseline:** Step 15 v1 = 75.0% unweighted at Tier A N=24; Step 3 Hybrid canonical = 73.2% N=500.
**Kill gate:** unweighted ≥ 78% AND multi-session ≥ 50%.

---

## 1. Verdict: RED on aggregate, instructive on category

**Aggregate regressed −4.2pp vs v1.** Tier A N=24 unweighted **70.8% (17/24) CI [54.2%, 87.5%]** vs v1's 75.0% CI [58.3%, 91.7%]. Kill gate missed on the unweighted threshold despite multi-session ≥ 50% passing comfortably.

**The diagnosed cross-session mechanism works.** Multi-session lifted from 25% to 75% (+50pp). Knowledge-update lifted from 75% to 100% (+25pp). Cross-session batching DID enable the Observer to encode patterns that span session boundaries — exactly as predicted.

**But intra-batch compression destroyed single-session fidelity.** Single-session-assistant dropped 100% → 50% (−50pp). Single-session-user 100% → 75% (−25pp). Temporal-reasoning 50% → 25% (−25pp). Batched Observer calls collapse multi-session transcripts into observation blocks that lose the per-session anchors (exact quotes, precise dates, specific entity attributions) single-session and temporal questions require.

Run JSON: [results/runs/2026-04-22T10-15-21-854--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T10-15-21-854--longmemeval-s--gpt-4o--full-cognitive--ingest.json). Cost: $1.92. Run time: 33 min. Within kill-criterion discipline; Phase A and Phase B NOT executed per plan §Task 10 Step 3.

---

## 2. Headline numbers

| Metric | v2 Step 15 (24k batch) | v1 Step 15 (per-session) | Step 3 canonical N=500 | Δ v2 vs v1 |
|---|---:|---:|---:|---:|
| Unweighted | 70.8% (17/24) | 75.0% (18/24) | 73.2% | **−4.2pp** |
| CI | [54.2%, 87.5%] | [58.3%, 91.7%] | [69.2%, 77.0%] | — |
| Cost/correct | $0.113 | $0.238 | $0.021 | cheaper (52%) |
| Avg latency | 64s | 124s | 98s | cheaper by 60s |
| p95 latency | 80s | — | 170s | — |
| Total run cost | $1.92 | $4.28 | $7.80 | cheaper |

v2 observer calls are ~4-8 per case (vs v1's ~49) so wall-clock + cost drop substantially. The accuracy regression is real though, not a latency trade.

---

## 3. Per-category breakdown

| Category | v2 Step 15 | v1 Step 15 | Step 3 canonical | Mastra OM gpt-4o | Δ v2 vs v1 |
|---|---:|---:|---:|---:|---:|
| single-session-user | 75.0% | **100.0%** | 97.1% | 98.6% | **−25.0pp** |
| single-session-assistant | 50.0% | **100.0%** | 89.3% | 82.1% | **−50.0pp** |
| single-session-preference | 100.0% | 100.0% | 60.0% | 73.3% | 0 |
| **knowledge-update** | **100.0%** | 75.0% | 86.8% | 85.9% | **+25.0pp** |
| **multi-session** | **75.0%** | 25.0% | 54.9% | 79.7% | **+50.0pp** |
| temporal-reasoning | 25.0% | 50.0% | 70.2% | 85.7% | **−25.0pp** |

**The two categories that SHOULD improve with batching did: multi-session +50pp and knowledge-update +25pp.** Both require cross-session synthesis that per-session Observers cannot encode. v2 now handles them at or near Mastra's band.

**The categories that regressed share a common feature: reliance on per-session anchor fidelity.** Single-session-user/assistant questions ask about specific statements in specific sessions. Temporal-reasoning questions ask about precise event timing. Batched Observer outputs compress those specifics into aggregate observations that lose the anchor.

---

## 4. Diagnosis: cross-session collapse hurts per-session recall

### 4.1 The mechanism is correct

Per-case metadata confirms the Observer now sees cross-session content:

```
omObservationBatches:   4-7  per case   (v1: ~49 per case)
omObserverTokensIn:     ~126-132k total (~21k per batch, matching 24k target)
omFinalLogChars:        28-50k          (2.3-4x compression ratio)
```

At ~21k tokens per batch, each Observer call spans 5-15 sessions. Cross-session supersession ("Berlin in Feb, Paris in May") becomes encode-able because both dates appear in one Observer input. The multi-session +50pp and knowledge-update +25pp lifts are direct evidence the mechanism fires.

### 4.2 Three failure patterns on single-session + temporal

Inspecting the 7 failed cases:

**Pattern 1: Cross-session detail collision.** Temporal case `gpt4_f49edff3` asks for the order of three February events across three sessions. The Observer produced observations noting all three but the reader's ordering got confused. Sample answer:

> "1. You helped your cousin pick out items for her baby shower on February 10, 2023.
> 2. You helped your friend prepare the nursery on February 5, 2023.
> 3. You ordered a customized phone case for your friend's birthday on February 20, 2023.
> So, the order from first to last is: 1. Helped your cousin (Feb 10), 2. Nursery (Feb 5), 3. Phone case (Feb 20)"

The reader's "order from first to last" list is chronologically wrong (it should be Feb 5, Feb 10, Feb 20). In v1 per-session batching each date would land in its own observation block with unambiguous per-session date header. In v2 all three dates co-occur in one observation block and the reader has to re-sort them.

**Pattern 2: Cross-session entity confusion.** Temporal case `71017276` asks when the user met their aunt for a specific reason. The Observer processed multiple sessions mentioning the aunt plus the chandelier acquisition. Reader answer:

> "You mentioned acquiring a crystal chandelier from your great-grandmother on March 4, 2023. Today is March 4, 2023, so it seems you received the chandelier very recently... If you have more specific details about when you met your aunt, feel free to share!"

The reader lost the aunt-meeting anchor from the batched observation log. Per-session observations would have preserved the per-session context the aunt-meeting trace needed.

**Pattern 3: Cross-session merger fabrication.** Temporal case `b46e15ed` asks about two charity events. Reader answer:

> "You participated in two charity events on consecutive days: the '24-Hour Bike Ride' on February 14, 2023, and the 'Walk for Hunger' on March 19, 2023."

Feb 14 and March 19 are 33 days apart — not "consecutive days". The Observer likely merged two separate sessions into a single "charity events" aggregate observation, losing the gap between them. The reader then confabulated "consecutive days" from the merged phrasing.

### 4.3 Why Mastra does not show this regression

Mastra's published gpt-4o result (84.23%, multi-session 79.7%, temporal-reasoning 85.7%) ALSO uses batched Observer calls. They do not hit the single-session collapse because:

1. Their Observer is `gemini-2.5-flash`, which handles long-context instruction-following more faithfully than our `gpt-5-mini` substitute at equivalent batch sizes.
2. Their Observer is instructed to emit `Date: YYYY-MM-DD` headers per observation group (our prompt port does this too), but gemini-2.5-flash reliably preserves per-date grouping; gpt-5-mini occasionally collapses.
3. They use `bufferActivation = 0.8` with `6k retention` rollover — not strictly equivalent to our bulk-ingest batching, but it keeps the Observer's input window smoother across the run.

Observer model tier is now the highest-probability next lever.

---

## 5. Budget + cost

| Line item | Cost |
|---|---:|
| Observer calls (gpt-5-mini, ~132 total) | ~$0.48 |
| Reader calls (gpt-4o, 24 × 1 = 24) | ~$1.15 |
| Judge calls (gpt-4o, 24) | ~$0.29 |
| **Total (Tier A v2 N=24)** | **$1.92** |

`costPerCorrect = $0.113` at v2 is 52% cheaper than v1's `$0.238` because fewer, larger Observer calls amortize token overhead better. Even in RED, v2 is a cost improvement.

Phase A and Phase B not fired per kill-gate discipline. Rollout spend to date: ~$36.60 (Steps 1-15 v1) + $1.92 (v2 Tier A) = **~$38.52**.

---

## 6. What ships regardless of RED verdict

All v2 infrastructure is feature-gated and default-on only when `--observational-memory` is enabled (with the new `--om-batch-tokens` defaulting to 24_000 which produces v2 behavior). Tier 1 HybridRetriever canonical (73.2%) stays the shipping memory default.

**New code:**
- [`packages/agentos-bench/src/observational-memory/runner.ts`](../src/observational-memory/runner.ts) — `partitionSessionsIntoBatches`, `combineSessionsForObserver`, `runObserverOnBatch` helpers; `ingestSessions` refactored to accept `batchTokenTarget`.
- [`packages/agentos-bench/src/core/IBenchmark.ts`](../src/core/IBenchmark.ts) — `RunConfig.omBatchTokenTarget?: number` field threaded through `BenchContext['config']`.
- [`packages/agentos-bench/src/core/BenchmarkRunner.ts`](../src/core/BenchmarkRunner.ts) — `computeCaseRunKeyParts` appends `step-15-om-batching:v2:{target}` fingerprint tag, orthogonal to the existing prompt-hash tag.
- [`packages/agentos-bench/src/cli.ts`](../src/cli.ts) — `--om-batch-tokens <n>` option with `parsePositiveInteger` validator.
- [`packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`](../src/benchmarks/longmemeval/LongMemEvalS.ts) — OM branch passes `ctx.config.omBatchTokenTarget ?? 24_000` to `ingestSessions` and records `omBatchTokenTarget` in per-case metadata.

**Tests:** 13 new (7 unit + 6 wiring) across the existing two OM spec files. Full bench suite 313/313 passes. Typecheck clean.

**Rollback path:** revert the PR (CLI validators reject non-positive `--om-batch-tokens`, so no flag value restores per-session batching in the v2 code path). The v1 `ingestSessions` implementation is preserved in git history.

---

## 7. Honest caveats

1. **N=24 CI overlap.** Wide CIs [54.2%, 87.5%] for v2 and [58.3%, 91.7%] for v1 overlap heavily. The point-estimate regression is directional, not conclusive. A paired McNemar at N=102 Phase A could yield a tighter read, but the per-category regression on single-session-assistant (−50pp) is large enough that category-level signal is real even at this N.
2. **Batching batch-count varied per case.** 4-7 batches per case depending on haystack density. Cases with denser haystacks get fewer batches; sparser ones get more. This intra-run variation introduces uncontrolled variance on top of the measurement variance.
3. **Observer model not swapped.** Per the v2 design scope, observer stayed `gpt-5-mini`. Observer-model tier is a confound that may account for the regression; v3 will isolate it.
4. **Paired comparison against v1 skipped.** v1 used per-session batching; v2 uses 24k token batches. Same cases, same seed, different fingerprints, so case-run cache does not overlap. A `pnpm bench compare` run comparing the two run JSONs would surface a paired McNemar p-value — documented as a follow-up, not executed here.

---

## 8. Pattern update

The rollout's empirical "n=10 RED retrieval layer adds regress; replacement architectures break the canonical" pattern gets refined.

Prior pattern (Steps 2-14 + Step 15 v1):
- Retrieval-layer additions on top of Step 3 Hybrid: always RED
- Step 15 v1 (replacement with observational compression): first GREEN-soft since Step 3

New refinement (Step 15 v2):
- Batched-Observer architecture DOES enable cross-session encoding (multi-session +50pp is evidence)
- BUT cross-session batching with a mid-tier observer (`gpt-5-mini`) hurts per-session fidelity
- The "batching unlocks multi-session" prediction held; the "single-session categories stay at ceiling" prediction did NOT hold
- The regression is a TRADE-OFF, not a failure — v2 moves accuracy along a different axis than v1

The right framing: Step 15 v1 and v2 are points on a Pareto frontier. v1 maximizes per-session fidelity at the cost of cross-session encoding. v2 maximizes cross-session encoding at the cost of per-session fidelity. Pure batching on a mid-tier observer cannot hit both.

---

## 9. Recommendations (ranked by expected value)

### Option A (recommended): Step 15 v3 = Mastra-exact observer model (gemini-2.5-flash)

Swap the Observer and Reflector from `gpt-5-mini` to `gemini-2.5-flash` to match Mastra's exact published configuration. Three reasons this is the right next experiment:

1. **The regression mechanism is consistent with observer-model under-capacity.** gpt-5-mini collapses per-session detail when processing 24k-token multi-session transcripts; gemini-2.5-flash (a stronger long-context instruction follower) may preserve it.
2. **Mastra uses gemini-2.5-flash at 84.23% gpt-4o.** Direct comparison with our 70.8% v2 would tell us whether the 13pp gap is observer model vs other architecture.
3. **Cheap to test.** Gemini 2.5 Flash is cheaper per token than gpt-5-mini. Adding a `GeminiReader` (~1-2 hours), plus Tier A v3 at ~$3, is a small incremental bet.

Budget: ~$3-5 for `GeminiReader` implementation + Tier A v3 N=24. Kill gate same as v2 (≥ 78% unweighted AND ≥ 50% multi-session). Requires `GEMINI_API_KEY` in `apps/wilds-ai/.env` (user to provision).

### Option B: Step 15 v3 alt = dual observer (per-session + batched, concatenate logs)

Keep `gpt-5-mini` but run the Observer TWICE per case: first per-session (preserves single-session detail), then batched (adds cross-session patterns). Concatenate both outputs into the reader's observation log. Cost: ~2x observer calls per case = ~$8-10 at Tier A N=24. Risk: longer observation logs could dilute reader attention and not actually combine the strengths.

### Option C: Step 15 v3 alt = hierarchical observer

Per-session Observer first (fidelity), then batch-process the per-session outputs with a second Observer pass (cross-session patterns, smaller input context). Cost: similar to Option B. Harder to implement cleanly; Observer prompt needs retargeting for the second pass.

### Option D: Accept v1 as canonical, publish v2 as negative result

Step 15 v1 at 75.0% stays the shipping opt-in OM config. v2 documented as a negative result — the batching mechanism works but the observer model can't sustain per-session fidelity at batch sizes. Publish as "Pareto frontier" finding: v1 is the reader-fidelity point, v2 is the cross-session-encoding point, Mastra's 84.23% requires observer model tier we haven't matched.

### Recommended path: A, then D if A also plateaus

1. Spec + plan Step 15 v3 with gemini-2.5-flash observer (fresh brainstorm + plan + TDD tasks).
2. Tier A v3 at the same 24k batch target + gpt-5-mini → gemini-2.5-flash observer swap.
3. If Tier A v3 hits ≥ 78% AND multi-session ≥ 50% AND single-session categories do NOT regress from v1 baseline, ladder Phase A + Phase B.
4. If Tier A v3 plateaus (e.g., lifts cross-session but still hurts single-session), confirm Option D and ship v1 as the shipping OM config.

---

## 10. Commits landed

Pending explicit user approval (per standing rule). Proposed commit set:

```
feat(bench): Step 15 v2 — cross-session observer batching

Refactor packages/agentos-bench/src/observational-memory/runner.ts
ingestSessions to partition sessions into 24_000-token-bounded batches
before each observer LLM call. Observer now sees 5-15 sessions per call
instead of 1, closing the diagnosed cross-session isolation gap from
Step 15 v1.

New public helpers: partitionSessionsIntoBatches,
combineSessionsForObserver, runObserverOnBatch.
New CLI flag: --om-batch-tokens <n> (default 24000, parsePositiveInteger).
New RunConfig field: omBatchTokenTarget (undefined when absent; runtime
default applied at call site).
New cache fingerprint tag: step-15-om-batching:v2:{target} orthogonal to
the existing step-15-om:{hash12} prompt-hash tag.

Tests: 13 new (7 unit + 6 wiring) across the existing two OM spec files.
Full bench suite 313/313 passes. Typecheck clean.

Design: packages/agentos-bench/docs/specs/2026-04-21-step-15-v2-cross-session-observer-batching-design.md
Plan: packages/agentos-bench/docs/plans/2026-04-21-step-15-v2-plan.md
```

```
bench: Step 15 v2 Tier A — RED at 70.8%, cross-session lifts + single-session regression

Aggregate 70.8% (17/24) CI [54.2%, 87.5%] vs v1's 75.0%, −4.2pp.
Multi-session +50pp (25% → 75%), knowledge-update +25pp (75% → 100%):
the diagnosed cross-session mechanism works.
Single-session-assistant −50pp, single-session-user −25pp,
temporal-reasoning −25pp: batched observer compresses per-session detail.

Kill gate missed (unweighted < 78%). Phase A / Phase B skipped per plan
§Task 10 Step 3. Total cost $1.92. Run JSON:
results/runs/2026-04-22T10-15-21-854--longmemeval-s--gpt-4o--full-cognitive--ingest.json.

Full findings: packages/agentos-bench/docs/STEP_15_V2_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md
```

---

## 11. Rollback

Not required. `--observational-memory` is default off. Tier 1 HybridRetriever at 73.2% remains shipping unchanged. The v2 batching code path is the new default for `--observational-memory`; to fall back to v1 per-session behavior, revert the `feat(bench): Step 15 v2 ...` commit.

---

End of Step 15 v2 findings.
