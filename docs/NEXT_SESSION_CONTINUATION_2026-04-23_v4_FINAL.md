# NEXT_SESSION_CONTINUATION — v4 FINAL (post-Phase-B Step 18 v2 + documentation push + coderabbit hardening)

**Date written:** 2026-04-23 end-of-day (handoff body); end-of-session addendum below
**Supersedes:** [NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md) (which was written before the v11 documentation push and the Tier 3 policy router product-feature decision)
**Author intent:** this handoff is written for a FRESH-CONTEXT Opus 4.7 session. It assumes zero prior knowledge of the AgentOS bench rollout. Read it linearly, verify state with the pre-flight checklist, then execute the four task blocks (final testing → final review → policy router spec → commits).

---

## END-OF-SESSION ADDENDUM (post-handoff, pre-commit)

After this handoff was written, the same session ran a coderabbit:code-reviewer pass on the Step 18 + Step 19 code surface area. Coderabbit reported **0 critical, 2 HIGH, 5 MEDIUM, 5 LOW, 4 NIT, 3 architectural notes**. All findings except 1 (L5 — hypothetical Vitest module-cache concern) were applied as a single hardening pass before commit. Each fix verified by grep evidence; M5 (empty-bucket coverage tests) verified via RED-GREEN cycle (broke `emptyBucket` sentinel → 1 test correctly failed → reverted → 11/11 GREEN restored).

**Coderabbit fixes applied:**
- **H1** — `--om-retriever-ms-bm25-weight` now uses `parseUnitIntervalWeight` to enforce `0 ≤ w ≤ 1`. Previously accepted `0` (silent disable of sparse) and `>1` (negative dense weight breaking RRF).
- **H2** — `RunConfig.captureRetentionInputs?: boolean` flag added with default `true`; `--no-capture-retention-inputs` opt-out for runs that don't consume the retention metric (saves ~10-20MB per cached run JSON at N=500).
- **M1** — stale docstring at `computeTokenRetention.ts` (excluded threshold) corrected to "zero high-IDF tokens after stopword + length filtering".
- **M2** — stale JSDoc at `extractHighIdfTokens.ts` corrected to `length >= MIN_TOKEN_LENGTH (=2)`.
- **M3** — added "SEMANTICS NOTE" block documenting that `observerToReader` and `retrievedToReader` are **absolute reader-side rates per-stage-source** (not conditional rates); when both stages are present they collapse to `e2e`. Includes formula for true conditional rates if a consumer wants them.
- **M4** — `--om-retriever-ms-overfetch` now uses `parsePositiveInteger` (was `parseFloatArg`).
- **M5** — added 3 empty-bucket coverage tests (`whenWrong` empty when all-passed; `whenCorrect` empty when all-failed; per-category sentinel applies independently). Test count 418 → 421.
- **L1** — added "SECURITY NOTE" docstring on `routerCategory` parameter explaining the Set-membership-only safety property and how to harden if the call site is ever refactored to interpolate.
- **L2** — switched `extractHighIdfTokens` and `scoreStageRetention` from `[a-z0-9]` regex to Unicode-aware `\p{L}\p{N}` (with `u` flag) so CJK and other non-Latin scripts are preserved.
- **L3** — `scoreStageRetention` switched from substring `.includes()` to whole-token Set-membership match. Prevents short tokens like `'50'` from inflating retention by matching inside `'1950'` or `'$50'`.
- **L4** — added comment at the OM-with-retrieval branch in `LongMemEvalS.ts` documenting that Step 19 overrides are intentionally NOT passed there (Step 16 family is RED; canonical-only mode is the intended target for Step 19 knobs).
- **N1** — `aggregateStage` closure hoisted from inside `aggregateBucket` to file scope (one fewer allocation per category-bucket call).
- **N2** — `OPTIONAL_RUN_CONFIG_KEYS` const + `OptionalRunConfigKey` type extracted as the single source of truth for `BenchContext.config` Omit/Pick lists. The two halves no longer drift; adding a new optional flag is a one-line tuple update.
- **N3** — `VERBATIM_CITATION_ELIGIBLE_CATEGORIES` co-located in `prompts.ts` next to `CONDITIONAL_VERBATIM_CITATION` (was in `runner.ts`); imported into `runner.ts`. Prevents the rule content and its eligibility set from drifting out of lockstep. The Set is `Object.freeze`'d at module init.
- **N4** — pinned the `DEFAULT_ROUTE` fallback assumption with an inline comment in `LongMemEvalS.ts` so a future change to `DEFAULT_ROUTE` doesn't silently break v11 routing.
- **A1** — pinned the `retention-instrumentation:v1` cache fingerprint as INTENTIONALLY UNCONDITIONAL with a "DO NOT convert to a conditional gate — bump the version suffix instead" warning. Future schema changes must use `:v2`, `:v3`, etc.
- **A2** — added `RetentionInputs` and `RetentionRetrievedEvidence` interfaces in `core/metrics/index.ts` documenting the cross-benchmark contract for `computeTokenRetention` consumers (LOCOMO, BEAM adapters can implement against this).
- **A3** — Step 19 ground-truth gating rationale (`c.type === 'multi-session'` not router output) is documented in both code (`LongMemEvalS.ts:600-607`) AND findings doc ([STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md](STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md):88).
- **L5** — DEFERRED. Hypothetical Vitest module-cache concern with no production impact; revisit only if observed in CI.

