---
title: Next-Session Handoff v6, After CodeRabbit Fixes (Brain 0.3.2 + remaining items)
date: 2026-04-25 (end of session)
supersedes: NEXT_SESSION_2026-04-26_HANDOFF_v5_AFTER_STAGE_E_PHASE_1-3.md
---

# Next-Session Handoff v6: After CodeRabbit Fixes

**Supersedes:** [NEXT_SESSION_2026-04-26_HANDOFF_v5_AFTER_STAGE_E_PHASE_1-3.md](NEXT_SESSION_2026-04-26_HANDOFF_v5_AFTER_STAGE_E_PHASE_1-3.md)

**Status at handoff:** all 5 top-priority CodeRabbit findings fixed and shipped to `framersai/agentos@f7ecef31` (semantic-release will auto-bump to 0.3.2 on CI). 267 retrieval tests pass locally; Postgres-gated tests (now including the new C1 rollback test and the v1 import test) run in CI. Monorepo submodule pointer bumped + pushed. The Stage E mission for next session is unchanged: Phase 4 integration into `CognitiveMemoryManager` + bench `--typed-network` wiring + first $1-5 LLM smoke.

---

## 0. The 60-second briefing

What shipped this session (in addition to v5):

| Deliverable | State | Path / Commit |
|---|---|---|
| Brain 0.3.1 hardening (16 issues from post-0.3.0 review) | DONE, shipped + auto-released by semantic-release | `framersai/agentos@b475d8f2` |
| Stage E typed-network module (Phase 1-3 of plan) | DONE, 59 unit tests | `framersai/agentos/src/memory/retrieval/typed-network/` |
| v1 publication: 4 blog posts + index update | DONE, shipped | `framersai/agentos-live-docs@0fcb600` |
| v1 publication: bench docs + eval matrix + LEADERBOARD + Stage G-M FPR probe | DONE, shipped | monorepo `4a9522d46` |
| CodeRabbit code review of all the above | DONE | conversation transcript only (not committed) |
| C1 fix: `_bulkCopy` adapter.transaction() for Postgres atomicity | DONE | agentos commit `9a907337` |
| I3 fix: importFromSqlite peek + MigrationRunner._readSchemaVersion handle v1 schema | DONE | agentos commits `9a907337` (peek) + `57e2a1c8` (runner) |
| I7 fix: stripCodeFence accepts any alphabetic language tag | DONE | agentos commit `04427cf8` |
| I9 fix: redactPostgresPassword handles keyword form | DONE, extracted to own module + 10 unit tests | agentos commit `928c5e86` |
| C2 doc: openWithAdapter concurrent-transaction JSDoc warning | DONE | bundled in `9a907337` |
| Postgres-gated test for C1 (5 valid + 1 orphan chunk rollback) | DONE | `Brain.postgres.test.ts` |
| SQLite test for v1 import path | DONE | `Brain.export-import.test.ts` |
| Monorepo submodule pointer bumped + pushed | DONE | monorepo `a71263474` |

What was NOT shipped this session (intentional deferrals):

- **CodeRabbit important items I2, I4, I5, I6, I8** (5 findings):
  - **I2:** `_initSchema` runs OUTSIDE the migration lock. Safe today (all DDL is `IF NOT EXISTS`), latent for future migrations adding non-idempotent DDL. Defer to v0.3.3 hardening when needed.
  - **I4:** `_writeSchemaVersion` doesn't seed `created_at` on first migration (semantic, not bug). Add a comment in next session if revisited.
  - **I5:** extraction-prompt.ts could echo schema fields inline for robustness against field-name drift. Improvement, not bug. Defer.
  - **I6:** `temporal.start`/`temporal.end` not paired-validated in zod schema. Half-interval malformations would slip through; downstream `TemporalIntervalOverlap.scoreOverlap` happens to handle it correctly today. Defer.
  - **I8:** empty `brain_meta` falls through to brain-id derivation. Works correctly; comment-only improvement. Defer.

