# Token-Retention Measurement Framework + First Incremental Tuning Cycle

**Date:** 2026-04-23
**Status:** Design v1; replaces handoff candidate #1's "tuned OM observer prompt" framing with a measurement-first approach.
**Supersedes:** None. New foundational instrumentation that all of handoff §5 candidates 1-7 will use.
**Authoring context:** Selected after the 26-experiment rollout landed Tier 1 (canonical 73.2%) + Tier 2 (16c v10 74.6%) at Phase B N=500. The user requested a "best measure test and incrementally improve before making final architectural decisions" framework rather than another single-shot tactical swing. Budget approved up to $1k+.

---

## 1. Summary

Add a token-retention metric to the bench that decomposes Tier 1 canonical, Tier 2 v10 router, and Tier 3 v5 OM-only pipelines into per-stage retention rates. The metric measures what fraction of high-IDF tokens (named entities, dates, numeric values, specific terms) from the gold answer survive each pipeline stage end-to-end (raw → observer → retrieved passages → reader answer).

The framework decomposes the v5 vs canonical Pareto trade into a measurable diagnostic: per-category, per-stage retention rates surface which pipeline layer drops the most high-IDF tokens. Candidate #1 (tuned OM observer prompt) then tunes the layer with the worst retention rather than guessing which prompt section to edit.

The framework is durable across all of handoff §5 candidates 1-7. Subsequent experiments use the metric to target their tuning to the right layer instead of running blind ablations.

**Measurement-first ROI claim:** at $1k+ budget, the marginal cost of the framework (~$70 baseline runs across 3 tiers + ~6 hours of code) buys diagnostic backing for every subsequent tuning iteration. Without it, candidates 1-7 each cost $30-400 and produce one accuracy datapoint apiece. With it, each candidate produces accuracy + retention + per-stage diagnosis, so failures are interpretable and successes generalize.

---

## 2. Architecture

Three new bench-side artifacts and one schema extension.

### 2.1 `src/core/metrics/computeTokenRetention.ts` (new module)

Pure function, deterministic, no I/O. Sits alongside the existing ten metric modules at [src/core/metrics/](../../src/core/metrics/).

```typescript
import type { CaseResult } from '../IBenchmark.js';
import type { BootstrapResult } from './computeBootstrapCI.js';
import type { QuestionCategory } from '../../observational-memory/questionRouter.js';

export interface TokenRetentionStageRates {
  /** Cases where this stage applies (e.g., observer rates only count OM cases). */
  n: number;
  /** Bootstrap-summarized mean retention (value + ciLo + ciHi + resamples + ci). */
  retention: BootstrapResult;
}

export interface TokenRetentionPerCategory {
  rawToObserver?: TokenRetentionStageRates;
  rawToRetrieved?: TokenRetentionStageRates;
  observerToReader?: TokenRetentionStageRates;
  retrievedToReader?: TokenRetentionStageRates;
  e2eRetention: TokenRetentionStageRates;
}

export interface TokenRetentionResult {
  perCategory: Record<QuestionCategory, TokenRetentionPerCategory>;
  overall: TokenRetentionPerCategory;
  /** Cases excluded from per-category aggregate (n < 3 high-IDF tokens after filtering). */
  excluded: { caseId: string; category: QuestionCategory; tokenCount: number }[];
}

export function computeTokenRetention(args: {
  cases: CaseResult[];
  bootstrapResamples?: number;
  seed?: number;
}): TokenRetentionResult;
```

The `BootstrapResult` shape (`{ value, ciLo, ciHi, resamples, ci }`) matches the existing `accuracyCI`, `weightedAccuracyCI`, and `byTypeCI` fields on `BenchResult` — keeps the JSON output uniform and lets downstream consumers reuse existing CI rendering helpers.

### 2.2 `CaseRun.metadata` keys (no interface change)

