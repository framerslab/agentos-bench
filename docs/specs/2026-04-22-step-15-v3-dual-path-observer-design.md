# Step 15 v3 — Dual-Path Observer

**Date:** 2026-04-22
**Author session:** Opus 4.7 (1M context)
**Status:** Design approved, implementation pending
**Supersedes:** None. Extends Step 15 v2 ([STEP_15_V2_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md](../STEP_15_V2_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md)).

---

## 1. Summary

Step 15 v1 (per-session Observer) preserved single-session fidelity but could not encode cross-session patterns (multi-session 25%, temporal 50%). Step 15 v2 (batched Observer, 24k token target) encoded cross-session patterns (multi-session +50pp, KU +25pp) but compressed per-session detail away (SSA −50pp, SSU −25pp, temporal −25pp). Aggregate v1 = 75.0% > v2 = 70.8%.

Step 15 v3 runs the Observer on BOTH paths in parallel and concatenates both observation logs into the reader's system prompt:

- **Per-session pass**: each session gets its own Observer call (v1 semantics). Preserves per-session dates, quotes, entity anchors.
- **Batched pass**: sessions grouped into 24k-token batches (v2 semantics). Encodes cross-session patterns.

Reader context = per-session log concatenated with batched log. Strictly additive: v1's strengths + v2's strengths with no information lost from either. Observer model stays `gpt-5-mini` (no new dependency).

Budget: ~$6 Tier A N=24 (2× v2 observer calls). If v3 hits ≥ 78% unweighted AND every category within 5pp of v1 baseline, ladder Phase A ($20) + Phase B ($100). Total if all three tiers fire: ~$130, within rollout headroom.

Expected outcome: unweighted 78-83%, multi-session 70-80%, single-session all ≥ 95%, temporal 55-70%.

---

## 2. Context and evidence

### 2.1 Pareto frontier from v1 + v2

| Category | v1 per-session | v2 batched | v3 target |
|---|---:|---:|---:|
| single-session-user | 100% | 75% | ≥ 95% |
| single-session-assistant | 100% | 50% | ≥ 95% |
| single-session-preference | 100% | 100% | 100% |
| knowledge-update | 75% | 100% | ≥ 90% |
| temporal-reasoning | 50% | 25% | ≥ 55% |
| multi-session | 25% | 75% | ≥ 70% |
| **Unweighted** | **75.0%** | **70.8%** | **≥ 78%** |

v3 recovers v1's fidelity floor (single-session) while keeping v2's cross-session ceiling (multi-session, KU).

### 2.2 Why dual-path should work

Per-case diagnosis in v2 findings §4.2: when `gpt-5-mini` Observer processes 24k tokens covering 5-15 sessions, it collapses per-session anchors. Example: "User participated in two charity events on consecutive days" merged two sessions 33 days apart.

In v3, the per-session pass handles that case correctly: "Feb 14: User participated in 24-Hour Bike Ride. March 19: User participated in Walk for Hunger." The reader sees both observation blocks and cannot be misled by the merged cross-session observation.

Duplication between passes is controlled by Observer prompt behavior: each pass sees different input, so produces different output. The per-session pass emits per-session observations; the batched pass emits cross-session synthesis. No new prompts required.

### 2.3 Scope boundary

No new Gemini reader. No observer model upgrade. No prompt changes. No retention rollover. No thread attribution markup. No hierarchical Observer. Those remain deferred as Step 15 v4 contingencies if v3 misses its kill gate.

---

## 3. Architecture

### 3.1 Data flow

```
haystack: S1 | S2 | S3 | S4 | ... | S49
         |  |  |  |        |             |
         |  +--+--+--...---+             |
         |     per-session pass           |
         |     (v1 semantics)             |
         |     49 parallel Observer calls |
         |     → perSessionLog           |
         |                                 |
         +--[partition into 24k batches]--+
               |                           |
               +---+---+---+---+---+       |
               batched pass                |
               (v2 semantics)              |
               5-8 parallel Observer calls |
               → batchedLog               |
                                            |
            finalLog = perSessionLog       |
                    + "\n\n## Cross-session patterns\n\n"
                    + batchedLog           |
                                            |
                                    Reader (gpt-4o)
```

Both passes run concurrently in a shared worker pool. Total observer calls per case: ~49 (per-session) + ~6 (batched) = ~55. Concurrency default stays 4, shared pool. Wall time per case ≈ 55 / 4 × 10s = ~140s average at v3, vs v2's ~64s. Reader call is unchanged.

### 3.2 Three modes, one runner

The `ingestSessions` function accepts an `omMode` parameter with three values:

- **`per-session`**: only the per-session pass fires. Restores v1 behavior exactly.
- **`batched`**: only the batched pass fires. Preserves v2 behavior exactly.
- **`dual-path`**: both passes fire, logs concatenated. v3 default.

This unifies v1, v2, v3 behind one parameter. The old v1 code path (which only had per-session observer) is restored under the `per-session` mode for matched-ablation re-runs.

### 3.3 Log structure

