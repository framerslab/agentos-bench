---
title: Next-Session Handoff v5, After Stage E Phase 1-3 (typed-network primitives shipped)
date: 2026-04-25 (end of session)
supersedes: NEXT_SESSION_2026-04-27_HANDOFF_v4_AFTER_V1_PUBLICATION.md
---

# Next-Session Handoff v5: After Stage E Phase 1-3

**Supersedes:** [NEXT_SESSION_2026-04-27_HANDOFF_v4_AFTER_V1_PUBLICATION.md](NEXT_SESSION_2026-04-27_HANDOFF_v4_AFTER_V1_PUBLICATION.md)

**Status at handoff:** Stage E Phase 1, 2, and 3 (the pure-code + LLM-mocked-extraction primitives) are shipped to `framersai/agentos@d8678495`. The full typed-network module exists in agentos core with 59/59 tests green. The bench v1 publication is also fully shipped (4 blog posts, eval matrix, Stage G FPR probe, LEADERBOARD updates, 3 design docs). All commits pushed to GitHub; CI is running.

**Mission for next session:** Stage E Phase 4 (integration into `CognitiveMemoryManager` + bench `--typed-network` wiring + first $1-5 LLM smoke). Per plan [2026-04-26-hindsight-4network-observer-plan.md](plans/2026-04-26-hindsight-4network-observer-plan.md) §"Phase 4".

---

## 0. The 60-second briefing

What shipped this session (in addition to what v4 reported):

| Deliverable | State | Path |
|---|---|---|
| Brain storage hardening 0.3.1 | DONE, pushed | `framersai/agentos@b475d8f2` (semantic-release auto-bump from `0676d8ba`) |
| MigrationRunner + Migration interface | DONE, 6/6 tests | `agentos/src/memory/retrieval/store/migrations/MigrationRunner.ts` + index.ts + types.ts |
| portable-tables.ts (single source of truth) | DONE | `agentos/src/memory/retrieval/store/portable-tables.ts` |
| Brain.importFromSqlite single-brain validation | DONE, 1 new test | `agentos/src/memory/retrieval/store/Brain.ts` (peeks brain_meta via raw adapter) |
| Brain.openPostgres password redaction | DONE | `agentos/src/memory/retrieval/store/Brain.ts:redactPostgresPassword` |
| #brainId ECMAScript private field | DONE | `agentos/src/memory/retrieval/store/Brain.ts` |
| Postgres archived_traces agent_id guard (I6) | DONE | `agentos/src/memory/retrieval/store/migrations/v1-to-v2.ts:migratePostgresTable` |
| Cross-dialect round-trip test (sqlite->postgres->sqlite) | DONE, gated on AGENTOS_TEST_POSTGRES_URL | `agentos/src/memory/retrieval/store/__tests__/Brain.export-import.test.ts` |
| 3 new Postgres tests (concurrent open + FK + rollback) | DONE, gated on AGENTOS_TEST_POSTGRES_URL | `agentos/src/memory/retrieval/store/__tests__/Brain.postgres.test.ts` |
| Brain hardening spec + plan | DONE | `agentos/docs/superpowers/specs/2026-04-25-brain-storage-hardening-design.md` + `plans/2026-04-25-brain-storage-hardening.md` (gitignored) |
| Stage E typed-network module (Phase 1+2+3) | DONE, 59/59 tests | `agentos/src/memory/retrieval/typed-network/` |
| Stage E spec + plan path fixes (15 sites) | DONE | `agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md` + plan |
| Stage E spec + plan em-dash sweep (41 instances) | DONE | same |
| v1 publication blog posts (4) | DONE, pushed | `agentos-live-docs/blog/2026-04-26-*.md` |
| v1 publication eval matrix | DONE | `agentos-bench/results/eval-matrix-v1/` |
| LEADERBOARD updates | DONE | `agentos-bench/results/LEADERBOARD.md` |
| Submodule pointers bumped + pushed | DONE | monorepo `4a9522d46` |

What was NOT shipped this session:

- **Stage E Phase 4** (integration + bench wiring), primitives exist; nothing wired into `CognitiveMemoryManager` yet, no `--typed-network` CLI flag.
- **Stage E Phase 5+** ($1+ smoke + Phase A measurement). Awaiting Phase 4 + your explicit budget approval.
- **Phase B fills on LongMemEval-M** (Tier 2b OM-v11, Tier 3 max-acc, Tier 3 min-cost). Status unchanged from v4 ("PENDING / IN FLIGHT"); the comparison-table.md cells stay placeholders until those runs land.
- **Retrieval Config Router** (`2026-04-26-retrieval-config-router-design.md`), design exists, no code. Decision deferred until after Stage E Phase A outcome.

Headline gap to frontier (unchanged from v4):