`CaseRun.metadata` is already typed `Record<string, unknown>` at [IBenchmark.ts:710](../../src/core/IBenchmark.ts#L710). The runner already captures `metadata.retrievedEvidence` (verified at [LongMemEvalS.ts:589](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L589)) as `Array<{ id, content, sessionId, ... }>` for canonical and OM-with-retrieval paths. Existing convention also captures `metadata.omFinalLogChars` (the byte length, not the text) at [LongMemEvalS.ts:526](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L526) for OM paths.

This spec adds **one new metadata key** and **reuses one existing key**:

```typescript
// NEW: full text of the dual-path observation log (sibling to existing omFinalLogChars).
//      Populated by LongMemEvalS.runCase in the OM branch when an OM mode runs.
metadata.omFinalLog?: string;       // v5 / v10-OM-route / 16 / 17 only

// EXISTING: structured retrieved evidence already captured at LongMemEvalS.ts:589.
//           Aggregator extracts the .content field from each entry for retention scoring.
metadata.retrievedEvidence?: Array<{ id?: string; content?: string; sessionId?: string }>;

// Reader output is already captured as CaseRun.actualOutput (no metadata copy needed).
```

The aggregator (`computeTokenRetention`) reads these when present. v10's mixed routes per case populate the appropriate key for the route the classifier picked: canonical-route cases get `retrievedEvidence` populated and `omFinalLog` undefined, OM-route cases get the reverse. Cases where neither is populated (shouldn't happen in production tiers) fall through to `actualOutput`-only e2e measurement and are flagged in the excluded list.

### 2.3 `BenchResult.tokenRetention` aggregator

Lives alongside the existing `evidenceOrigin` aggregator on the run JSON output:

```typescript
interface BenchResult {
  // ... existing fields ...
  evidenceOrigin?: Record<string, number>;             // existing
  tokenRetention?: TokenRetentionResult;                // NEW (optional, like evidenceOrigin)
}
```

Optional to match the existing `evidenceOrigin` pattern (legacy run JSONs without retention serialize cleanly). Serialized into every new run JSON in `results/runs/` once the framework lands. Visible in the leaderboard's per-run footnotes.

### 2.4 Capture-point summary

| Stage | Source | Wiring |
|---|---|---|
| OM final log (text) | `ingest.finalLog` already in scope at [LongMemEvalS.ts:511](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L511) | Add one line: `runMetadata.omFinalLog = ingest.finalLog;` adjacent to existing `runMetadata.omFinalLogChars = ingest.finalLog.length;` (line 526) |
| Retrieved evidence (structured) | Already captured at [LongMemEvalS.ts:589](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L589) as `runMetadata.retrievedEvidence = out.retrievedEvidence;` | No new wiring; aggregator reads existing key |
| Reader answer | Already captured as `CaseRun.actualOutput` | No new wiring |

---

## 3. Token extraction methodology (heuristic v1)

For each case:

1. **Tokenize the gold answer** (lowercase, NFKD-normalize, strip punctuation, split on whitespace).
2. **Drop English stopwords** using a frozen 200-word stoplist (committed to `src/core/metrics/stopwords.ts` to avoid runtime dependency drift).
3. **Drop tokens shorter than 4 characters.** This filters articles/conjunctions/prepositions ("a", "the", "and", "of", "to", "in", "it") without dropping short proper nouns. Proper nouns shorter than 4 chars are rare on LongMemEval-S (verified empirically against 10 sampled gold answers).
4. **Remaining tokens = "high-IDF candidates"** for the case. Heuristic v1: not actual IDF over the LME-S corpus. True corpus IDF is a v2 if the heuristic produces too-noisy signals.
5. **For each candidate token, search verbatim in each pipeline stage's text.**
   - Search uses substring match after the same normalization (lowercase + NFKD).
   - Multi-occurrence in stage text counts as one match (presence, not frequency).
6. **Per-case rate at each stage** = matches / candidates.
7. **Per-category aggregate** = mean over cases in that category.
8. **Bootstrap 95% CI** = 10000 percentile-bootstrap resamples, seed=42, Mulberry32 PRNG (matching the existing `computeBootstrapCI.ts` discipline).

