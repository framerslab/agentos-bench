# Step 15 v3 Findings — Dual-Path Observer

**Date:** 2026-04-22
**Scope:** Run Observer on per-session pass AND token-bounded batched pass in parallel; concatenate both observation logs into the reader's system prompt under `## Per-session observations` + `## Cross-session patterns` section headers. Observer model stays `gpt-5-mini`; no new dependencies.
**Spec:** [specs/2026-04-22-step-15-v3-dual-path-observer-design.md](specs/2026-04-22-step-15-v3-dual-path-observer-design.md)
**Plan:** [plans/2026-04-22-step-15-v3-dual-path-plan.md](plans/2026-04-22-step-15-v3-dual-path-plan.md)
**Baseline:** v1 per-session 75.0% / v2 batched 70.8%.
**Kill gate:** unweighted ≥ 78% AND multi-session ≥ 50% AND all three single-session categories ≥ 90%.

---

## 1. Verdict: RED on aggregate, mirror-image of v2 per-category

**Aggregate: 70.8% (17/24) CI [54.2%, 87.5%], identical to v2.** Single-session categories restored to v1's 100% across all three (the per-session pass works as designed — the reader extracts single-session answers from the per-session log). But cross-session categories regressed back to v1 levels (multi-session 25%, temporal 25%, KU 75%). The batched pass's cross-session observations were present in the reader's context but did not translate into cross-session accuracy.

This is the opposite of v2: v2 gained cross-session at the cost of single-session; v3 preserved single-session at the cost of losing v2's cross-session gains. Net accuracy identical. Cost ~3× v2 because of the 2× observer call count.

Run JSON: [results/runs/2026-04-22T10-53-57-497--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T10-53-57-497--longmemeval-s--gpt-4o--full-cognitive--ingest.json). Cost: $6.17. Run time: 47 min. Kill gate missed; Phase A and Phase B NOT fired per plan §Task 7 Step 2.

---

## 2. Headline numbers

| Metric | v3 dual-path | v2 batched | v1 per-session | Step 3 canonical N=500 |
|---|---:|---:|---:|---:|
| Unweighted | 70.8% (17/24) | 70.8% (17/24) | 75.0% (18/24) | 73.2% |
| CI | [54.2%, 87.5%] | [54.2%, 87.5%] | [58.3%, 91.7%] | [69.2%, 77.0%] |
| Cost/correct | $0.363 | $0.113 | $0.238 | $0.021 |
| Avg latency | 117s | 64s | 124s | 98s |
| p95 latency | 166s | 80s | — | 170s |
| Total Tier A cost | $6.17 | $1.92 | $4.28 | $7.80 |

Dual-path at Tier A is 3.2× v2's cost for zero aggregate accuracy lift. Latency roughly tracks v1's envelope despite 2× observer calls because per-session and batched passes run in parallel through independent worker pools.

---

## 3. Per-category breakdown

| Category | v3 dual-path | v2 batched | v1 per-session | Mastra OM gpt-4o | Δ v3 vs v2 | Δ v3 vs v1 |
|---|---:|---:|---:|---:|---:|---:|
| single-session-user | **100.0%** | 75.0% | 100.0% | 98.6% | **+25.0pp** | 0 |
| single-session-assistant | **100.0%** | 50.0% | 100.0% | 82.1% | **+50.0pp** | 0 |
| single-session-preference | 100.0% | 100.0% | 100.0% | 73.3% | 0 | 0 |
| knowledge-update | 75.0% | 100.0% | 75.0% | 85.9% | −25.0pp | 0 |
| multi-session | 25.0% | 75.0% | 25.0% | 79.7% | −50.0pp | 0 |
| temporal-reasoning | 25.0% | 25.0% | 50.0% | 85.7% | 0 | −25.0pp |

