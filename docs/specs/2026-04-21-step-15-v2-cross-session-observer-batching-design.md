# Step 15 v2 — Cross-Session Observer Batching

**Date:** 2026-04-21
**Author session:** Opus 4.7 (1M context)
**Status:** Design approved, pending implementation plan
**Supersedes:** None. Extends Step 15 v1 ([STEP_15_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-21.md](../STEP_15_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-21.md)).

---

## 1. Summary

Step 15 v1 hit 75.0% unweighted at Tier A N=24 CI [58.3%, 91.7%] — first architectural change since Step 3 Hybrid to beat the 73.2% canonical point estimate. Single-session categories all swept at 100%. Cross-session categories regressed: multi-session 25% vs Mastra's 79.7%, temporal-reasoning 50% vs Mastra's 85.7%.

Step 15 v2 closes the diagnosed gap with one architectural change: refactor `ingestSessions` to run the Observer on token-bounded batches of sessions instead of per-session in isolation. Batch target: `24_000` tokens (matches Mastra's `messageTokens × bufferActivation` = `30_000 × 0.8`). Observer sees 5-15 sessions per call instead of 1. Cross-session pattern encoding becomes possible.

Observer model stays at `gpt-5-mini` (unchanged from v1). Pure refactor. No new dependencies, no new env vars, no model swap.

Budget: ~$3-5 for Tier A N=24. If v2 clears the kill gate, ladder Phase A N=102 (~$20) then Phase B N=500 (~$100) for a new canonical.

Expected outcome at Tier 1:
- Unweighted: 78-81% (vs v1's 75.0%, canonical's 73.2%)
- Multi-session: 45-55% (vs v1's 25%, canonical's 54.9%, Mastra's 79.7%)
- Temporal-reasoning: 65-75% (vs v1's 50%, canonical's 70.2%, Mastra's 85.7%)
- Single-session: stays at 100% across all three subcategories

**Contingent follow-up (not in this spec):** if v2 plateaus below 78% unweighted or below 50% multi-session, Step 15 v3 adds a `GeminiReader` and swaps the Observer/Reflector to `gemini-2.5-flash` to match Mastra's exact config. This is documented as a deferred pivot in §11, not a Tier 1 commitment.

---

## 2. Context and evidence

### 2.1 Why batching is the diagnosed gap

Current `runner.ts::ingestSessions` in [packages/agentos-bench/src/observational-memory/runner.ts](../../src/observational-memory/runner.ts) runs the Observer per-session in parallel with concurrency 4. Each observer call sees exactly one session's transcript. Cross-session patterns ("user stated X in session 12, updated to Y in session 18") cannot be encoded because no observer call sees both sessions.

Mastra's [observational-memory.ts](../../.firecrawl/mastra-om/observational-memory.ts) at resource scope pools messages across threads. When unobserved-message-tokens exceed `messageTokens = 30_000`, the Observer fires on a batch of `messageTokens × bufferActivation = 24_000` tokens, retaining the newest `6_000` as unobserved for the next batch. For bulk ingest (our bench use case), the retention pattern is functionally equivalent to strict token-bounded batching without rollover: messages retained in buffer-N simply move into batch-N+1 without cross-observer visibility.

### 2.2 Per-category gap analysis at Tier A N=24

| Category | v1 Step 15 | Step 3 canonical N=500 | Mastra OM gpt-4o | v2 target |
|---|---:|---:|---:|---:|
| single-session-user | 100.0% | 97.1% | 98.6% | 100% |
| single-session-assistant | 100.0% | 89.3% | 82.1% | 100% |
| single-session-preference | 100.0% | 60.0% | 73.3% | 100% |
| knowledge-update | 75.0% | 86.8% | 85.9% | 80-90% |
| **temporal-reasoning** | **50.0%** | 70.2% | **85.7%** | **65-75%** |
| **multi-session** | **25.0%** | 54.9% | **79.7%** | **45-55%** |

Single-session categories are at ceiling. All the headroom for v2 is in the three cross-session-dependent categories (KU, TR, MS).

### 2.3 Not porting Supermemory or Hindsight

Research on competing frontier systems ([supermemory.ai/research](https://supermemory.ai/research), [arXiv:2512.12818](https://arxiv.org/abs/2512.12818)):

- **Supermemory (81.6% gpt-4o)** uses hybrid retrieval with atomic-fact memory summaries pointing at raw chunks. Architecturally close to our existing HybridRetriever + Step 9 fact-graph combination. Step 9 went RED in our stack (`evidenceOrigin: fact_graph 0/24`). Porting Supermemory risks an 11th null result on a known-hostile pattern for our reader.
- **Hindsight (91.4% gemini-3-pro, OSS-20B hits 83.6%)** uses four typed memory networks (world / experience / opinion / observation) plus temporal-entity graph plus multi-strategy retrieval. Architecturally distinct from both Mastra and our current stack. Does NOT publish a gpt-4o number. Worth porting if v2 plateaus; not before.

### 2.4 LongMemEval multi-session ceiling

Mastra's blog explicitly notes: "Multi-session is the hardest category. OM's best multi-session score (87.2%) ties Hindsight's best. This appears to be a ceiling that current systems hit." Our 25% has enormous headroom; 55-75% is a realistic target for v2 at matched-ablation methodology without changing the observer model.

---

## 3. Architecture

### 3.1 Data flow

**Before (Step 15 v1):**

```
haystack: S1(2k) | S2(3k) | S3(1k) | S4(2k) | ... | S49(2k)
               |        |        |        |              |
        Observer(S1) Observer(S2) Observer(S3) Observer(S4) ... Observer(S49)
        [parallel, concurrency=4, each call sees 1 session]
               |        |        |        |              |
           obs_1    obs_2    obs_3    obs_4    ...    obs_49
                                        |
                                concatenate
                                        |
                                   final log
                                        |
                                   reader answer
```

49 observer calls per case. Each observer has 1 session of context.

**After (Step 15 v2):**

```
haystack: S1 | S2 | S3 | S4 | ... | S49
          \_____________/  \______/   \___/
            batch 1 (24k)  batch 2   batch N
                  |            |       |
            Observer(B1)  Observer(B2) ... Observer(BN)
            [parallel, concurrency=4, each call sees 5-15 sessions]
                  |            |       |
               obs_B1       obs_B2 ... obs_BN
                              |
                         concatenate
                              |
                         final log
                              |
                         reader answer
```

~4-8 observer calls per case (115k haystack / 24k target = ~5 typical). Each observer has 5-15 sessions of context, spanning session boundaries.

### 3.2 Batching algorithm

Replaces the per-session loop in [`ingestSessions`](../../src/observational-memory/runner.ts) starting at the `for (const next of queue)` block:

```typescript
function partitionSessionsIntoBatches(
  sessions: readonly OmSession[],
  batchTokenTarget: number,
): OmSession[][] {
  const batches: OmSession[][] = [];
  let current: OmSession[] = [];
  let currentTokens = 0;
  for (const session of sessions) {
    const sessionText = formatSessionForObserver(session);
    const sessionTokens = approxTokens(sessionText);
    // Single oversized session gets its own batch — no mid-session split.
    if (currentTokens + sessionTokens > batchTokenTarget && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(session);
    currentTokens += sessionTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
```

Invariants:
- A batch never splits a session mid-stream. A session that exceeds `batchTokenTarget` alone becomes its own single-session batch.
- The final batch may be smaller than the target (no padding).
- Session order is preserved within and across batches (haystack order, which is chronological for LongMemEval-S).

### 3.3 Observer call over a batch

A new helper `combineSessionsForObserver(batch: OmSession[]): string` concatenates each session's `formatSessionForObserver` output with `\n\n` separators. Each session's existing `Date: {ISO}` header acts as the natural cross-session boundary in the observer's input. No new `<thread>` or `<session>` wrapping — the date grouping that Mastra's observer prompt already requires in its output (`Date: Dec 4, 2025` / `Date: Dec 5, 2025`) carries session provenance without additional markup.

The observer is invoked with a transcript that looks like:

```
Date: 2024-05-01
[user @ 09:15] Hi, I want to plan a trip to Berlin next week...
[assistant @ 09:16] ...

Date: 2024-05-08
[user @ 14:22] Just got back from Berlin. The museum we discussed was great.
[assistant @ 14:23] ...

Date: 2024-05-15
[user @ 10:00] I'm thinking of going to Paris next month instead.
...
```

The observer produces date-grouped observations:

```xml
<observations>
Date: May 1, 2024
* 🔴 (09:15) User planned Berlin trip for week of May 8.

Date: May 8, 2024
* 🔴 (14:22) User completed Berlin trip, enjoyed museum discussed previously.

Date: May 15, 2024
* 🔴 (10:00) User considering Paris trip next month (replacing planned follow-up Berlin visit).
</observations>
```

Cross-session supersession ("replacing planned follow-up Berlin visit") becomes encodable because the observer sees all three sessions in one pass.

Token budget math: observer's `maxOutputTokens` is already 100_000 (see `OM_DEFAULTS.observation.maxOutputTokens`). Input is 24k target + observer system prompt (~5k) = ~29k typical. Output cap of 100k is ~3x the expected output of a 5-15-session batch, so no truncation risk.

### 3.4 Concurrency

`observerConcurrency` (default 4) stays. With fewer, larger batches (~4-8 per case), four parallel observer calls usually saturate all batches on the first wave. Memory pressure per call is higher (24k input tokens vs ~2.3k per session), still well under the Observer's context window.

### 3.5 Reflection trigger

Reflector threshold stays at `OM_DEFAULTS.reflection.observationTokens = 40_000`. Expected firing rate stays near zero at Tier A N=24 (per v1 findings, 0/24 cases triggered reflection because logs averaged 19k tokens). Fewer, denser batches in v2 may slightly increase log length per case, but should still stay well below the 40k threshold.

### 3.6 Reader-side context (unchanged)

`buildOmReaderSystemPrompt` is unchanged. Reader sees:

```
OBSERVATION_CONTEXT_PROMPT

<observations>
{consolidated observation log from all batches}
</observations>

OBSERVATION_CONTEXT_INSTRUCTIONS

OBSERVATION_CONTINUATION_HINT
```

No retrieval. Single reader call. Same as v1.

---

## 4. Cache fingerprint strategy

### 4.1 Current fingerprint (v1)

`computeCaseRunKeyParts` in [`BenchmarkRunner.ts`](../../src/core/BenchmarkRunner.ts) appends `step-15-om:${OM_PROMPT_HASH.slice(0, 12)}` when `observationalMemory` is true. `OM_PROMPT_HASH` is a SHA-256 of the observer + reflector + context prompts.

### 4.2 Fingerprint extensions for v2

One new orthogonal tag added alongside the existing prompt-hash tag:

```typescript
if (config.observationalMemory) {
  const tag = `step-15-om:${OM_PROMPT_HASH.slice(0, 12)}`;
  runKeyParts.push(tag);
  resultKeyParts.push(tag);

  // v2: batching strategy + target size
  const batchTokenTarget = config.omBatchTokenTarget ?? 24_000;
  const batchTag = `step-15-om-batching:v2:${batchTokenTarget}`;
  runKeyParts.push(batchTag);
  resultKeyParts.push(batchTag);
}
```

Rationale:
- Prompt hash and batching config invalidate independently. Any change auto-invalidates cached answers.
- v1 runs (no batching tag) stay in their own cache bucket. Re-running v1 never replays v2 results and vice versa.
- Ablations at `batchTokenTarget = 16_000` vs `24_000` vs `40_000` don't collide.

### 4.3 v1 cache is NOT deleted

Existing v1 case-run cache entries remain intact. If someone re-runs the Step 15 v1 config (would require reverting the runner change), they can recover the original results. v2 runs write new cache entries under the new fingerprint.

---

## 5. CLI and RunConfig

### 5.1 New flag

Added to [`cli.ts`](../../src/cli.ts):

```
--om-batch-tokens <n>
    Token target per observer batch in OM ingest.
    Default: 24000 (Mastra messageTokens × bufferActivation = 30k × 0.8).
    Sessions are grouped until the running token count exceeds this target.
    A single session exceeding the target becomes its own batch (no split).
```

### 5.2 RunConfig additions

In [`IBenchmark.ts`](../../src/core/IBenchmark.ts):

```typescript
export interface RunConfig {
  // ...existing fields...
  observationalMemory?: boolean;
  omBatchTokenTarget?: number;  // NEW, default 24_000 at runtime
}
```

`resolveRunConfig` propagates `omBatchTokenTarget`. `observationalMemory: true` is required for the new field to take effect.

---

## 6. Tests

New tests added to [`tests/`](../../tests/):

### 6.1 Unit tests (add to `observationalMemory.unit.spec.ts`)

1. `partitionSessionsIntoBatches` produces fewer batches than sessions when sessions are small.
2. `partitionSessionsIntoBatches` places a single oversized session in its own batch (no split).
3. `partitionSessionsIntoBatches` respects `batchTokenTarget`: no batch exceeds target unless it contains a single session that alone exceeds target.
4. `partitionSessionsIntoBatches` preserves session order across and within batches.
5. `combineSessionsForObserver` concatenates session transcripts with `\n\n` separators and preserves date headers.
6. `ingestSessions` with `batchTokenTarget` creates the expected number of observer calls (mocked reader, count the invocations).

### 6.2 Wiring tests (add to `step15ObservationalMemory.wiring.spec.ts`)

1. Cache fingerprint changes when `omBatchTokenTarget` changes (`24000` vs `40000` produce different `runKeyParts`).
2. `resolveRunConfig` preserves explicit `omBatchTokenTarget` values.
3. Cache fingerprint omits the batching tag when `observationalMemory` is false.

### 6.3 Integration / smoke

No new integration tests. The existing v1 wiring tests continue to pass without modification. Regression coverage is at the unit + wiring layer.

### 6.4 Test execution

From `packages/agentos-bench/`:

```bash
pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts
```

Expected: 19 existing tests pass unchanged + 9 new tests (6 unit + 3 wiring) = 28 passing.

Full bench suite:

```bash
pnpm vitest run
```

Expected: all prior passing tests still pass (no regressions to Phase 1 metrics, Steps 12/13/14 wiring, etc.).

---

## 7. Execution ladder

### 7.1 Tier A N=24

After implementation + tests green + typecheck clean:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
set -a && source apps/wilds-ai/.env && set +a
OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  LONGMEMEVAL_S_PATH="$(pwd)/data/longmemeval/longmemeval_s.json" \
  pnpm bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-batch-tokens 24000 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 10
```

Expected cost: $3-5. Expected duration: 30-45 minutes. The same stratified seed + sample as v1's Tier A run enables a paired-McNemar comparison via `compareRuns`.

### 7.2 Kill gate

| Metric | Threshold |
|---|---:|
| Unweighted | ≥ 78% |
| Multi-session | ≥ 50% |

Both must pass. If either fails, skip Phase A and pivot to Step 15 v3 (see §11).

### 7.3 Phase A N=102

Conditional on Tier A passing the kill gate.

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory --om-batch-tokens 24000 \
  --sample 102 --stratified --sample-per-type 17 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 30
```

Expected cost: $15-20. The `--sample 102 --stratified --sample-per-type 17` combo matches the Phase A pattern from [PHASE_A_FINDINGS_2026-04-19.md:221](../PHASE_A_FINDINGS_2026-04-19.md): 17 cases per category × 6 categories = 102 cases with balanced type coverage.

Gate to Phase B:
- Unweighted delta ≥ +5pp over 73.2% canonical (point estimate ≥ 78.2%)
- Paired McNemar p < 0.05 via `compareRuns.paired`
- CI lower bound ≥ canonical upper bound (77.0%) OR the paired delta is significant regardless

### 7.4 Phase B N=500

Conditional on Phase A passing gate. Full dataset. Publication-grade number.

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory --om-batch-tokens 24000 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 150
```

Expected cost: $80-100. Expected duration: 6-8 hours. N-regression guard on `summary.json` auto-accepts the new row if N ≥ 500.

### 7.5 Ship / default flip

If Phase B clears 78%+ with tighter CI, promote the v2 OM config to the shipping default for the `--observational-memory` flag. Existing canonical row (73.2% Step 3 Hybrid) stays the Tier 1 default memory mode (`full-cognitive + ingest + hybrid + rerank`); OM remains opt-in behind its flag.

---

## 8. Budget

| Step | Expected cost | Cumulative |
|---|---:|---:|
| v2 Tier A N=24 | $3-5 | $5 |
| Phase A N=102 | $15-20 | $25 |
| Phase B N=500 | $80-100 | $125 |

Stays within "hundreds" headroom. ~$130 total if all three tiers fire.

If v2 Tier A misses the kill gate (~$5 spent, no further ladder), the project can absorb Step 15 v3 (GeminiReader + gemini-2.5-flash observer, ~$5 Tier A) on top.

---

## 9. Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Observer at gpt-5-mini produces prompt-noncompliant output over larger batches (missing `<observations>` tag) | Low | Case-level failure, cached | `extractObservationsBlock` falls back to `stripWrappers(raw)` on tag miss. Logged; counted in `omFinalLogChars` metric. |
| Batch token estimator (4-char heuristic) under/over-estimates, letting a batch balloon past observer's `maxOutputTokens` (100k) | Low | Observer call fails, case-level error | Approximator underestimates by ~10% in practice. Target 24k with 100k output cap gives ~3x safety margin. Refine to model-specific tokenizer if issues surface. |
| Cached v2 runs replay across ablation variants | Low | Wrong verdict at $0 cost | Fingerprint tag `step-15-om-batching:v2:{target}` makes ablation variants orthogonal in the cache key. |
| Multi-session ceiling (87.2%) means v2 maxes out before hitting the kill gate | Low | Kill gate missed despite real improvement | Kill gate (50% multi-session) is well below the 87.2% ceiling. Unlikely to block. |
| Existing per-session v1 cache entries replay during v2 runs | Zero | N/A | v2 cache keys include new batching tag, so v1 entries under old keys are untouched. |
| Observer struggles with longer cross-session transcripts and loses per-session fidelity | Medium | Single-session categories could drop from 100% | Paired McNemar with v1's Tier A run catches this. If any single-session category drops, findings doc records the regression even if the aggregate passes. |
| Memory pressure on the observer's 24k-token input at concurrency 4 causes latency spikes | Low | Slower Tier A run, not accuracy | Observer cost scales with content, not call count. Overall wall-clock may be similar to v1. |

---

## 10. Rollback plan

All new code is opt-in behind existing `--observational-memory` flag plus new optional `--om-batch-tokens` flag. Default for the new flag is `24_000`, which means passing `--observational-memory` alone runs the v2 config.

To replay v1 behavior exactly, revert the PR. There is no CLI value of `--om-batch-tokens` that restores per-session batching in the v2 code path — CLI validators reject non-positive token targets, and the algorithm in §3.2 never produces one-session-per-batch at positive targets (a 1-token target would try to push a zero-length batch). If per-session replay is needed, revert the runner change.

If v2 regresses against v1 despite the analysis (unlikely given the diagnosed gap), the Tier A smoke catches it. No production impact because OM is already opt-in. The Tier 1 HybridRetriever canonical (73.2%) stays the shipping default.

---

## 11. Contingent follow-up: Step 15 v3 (deferred)

If v2 Tier A misses the kill gate (unweighted < 78% OR multi-session < 50%), the next experiment is **Step 15 v3: match Mastra's exact observer model**.

Mastra's published configuration uses `gemini-2.5-flash` for the Observer and Reflector across all runs (84.23% gpt-4o, 94.87% gpt-5-mini, 93.27% gemini-3-pro). Our v1 and v2 use `gpt-5-mini` for the observer — a ~0.5-tier drop. Research indicates closing this gap may contribute 3-8pp on cross-session categories.

**Step 15 v3 would add:**
- `GEMINI_API_KEY` environment variable (user provisions a Google AI Studio key)
- `packages/agentos-bench/src/readers/GeminiReader.ts` mirroring `OpenAIReader`
- Wiring in `createReader.ts` to route `gemini-*` model strings
- `--om-observer-model <model>` CLI flag (allowlist: `gpt-5-mini`, `gemini-2.5-flash`)
- Separate cache fingerprint tag: `step-15-om-observer:${model}`
- New dependency: `@google/generative-ai`

**Budget:** ~$5 Tier A N=24. Separate spec + plan + brainstorm before firing.

This is NOT part of v2. Do not implement it proactively. It fires only if v2 misses the kill gate, and only after a fresh brainstorming cycle with the user.

---

## 12. Open questions (decided, recorded here for traceability)

| Question | Decision | Rationale |
|---|---|---|
| Rollover retention between batches? | No | Mastra's 6k retention is a runtime-streaming artifact. For bulk ingest, messages retained in buffer N move to batch N+1 without cross-observer benefit. |
| Prior-observation context injection per batch? | No | Mastra's observer is stateless; each call sees only the transcript. Consistent with their 84.23% gpt-4o. Re-adds complexity + cost without precedent. |
| Intra-batch session ordering? | Chronological (haystack order) | LongMemEval-S haystacks are already chronological. Observer's date-header grouping depends on temporal ordering for the supersession logic to fire. |
| Observer concurrency default? | 4 (unchanged) | With ~4-8 batches per case, 4-way concurrency usually clears all batches in one wave. Rate-limit issues caught at Tier A smoke. |
| CLI flag for batch target? | Yes, `--om-batch-tokens` | Enables cheap ablation (16k vs 24k vs 40k) without code changes. Default 24_000. |
| Extend `OM_PROMPT_HASH` or add separate tag? | Separate tag | `step-15-om-batching:v2:{target}` is orthogonal to prompt changes. Independent invalidation. |
| Include GeminiReader / observer model swap in v2? | **No, deferred to v3** | Scope creep that conflates two variables in one experiment. Handoff §3 explicitly framed v2 as a pure batching refactor. Observer-model swap fires only if v2 misses the kill gate. |
| Port Supermemory as Step 16? | Deferred | Architecturally close to our Step 9 RED. Do not port unless v2 + v3 + Hindsight all plateau. |
| Port Hindsight as Step 16? | Contingent | If v2 + v3 both miss kill gates, Hindsight is the next port. Architecturally distinct from both Mastra and our existing stack. |

---

## 13. Acceptance

Design accepted 2026-04-21 by user after deep research validation covering:
- Mastra's Feb 2026 updated paper (84.23% gpt-4o, 94.87% gpt-5-mini actor, always gemini-2.5-flash observer)
- Supermemory's retrieval-with-atomic-facts architecture (ruled out near-term)
- Hindsight's four-typed-network paper ([arXiv:2512.12818](https://arxiv.org/abs/2512.12818), Dec 2025, open-source at github.com/vectorize-io/hindsight)
- LongMemEval multi-session 87.2% ceiling across frontier systems
- Scope boundary: v2 is pure batching refactor; observer model swap is a contingent v3

Next step: invoke `superpowers:writing-plans` to turn this design into a TDD-ordered task-by-task implementation plan.

---

End of design.