### 3.1 Edge cases

- **Cases with < 3 high-IDF tokens after filtering** (rare; estimated < 5% of LME-S cases) are excluded from per-category aggregates and listed in `TokenRetentionResult.excluded`.
- **Tokens that contain digits** (dates like "2024", numeric values like "$50") preserve digits during normalization. The 4-char minimum still applies (so single-digit tokens like "5" are dropped, but "2024", "$50" pass).
- **Compound tokens** (e.g., "Berlin-based") are split on hyphens during tokenization; each part is checked independently.
- **Unicode normalization:** NFKD before matching handles "café" vs "cafe" inconsistencies.

### 3.2 Why this heuristic (not true IDF)

True IDF requires a corpus pass at run time. The heuristic stoplist + length cutoff approximates IDF for the categories LongMemEval-S cares about (named entities, dates, numbers, specific values are almost always 4+ chars and not in the stoplist). The signal is **directional** (which stage drops more tokens than another), not absolute. v2 with true IDF only matters if the directional signal is too noisy to drive tuning decisions, which we can verify after the baseline run.

---

## 4. Per-tier instrumentation plan

| Tier | Pipeline stages | Captured fields | Retention rates measured |
|---|---|---|---|
| **Tier 1 canonical** | raw → HybridRetriever (BM25+dense+RRF+rerank) → top-K passages → reader | `metadata.retrievedEvidence`, `actualOutput` | rawToRetrieved, retrievedToReader, e2e |
| **Tier 2 v10 (canonical route, ~80%)** | same as Tier 1 | same | same as Tier 1 |
| **Tier 2 v10 (OM route, ~20%)** | raw → v5 observer → dual-path log + scaffold → reader | `metadata.omFinalLog`, `actualOutput` | rawToObserver, observerToReader, e2e |
| **Tier 3 v5 OM-only (every case)** | raw → v5 observer → dual-path log + scaffold → reader | same | same as v10 OM route |

Per-case `metadata` fields are populated based on which path runs. The aggregator handles `undefined` stages gracefully (excludes them from the corresponding rate).

---

## 5. First experiment using the framework

### 5.1 Phase 1: framework validation (no LLM cost)

1. Implement `computeTokenRetention.ts` with unit tests (5+ tests covering: stopword filtering, length cutoff, NFKD normalization, multi-occurrence counting, edge cases).
2. Wire the metadata capture in `LongMemEvalS.runCase` for both routes.
3. Wire the aggregator into `BenchResult` JSON serialization.
4. Run `pnpm typecheck` (must be silent) + `pnpm vitest run` (must pass 380+ tests including the 5 new ones).

### 5.2 Phase 2: cross-tier baseline measurement (~$70 LLM)

Three parallel Tier A N=24 runs. No new CLI flag needed — the metric is pure aggregation over existing case data and runs by default once the framework lands.

1. **Tier 1 canonical baseline** (~$10): `--hybrid-retrieval --context-summary gpt-5-mini --reader-top-k 10`.
2. **Tier 2 v10 baseline** (~$30): adds `--observational-memory --om-mode dual-path --om-reader-scaffold --om-observer-model gpt-4o --om-dynamic-router --om-classifier-fewshot`.
3. **Tier 3 v5 baseline** (~$30): same as v10 minus `--om-dynamic-router --om-classifier-fewshot` (always-on OM, no router).

The Phase 2 runs intentionally fire after the `retention-instrumentation:v1` cache fingerprint bump (see §10), so they write fresh case-run entries with the new `metadata.omFinalLog` populated. Outputs: 3 run JSONs each with `tokenRetention` populated per category.

### 5.3 Phase 3: diagnosis (no LLM cost)

Write a one-page findings doc comparing per-category retention rates across the 3 tiers. Specific questions the diagnosis must answer:

- For each category (KU, MS, TR, SSU, SSA, SSP), what is the dominant token loss layer in v5? In v10 OM route? In canonical?
- Does the v5 observer drop more KU/MS tokens than the v10 canonical route's retriever?
- Does the canonical reader cite a higher fraction of retrieved-passage tokens than the v5 reader cites of observer-output tokens?
- Where is the SSA -12.8pp v5-vs-canonical drop coming from at the retention level?

### 5.4 Phase 4: targeted tune (~$30 LLM)

Based on the Phase 3 diagnosis, edit the prompt section corresponding to the worst-retention layer:

| Diagnosis | Tune target |
|---|---|
| Observer drops KU/MS tokens more than reader cites them | Add LongMemEval-style anti-paraphrase examples to `OBSERVER_EXTRACTION_INSTRUCTIONS`. Bump `OM_PROMPT_HASH`. |
| Reader doesn't cite observer tokens enough | Tighten `OBSERVATION_CONTEXT_INSTRUCTIONS` or `CROSS_SESSION_READER_SCAFFOLD` to require verbatim citation of named entities / dates / numeric values. |
| Canonical retriever returns gold-token-poor passages | Tune `HybridRetriever` rerank weights (out of OM scope; defer to a separate spec). |
| Canonical reader doesn't cite passage tokens | Add a passage-citation discipline to the reader system prompt. |

Run the tuned variant at Tier A N=24 (~$30). Compare retention deltas + accuracy deltas vs the Phase 2 baseline.

### 5.5 Phase 5: kill-criteria gate