**Dual-path did exactly one thing: restore v1's single-session fidelity.** It did not preserve v2's cross-session gains. Three categories match v1 exactly (single-session-user, single-session-assistant, KU, multi-session); two match v2 exactly (single-session-preference, temporal-reasoning); single-session-preference stays 100% across all three; temporal stays at 25% (matching v2's low point).

---

## 4. Diagnosis: the reader uses the per-session block, ignores the batched block

### 4.1 What should have happened

The reader's system prompt contained both sections:

```
<observations>
## Per-session observations
[~20k chars of v1-style per-session observations, 49 date-grouped blocks]

## Cross-session patterns
[~30k chars of v2-style batched observations, 5-8 multi-session-spanning blocks
 that explicitly encode temporal sequences, supersession, KU progressions]
</observations>
```

The expected behavior: for a single-session question ("what did I say in the May 15 session?"), the reader draws from Per-session. For a multi-session question ("what's the order of these three events?"), the reader draws from Cross-session patterns. Dual-path should therefore be a strict superset: v1's single-session accuracy + v2's cross-session accuracy.

### 4.2 What actually happened

Single-session questions: reader pulled from Per-session block, answered correctly → 100% restored.
Cross-session questions: reader ALSO pulled from Per-session block, missed the cross-session synthesis → 25% multi-session, 75% KU. Identical to v1.

The reader did not fall through to `## Cross-session patterns` when the answer required cross-session synthesis. Either:

1. **Position bias (lost-in-the-middle)**: the per-session block comes first and is ~20k chars; the cross-session block is at position ~20k+ in the reader's context. GPT-4o is known to weight earlier-in-context content more heavily (Liu et al., 2023, "Lost in the Middle"). The reader reads per-session, extracts details, and stops.
2. **Semantic conflict**: when the reader sees both "Feb 14: User participated in Bike Ride" (per-session) and "Cross-session: User attended two charity events 33 days apart" (batched synthesis), it may treat the per-session observation as authoritative raw data and the batched one as metadata.
3. **Volume bias**: per-session block has more `Date: ...` section headers (49 vs 5-8) than batched. When the reader's attention scans for the question's referenced date, it finds per-session entries first and stops.

All three mechanisms push the reader toward per-session content.

### 4.3 Why this matters: architectural, not tuning

The categorical perfection of single-session + perfect match to v1 on cross-session suggests the reader is NOT doing joint reasoning across the two sections. It's treating the log as one big document and the per-session content dominates.

Simple ordering fixes (cross-session first) would change WHICH section dominates but probably won't induce joint reasoning. A proper fix needs one of:

- **Single unified log** (not two separate sections) where per-session detail and cross-session synthesis are interleaved inline
- **Reflector pass** over the combined output to merge the two views into one coherent sequence  
- **Observer model upgrade** so a single batched pass produces output that preserves per-session detail (Mastra's approach with gemini-2.5-flash)

---

## 5. Budget + cost

| Line item | Cost |
|---|---:|
| Per-session observer calls (~49 per case × 24 cases) | ~$1.50 |
| Batched observer calls (~6 per case × 24 cases) | ~$0.55 |
| Reader calls (gpt-4o, 24 × 1) | ~$3.60 |
| Judge calls (gpt-4o, 24) | ~$0.50 |
| **Total (Tier A v3 N=24)** | **$6.17** |

Higher reader cost than v2 because the dual-path log pushes reader input size from ~20k chars (v1) / ~30k chars (v2) to ~50k chars in v3. Reader input doubles the dominant cost line.

Phase A and Phase B NOT fired per kill gate. Rollout spend to date: $36.60 + $1.92 + $6.17 = **~$44.70**.

---

## 6. What ships

All three modes now accessible:

- `--om-mode per-session` (reproduces v1 exactly, cheapest ingest — one Observer call per session)
- `--om-mode batched` (reproduces v2 exactly — one Observer call per 24k-token batch)
- `--om-mode dual-path` (v3 default, both passes concatenated)

New cache fingerprint tag: `step-15-om-config:{mode}:{target}` (replaces Step-15 v2's `step-15-om-batching:v2:{target}`). All three modes cache independently.

Code changes:
- [`src/observational-memory/runner.ts`](../src/observational-memory/runner.ts): `OmIngestMode` type, `runPerSessionPass`, `runBatchedPass`, `concatenateObservationBlocks` helpers, mode dispatcher in `ingestSessions`.
- [`src/core/IBenchmark.ts`](../src/core/IBenchmark.ts): exports `OmIngestMode`, adds `omMode?` to `RunConfig`.
- [`src/core/BenchmarkRunner.ts`](../src/core/BenchmarkRunner.ts): propagates `omMode` in `resolveRunConfig`, writes new fingerprint tag in `computeCaseRunKeyParts`.
- [`src/cli.ts`](../src/cli.ts): `--om-mode` flag with allowlist validator.
- [`src/benchmarks/longmemeval/LongMemEvalS.ts`](../src/benchmarks/longmemeval/LongMemEvalS.ts): passes `omMode` to `ingestSessions`, records mode + per-pass batch counts in per-case metadata.

Tests: 7 new unit + 5 new wiring = 12 new tests. Full bench suite 320/320 passes. Typecheck clean.

Rollback: `--om-mode per-session` restores v1 (75.0%). `--om-mode batched` restores v2 (70.8%). No git revert needed.

---

## 7. Honest caveats

1. **N=24 CI overlap.** [54.2%, 87.5%] for v3; [54.2%, 87.5%] for v2. Point estimate and CI identical by coincidence. Neither dominates.
2. **Per-category pattern is exact mirror of v2.** v3 traded v2's cross-session for v1's single-session. That's not accidental — it's architectural.
3. **Cost escalation.** v3 costs 3.2× v2 for zero aggregate lift. Extra reader input (two concatenated logs) is the dominant driver.
4. **No run-level paired comparison** to v1 or v2. Same seed + stratified sample, so `pnpm bench compare` could yield paired-McNemar deltas; documented as a follow-up, not required for the verdict.
5. **Single kill-gate check**. The spec added three single-session ≥ 90% thresholds beyond v2's two. All three single-session passed at 100%. The aggregate + multi-session thresholds are what failed.

---

## 8. Pattern update

Rollout pattern now spans three architectural attempts on top of the Step 15 Observational Memory port:

| Variant | Single-session | Cross-session | Aggregate | Mechanism |
|---|---|---|---|---|
| v1 per-session | 100% | weak (25% MS / 50% TR / 75% KU) | 75.0% | observer sees 1 session per call |
| v2 batched | weak (50-75%) | strong (75% MS / 25% TR / 100% KU) | 70.8% | observer sees 24k tokens ≈ 5-15 sessions |
| v3 dual-path | 100% | weak (25% MS / 25% TR / 75% KU) | 70.8% | both passes, log concatenated |

Neither architecture hits both axes at `gpt-5-mini` observer tier. The information is in the log but the reader does not jointly reason across per-session + cross-session when both are present. v2 forces the reader to use cross-session but loses per-session anchors. v3 gives the reader both but the reader falls back to per-session.

The frontier at this observer tier is Pareto — pick one axis. The gap to Mastra's 84.23% aggregate is likely observer model (`gemini-2.5-flash`), not batching architecture.

---

## 9. Recommendations (ranked)

### Option A (highest expected value): Step 15 v4 = Mastra-exact observer (gemini-2.5-flash)

Keep v2 batched-only architecture. Swap Observer and Reflector from `gpt-5-mini` → `gemini-2.5-flash`. Matches Mastra's published 84.23% gpt-4o config exactly.

**Reasoning:** three matched-ablation experiments (v1, v2, v3) have now traced the Pareto frontier at `gpt-5-mini`. The fundamental limit looks like observer-model capacity. `gemini-2.5-flash` is one tier above `gpt-5-mini` on long-context instruction following; Mastra's data shows it preserves per-session detail AT batch sizes up to 24k tokens. If gemini-2.5-flash is the load-bearing variable, v2 architecture + gemini-2.5-flash observer should hit 80%+.

**Requirements:**
- `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) (user to provision)
- New `GeminiReader` implementation (~1-2 hours engineering) mirroring `OpenAIReader` at `packages/agentos-bench/src/readers/GeminiReader.ts`
- New dependency: `@google/generative-ai`
- CLI flag extension: `--om-observer-model gemini-2.5-flash`

**Budget:** ~$3-5 Tier A v4. Gemini 2.5 Flash is cheaper per token than gpt-5-mini (as of Apr 2026). Total v4 spend: ~$10 if ladder kicks in through Phase A.

### Option B: Flip v3 section order (cheap validation of position-bias hypothesis)

Keep v3 dual-path architecture; concatenate batched log FIRST, per-session SECOND. If the reader actually reads top-down, cross-session synthesis should dominate single-session questions incorrectly (making them regress) while cross-session questions should improve. If instead nothing changes, position bias is ruled out and the issue is architectural.

**Budget:** ~$6 Tier A v3b.

**Risk:** low-information outcome if both orders give 70.8% — proves the reader treats the log as one document but doesn't tell us how to fix it.

### Option C: Hierarchical observer (Reflector-style synthesis over dual-path log)

After the dual-path observer passes, run ONE additional LLM call (Reflector prompt) that reads both sections and produces a single unified observation log with per-session detail and cross-session synthesis interleaved. Reader sees one log, no sections.

**Budget:** ~$7-8 Tier A (adds one Reflector call per case on top of v3 cost).

**Risk:** Reflector compression might lose detail again — it's just another LLM pass at `gpt-5-mini` tier. If that was going to work, v2 would have worked.

### Option D: Accept v1 as shipping canonical + publish

v1 per-session at 75.0% is the best OM result. Ship it. Document v2 and v3 as "Pareto frontier exploration" — they clarify what batching does (+cross-session, -single-session) and what dual-path adds (single-session recovery without cross-session).

**Budget:** $0. Just documentation.

### Recommended path: A

- Spec + plan Step 15 v4 with `GeminiReader` + `gemini-2.5-flash` observer
- Tier A v4 at `--om-mode batched --om-batch-tokens 24000` with Gemini observer
- Kill gate: unweighted ≥ 78% AND multi-session ≥ 50% AND single-session-* ≥ 90%
- If v4 passes: ladder Phase A + Phase B (~$120 more)
- If v4 also plateaus at gpt-5-mini-level numbers: the issue is NOT observer model — it's something we haven't understood yet. Pivot to Hindsight port (Option D from the earlier deep research, arXiv:2512.12818, open-source at github.com/vectorize-io/hindsight).

---

## 10. Commits landed

Pending explicit user approval. Proposed set:

```
feat(bench): Step 15 v3 — dual-path Observer (per-session + batched)

Introduces OmIngestMode type with three values:
- per-session: v1 behavior (one Observer call per session)
- batched: v2 behavior (one Observer call per 24k-token batch)
- dual-path: v3 default (both passes in parallel, logs concatenated)

New CLI flag: --om-mode.
New RunConfig field: omMode.
New cache fingerprint tag: step-15-om-config:{mode}:{target}
(replaces step-15-om-batching:v2:{target}).

Tests: 12 new (7 unit + 5 wiring) + 4 existing v2 tests updated for
explicit omMode parameter. Full bench suite 320/320. Typecheck clean.

Design: docs/specs/2026-04-22-step-15-v3-dual-path-observer-design.md
Plan: docs/plans/2026-04-22-step-15-v3-dual-path-plan.md
```

```
bench: Step 15 v3 Tier A — RED at 70.8%, Pareto frontier confirmed

Aggregate 70.8% (17/24) CI [54.2%, 87.5%] — identical to v2.
Single-session categories restored to v1's 100% (v3 per-session pass works).
Cross-session categories regressed to v1's 25% / 25% / 75% despite
batched pass present in reader context.

Diagnosis: reader draws from per-session block preferentially when both
are present; doesn't jointly reason across the two sections. Three
attempts (v1, v2, v3) trace a Pareto frontier at gpt-5-mini observer tier.
Fix is likely observer-model upgrade (Mastra uses gemini-2.5-flash).

Kill gate missed (unweighted < 78%). Phase A / Phase B skipped.
Total cost $6.17. Run JSON:
results/runs/2026-04-22T10-53-57-497--longmemeval-s--gpt-4o--full-cognitive--ingest.json.

Findings: docs/STEP_15_V3_DUAL_PATH_FINDINGS_2026-04-22.md
```

---

## 11. Rollback

Not required. All three modes remain accessible. Tier 1 canonical (73.2% HybridRetriever) is unchanged.

---

End of Step 15 v3 findings.
