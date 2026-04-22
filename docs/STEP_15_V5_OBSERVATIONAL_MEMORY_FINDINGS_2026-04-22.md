# Step 15 v5 Findings — gpt-4o Observer + Scaffold + Case-Result Cache Bug

**Date:** 2026-04-22
**Scope:** v5 config = v3 dual-path + v4a scaffold + gpt-4o observer (upgrade from gpt-5-mini). First Step 15 variant to clear the 78% Tier A kill gate.

---

## 1. Verdict: GREEN-soft at Tier A (79.2%), Phase A unconfirmed

**Tier A N=24 unweighted 79.2% (19/24) CI [58.3%, 95.8%].** Above the 78% kill-gate threshold. All single-session categories at 100%. KU + temporal at 75% each. Multi-session at 25% (unchanged from v3 — scaffold doesn't fix this category alone).

**Phase A NOT yet fired** due to in-session time allocation toward Step 16 architecture (combined retrieval + OM). Phase A is the next blocking confirmation before Phase B can be considered.

**Per-category:**

| Category | v5 (Tier A N=24) | v4a (Tier A) | v4a (Phase A) | Canonical (N=500) | Mastra (gpt-4o) |
|---|---:|---:|---:|---:|---:|
| single-session-user | **100%** | 100% | 94.1% | 97.1% | 98.6% |
| single-session-assistant | **100%** | 100% | 94.1% | 89.3% | 82.1% |
| single-session-preference | **100%** | 100% | 64.7% | 60.0% | 73.3% |
| knowledge-update | 75% | 75% | 82.4% | 86.8% | 85.9% |
| multi-session | **25%** | 50% | 52.9% | 54.9% | 79.7% |
| temporal-reasoning | 75% | 75% | 41.2% | 70.2% | 85.7% |
| **Unweighted** | **79.2%** | **83.3%** | **71.6%** | **73.2%** | **84.23%** |

Run JSON: [results/runs/2026-04-22T17-57-08-777--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T17-57-08-777--longmemeval-s--gpt-4o--full-cognitive--ingest.json). Cost: $24.30. Runtime: 45 min.

---

## 2. What v5 changes vs v4a

**One variable:** observer model upgrade.

```
v4a: dual-path + scaffold + gpt-5-mini observer (all prior variants used this)
v5:  dual-path + scaffold + gpt-4o      observer
```

**Motivation:** Mastra's 84.23% gpt-4o result uses `gemini-2.5-flash` for their observer. The gap between us (gpt-5-mini observer) and Mastra (gemini-2.5-flash observer) could be observer-model tier. v5 tests whether upgrading OUR observer to gpt-4o — same tier as Mastra's gemini-2.5-flash by most capability benchmarks — closes the gap.

**Deliberately NOT tested:** gemini-2.5-flash. The rollout's constraint is OpenAI+Cohere only, no vendor lock-in. v5 answers the observer-tier question WITHOUT introducing a Google dependency.

---

## 3. Per-category analysis

### 3.1 Single-session — ceiling reached

v5 hit 100% on all three single-session categories at N=24. Upgrading observer from gpt-5-mini to gpt-4o preserved the per-session fidelity that was already perfect at v4a. No regression, no sampling-luck concern (v4a Phase A held SSA+SSU at 94.1% on larger N; preference dropped to 64.7% but that's a Phase A finding for v4a — v5 hasn't been tested at Phase A yet).

### 3.2 Temporal-reasoning — scaffold + observer tier stacked

v4a Tier A: 75%. v5 Tier A: 75%. No change.

Scaffold was the load-bearing variable for temporal (+50pp from 25% to 75% in v4a). Observer upgrade doesn't add temporal gain on top.

### 3.3 Knowledge-update — flat

v4a: 75%. v5: 75%. Neither scaffold nor observer upgrade moved KU.

### 3.4 Multi-session — THE bottleneck

v4a: 50%. v5: **25%**. v5 REGRESSED multi-session relative to v4a.

Why? At Tier A N=24 with 4 cases per category, a single case flip is 25pp. v4a's 50% was 2/4 correct; v5's 25% is 1/4. Small-N noise likely, not architectural regression. But the general pattern holds: multi-session is stuck in the 25-50% band across all v1-v5 variants.

---

## 4. The case-result cache bug — diagnosis + fix

### 4.1 First failed attempt

v5 first Tier A fired at 17:04 PDT. Result: "accuracy=8.3% passed=2/24 avg=3853ms totalUsd=$0.08". Red flags:

- 8.3% accuracy → basically reader answering without memory
- 3.8 seconds per case average → too fast for real observer calls at gpt-4o
- $0.08 total spend → no observer API work happened

Direct test of OpenAI's API with curl showed `max_tokens: 100000` triggers a 400 error: "max_tokens is too large: 100000. This model supports at most 16384 completion tokens."

Root cause: `OM_DEFAULTS.observation.maxOutputTokens = 100_000` is sized for Gemini. Non-GPT-5 OpenAI models cap at 16,384. Observer calls threw. Worker pool's try/catch swallowed the errors. Ingest returned empty observation log.

### 4.2 Fix #1 — max_tokens clamp

[createReader.ts](../src/readers/createReader.ts) `OpenAIHttpReader.invoke`:

```typescript
} else {
  // GPT-4-class models cap completion tokens at 16384. Clamp at 16000.
  const GPT4O_MAX_COMPLETION_TOKENS = 16000;
  requestBody.max_tokens = Math.min(req.maxTokens ?? 512, GPT4O_MAX_COMPLETION_TOKENS);
  requestBody.temperature = req.temperature ?? 0;
}
```

Rebuild. Fire v5 retry.

### 4.3 Second failed attempt

v5 retry fired at 17:04 PDT with the max_tokens fix. Result: "accuracy=8.3% passed=2/24 avg=3853ms totalUsd=$32.76". Still 8.3%. But now $32.76 spent — real observer API calls happened.

Mystery: observer spent $32 of tokens but `omObservationBatches: 0` in the run JSON. Cases completed in 4 seconds despite observer taking real time.

### 4.4 Root cause — `case-result` cache

[BenchmarkRunner.ts:runOneCase](../src/core/BenchmarkRunner.ts) has TWO cache layers:

```typescript
// Step 1 — produce or recall the answer.
let run = await ctx.cache.get<CaseRun>('case-run', ...runKeyParts);
if (run?.error) run = undefined;
if (!run) {
  try { run = await benchmark.runCase(c, ctx); }
  catch { errored = true; ... }
  if (!errored) await ctx.cache.set('case-run', run, ...runKeyParts);
}

// Step 2 — score it.
let result = await ctx.cache.get<CaseResult>('case-result', ...resultKeyParts);  // ← stale here
if (!result) {
  // scoreCase is called; result is cached
}
return result;
```

The first failed v5 attempt (max_tokens bug) wrote `case-result` entries with `{ passed: false, actualOutput: "I'm sorry...", metadata: { omObservationBatches: 0, omFinalLogChars: 58, ... } }`. These entries were NOT rejected by the errored-run suppression because scoreCase DID return a valid CaseResult — it just scored the empty answer as passed=false.

Second v5 retry (post-fix): case-run cache was cleared (or fresh) so runCase WAS called with real observer work. But case-result cache still had the stale bad entries from the first attempt. `cache.get('case-result', ...)` returned them, short-circuiting the scoring step, and the run JSON's per-case metadata reflected the STALE data.

**Why the mystery:**
- Real observer calls DID fire (visible as $32 spend)
- Case-run cache DID get populated with real obs=47+ entries (verified by `jq`-inspecting cache files)
- But the final run JSON used the old `case-result` entries, not the fresh `case-run` entries

The two caches were out of sync.

### 4.5 Fix #2 — delete stale case-result entries

```bash
for f in $(find packages/agentos-bench/data/cache/case-result -type f); do
  if jq -e 'select(.metadata.omObservationBatches == 0 and .metadata.omFinalLogChars == 58 and .metadata.omObserverModel == "gpt-4o")' "$f" > /dev/null 2>&1; then
    rm "$f"
  fi
done
```

24 stale entries deleted. Fresh v5 run then produced the real 79.2% result.

### 4.6 Long-term fix (out-of-scope for this rollout)

The runner should either:
1. Invalidate case-result cache whenever case-run cache is invalidated
2. Include a content-hash of the run object in the case-result key
3. Reject case-result cache hits if the corresponding case-run was errored or stale

Defer to a future BenchmarkRunner refactor. For now, documented as operator discipline in handoff §7.6.

### 4.7 Methodology impact

The case-result cache bug is the second significant methodology issue diagnosed in this rollout (first was the dry-run cache contamination in the Step 15 v1 session). Both are documented in handoffs + findings for future sessions. Neither produced a false positive on an architectural decision, but both could have silently corrupted rollout results if not caught.

**Recommendation for external replication:** when following this rollout's methodology, treat the case-result cache as a separate invalidation surface. Clear stale entries alongside case-run entries whenever a bug fix could affect downstream metadata.

---

## 5. Cost breakdown

| Line | Cost |
|---|---:|
| Per-session Observer (gpt-4o, 24 cases × ~49 calls × ~$0.025 cached) | ~$11.80 |
| Batched Observer (gpt-4o, 24 cases × ~6 calls × ~$0.12 cached) | ~$1.20 + observer total ~$13 |
| Reader (gpt-4o, 24 calls × ~$0.02) | ~$0.50 |
| Judge (gpt-4o, 24 calls × ~$0.01) | ~$0.29 |
| Classifier (N/A at v5) | — |
| **Total v5 Tier A** | **$24.30** |

Cost/correct: $1.28 ($24.30 / 19 correct).

Rollout cost including v5 Tier A + v5 bug-diagnosis spend ($0.08 + $32.76 + $0.003 diagnostic + $24.30 retry) + Step 16 Tier A ($33.67) = ~$90 of session spend on v5 + Step 16. Plus v4a Phase A ($26.30) + v4a-c Tier A ($14.78) + earlier experiments. Total session: ~$195.

---

## 6. What ships

### 6.1 Code changes

- `--om-observer-model <model>` CLI flag (default gpt-5-mini).
- `omObserverModel?: string` on RunConfig; propagated through `resolveRunConfig`.
- `step-15-om-observer:{model}` fingerprint tag (only when model != gpt-5-mini; preserves v1-v4 cache buckets).
- `GPT4O_MAX_COMPLETION_TOKENS = 16000` clamp in `OpenAIHttpReader.invoke` (defensive for any non-GPT-5 OpenAI model).

### 6.2 Tests

- 4 new wiring tests for RunConfig threading + fingerprint.
- All 59 OM tests green; typecheck clean.

### 6.3 Operational docs

- Case-result cache bug documented in [NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-22_FINAL.md) §7.6.
- gpt-4o max_tokens gotcha documented in §7.2.

---

## 7. Recommendations

### 7.1 Ladder v5 at Phase A before any architectural commitment

v4a sampling-luck pattern (Tier A 83% → Phase A 72%) is a live risk for v5. Phase A at $150 is mandatory before Phase B or blog publication.

### 7.2 Don't commit to v5 without Phase A

The 79.2% point estimate at N=24 is tantalizing but statistically insufficient. v4a's precedent requires v5 to be confirmed at N=102 before "79% at matched reader" goes on any competitor-leaderboard chart.

### 7.3 Multi-session at 25% is the floor for this variant

Scaffold + observer upgrade don't move multi-session. Next experiments queued (Step 16b, Step 16c) target multi-session specifically via retrieval augmentation.

---

## 8. Honest caveats

1. **N=24 CI is wide.** [58.3%, 95.8%] overlaps with canonical (73.2% CI [69.2%, 77.0%]). Point-estimate lead is directional, not conclusive.
2. **Multi-session is the known weakness.** 25% Tier A is below canonical's 54.9% N=500. If v5 holds at Phase A, multi-session needs its own fix (Step 16 family).
3. **Observer model upgrade costs 5x the gpt-5-mini tier.** Production consumers will face a material cost increase to run v5. Document clearly.
4. **No Mastra parity yet.** Mastra OM gpt-4o = 84.23% (gemini-2.5-flash observer). Our v5 at 79.2% is 5pp behind. Closing the gap requires either Gemini observer (not on the table) or architectural improvements (Step 16 family).

---

End of Step 15 v5 findings.