- **GREEN at Tier A:** tuned-layer retention improvement ≥ 5pp AND aggregate accuracy ≥ baseline (no regression > 2pp on any single category) → ladder to Phase A with explicit user approval (~$80).
- **RED at Tier A:** zero retention improvement OR aggregate accuracy regression > 5pp → STOP, write findings, diagnose what went wrong, propose a different layer or different prompt direction, re-spec.
- **NULL at Tier A:** retention improved but accuracy unchanged → useful diagnostic (the layer's tokens weren't the bottleneck; reader doesn't cite them anyway), document and consider tuning a different layer.

---

## 6. Kill criteria

### 6.1 Framework gate (Phase 1)

- `pnpm typecheck` silent
- `pnpm vitest run` passes 380+ tests (375 existing + 5 new)
- Pilot run on a single LongMemEval-S case produces non-trivial retention numbers (not all 100%, not all 0%)
- `BenchResult.tokenRetention` serialized into run JSON correctly (verified by re-loading and asserting structure)

### 6.2 Baseline gate (Phase 2)

- All 3 Tier A runs complete without errors
- Per-category sample sizes are reasonable (n ≥ 4 per category after exclusions for cases with < 3 high-IDF tokens)
- Retention numbers are interpretable (e.g., observer rate > 0%, reader rate ≤ observer rate, e2e ≤ either)

### 6.3 Tuning experiment gate (Phase 4)

Per kill ladder:
- Tier A: tuned-layer retention improvement ≥ 5pp AND aggregate accuracy ≥ baseline (no regression > 2pp on any single category) → continue to Phase A.
- Tier A: zero retention improvement OR aggregate accuracy regression > 5pp → STOP. Diagnose, write findings, re-spec.
- Phase A: per existing kill ladder (handoff §11), < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.
- Phase B: explicit user approval required before firing ($120-150 commitment).

---

## 7. Cost ledger

| Item | Cost | Cum. |
|---|---:|---:|
| Framework code (Phase 1, no LLM) | $0 | $0 |
| Tier 1 canonical baseline Tier A | ~$10 | ~$10 |
| Tier 2 v10 baseline Tier A | ~$30 | ~$40 |
| Tier 3 v5 baseline Tier A | ~$30 | ~$70 |
| Phase 4 tuning iteration Tier A | ~$30 | ~$100 |
| Optional Phase 4b second tuning iteration Tier A | ~$30 | ~$130 |
| **First-cycle ceiling (Tier A only)** | | **~$130** |
| If GREEN at Tier A, Phase A on tuned variant | ~$80 | ~$210 |
| If GREEN at Phase A, Phase B (explicit approval) | ~$120-150 | ~$330-360 |

Well within the $1k+ approved budget. The Phase B gate stays explicit-approval-required per handoff §11.

Phase 1 work is pure code (no LLM); Phase 2 baselines fire in parallel; Phase 4 fires sequentially per kill ladder. Total wall-clock estimate: ~10-12 hours including documentation, assuming framework code lands in 6 hours and runs complete in 1-2 hours each.

---

## 8. Documentation expectations

Per handoff §10:

1. **Spec doc** (this file) at `docs/specs/2026-04-23-token-retention-framework-design.md`. Done before any code.
2. **Plan doc** at `docs/plans/2026-04-23-token-retention-framework-plan.md` — checkbox tasks for `superpowers:executing-plans`. Done after spec approval.
3. **Findings doc** at `docs/STEP_18_TOKEN_RETENTION_FRAMEWORK_FINDINGS_{YYYY-MM-DD}.md` — Phase 2 baseline retention profiles + Phase 4 first tuning result. Mirrors STEP_16C_V10_PHASE_B structure: §1 Verdict, §2 Headline numbers, §3 Per-category breakdown, §4 Cost, §5 Latency, §6 Mechanism, §7 Tradeoff, §8 Recommendations, §9 Files.
4. **Umbrella scoreboard update** at `RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` — new row for the tuning iteration with verdict.
5. **LEADERBOARD.md update** ONLY IF the tuning lifts a shipping tier at Phase B (e.g., v10 Phase B → 76%+).
6. **Bench blog update** ONLY IF a shipping tier changes.
7. **Architecture decision matrix update** ONLY IF ship-tier assignments change.
8. **Next-session continuation handoff** at session end, capturing baseline retention profiles + tuning result + next-iteration recommendations.

---

## 9. Out of scope (defer)

- **True IDF over LME-S corpus.** Heuristic v1 (stopword + length filter) is the starting point. v2 with corpus-IDF only matters if the directional signal is too noisy to drive tuning decisions, which we verify after Phase 2.
- **Token retention for non-OM tiers' OBSERVER stage.** Canonical doesn't have an observer; the schema handles the `undefined` cleanly.
- **Per-stage latency methodology re-analysis.** Separate handoff §9.3 open question; tracked independently.
- **Candidates 2-7 from handoff §5.** Each gets its own spec/plan after candidate #1's first cycle lands. The framework built here applies directly to candidates 2 (v6 gpt-5 medium reasoning), 3 (Step 17 v3 BM25 session scoring), 4 (Gemini observer), and 5 (Hindsight typed networks) without further infrastructure work.
- **Multimodal benchmarks.** LongMemEval-S is text-only; the framework is text-only by construction. A multimodal extension is a separate spec.
- **Dashboard / visualization.** Run JSONs are human-readable; charts can be generated ad-hoc. A dashboard is deferrable.

---

## 10. Open questions to resolve during implementation

- **Stopword list source.** Use NLTK English stopwords (200 words) committed verbatim to `stopwords.ts`. Frozen list avoids runtime dep on NLTK.
- **Bootstrap CI implementation reuse.** The existing [computeBootstrapCI.ts](../../src/core/metrics/computeBootstrapCI.ts) takes a sample array and returns a CI. Reuse directly; pass per-case retention rates as the sample.
- **Per-route v10 attribution.** When v10 routes a case to canonical, the case's `metadata.retrievedEvidence` is populated and `metadata.omFinalLog` is undefined. The aggregator computes `rawToRetrieved + retrievedToReader + e2e` for that case. When v10 routes to OM, the reverse. The per-route aggregate is reported separately within the v10 result (using the existing `metadata.omRouterRunOM` boolean at [LongMemEvalS.ts:322](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L322) as the per-case route classifier) so we can measure the two routes' retention profiles independently.
- **Cache fingerprint impact.** The aggregator (`computeTokenRetention`) is pure aggregation over case data and does not require a fingerprint bump on its own. However, the new `metadata.omFinalLog` key will be `undefined` on case-run entries cached before this change (the existing `metadata.retrievedEvidence` key is already populated in current cached entries, so retention can be computed for canonical immediately even on cached cases). The Phase 2 baseline runs deliberately bump a `retention-instrumentation:v1` cache fingerprint (added to `computeCaseRunKeyParts` in `BenchmarkRunner.ts`) so the 3 baseline Tier A runs write fresh case-run entries with `omFinalLog` captured for OM cases. Subsequent runs (Phase 4 tune, candidates 2-7) re-use the new case-run cache normally; the fingerprint bump is one-time.

---

## 11. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Heuristic token extraction too noisy to drive tuning decisions | After Phase 2, inspect per-category retention numbers. If CIs are wider than 15pp at Tier A N=24, escalate to Phase A N=102 for the baseline (~$60 extra) before tuning. |
| Tuning the diagnosed layer doesn't move accuracy | Documented as NULL result. The diagnosis itself is valuable: the layer's tokens aren't the bottleneck. Try a different layer or a different mechanism (e.g., reader instruction vs prompt edit). |
| Adding `omFinalLog` (full text) to case metadata bloats run JSONs | Per-case OM final log is ~5-15KB (existing `omFinalLogChars` confirms typical sizes). At N=500, adds ~5MB to the run JSON. Within reasonable bounds — existing run JSONs are 100KB-5MB depending on cases included. If size becomes a problem, gate the field behind a `--capture-om-final-log` flag in a follow-up. |
| Retention metric computation is slow on large runs | Pure-function in TypeScript; estimated ~50ms per case for tokenization + matching at typical observer log sizes. N=500 = ~25 seconds aggregate. Negligible. |

---

## 12. Acceptance criteria

The framework is "shipped" when:

1. ✅ `computeTokenRetention.ts` exists and passes its 5+ unit tests.
2. ✅ `LongMemEvalS.runCase` populates the new metadata fields for both routes.
3. ✅ `BenchResult.tokenRetention` serializes into run JSONs.
4. ✅ Phase 2 produces 3 run JSONs with interpretable per-category retention numbers.
5. ✅ Phase 3 findings doc identifies the bottleneck layer per category.
6. ✅ Phase 4 either GREEN-ladders to Phase A or RED-stops with diagnosis.
7. ✅ Findings doc + umbrella update + next-session handoff committed (commits ONLY when user explicitly asks).

---

## 13. Files to create / modify

**New:**
- `src/core/metrics/computeTokenRetention.ts`
- `src/core/metrics/stopwords.ts`
- `tests/computeTokenRetention.spec.ts`
- `docs/STEP_18_TOKEN_RETENTION_FRAMEWORK_FINDINGS_{YYYY-MM-DD}.md` (after Phase 4)
- `docs/plans/2026-04-23-token-retention-framework-plan.md` (after spec approval)

**Modified:**
- `src/core/metrics/index.ts` (export the new module)
- `src/core/IBenchmark.ts` (add `tokenRetention?: TokenRetentionResult` to `BenchResult`; document the reserved `metadata.omFinalLog` (new) key alongside the existing `metadata.retrievedEvidence` and `metadata.omFinalLogChars` keys in JSDoc on `CaseRun.metadata`. No interface signature changes for `CaseRun.metadata` itself, since it is already `Record<string, unknown>`.)
- `src/benchmarks/longmemeval/LongMemEvalS.ts` (populate metadata fields per route)
- `src/core/BenchmarkRunner.ts` (call `computeTokenRetention` and populate `BenchResult.tokenRetention` at run completion)
- `src/cli.ts` (no flag needed; metric runs by default — it's pure aggregation over existing data)
- `RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` (after Phase 4, add scoreboard row)

---

End of design.