Concatenated with explicit section headers so the reader knows the provenance of each block:

```
<observations>
## Per-session observations

Date: 2024-05-01
* 🔴 (09:15) User planned Berlin trip...

Date: 2024-05-08
* 🔴 (14:22) User completed Berlin trip...

Date: 2024-05-15
* 🔴 (10:00) User considering Paris trip...

## Cross-session patterns

Date: 2024-05-01
* 🔴 (09:15) User planned Berlin trip for week of May 8.

Date: 2024-05-15
* 🔴 (10:00) User considering Paris trip next month (replacing planned follow-up Berlin visit).
</observations>
```

The `## Per-session observations` and `## Cross-session patterns` headers are purely organizational for the reader; the Observer prompt does not know about these headers — they're injected by the runner at concatenation time.

### 3.4 Token accounting

`OmIngestResult` gains two new fields to separate the two passes in metadata:

- `perSessionObservationBatches: OmObservationBatch[]` (formerly unused)
- `batchedObservationBatches: OmObservationBatch[]` (renamed from `observationBatches` for clarity)
- Legacy `observationBatches` alias preserved and points to whichever batches fired, so downstream consumers don't break

Cost tracker records as before, aggregated. `omObserverTokensIn` and `omObserverTokensOut` in case metadata sum both passes.

### 3.5 Concurrency

Total parallel observer calls = per-session count + batched count = ~55 per case. Running at concurrency 4 means ~14 call-waves. At 10s per wave, ~140s per case. Default concurrency bumps to 6 to keep wall time under v2's 64s × 2 = 128s (roughly matching the v2 latency envelope).

`observerConcurrency` default: 6 (was 4 in v2). Covers both passes' shared pool.

---

## 4. Cache fingerprint

New orthogonal tag added alongside existing prompt-hash tag:

```typescript
if (config.observationalMemory) {
  const tag = `step-15-om:${OM_PROMPT_HASH.slice(0, 12)}`;
  runKeyParts.push(tag);
  resultKeyParts.push(tag);

  const omMode = config.omMode ?? 'dual-path';
  const batchTokenTarget = config.omBatchTokenTarget ?? 24_000;
  const configTag = `step-15-om-config:${omMode}:${batchTokenTarget}`;
  runKeyParts.push(configTag);
  resultKeyParts.push(configTag);
}
```

The previous `step-15-om-batching:v2:{target}` tag is REPLACED by `step-15-om-config:{mode}:{target}`. This orphans any existing v2 cache entries, but that's desirable: v2 runs should not replay under v3's dual-path default.

Ablation variants — `--om-mode per-session` vs `--om-mode batched` vs `--om-mode dual-path` — all produce distinct fingerprints and cache independently.

---

## 5. CLI and RunConfig

### 5.1 New flag

```
--om-mode <per-session|batched|dual-path>
    Step 15 v3: observer mode for OM ingest.
    - per-session: v1 behavior. One Observer call per session.
                   Preserves per-session fidelity; cannot encode
                   cross-session patterns.
    - batched: v2 behavior. One Observer call per 24k-token batch
               spanning sessions. Encodes cross-session patterns;
               compresses per-session detail at batch sizes.
    - dual-path (DEFAULT): both passes run in parallel, logs
                           concatenated into the reader's prompt.
                           Preserves per-session fidelity AND
                           encodes cross-session patterns.
    Only effective with --observational-memory.
```

### 5.2 RunConfig additions

```typescript
export type OmIngestMode = 'per-session' | 'batched' | 'dual-path';

export interface RunConfig {
  // ...existing fields...
  observationalMemory?: boolean;
  omBatchTokenTarget?: number;
  omMode?: OmIngestMode;  // NEW, default 'dual-path' at runtime
}
```

`resolveRunConfig` propagates. Runtime default (`dual-path`) applied at call site in `LongMemEvalS.runCase`, not in the reducer.

---

## 6. Tests (12 new: 7 unit + 5 wiring)

### 6.1 Unit tests (add to `observationalMemory.unit.spec.ts`)

1. `ingestSessions` with `mode: 'dual-path'` invokes Observer for every session AND for each batch.
2. `ingestSessions` with `mode: 'per-session'` invokes Observer once per session (restores v1 semantics).
3. `ingestSessions` with `mode: 'batched'` invokes Observer once per batch (preserves v2 semantics).
4. Dual-path `finalLog` contains both `## Per-session observations` and `## Cross-session patterns` section headers.
5. Dual-path total observer tokens = per-session tokens + batched tokens (additive accounting).
6. Per-session-mode `finalLog` does NOT contain `## Cross-session patterns` header (backward-compat shape).
7. Batched-mode `finalLog` does NOT contain `## Per-session observations` header (backward-compat shape).

### 6.2 Wiring tests (add to `step15ObservationalMemory.wiring.spec.ts`)