- **CodeRabbit minor items M1-M8** (8 polish findings): all defer-worthy. The biggest one (M5: causal-edge bidirectional symmetry vs paper) is a deliberate design choice that the JSDoc could flag more loudly.

- **Stage E Phase 4** (CognitiveMemoryManager + bench wiring + $1-5 smoke): unchanged from v5, scope mapped in v5 §2.

- **Phase B fills on LongMemEval-M** (Tier 2b OM-v11, Tier 3 max-acc, Tier 3 min-cost): unchanged from v4. ~$36 net new LLM. Status: queued.

- **`RetrievalConfigRouter` design**: design exists in `agentos-bench/docs/specs/2026-04-26-retrieval-config-router-design.md`; no code. Decision deferred until after Stage E Phase A measures.

---

## 1. Mission for next session

Ranked by ROI per dollar:

| # | Action | Cost | Effort | Why |
|---|---|---:|---|---|
| 1 | **Stage E Phase 4 integration** (CognitiveMemoryManager wiring + bench `--typed-network` flag) | $0 | 1 day | Pure code. Connects shipped primitives to bench measurement infrastructure. |
| 2 | **Stage E Phase 4 smoke** (5 LongMemEval-S cases at `--typed-network full`) | $1-5 | 1 day | First real LLM spend. Confirms wiring works before Phase A. |
| 3 | **Stage E Phase 5 (Phase A)** | $30 | 1 day | LongMemEval-S N=54 stratified, decision gate at +2pp. |
| 4 | **Stage E Phase 6 decision** | $0 | 30 min | Iterate / Phase B / abandon. |
| 5 | **Stage E Phase 7 (Phase B)** | $290 | 2 days | Conditional on Phase A pass. |
| 6 | **Stage E Phase 8 (v2 publication)** | $0 | 1 day | Blog post + comparison-table v2. |

**Recommended starting move:** pre-flight (§4 below), then begin Phase 4 Task 1 (CognitiveMemoryManager integration). Phase 4 ends with the $1-5 smoke, which is the first real budget ask.

---

## 2. Stage E Phase 4 detailed scope (carry-over from v5 §2)

### 2.1 agentos core integration

`packages/agentos/src/memory/CognitiveMemoryManager.ts`:
- New optional config field `typedNetwork?: { variant: 'minimal' | 'full' | 'production'; observerLLM: ITypedExtractionLLM }`.
- `encode()` calls `TypedNetworkObserver.extract()` after the standard encode when typed-network is configured. Resulting facts are embedded by the existing `IEmbeddingManager` and stored in a `TypedNetworkStore` instance held by the manager.
- `retrieve()` runs the standard 6-signal scoring AND, when typed-network is configured, also runs `TypedSpreadingActivation.spread()` + `fourWayRrf()`. Final ranking merges the two ranked lists via a configurable weight (default 0.5 / 0.5; tunable via Phase A).

### 2.2 bench wiring

`packages/agentos-bench/src/cli.ts`:
- Add `--typed-network <variant>` flag accepting `minimal | full | production`.
- Thread variant through to RunConfig.

`packages/agentos-bench/src/core/IBenchmark.ts`:
- Add `typedNetwork?: 'minimal' | 'full' | 'production'` to `RunConfig`.
- Add `'typedNetwork'` to `OPTIONAL_RUN_CONFIG_KEYS`.

`packages/agentos-bench/src/core/BenchmarkRunner.ts`:
- Propagate `typedNetwork` field through the run-config resolution chain.