**Final post-fix validation (fresh):**
- `pnpm typecheck`: silent exit 0
- `pnpm vitest run`: 421 tests pass across 64 files (was 418 + 3 from M5)
- `pnpm build`: silent exit 0
- All key `dist/` files present: `cli.js`, `core/metrics/computeTokenRetention.js`, `core/metrics/scoreStageRetention.js`, `observational-memory/runner.js`, `observational-memory/prompts.js`

**Commit plan executed (3 modular commits):**
1. **Code commit** — Step 18 framework + Tier 2b v11 + Step 19 plumbing + coderabbit hardenings (12 source files + 2 test files)
2. **Docs commit** — LEADERBOARD + bench blog + matrix + umbrella + STEP_18 §16 + STEP_19 findings + v3 + v4 handoffs (8 files)
3. **Provenance commit** — Phase B v11 run JSON + 8 Step 19 variant JSONs + summary.json (10 files)

Pushed to `origin/master` (manicinc/voice-chat-assistant) — the bench package lives in the monorepo tree (NOT a submodule).

The rest of this handoff describes the state the next session inherits.

---

---

## 0. Why this handoff exists (mission summary)

The AgentOS LongMemEval-S benchmark rollout shipped its third production tier (Tier 2b v11) at end-of-day 2026-04-23. The benchmark methodology now includes a per-correctness token-retention probe that decomposes accuracy by per-stage retention rates (raw → observer → retrieved → reader-cited) split by per-case correctness — the durable architectural contribution from this session.

**Current production tier structure (Phase B confirmed for all three tiers):**
- **Tier 1 (default):** Step 3 HybridRetriever — 73.2% [69.2%, 77.0%] N=500 at gpt-4o reader+judge, $0.0213/correct
- **Tier 2a (opt-in):** v10 dynamic router (gpt-5-mini fewshot classifier; KU/MS → OM, SSU/SSA/SSP/TR → canonical) — 74.6% [70.8%, 78.4%], $0.327/correct, 8.3x faster reader latency, +5.3pp MS
- **Tier 2b (opt-in, refinement of v10):** v10 + conditional verbatim rule on KU/SSU router categories — 75.4% [71.6%, 79.0%], $0.436/correct, +1.5pp MS vs v10 / +6.8pp MS vs canonical, mechanism (per-correctness retention gap +0.495) reproduced Phase A → Phase B

**What this session accomplished:**
- Phase B Step 18 v2 confirmation at 75.4% N=500 ($164.45 cost)
- Step 19 conditional retriever-knob tuning ran, all three variants NULL on multi-session
- Documentation push: LEADERBOARD.md updated with three tier rows + footnotes; bench blog rewritten with three-tier TL;DR + Step 18 narrative section + production tier table restructure + Tier 3 policy router forward-reference; ARCHITECTURE_DECISION_MATRIX updated with Tier 2b resolution + Tier 3 roadmap; umbrella scoreboard updated with Step 18 v2 Phase B GREEN row; STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS doc has §16 Phase B section; STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS doc written

**What this session deliberately did NOT do (your job in next session):**
1. Run the full test suite (only targeted tests were run mid-session)
2. Run typecheck + build to verify the working tree compiles cleanly
3. Spec the Tier 3 budget-aware policy router product feature (queued)
4. Commit any of the working-tree changes (per CLAUDE.md commit policy: ONLY when user explicitly asks)
5. Push to remote

**Tier 3 budget-aware policy router** is the highest-priority product feature queued for this next session. ~1 week of implementation work, NO new LLM-cost runs needed (all per-category cost-accuracy curves already measured at Phase B N=500). See §6 below for the spec scope.

---

## 1. Pre-flight checklist (run BEFORE any other work)

Run these checks in parallel from the monorepo root `/Users/johnn/Documents/git/voice-chat-assistant`. They verify the working tree is in the state this handoff documents. If any check FAILS, stop and read §10 (gotchas) before proceeding.

```bash
# Verify working directory and submodule state
pwd  # must print /Users/johnn/Documents/git/voice-chat-assistant
git -C packages/agentos-bench status --short | head -30

# Verify the three production tier numbers exist in LEADERBOARD
grep -E "Tier 2[ab]|Tier 1 canonical" packages/agentos-bench/results/LEADERBOARD.md | head -3
# Expect 3 lines: Tier 2b 75.4%, Tier 2a 74.6%, Tier 1 canonical 73.2%

# Verify Step 18 v2 Phase B section exists
grep -c "75.4%" packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md
# Expect ≥3

# Verify token retention metric is present
ls packages/agentos-bench/src/core/metrics/computeTokenRetention.ts \
   packages/agentos-bench/src/core/metrics/extractHighIdfTokens.ts \
   packages/agentos-bench/src/core/metrics/scoreStageRetention.ts \
   packages/agentos-bench/src/core/metrics/stopwords.ts
# Expect all 4 files present

# Verify cache-fingerprint tag is wired
grep -n "retention-instrumentation:v1" packages/agentos-bench/src/core/BenchmarkRunner.ts
# Expect a line in resultKeyParts and runKeyParts

# Verify CONDITIONAL_VERBATIM_CITATION constant + eligibility set
grep -n "CONDITIONAL_VERBATIM_CITATION\|VERBATIM_CITATION_ELIGIBLE_CATEGORIES" \
  packages/agentos-bench/src/observational-memory/prompts.ts \
  packages/agentos-bench/src/observational-memory/runner.ts

# Verify Step 19 retriever-knob CLI flags shipped
grep -n "om-retriever-ms-k\|om-retriever-ms-bm25-weight\|om-retriever-ms-overfetch" \
  packages/agentos-bench/src/cli.ts
# Expect 3 flag definitions

# Verify env files have the rotated keys (sk-proj-F26yFdOW... and sk-ant-api03-LN_fW0lg4...)
grep -h "OPENAI_API_KEY=sk-proj-\|ANTHROPIC_API_KEY=sk-ant-api03-" \
  apps/wilds-ai/.env apps/wilds-ai/.env.local apps/wilds-ai/.env.production | head -6
```