- LongMemEval-S: 76.6% (us, Tier 3 min-cost) vs Mastra OM 84.23%, Hindsight 91.4% Gemini-3-pro / 89.0% OSS-120B, Mem0 v3 platform 93.4% (claimed)
- LOCOMO: 51.5% (us, K=20-tuned) vs Hindsight OSS-120B 89.61%, Mem0 v3 platform 91.6% (claimed) / 66.9% (Mem0's own production-stack article)
- LongMemEval-M: 30.6% (us, first published number for any orchestration-router architecture)

---

## 1. Mission for next session

Ranked by ROI per dollar (Stage E remains the highest-leverage work):

| # | Action | Cost | Effort | Why |
|---|---|---:|---|---|
| 1 | **Stage E Phase 4 integration** (CognitiveMemoryManager wiring + bench `--typed-network` flag) | $0 | 1 day | Pure code. Connects the shipped primitives to the bench measurement infrastructure. |
| 2 | **Stage E Phase 4 smoke** (5-case end-to-end with real `gpt-5-mini`) | $1-5 | 1 day | First real LLM spend. Confirms the wiring works before committing to Phase A. |
| 3 | **Stage E Phase 5 (Phase A measurement)** | $30 | 1 day | LongMemEval-S N=54 stratified at `--typed-network minimal` and `--typed-network full`. Decision gate at +2 pp baseline. |
| 4 | **Stage E Phase 6 decision gate** | $0 | 30 min | Iterate variant choice OR proceed to Phase B OR abandon (publish negative result). |
| 5 | **Stage E Phase 7 (Phase B if Phase A passes)** | $290 | 2 days | LongMemEval-S/M + LOCOMO at full N. |
| 6 | **Stage E Phase 8 (v2 publication)** | $0 | 1 day | Blog post + comparison-table v2 + LEADERBOARD update. |

**Recommended starting move:** Run pre-flight, then begin Phase 4 Task 1 (CognitiveMemoryManager integration). Phase 4 ends with a $1-5 smoke, which is the first real budget ask.

---

## 2. Stage E Phase 4 detailed scope

The plan's Phase 4 (lines 800-900 of `2026-04-26-hindsight-4network-observer-plan.md`) covers:

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
- Add `typedNetwork: 'full'` to SAMPLES record (this is the regression mode the test was written to catch; the v1 publication's Stage I work hit it once already).

### 2.3 smoke test

5 LongMemEval-S cases at `--typed-network full`, single seed, `gpt-5-mini` extraction + `gpt-4o` reader. Verify:
- Typed facts are extracted and stored
- Spreading activation runs without errors
- 4-way RRF produces a non-empty fused ranking
- Reader's prompt includes typed-network results
- Total cost reported in the run JSON

Expected cost: $1-5. Total budget gate before Phase 4 starts: explicit user approval.

---

## 3. Pre-flight checklist for the fresh session

Before touching anything:

1. **`git status -s`** in monorepo. Expect a few unrelated files (apps/agentos-* dirty content, src/emergent + src/sandbox files from other sessions). Confirm no agentos-bench or agentos files are dirty (clean from this session's work).

2. **`cd packages/agentos && git status -s`**. Expect only the unrelated other-session changes (typed-network/, etc. should all be tracked now). HEAD should be `framersai/agentos@b475d8f2` or later (semantic-release may have created `0.3.2` if the typed-network commits triggered another release).

3. **`pnpm --dir packages/agentos-bench test 2>&1 | tail -5`**, expect `Tests 514 passed` (or 515 if the contract test now picks up `typedNetwork`).

4. **Verify agentos dist is fresh:**
   ```bash
   grep "TypedNetwork" packages/agentos/dist/memory/index.js | head -3
   ```
   If empty, run `pnpm --dir packages/agentos build`.

5. **Verify agentos typed-network exports:**
   ```bash
   grep "export.*TypedNetwork" packages/agentos/src/memory/retrieval/typed-network/index.ts
   ```
   Should show all primitives (TypedNetworkStore, TypedNetworkObserver, TypedSpreadingActivation, fourWayRrf).

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

## 4. Constraints (NON-NEGOTIABLE, copied from prior handoffs)

- **Git branch:** master, never main
- **Commits:** NEVER commit unless user explicitly asks
- **Push:** NEVER push unless user explicitly asks
- **Commit messages:** NEVER mention AI, Claude, Opus, rewrite, LLM. No `Co-Authored-By` lines.
- **Monorepo commits:** Always `--no-verify` (secretlint blocks tracked .env files)
- **agentos / agentos-live-docs / paracosm are submodules:** cd into each, commit, push to its origin, update submodule pointer in monorepo
- **No subagents.** No worktrees with submodules. Never stash/reset/restore (other sessions are active).
- **Working dir for bench:** always `pnpm --dir packages/agentos-bench ...` or absolute paths
- **No em dashes.** Use periods, commas, or colons.
- **TDD discipline.** Failing test first, then minimal implementation. Skipping the failing-test step disqualifies the work as TDD.
- **Get explicit user approval before any new LLM run > $5.**

---

## 5. Methodology invariants (unchanged from v3 / v4)

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

## 6. Decision gates (carry-over from spec §8)

| Gate | Criterion | Action if pass / fail |
|---|---|---|
| Phase 4 smoke -> Phase A | 5-case smoke produces non-empty 4-way RRF ranking with no errors | Pass: ask user for $30 Phase A approval; fail: debug wiring |
| Phase A -> Phase B | LongMemEval-S Phase A point estimate >= 78.6% (baseline 76.6% + 2pp) | Pass: ask user for $290 Phase B approval; fail: iterate variant choice OR abandon (publish as 3rd negative result) |
| Phase B -> Ship | LongMemEval-S Phase B aggregate >= 78.6% with 95% CI lower bound >= 76.6% | Pass: ship as new shipping default; fail: ship as opt-in tier with negative-finding documentation |
| Ship as default -> Update LEADERBOARD | Phase B aggregate beats Tier 3 min-cost on >= 3 of 6 categories | Pass: replace Tier 3 min-cost row; fail: add as new tier alongside |

---

## 7. Open architectural questions (carry-over from spec §9)

These should be addressed during Phase 4 implementation or first iteration of Phase A:

1. **Storage of typed facts**: extend `IMemoryGraph` interface OR create separate `ITypedMemoryStore`? Lean separate (bank concept is orthogonal to existing graph traversal). Same backend (`SqlMemoryGraph`) implements both.

2. **Confidence on Opinion bank**: LLM extractor outputs `confidence ∈ [0, 1]`; default 1.0 for non-Opinion. Decay over time per `μ(time-since-mention)` or treat as static? Lean static for v1; revisit for v2.

3. **Causal edge extraction**: paper says "LLM-extracted, w=1.0". Same 6-step extraction also emits causal edges via `reasoningMarkers` field; or separate LLM call? Lean piggyback for `minimal` and `full` variants; separate LLM call for `production` variant (out of scope for v1).

4. **Spreading activation depth**: paper doesn't fix `maxDepth`. AgentOS's existing `SpreadingActivation` defaults to depth=3. Use the same default; ablate in Phase A.

5. **RRF k constant**: paper uses k=60. Stick with 60 unless Phase A shows meaningful sensitivity.

6. **Per-benchmark routing**: should typed-network ship as a 5th `MemoryRouter` backend ID (`'hindsight-typed-network'`)? Or as a primitive used internally by `canonical-hybrid` when configured? Lean separate backend ID, keeps the architectural primitive cleanly opt-in.

---

## 8. Recommended starting move

In order, with the pre-flight check between each:

1. **Read** `2026-04-26-hindsight-4network-observer-design.md` end-to-end at max reasoning.
2. **Read** `2026-04-26-hindsight-4network-observer-plan.md` §"Phase 4" (lines 800-900).
3. **Pre-flight check** (§3 above).
4. **Begin Phase 4 Task 4.1**: extend `CognitiveMemoryManager` config with `typedNetwork` field. TDD: failing test first that asserts `manager.typedNetworkStore !== undefined` when configured; minimal impl that wires the store; commit.
5. **Phase 4 Task 4.2**: `encode()` calls observer + persists facts. TDD with mocked LLM (re-use `ITypedExtractionLLM` from existing tests).
6. **Phase 4 Task 4.3**: `retrieve()` runs spreading activation + 4-way RRF. TDD with deterministic fixture data.
7. **Phase 4 Task 4.4**: bench wiring (CLI flag + RunConfig + contract test SAMPLES update).
8. **Phase 4 Task 4.5**: 5-case smoke. **Stop here for explicit user approval before any LLM spend.**

---

## 9. What's already shipped that you should NOT redo

The following exist and are tested. Do not re-create them:

- `agentos/src/memory/retrieval/typed-network/types.ts` (BANK_IDS, EDGE_KINDS, TypedFact, TypedEdge, FactTemporal, Participant, isBankId)
- `agentos/src/memory/retrieval/typed-network/TypedNetworkStore.ts` (in-memory 4-bank store, bidirectional edges)
- `agentos/src/memory/retrieval/typed-network/TemporalIntervalOverlap.ts` (rankByTemporalOverlap)
- `agentos/src/memory/retrieval/typed-network/TypedSpreadingActivation.ts` (Eq. 12, default multipliers)
- `agentos/src/memory/retrieval/typed-network/FourWayRrf.ts` (k=60 RRF)
- `agentos/src/memory/retrieval/typed-network/TypedNetworkObserver.ts` (LLM observer with mocked extraction in tests; `ITypedExtractionLLM` interface for production injection)
- `agentos/src/memory/retrieval/typed-network/prompts/extraction-prompt.ts` (TYPED_EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt)
- `agentos/src/memory/retrieval/typed-network/prompts/extraction-schema.ts` (TypedExtractionSchema, TypedExtractionFactSchema, zod-validated)
- `agentos/src/memory/retrieval/typed-network/index.ts` (barrel exports)
- 6 test files with 59 tests passing

If you start scaffolding Phase 1-3 again, STOP. Run `ls packages/agentos/src/memory/retrieval/typed-network/` first.

---

## 10. Other follow-ups noted but not started

- **`RetrievalConfigRouter` design** at `agentos-bench/docs/specs/2026-04-26-retrieval-config-router-design.md` (per-query LLM-as-judge dispatch among `(canonical, hyde, topk50, ...)` calibrated from LongMemEval-M Phase A N=54 ablation matrix; +13 pp lift). Decision: hold until after Stage E Phase A measures (if Stage E fails, this becomes higher priority; if Stage E passes, this is potentially redundant with the typed-network signal).
- **BEAM 100K spot-check**: still `BeamUnimplementedError` placeholder. Defer to v2 paired with Stage E Phase B.
- **Phase B fills on LongMemEval-M** (Tier 2b OM-v11 + Tier 3 max-acc + Tier 3 min-cost): unchanged from v4. Comparison-table.md cells stay placeholders until those runs land. Cost: ~$36 net new LLM. Status: queued; Tier 2b OM-v11 was "in flight" at end of v4 session but I don't see the run JSON in `results/runs/`, so it may have been canceled or not started.
- **Cross-vendor reproductions** (Hindsight via `vectorize-io/agent-memory-benchmark`): defer to v2 with Gemini-judge caveat.

---

## 11. Reference anchors

- Spec: `agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`
- Plan: `agentos-bench/docs/plans/2026-04-26-hindsight-4network-observer-plan.md`
- Hindsight paper: arxiv.org/html/2512.12818v1
- v1 comparison table: `agentos-bench/results/eval-matrix-v1/comparison-table.md`
- v1 transparency notes: `agentos-bench/results/eval-matrix-v1/transparency-notes.md`
- Brain hardening spec (the storage layer Stage E builds on): `agentos/docs/superpowers/specs/2026-04-25-brain-storage-hardening-design.md` (gitignored, local-only)
- Brain 0.3.1 CHANGELOG: `agentos/CHANGELOG.md` (top entry)
- Existing primitive Stage E extends: `agentos/src/memory/retrieval/graph/SpreadingActivation.ts`
- Existing primitive Stage E integrates with: `agentos/src/memory/CognitiveMemoryManager.ts`
- Vendor-bias caveat to publish: Hindsight's headline 91.4% uses Gemini-3-pro; their open benchmark uses Gemini judge. Apples-to-apples for our gpt-4o reader is OSS-20B 83.6% / OSS-120B 89.0%.

---

## 12. Session-end summary (this session, 2026-04-25)

This session executed two large pieces of work back-to-back:

1. **Brain Storage Hardening (0.3.1)**, closed 16 correctness/maintainability/polish gaps from the post-0.3.0 code review. Introduced `MigrationRunner` abstraction, fixed concurrent-open race via per-brain advisory lock, added single-brain validation on import, redacted Postgres passwords in error messages, hoisted `PORTABLE_TABLES` to one shared module. 20 commits, +928/-101 LOC across 11 files. Full spec at `agentos/docs/superpowers/specs/2026-04-25-brain-storage-hardening-design.md` (gitignored). Pushed to `framersai/agentos`; semantic-release auto-bumped to 0.3.1.

2. **Stage E Phase 1-3**, typed-network module scaffolded by a parallel session. Verified quality (spot-checked Eq. 12 numerics + LLM-quirk handling), confirmed 59/59 tests green, committed as 3 phase-aligned commits, pushed. Plus spec/plan path bug fixes (15 sites where the plan referenced the wrong directory) and em-dash sweep (41 instances).

3. **Pushed and committed v1 publication work** that had been sitting uncommitted from the previous session: 23-file commit covering eval matrix, 4 blog posts (in agentos-live-docs submodule), Stage G judge FPR probe, LEADERBOARD updates, 2 new design docs, and the bench Brain rename sweep.

4. **Submodule pointers bumped + pushed** for both `framersai/agentos` and `framersai/agentos-live-docs` from the monorepo.

End-of-session state:
- `framersai/agentos@b475d8f2` (or later if CI re-bumps), typed-network module live
- `framersai/agentos-live-docs@0fcb600`, v1 blog posts live
- `manicinc/voice-chat-assistant@4a9522d46`, bench v1 publication committed, submodule pointers bumped
- All CI runs in flight; no failures observed before push

The next session is starting from a clean shipped state.