`packages/agentos-bench/src/cognitive/createCognitiveManager.ts`:
- When `typedNetwork` is set, construct a `TypedNetworkObserver` (with the bench's standard OpenAI LLM adapter at `gpt-5-mini`) and inject into `CognitiveMemoryManager` config.

`packages/agentos-bench/tests/resolveRunConfigContract.spec.ts`:
- Add `typedNetwork: 'full'` to SAMPLES record (regression mode the test was written to catch; Stage I work hit it once).

### 2.3 smoke test

5 LongMemEval-S cases at `--typed-network full`, single seed, `gpt-5-mini` extraction + `gpt-4o` reader. Verify:
- Typed facts are extracted and stored
- Spreading activation runs without errors
- 4-way RRF produces a non-empty fused ranking
- Reader's prompt includes typed-network results
- Total cost reported in the run JSON

Expected cost: $1-5. Total budget gate before Phase 4 starts: explicit user approval.

---

## 3. CodeRabbit findings deferred to a future hardening pass

The CodeRabbit review of this session's work surfaced these items beyond the top 5 fixed. None are bugs that fire today; all are improvements worth tracking.

### Important (deferred)

- **I2:** `_initSchema` runs outside the migration advisory lock. Currently safe (all DDL is `CREATE TABLE/INDEX IF NOT EXISTS`). Adding a non-idempotent DDL statement in a future schema would silently break two-process concurrent first-open. Mitigation when needed: wrap `_initSchema` in the same advisory-lock + transaction pattern used by `MigrationRunner.runPending`.

- **I4:** When migrating a v1 file, `MigrationRunner._writeSchemaVersion` updates `schema_version` but does not seed `created_at`. `_seedMeta` runs after migration with `INSERT OR IGNORE` and adds `created_at` then. The `created_at` of a migrated brain reflects the migration timestamp, not the original brain's creation time. Document explicitly OR (better) preserve the original `created_at` if it exists.

- **I5:** `prompts/extraction-prompt.ts` does not echo the JSON schema field names inline. The LLM is told to "output JSON matching the schema strictly" but isn't shown which fields are required. Modern models infer correctly; brittle against drift. Improvement: add a schema example block to the system prompt body.

- **I6:** `prompts/extraction-schema.ts` allows `temporal.start` and `temporal.end` independently. A malformed extraction with only `start` and no `end` slips through; downstream `TemporalIntervalOverlap.scoreOverlap` happens to handle this correctly today (only triggers in-interval logic when both are valid). Improvement: add `.refine` for the pairing constraint.

- **I8:** `Brain.importFromSqlite` accepts an empty `brain_meta` (0 rows) by falling through to path-derived brainId. Works correctly today; the path-derived brainId becomes the receiver's seed, then PORTABLE_TABLES rows import unscoped. Add a comment explaining why empty brain_meta does not fail validation.

### Minor (deferred)

- **M1:** `MigrationRunner` fresh-DB short-circuit is correct (covered).
- **M2:** `TypedSpreadingActivation` default multipliers are sane pre-ablation; Phase A will tune.
- **M3:** Spreading activation `frontier` propagation reads from live `activations` map. Geometrically correct due to monotonic max-update; add one-line comment.
- **M4:** `fourWayRrf` could fold the four `accumulate` calls into a loop. Cosmetic.
- **M5:** `TypedNetworkStore.addEdge` makes causal edges bidirectional, divergent from paper's directional causal. Deliberate for traversal symmetry; if downstream consumers need direction, add a `directional?: boolean` field on `TypedEdge`.
- **M6:** `archived_traces` brain_id-from-agent_id behavior documented but not tested. Add a Postgres-gated test.
- **M7:** Same as I5 (schema-in-prompt).
- **M8:** CHANGELOG entries for 0.3.1 are accurate (no action needed).

### CodeRabbit clean bill of health

CodeRabbit explicitly cleared:
- MigrationRunner SQLite/Postgres asymmetry (correct on both)
- Peek-then-open race window (microseconds, immaterial)
- `pg_advisory_xact_lock` namespace collisions (4.3B space, prefix-namespaced)
- `#brainId` cross-instance access (uses public `target.brainId` getter)
- 6-step extraction prompt vs paper §2.3 (matches verbatim)
- Math in TypedSpreadingActivation (Eq. 12 max-aggregation correct)
- 4-way RRF k=60 implementation
- Default edge multipliers (entity/causal=1.0, temporal=0.7, semantic=0.6) as sane pre-ablation defaults
- 59 unit tests adequate for Phase 1-3

---

## 4. Pre-flight checklist for the fresh session

Before touching anything:

1. **`git status -s`** in monorepo. Expect a few unrelated files (apps/agentos-* dirty content, src/emergent + src/sandbox files from other sessions). Confirm no agentos-bench or agentos files are dirty (clean from this session's work).

2. **`cd packages/agentos && git status -s`**. Expect only the unrelated other-session changes. HEAD should be `framersai/agentos@f7ecef31` or later (semantic-release may have created `0.3.2` if the C1/I3/I7/I9 commits triggered another release).

3. **`pnpm --dir packages/agentos-bench test 2>&1 | tail -5`**, expect `Tests 514 passed` (or 515 if flaky).

4. **Verify agentos dist is fresh:**
   ```bash
   grep "TypedNetwork" packages/agentos/dist/memory/index.js | head -3
   grep "redactPostgresPassword\|MigrationRunner" packages/agentos/dist/memory/retrieval/store/Brain.js | head -5
   ```
   If empty, run `pnpm --dir packages/agentos build`.

5. **Verify agentos typed-network exports unchanged:**
   ```bash
   grep "export.*TypedNetwork" packages/agentos/src/memory/retrieval/typed-network/index.ts
   ```

6. **Check API keys:**
   ```bash
   grep -E "^OPENAI_API_KEY=" /Users/johnn/Documents/git/super-cloud-mcps/.env  | head -1
   ```

7. **Read the four primary docs end-to-end at max reasoning:**
   - `docs/specs/2026-04-26-hindsight-4network-observer-design.md` (~330 lines)
   - `docs/plans/2026-04-26-hindsight-4network-observer-plan.md` §"Phase 4" (lines 800-900)
   - `agentos/src/memory/retrieval/typed-network/index.ts` (the surface to integrate against)
   - `results/eval-matrix-v1/comparison-table.md` (the v1 baseline Stage E pushes against)

---

## 5. Constraints (NON-NEGOTIABLE, copied from prior handoffs)

- **Git branch:** master, never main
- **Commits:** NEVER commit unless user explicitly asks
- **Push:** NEVER push unless user explicitly asks
- **Commit messages:** NEVER mention AI, Claude, Opus, rewrite, LLM. No `Co-Authored-By` lines.
- **Monorepo commits:** Always `--no-verify` (secretlint blocks tracked .env files)
- **agentos / agentos-live-docs / paracosm are submodules:** cd into each, commit, push to its origin, update submodule pointer in monorepo
- **No subagents** EXCEPT `coderabbit:code-reviewer` at end of session per user feedback memory.
- **No worktrees with submodules.** Never stash/reset/restore (other sessions are active).
- **Working dir for bench:** always `pnpm --dir packages/agentos-bench ...` or absolute paths
- **No em dashes.** Use periods, commas, or colons.
- **TDD discipline.** Failing test first, then minimal implementation. Skipping the failing-test step disqualifies the work as TDD.
- **Get explicit user approval before any new LLM run > $5.**

---

## 6. Methodology invariants (unchanged from v3 / v4 / v5)

- **Reader:** `gpt-4o` via OpenAI API. Temperature 0. Max tokens 256 reader, 1024 observer, 4096 typed-extraction.
- **Judge:** `gpt-4o-2026-08-06`. Rubric `2026-04-18.1`. Empty system prompt. Probed FPR per benchmark (S=1%, M=2%, LOCOMO=0%).
- **Bootstrap:** 10,000 resamples via Mulberry32, seed=42. 95% percentile CIs.
- **Per-case artifacts:** every shipping number has a `results/runs/<timestamp>--...--ingest.json`.
- **Cost tracking:** `totalUsd` = full-pipeline; `costPerCorrect` = totalUsd / passedCases.
- **Single-provider reproducibility:** classifiers, judges, observers all on OpenAI.
- **Embedder:** `CharHashEmbedder` (lexical FNV-1a) for shipping configurations; `openai:text-embedding-3-small` only for paired ablations.
- **Reranker:** Cohere `rerank-v3.5`, required for every Tier 1+ row.
- **Stage E observer:** `gpt-5-mini` for extraction (cost-tier); ablate at `gpt-4o` for quality if Phase A passes.
- **Heap budget:** `NODE_OPTIONS=--max-old-space-size=8192` required for any LongMemEval-M run.

---

## 7. Decision gates (carry-over from spec §8)

| Gate | Criterion | Action if pass / fail |
|---|---|---|
| Phase 4 smoke -> Phase A | 5-case smoke produces non-empty 4-way RRF ranking with no errors | Pass: ask user for $30 Phase A approval; fail: debug wiring |
| Phase A -> Phase B | LongMemEval-S Phase A point estimate >= 78.6% (baseline 76.6% + 2pp) | Pass: ask user for $290 Phase B approval; fail: iterate variant choice OR abandon (publish as 3rd negative result) |
| Phase B -> Ship | LongMemEval-S Phase B aggregate >= 78.6% with 95% CI lower bound >= 76.6% | Pass: ship as new shipping default; fail: ship as opt-in tier with negative-finding documentation |
| Ship as default -> Update LEADERBOARD | Phase B aggregate beats Tier 3 min-cost on >= 3 of 6 categories | Pass: replace Tier 3 min-cost row; fail: add as new tier alongside |

---

## 8. Recommended starting move

In order:

1. **Read** `2026-04-26-hindsight-4network-observer-design.md` end-to-end at max reasoning.
2. **Read** `2026-04-26-hindsight-4network-observer-plan.md` §"Phase 4" (lines 800-900).
3. **Pre-flight check** (§4 above).
4. **Begin Phase 4 Task 4.1**: extend `CognitiveMemoryManager` config with `typedNetwork` field. TDD: failing test that asserts `manager.typedNetworkStore !== undefined` when configured; minimal impl that wires the store; commit.
5. **Phase 4 Task 4.2**: `encode()` calls observer + persists facts. TDD with mocked LLM (re-use `ITypedExtractionLLM` from existing tests).
6. **Phase 4 Task 4.3**: `retrieve()` runs spreading activation + 4-way RRF. TDD with deterministic fixture data.
7. **Phase 4 Task 4.4**: bench wiring (CLI flag + RunConfig + contract test SAMPLES update).
8. **Phase 4 Task 4.5**: 5-case smoke. **Stop here for explicit user approval before any LLM spend.**

---

## 9. What's already shipped that you should NOT redo

The following exist and are tested. Do not re-create them:

**Brain storage (post-0.3.1, post-CodeRabbit):**
- `agentos/src/memory/retrieval/store/Brain.ts` (Brain class with `#brainId`, three factories, MigrationRunner integration)
- `agentos/src/memory/retrieval/store/migrations/MigrationRunner.ts` (handles both v1 and v2 schemas now)
- `agentos/src/memory/retrieval/store/migrations/v1-to-v2.ts` (Migration object + Postgres `agent_id` guard)
- `agentos/src/memory/retrieval/store/migrations/types.ts` (Migration interface)
- `agentos/src/memory/retrieval/store/migrations/index.ts` (registry: MIGRATIONS, LATEST_SCHEMA_VERSION)
- `agentos/src/memory/retrieval/store/portable-tables.ts` (single source of truth for portable tables)
- `agentos/src/memory/retrieval/store/postgresPasswordRedaction.ts` (URL + keyword form)
- 30 storage unit tests + 7 Postgres-gated integration tests + 6 MigrationRunner tests + 10 redaction tests + 5 export-import tests = **58 storage tests**

**Stage E typed-network:**
- All 6 production files + 6 test files in `agentos/src/memory/retrieval/typed-network/` (60 unit tests after I7 fix added 1 test)

If you start scaffolding any of these again, STOP. Run `ls packages/agentos/src/memory/retrieval/store/` and `ls packages/agentos/src/memory/retrieval/typed-network/` first.

---

## 10. Reference anchors

- Spec: `agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
- Plan: `agentos-bench/docs/plans/2026-04-26-hindsight-4network-observer-plan.md`
- Hindsight paper: arxiv.org/html/2512.12818v1
- v1 comparison table: `agentos-bench/results/eval-matrix-v1/comparison-table.md`
- v1 transparency notes: `agentos-bench/results/eval-matrix-v1/transparency-notes.md`
- Brain hardening spec (the storage layer Stage E builds on): `agentos/docs/superpowers/specs/2026-04-25-brain-storage-hardening-design.md` (gitignored, local-only)
- Brain CHANGELOG: `agentos/CHANGELOG.md`
- Existing primitive Stage E extends: `agentos/src/memory/retrieval/graph/SpreadingActivation.ts`
- Existing primitive Stage E integrates with: `agentos/src/memory/CognitiveMemoryManager.ts`
- Vendor-bias caveat to publish: Hindsight's headline 91.4% uses Gemini-3-pro; their open benchmark uses Gemini judge. Apples-to-apples for our gpt-4o reader is OSS-20B 83.6% / OSS-120B 89.0%.

---

## 11. Session-end summary (this session, 2026-04-25)

This session executed three large efforts back-to-back:

1. **Brain Storage Hardening (0.3.1)**, 16 issues from a post-0.3.0 code review. MigrationRunner abstraction, per-brain advisory lock, single-brain validation on import, password redaction, hoisted PORTABLE_TABLES, etc. 20 commits, +928/-101 LOC across 11 files. Spec at `agentos/docs/superpowers/specs/2026-04-25-brain-storage-hardening-design.md` (gitignored). Pushed to `framersai/agentos`; semantic-release auto-bumped to 0.3.1.

2. **Stage E Phase 1-3**, typed-network module scaffolded by a parallel session. Verified quality (Eq. 12 numerics, LLM-quirk handling), confirmed 59 tests green, committed as 3 phase-aligned commits. Plus spec/plan path bug fixes (15 sites, plan referenced wrong directory) and em-dash sweep (41 instances).

3. **CodeRabbit code review** of efforts 1+2, then **5 top-priority fixes** applied via TDD discipline:
   - **C1:** `_bulkCopy` Postgres atomicity fix (raw `BEGIN`/`COMMIT` against pool was non-atomic; now uses `adapter.transaction()` to pin one connection). Postgres-gated rollback test added.
   - **I3:** `importFromSqlite` peek + MigrationRunner `_readSchemaVersion` now handle v1 schema (no `brain_id` column). Test added.
   - **I7:** `stripCodeFence` regex broadened from `(?:json|JSON)?` to `[a-zA-Z]+` (any alphabetic language tag). Test added.
   - **I9:** `redactPostgresPassword` extracted to own module; now handles URL form + bare keyword form + quoted keyword form. 10 unit tests.
   - **C2:** `Brain.openWithAdapter` JSDoc warning about `PostgresAdapter.transactionalClient` shared mutable state.

4. Plus the **v1 publication work** committed and pushed: 23-file commit covering eval matrix, 4 blog posts (in agentos-live-docs submodule), Stage G judge FPR probe, LEADERBOARD updates, 2 new design docs, bench Brain rename sweep.

End-of-session state:
- `framersai/agentos@f7ecef31` (or later if CI re-bumps to 0.3.2)
- `framersai/agentos-live-docs@0fcb600` (v1 blog posts live)
- `manicinc/voice-chat-assistant@a71263474` (bench v1 publication committed, submodule pointers bumped)
- All CI runs in flight; no failures observed before push
- 5 important + 8 minor CodeRabbit findings deferred to a future hardening pass (none fire today)

The next session is starting from a clean shipped state. Stage E Phase 4 is the highest-ROI work; first $1-5 LLM spend is gated on user approval after the integration code lands.