**Expected pre-flight outcome:** all checks PASS. If any returns empty or different numbers, the working tree has drifted from this handoff's documented state — investigate before proceeding.

---

## 2. MANDATORY reading list (in order)

These four documents are the source-of-truth for the entire session. Read them in this order:

1. **[ARCHITECTURE_DECISION_MATRIX_2026-04-23.md](ARCHITECTURE_DECISION_MATRIX_2026-04-23.md)** — full tier-decision rationale for Tier 1 / Tier 2a / Tier 2b + Tier 3 roadmap (~170 lines)
2. **[STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md)** — full Step 18 v1 RED → v2 GREEN-soft → v3 NULL trajectory + Phase B confirmation in §16 (~430 lines)
3. **[STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md](STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md)** — full Step 19 retriever-knob NULL diagnosis + plumbing-shipped notes
4. **[RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md)** — the rolling 28-experiment scoreboard (~490 lines). Step 18 v2 Phase B row is at the bottom of the scoreboard table.

After reading all four, read the existing handoff as historical context only:
- [NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md) — superseded by this v4 handoff but useful for the parallel-session-revert warnings and the API-key incident details

---

## 3. Working tree state at handoff time

`git status --short` from monorepo root should show approximately this set of modifications (uncommitted):

**Bench package (modified):**
- `packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` (added Step 18 v2 Phase B + Step 19 rows; updated total cost to ~$870; updated TL;DR to mention 3 tiers + Tier 3 roadmap)
- `packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md` (§16 Phase B confirmation appended)
- `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md` (title updated to 3-tier; TL;DR rewrote for 3 tiers + 28 experiments + ~$870 cost; new Step 16c → 17 → 18 → 19 section; Production tier structure restructured into clean 3-tier table + Experimental opt-ins sub-table; What's next leads with Tier 3 policy router + Hindsight typed-network)
- `packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md` (added Step 18 v2 resolved section; Tier sourcing table refreshed with Tier 2a/2b/3; cost summary updated; Next-session work + What was decided sections added)
- `packages/agentos-bench/results/LEADERBOARD.md` (added Tier 1 / Tier 2a / Tier 2b rows + per-row footnotes + 95% CI column; updated `Last updated` timestamp)
- `packages/agentos-bench/results/summary.json` (auto-regenerated during runs)
- `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts` (Step 19 plumbing: hybridSparseWeightOverride, hybridOverFetchMultiplierOverride; per-case override gating on `c.type === 'multi-session'`; runMetadata captures `expected`, `type`, `omFinalLog`, `retrievedEvidence`; computeTokenRetention call in aggregate())
- `packages/agentos-bench/src/core/IBenchmark.ts` (added `tokenRetention?: TokenRetentionResult` to BenchResult; expanded BenchContext.config Omit/Pick lists with Step 19 fields; CaseRun.metadata JSDoc documents reserved keys)
- `packages/agentos-bench/src/observational-memory/runner.ts` (added `routerCategory?: string` param to `buildOmReaderSystemPrompt`; VERBATIM_CITATION_ELIGIBLE_CATEGORIES = {knowledge-update, single-session-user})
- `packages/agentos-bench/tests/buildOmReaderSystemPrompt.spec.ts` (test for SSA NOT eligible since v3 reverted to v2)
- `packages/agentos-bench/src/micro/WorkingMemoryCapacity.ts` (modified pre-session, not by Step 18 work)

**Bench package (untracked new files):**
- `packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md` (superseded by this v4)
- `packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v4_FINAL.md` (this file)
- `packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md`
- `packages/agentos-bench/results/runs/2026-04-23T16-21-*` and `2026-04-23T16-49-*` etc. (Step 18 + Step 19 run JSONs — keep ALL of them; they're the run-level provenance for the findings docs)

**Bench package (potentially missing from this list — verify in pre-flight):**
- `packages/agentos-bench/src/core/metrics/stopwords.ts` (NEW)
- `packages/agentos-bench/src/core/metrics/extractHighIdfTokens.ts` (NEW)
- `packages/agentos-bench/src/core/metrics/scoreStageRetention.ts` (NEW)
- `packages/agentos-bench/src/core/metrics/computeTokenRetention.ts` (NEW)
- `packages/agentos-bench/src/observational-memory/prompts.ts` (CONDITIONAL_VERBATIM_CITATION constant added)
- `packages/agentos-bench/src/core/BenchmarkRunner.ts` (retention-instrumentation:v1 fingerprint + Step 19 resolveRunConfig pass-through)
- `packages/agentos-bench/src/cli.ts` (3 new Step 19 flags)
- 4 new tests: `tests/stopwords.spec.ts`, `tests/extractHighIdfTokens.spec.ts`, `tests/scoreStageRetention.spec.ts`, `tests/computeTokenRetention.spec.ts`
- `tests/computeTokenRetention.integration.spec.ts` (Phase 1 framework gate, optional)
- `tests/step15ObservationalMemory.wiring.spec.ts` (2 new fingerprint-presence tests)

If any of those new files/edits are MISSING from the working tree, a parallel session may have reverted them (this happened multiple times during the session — see §10).

**Other monorepo state (NOT touched by this session, leave alone):**
- `apps/wilds-ai/.env`, `.env.local`, `.env.production` (rotated OpenAI + Anthropic keys; do NOT modify)
- `apps/wilds-ai/packages/wilds-schema/src/blueprint.ts` etc. (parallel session work)
- All `apps/*/` submodules in dirty state

---

## 4. Task A — Final testing (run from `packages/agentos-bench/`)

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench

# 1. Typecheck — must exit silent 0
pnpm typecheck

# 2. Targeted tests for new Step 18 + Step 19 work
pnpm vitest run \
  tests/stopwords.spec.ts \
  tests/extractHighIdfTokens.spec.ts \
  tests/scoreStageRetention.spec.ts \
  tests/computeTokenRetention.spec.ts \
  tests/buildOmReaderSystemPrompt.spec.ts \
  tests/step15ObservationalMemory.wiring.spec.ts \
  tests/readerTopK.spec.ts

# 3. Full test suite
pnpm vitest run

# 4. Build — must exit silent 0; produces dist/core/metrics/computeTokenRetention.js
pnpm build
ls dist/core/metrics/computeTokenRetention.js dist/core/metrics/stopwords.js
```

**Expected outcomes:**
- `pnpm typecheck`: silent exit 0
- Targeted tests: all GREEN
- `pnpm vitest run`: ~418 tests pass (375 prior + new Step 18 + Step 19 tests). Some tests may be skipped if they require live LLM calls — that's expected.
- `pnpm build`: silent exit 0; both `dist` files exist

**If any test fails:**
- Read the failing test's expectation, then read the source file under test
- The most likely failure modes are:
  - `readerTopK.spec.ts` length-pin assertion: expected `runKeyParts: 13, resultKeyParts: 15` after the `retention-instrumentation:v1` cache fingerprint addition. If this fails, check `BenchmarkRunner.ts` to verify the fingerprint is wired in BOTH `runKeyParts` and `resultKeyParts` arrays at end of `computeCaseRunKeyParts`.
  - `buildOmReaderSystemPrompt.spec.ts` SSA eligibility test: expects `VERBATIM_CITATION_ELIGIBLE_CATEGORIES` to NOT contain `single-session-assistant`. If the test expects SSA eligible, the test file is from v3 (incorrect) — keep the v2-aligned test that asserts SSA is NOT eligible.
  - typecheck failures on `BenchmarkRunner.ts` lines ~179-180: `BenchContext.config` Omit/Pick lists must include the 3 Step 19 field names (`omRetrieverMsKOverride`, `omRetrieverMsBm25Weight`, `omRetrieverMsOverFetchMultiplier`).

**Do NOT proceed to Task B until all checks pass.**

---

## 5. Task B — Final review of all documentation

Per CLAUDE.md self-review-before-implementation rule: re-read every doc you intend to commit at maximum reasoning, looking specifically for stale numbers, broken links, framing inconsistencies, and references to files/functions that don't exist.

**Files to review (in order):**

1. `packages/agentos-bench/results/LEADERBOARD.md`
   - Verify 3 AgentOS rows: Tier 2b 75.4% [71.6, 79.0] / Tier 2a 74.6% [70.8, 78.4] / Tier 1 canonical 73.2% [69.2, 77.0]
   - Verify 3 footnotes: `[^canonical]` `[^v10]` `[^v11]`
   - Verify the v11 footnote says "+1.5pp vs v10 / +6.8pp vs canonical" not the reversed
   - Verify links to STEP_18 + STEP_16C_V10 findings docs work
   - Last updated should be 2026-04-23T17:30:00.000Z

2. `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md`
   - Title: "Three Production Tiers (73.2% / 74.6% / 75.4% Phase B N=500) and a Token-Retention Method for Reader Tuning"
   - TL;DR: 3 tiers + token-retention methodology paragraph + 28 experiments + ~$870 cost
   - Inline leaderboard table at line ~32: Tier 1 / Tier 2a / Tier 2b rows
   - "Honest comparison, honest caveats" section: "What we can defensibly say" lists all 3 tiers
   - "Production tier structure" section: 3-tier table + experimental opt-ins sub-table
   - "What's next" leads with Tier 3 budget-aware policy router + Hindsight typed-network observers
   - Reproducibility section: ~$870 total, references Step 18 + Step 19 findings docs, mentions `retention-instrumentation:v1` cache tag
   - Spot-check that no number says "$0.021" instead of "$0.0213" (consistency with leaderboard)
   - Spot-check that the title's three tier numbers exactly match the LEADERBOARD numbers

3. `packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md`
   - Title indicates "RESOLVED — three-tier production structure"
   - Has the Step 18 v2 Phase B resolved section with the 75.4% number
   - "Tier sourcing for production" table has Tier 1 / Tier 2a / Tier 2b / Tier 3 / Tier 4 / Experimental rows
   - "Next-session work" section has Tier 3 budget-aware policy router + Hindsight typed-network entries
   - "What was decided" checklist at bottom

4. `packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md`
   - Top-of-doc TL;DR mentions 3 shipping tiers + ~$870 + Step 18 + Step 19
   - Scoreboard table includes "18 v2 Phase B" row labeled "GREEN-soft (SHIPPED as Tier 2b)"
   - Total cost line says ~$870

5. `packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md`
   - §16 Phase B confirmation section exists
   - Per-correctness gap +0.495 reproduction noted
   - Cost $164.45 noted
   - Per-category breakdown matches umbrella row

6. `packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md`
   - All 3 variants (K=30, BM25=0.7, overfetch=6.0) NULL on MS
   - Diagnosis: bottleneck is candidate-pool composition, not ranking
   - Plumbing shipped as opt-in flags

**Cross-doc consistency spot checks:**

```bash
# All docs should agree on Tier 2b Phase B accuracy
grep -h "75.4%" \
  packages/agentos-bench/results/LEADERBOARD.md \
  packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
  packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md \
  packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md \
  packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md | wc -l
# Expect ≥10 hits

# All docs should agree on per-correctness gap +0.495
grep -h "0.495" \
  packages/agentos-bench/results/LEADERBOARD.md \
  packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
  packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md \
  packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md | wc -l
# Expect ≥6 hits

# Total session cost should be consistent
grep -h "~\$870\|approximately \$870" \
  packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
  packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md \
  packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md
# Expect ≥3 hits
```

**If any inconsistency is found:** fix it. Treat the LEADERBOARD numbers as canonical (it was written first this session).

---

## 6. Task C — Tier 3 budget-aware policy router spec (the new product feature)

**Why this matters.** Memory-architecture vendors (Mem0, Mastra, Supermemory, Zep) ship one architecture each. Cost-aware LLM routing prior art ([FrugalGPT (Chen et al. 2023, arXiv:2305.05176)](https://arxiv.org/abs/2305.05176), [RouteLLM (LMSYS 2024)](https://lmsys.org/blog/2024-07-01-routellm/), [AutoMix (Madaan et al. 2023, arXiv:2310.12963)](https://arxiv.org/abs/2310.12963)) routes between MODELS at fixed pipelines. Routing between RETRIEVAL ARCHITECTURES at a fixed reader, parameterized by per-category × per-tier cost-accuracy curves measured at Phase B N=500, is genuinely under-explored. AgentOS has the Phase B data to power this. Estimated work: ~1 week, no LLM-cost runs needed.

**Deliverable:** a spec doc at `packages/agentos-bench/docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md` covering the points below.

**Spec scope:**

### 6.1. Decision matrix interface

Given a query, the policy router needs three inputs to decide a backend:
1. **Predicted category** — already produced by the v10 gpt-5-mini fewshot classifier ($0.0005/query)
2. **Budget envelope** — a per-query USD ceiling (configurable; default e.g., `$0.10`) OR a per-session/per-month USD ceiling tracked across calls
3. **Workload prior** — optional explicit hint from the calling app about its workload mix (defaults to a generic uniform prior)

Output: a backend selection from `{tier_1_canonical, tier_2a_v10, tier_2b_v11, future_tier_4}`.

### 6.2. Cost-accuracy curve table (already measured)

Per category × per tier accuracy at Phase B N=500:

| Category | n | Tier 1 canonical | Tier 2a v10 | Tier 2b v11 |
|---|---:|---:|---:|---:|
| single-session-user | (TBD from run JSON) | (TBD) | (TBD) | 98.6% |
| single-session-assistant | 56 | (TBD) | 87.5% | 83.9% |
| single-session-preference | (TBD) | (TBD) | (TBD) | 63.3% |
| knowledge-update | (TBD) | 86.8% | (TBD) | 87.2% |
| multi-session | 133 | 54.9% | 60.2% | 61.7% |
| temporal-reasoning | (TBD) | (TBD) | (TBD) | 69.2% |

Per query cost:
- Tier 1: $0.0213 / correct ≈ $0.016 / query (raw cost before correctness rate)
- Tier 2a: $0.327 / correct ≈ $0.244 / query
- Tier 2b: $0.436 / correct ≈ $0.329 / query

**Action item:** the spec needs to read the Phase B run JSONs (`results/runs/2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json` for Tier 1; `2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json` for Tier 2a v10; the most recent 2026-04-23 ingest run for Tier 2b v11) and fill in the (TBD) cells from the actual `caseResults` arrays. Use a per-category aggregation over `case.success` filtered by `case.metadata.type`.

### 6.3. Decision algorithm

Two reasonable approaches to consider in the spec:

**Approach A: greedy max-EV under budget constraint.**
For each backend `b`, compute expected accuracy contribution `E[acc | b, category]` from the table above. Pick the backend with the highest expected accuracy whose per-query cost ≤ budget envelope.

**Approach B: EV-per-dollar maximization.**
Pick the backend with the highest `(accuracy_lift_over_baseline) / (cost_premium_over_baseline)` ratio. This naturally prefers Tier 1 for categories where the lift to Tier 2a/2b is small relative to the cost premium.

The spec should pick one and explain the reasoning.

### 6.4. CLI interface

```
--policy-router \
  --budget-per-query 0.10 \
  --workload-prior uniform | --workload-prior-file <path>
```

Or session-level:
```
--policy-router \
  --budget-per-session 5.00 \
  --policy-router-state <path-to-running-spend-json>
```

### 6.5. Provenance + observability

Every router decision needs to be traceable in the bench results JSON. Add `case.metadata.policyRouterDecision: { backend: string, reasoning: string, costUsed: number }` so downstream analysis can compute per-backend hit rate, average cost-per-correct, and budget-envelope breach rate.

### 6.6. Validation plan

The policy router itself doesn't need a Phase B run — the per-backend accuracies are already measured. What needs validation is the routing-decision quality:

1. **Tier A N=24 sanity check** (~$5): run policy router with `--budget-per-query 0.10` on the smoke set; verify it picks Tier 1 ≥ 80% of the time and Tier 2a/2b for the high-value-per-query categories
2. **Phase A N=102 confirmation** (~$30): confirm aggregate accuracy ≥ Tier 1 baseline at strictly lower average cost-per-query
3. **Phase B N=500** is OPTIONAL — Phase A confirmation is sufficient since the per-backend accuracies already have Phase B N=500 CIs

Total LLM-cost validation: ~$35 if you run all three; ~$5 if just the smoke check.

### 6.7. Open questions for the spec author

- Should the budget envelope be hard or soft? (Hard = never exceed; soft = exceed if expected accuracy gain > 2x marginal cost)
- Should the router learn from production traffic? (i.e., update its cost-accuracy estimates per-tenant based on actual hit rate) — out of scope for v1, mention as future work
- Should it expose a "cheapskate mode" / "premium mode" preset? (Just a budget-envelope shortcut, but useful for UX simplicity)
- How does it interact with prompt caching? (If the same query hits cache, is the cost zero? Probably yes for the reader call, but classifier still runs.)

---

## 7. Task D — Commits + push (ONLY when user explicitly approves)

**CRITICAL:** per CLAUDE.md commit policy, do NOT commit anything until the user explicitly says "commit it" or "push it" or equivalent. This handoff documents the commit plan; the user authorizes execution.

When authorized, suggested commit groupings (each as a separate commit, in this order):

### Commit 1: Step 18 framework + Tier 2b v11 production code

```bash
git add packages/agentos-bench/src/core/metrics/stopwords.ts \
        packages/agentos-bench/src/core/metrics/extractHighIdfTokens.ts \
        packages/agentos-bench/src/core/metrics/scoreStageRetention.ts \
        packages/agentos-bench/src/core/metrics/computeTokenRetention.ts \
        packages/agentos-bench/src/core/metrics/index.ts \
        packages/agentos-bench/src/core/IBenchmark.ts \
        packages/agentos-bench/src/core/BenchmarkRunner.ts \
        packages/agentos-bench/src/observational-memory/runner.ts \
        packages/agentos-bench/src/observational-memory/prompts.ts \
        packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts \
        packages/agentos-bench/src/cli.ts \
        packages/agentos-bench/tests/stopwords.spec.ts \
        packages/agentos-bench/tests/extractHighIdfTokens.spec.ts \
        packages/agentos-bench/tests/scoreStageRetention.spec.ts \
        packages/agentos-bench/tests/computeTokenRetention.spec.ts \
        packages/agentos-bench/tests/buildOmReaderSystemPrompt.spec.ts \
        packages/agentos-bench/tests/step15ObservationalMemory.wiring.spec.ts \
        packages/agentos-bench/tests/readerTopK.spec.ts

git commit --no-verify -m "feat(agentos-bench): token-retention framework + Tier 2b v11 conditional verbatim reader

Adds per-stage + per-correctness token-retention metric (raw → observer →
retrieved → reader-cited) with bootstrap CIs. Cache fingerprint
retention-instrumentation:v1 ensures post-hoc rescoring is cache-safe.

Conditional verbatim citation rule appended to OM reader prompt only when
the v10 classifier returns knowledge-update or single-session-user. Step 19
adds opt-in retriever-knob CLI flags (--om-retriever-ms-k,
--om-retriever-ms-bm25-weight, --om-retriever-ms-overfetch).

Phase B N=500 confirmation: 75.4% [71.6, 79.0] at gpt-4o reader+judge,
+1.5pp MS vs v10 / +6.8pp MS vs canonical. Ships as Tier 2b production
opt-in (refinement of v10)."
```

### Commit 2: Documentation push (LEADERBOARD + bench blog + matrix + umbrella + findings)

```bash
git add packages/agentos-bench/results/LEADERBOARD.md \
        packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
        packages/agentos-bench/docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md \
        packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md \
        packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md \
        packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md \
        packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v3_FINAL.md \
        packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v4_FINAL.md \
        packages/agentos-bench/docs/specs/2026-04-23-token-retention-framework-design.md \
        packages/agentos-bench/docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md \
        packages/agentos-bench/docs/plans/2026-04-23-token-retention-framework-plan.md \
        packages/agentos-bench/docs/plans/2026-04-23-step-19-conditional-retriever-tuning-plan.md

git commit --no-verify -m "docs(agentos-bench): three-tier production structure + Step 18 framework + Tier 3 policy router roadmap

LEADERBOARD: added Tier 1 / Tier 2a v10 / Tier 2b v11 rows with per-row
footnotes documenting mechanism + cost-accuracy tradeoffs.

Bench blog: title updated to three-tier; new Step 16c → 17 → 18 → 19
narrative section documenting the per-correctness retention probe + its
falsifiable variant; production tier table restructured into 3 + 3
experimental opt-ins; What's next leads with Tier 3 budget-aware policy
router + Hindsight typed-network observers.

Architecture decision matrix: Tier 2b resolved at 75.4%; tier sourcing
table refreshed; Tier 3 policy router + Hindsight queued.

Umbrella scoreboard: Step 18 v2 Phase B GREEN row added; Step 19 NULL row;
total cost updated to ~\$870 across 28 experiments.

Step 18 + Step 19 findings docs included. Specs + plans for both steps
included. v4 fresh-context handoff supersedes v3."
```

### Commit 3: Phase B + Step 18/19 run JSONs (provenance)

```bash
git add packages/agentos-bench/results/runs/2026-04-23T*--longmemeval-s--gpt-4o--full-cognitive--ingest.json \
        packages/agentos-bench/results/summary.json

git commit --no-verify -m "chore(agentos-bench): add Phase B Step 18 v2 + Step 19 run JSONs for provenance

Includes the Phase B Step 18 v2 N=500 run that produced the Tier 2b 75.4%
result documented in the leaderboard, plus the three Step 19 retriever-knob
NULL Tier A runs."
```

### Push

```bash
# Verify origin
git remote -v
# Expect origin = framersai/agentos or similar

# Push to master
git push origin master
```

**`--no-verify` rationale:** monorepo secretlint hook fails on tracked .env files (a known pre-existing repo issue documented in [feedback_no_verify.md](memory/feedback_no_verify.md)). This is a documented bypass per the user's standing instruction, not a workaround for new secrets being committed.

---

## 8. Task E — Bench blog publishing (depends on user direction)

The bench blog at `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md` is now ready for publishing. The publish destination is user-determined:

- **If publishing to a Medium/Substack/dev.to:** copy the markdown verbatim. The internal links to `https://github.com/framersai/agentos/...` will resolve once committed and pushed.
- **If publishing to the manicinc.com blog or a project landing page:** check if there's a Markdown → HTML pipeline; the internal links should point at the relative GitHub paths.
- **If publishing to a research-paper-style venue:** the blog needs a citation block; pull from the References section at the bottom + the per-step findings docs.

**Ask the user for the publish destination before doing anything here.** Don't assume.

The Twitter/X thread mentioned in the user's pre-launch context: 5k followers; the user is showcasing Opus 4.7 quality. A summary tweet thread would lead with the three-tier numbers + the per-correctness retention method as the architecturally honest framing.

---

## 9. Cost summary at handoff time

**Cumulative session spend (LLM):** ~$870 across 28 experiments + 3 Phase B confirmations.

Step 1-17 prior: $644.99
Step 18-19 added end-of-day (approx):
- ~$15 Step 18 v1 + v2 + v3 Tier A
- $22.85 Step 18 v2 Phase A
- $164.45 Step 18 v2 Phase B
- $5.86 Step 18 v3 retest with v10 routing (wasted on misgated MS test, kept for transparency)
- $7.92 Step 19 retriever-knob variants Tier A (3 variants)

**Original budget approval:** $1k+. Headroom for Tier 3 policy router work: $130 (likely $0 actual since policy router is pure code work).

**If user wants to fire the Hindsight typed-network observer architectural research direction (per blog "What's next"):** ~$400 Tier A → Phase A → Phase B ladder. That would push session total to ~$1270, requiring fresh budget approval.

---

## 10. Common gotchas (read this BEFORE you hit any of them)

### 10.1. Working directory matters

The monorepo uses pnpm workspaces. For ALL bench commands, you MUST be in `packages/agentos-bench/`:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm vitest run    # works
```

NOT from monorepo root:
```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
pnpm vitest run    # fails with ENAMETOOLONG (recursive symlinks in wunderland-sol submodule)
```

### 10.2. `pnpm bench` vs `pnpm exec agentos-bench`

`pnpm bench` only works from inside `packages/agentos-bench/` because it's a per-package script. From monorepo root, use `pnpm --filter @framers/agentos-bench bench` or just `cd` first.

### 10.3. API keys — both OpenAI and Anthropic were rotated this session

The working keys are in `apps/wilds-ai/.env`, `.env.local`, `.env.production`:
- `OPENAI_API_KEY=sk-proj-F26yFdOW...`
- `ANTHROPIC_API_KEY=sk-ant-api03-LN_fW0lg4...`

Bench commands must be run with the env loaded:
```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
source ../../apps/wilds-ai/.env  # or use dotenv-cli if available
pnpm bench run longmemeval-s ...
```

If a Phase B fires and gets 401 on every case, the env wasn't sourced. Verify with:
```bash
echo "OpenAI: ${OPENAI_API_KEY:0:14}... Anthropic: ${ANTHROPIC_API_KEY:0:18}..."
```

### 10.4. Parallel-session reverts

A parallel coding session was active during this rollout and reverted Step 18 wiring multiple times. The most-likely-reverted edits (re-verify before assuming they're in place):

- `src/core/metrics/index.ts` — must export the 4 new metric modules
- `src/core/IBenchmark.ts` — `BenchResult.tokenRetention?: TokenRetentionResult` and Step 19 fields in `BenchContext.config` Omit/Pick lists
- `src/core/BenchmarkRunner.ts` — `retention-instrumentation:v1` fingerprint in BOTH `runKeyParts` and `resultKeyParts` arrays
- `src/benchmarks/longmemeval/LongMemEvalS.ts` — runMetadata captures `expected`, `type`, `omFinalLog`, `retrievedEvidence`; `aggregate()` calls `computeTokenRetention`
- `src/observational-memory/prompts.ts` — `CONDITIONAL_VERBATIM_CITATION` constant
- `src/observational-memory/runner.ts` — `routerCategory?: string` param + `VERBATIM_CITATION_ELIGIBLE_CATEGORIES` Set

Run the pre-flight checklist (§1) first thing. If anything is missing, re-apply per the patterns documented in [STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md) and the spec at [docs/specs/2026-04-23-token-retention-framework-design.md](specs/2026-04-23-token-retention-framework-design.md).

### 10.5. agentos dist must contain core/ + cognitive_substrate/ subdirs

If `pnpm typecheck` from `packages/agentos-bench/` complains about missing AgentOS exports, the agentos dist is partial. Rebuild from the agentos package:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos
pnpm build
ls dist/core dist/cognitive_substrate  # must exist
```

A full agentos build produces 844 dist files. If you see only 200-300, the build is partial.

### 10.6. omGuidedRetrieval.ts has a pre-existing broken import (out of scope)

`src/observational-memory/omGuidedRetrieval.ts` has a broken `IEmbeddingManager` import that pre-dates this session (Step 17 fragility). Don't try to fix it during this session unless explicitly tasked — the Step 17 result is RED-and-deprecated and not in any production tier path.

### 10.7. Don't run the full vitest suite from monorepo root

ENAMETOOLONG due to wunderland-sol submodule symlinks. Always cd to bench package first.

### 10.8. Don't commit the `.env` files to monorepo

The `apps/wilds-ai/.env*` files are tracked (per repo policy, see [feedback_env_files_tracked.md](memory/feedback_env_files_tracked.md)) but secretlint blocks them on commit. The `--no-verify` flag bypasses secretlint but you should still NEVER `git add apps/wilds-ai/.env*` unless explicitly asked — they may have been edited in parallel by other sessions and committing them risks overwriting fresher content.

### 10.9. Submodules — do NOT touch unless explicitly asked

`apps/wilds-ai/`, `apps/paracosm/`, `apps/agentos-live-docs/`, etc. are submodules with their own git histories. The session work is entirely inside `packages/agentos-bench/` and `packages/agentos/` — do not stage or commit submodule pointer updates without explicit user request.

---

## 11. Open questions to ask the user (before proceeding)

These need explicit answers before any non-trivial action:

1. **Should Task A (testing) and Task B (review) be done now in this session, or saved for after the policy router spec is written?**
   Recommended: do A + B first (zero risk, surfaces any working-tree bugs that would compound into the spec).

2. **Should the Tier 3 policy router spec be written in this session?**
   Recommended: yes, queued for this session per v3 handoff. The spec is 0-cost (pure docs); the implementation is the next-next-session work.

3. **Should we commit the work this session?**
   Recommended: yes, after testing + review pass. Three commits as documented in §7.

4. **Should we publish the bench blog this session?**
   Depends on user direction — see §8.

5. **Should we kick off Hindsight typed-network observer work?**
   Recommended: NO this session — separate scope, fresh budget approval needed (~$400). Document in spec backlog only.

6. **Should we update the agentos main README or a public-facing landing page with the three-tier numbers?**
   Recommended: ask the user. The agentos main README at `packages/agentos/README.md` does NOT currently cite Tier 2 numbers (verified during this session); decision is whether to add them.

---

## 12. Continuation prompt for fresh-context Opus session

If you're starting this work in a brand-new Opus 4.7 session with zero context, paste this prompt verbatim after `/clear`:

```
I'm continuing the AgentOS LongMemEval-S benchmark rollout from a handoff
at packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-23_v4_FINAL.md.

Read that file end-to-end at maximum reasoning effort BEFORE doing anything
else. It documents:
- Three production tiers (Tier 1 canonical 73.2%, Tier 2a v10 74.6%,
  Tier 2b v11 75.4%) all confirmed at Phase B N=500
- A token-retention probe methodology that's the durable architectural
  contribution (per-stage + per-correctness retention split)
- Tier 3 budget-aware policy router queued as the next product feature
  spec
- Pre-flight checklist for verifying working-tree state
- Four task blocks: testing → review → policy router spec → commits
- Common gotchas (parallel-session reverts, API keys, working directory)

After reading the v4 handoff, run the §1 pre-flight checklist. If anything
fails, stop and ask before proceeding.

Once pre-flight passes, do Task A (testing) + Task B (final review) before
asking me whether to proceed with Task C (Tier 3 policy router spec) or
Task D (commits + push).

Work entirely from /Users/johnn/Documents/git/voice-chat-assistant/.
DO NOT touch submodules. DO NOT commit anything until I explicitly ask.
DO NOT run any LLM-cost benchmark runs unless I explicitly ask.
```

---

End of v4 handoff.