1. `resolveRunConfig` preserves explicit `omMode: 'dual-path'`.
2. `resolveRunConfig` preserves explicit `omMode: 'per-session'`.
3. Cache fingerprint contains `step-15-om-config:dual-path:24000` when mode is dual-path.
4. Cache fingerprint changes between `dual-path` / `per-session` / `batched`.
5. Fingerprint omits config tag when `observationalMemory` is false.

### 6.3 Regression

All existing 32 tests (13 unit + 19 wiring as of v2) stay green. Some v2 tests may need updates if they assumed the old `step-15-om-batching:v2:{target}` tag name; those get updated to the new `step-15-om-config:{mode}:{target}` naming.

---

## 7. Execution ladder

### 7.1 Tier A N=24

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && \
  set -a && source apps/wilds-ai/.env && set +a && \
  OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  pnpm --filter @framers/agentos-bench bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-mode dual-path \
    --om-batch-tokens 24000 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 15
```

Expected: $5-7, ~40-50 min.

### 7.2 Kill gate

| Metric | Threshold |
|---|---:|
| Unweighted | ≥ 78% |
| Multi-session | ≥ 50% |
| Single-session-assistant | ≥ 90% (must not regress more than 10pp from v1) |
| Single-session-user | ≥ 90% |
| Single-session-preference | ≥ 90% |

Unweighted + multi-session thresholds unchanged from v2. Added three single-session thresholds to catch the v2-style category regression early. If ANY single-session category drops below 90%, STOP laddering regardless of aggregate — it means the dual-path concatenation isn't actually preserving v1's fidelity.

### 7.3 Phase A N=102

Conditional on full Tier A kill gate. Command matches v2's Phase A pattern:

```bash
  --om-mode dual-path --om-batch-tokens 24000 \
  --sample 102 --stratified --sample-per-type 17 \
  --max-usd 30
```

Gate to Phase B: unweighted ≥ 78.2% AND paired McNemar p < 0.05 vs 73.2% canonical.

### 7.4 Phase B N=500

Full dataset, no sample flag. Budget ~$100. Updates canonical via N-regression guard.

---

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reader attention dilution: duplicate content in both logs confuses the reader | Medium | Aggregate could plateau below v1 even if category floors hold | If v3 plateaus at 73-77%, try Observer prompt variant for pass 2 ("cross-session patterns only, no per-session detail repetition") as v3b |
| Cost blow-up: 2x observer calls exceeds budget | Low | Tier A ~$6 already accounted for | $15 max-usd cap fires preflight abort if projection exceeds |
| Latency blow-up: serial observer + batched passes double wall time | Low | Tier A 80-100 min vs v2 33 min | Concurrency bump to 6 keeps wall time near v2's envelope |
| Cache thrash: old v2 cache entries orphaned when fingerprint changes | Zero | Old entries don't replay, new entries write fresh | Intentional; v2 and v3 cache independently under distinct fingerprints |
| Reader context exceeds gpt-4o 128k limit | Very low | Runtime error, case-level failure | Per-session log ~20k chars + batched log ~30k chars = ~50k chars ≈ 12.5k tokens well under limit |
| Single-session categories regress from v1's 100% anyway | Low | v3 is no better than v2 | Kill gate's per-category thresholds catch this at Tier A; pivot to Option 3 (Gemini observer) or accept v1 as canonical |

---

## 9. Rollback

All three modes stay accessible via `--om-mode`. Default changes from "v2 batched" to "v3 dual-path". To restore v2 behavior exactly: pass `--om-mode batched`. To restore v1 behavior: `--om-mode per-session`. No git revert required.

Canonical Tier 1 HybridRetriever (73.2%) remains shipping default regardless of v3 outcome.

---

## 10. Open questions (decided)

| Question | Decision | Rationale |
|---|---|---|
| Different Observer prompts per pass? | No (both passes use current prompt) | Pass 1 input = single session → pass emits per-session observations naturally. Pass 2 input = multi-session → pass emits cross-session observations naturally. No prompt tuning required for MVP. If attention dilution surfaces, revisit. |
| Order of concatenation (per-session first or batched first)? | Per-session first, batched second | Per-session output is "raw detail"; batched output is "synthesis". Putting detail first then synthesis matches how the reader's `OBSERVATION_CONTEXT_INSTRUCTIONS` is written (preferring specific details when answering). |
| Run passes in parallel or serially? | Parallel (shared worker pool) | 2x calls at concurrency 6 has similar wall time to 1x at concurrency 4. No synchronization required. |
| Should `--om-mode` default become `dual-path` or stay `batched` for backward-compat? | `dual-path` | v2 batched-only is documented RED at Tier A. New default must be the best-known config. Explicit `--om-mode batched` preserves reproducibility for anyone re-running v2. |
| Include `per-session` mode at all? | Yes | Restores v1 behavior for matched-ablation runs. Code cost is tiny (gate on mode value). |

---

## 11. Acceptance

Design accepted 2026-04-22 by user: "go with option 1" after reviewing per-category Tier A v2 results and five alternative options.

Next step: invoke `superpowers:writing-plans` to produce the TDD task list, then execute inline.

End of spec.
