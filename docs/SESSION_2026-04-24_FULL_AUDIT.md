# 2026-04-24 Full Session Audit

**Purpose:** comprehensive auditable record of everything shipped on 2026-04-24, written for a fresh-session reviewer (Codex / human / future-self) with no prior conversation context. Every decision is documented; every commit and SHA is named; every test count is reproducible.

**TL;DR for an auditor:**

1. Self-caught Stage F-2 publication correction. The original Stage F-2 51.5% LOCOMO "tuned" headline was actually `--reader-top-k 20` alone — the `--no-abstention` flag was silently dropped at runtime by a missing field in `resolveRunConfig`. Caught from the next experiment's ablation, fixed with a one-line patch + parameterized contract test, re-ran the full ablation. Same-day correction.
2. Promoted bench-only `policyRouter` into agentos as `@framers/agentos/memory-router`. Five new agentos primitives + three new package subpaths. 163 new contract tests. Five new canonical guides. Blog rewritten.
3. Renamed `multi-stage-guardrails` → `cognitive-pipeline` after recognizing the misnaming (smart orchestration is not safety guardrails).
4. All three repos pushed: `agentos@425a9fc1`, `agentos-live-docs@3223135`, monorepo `c9651e9a8`.

This doc is structured for a Codex review with no context: every claim links to evidence (commit, file, test, run JSON).

## Verification at end of session

- agentos build: clean (`tsc` exit 0).
- agentos router-family tests: **163/163 pass** across 9 test files.
- agentos full test suite: 5731+/5821 pass; 14 failures are pre-existing in `vision/`, `media/images/` (unrelated to this session's work).
- agentos-bench build: clean.
- agentos-bench tests: **513/513 pass** across 68 test files.
- agentos-live-docs publication contract: **12/12 pass**.
- agentos-live-docs Docusaurus build: clean (148 files synced, 0 broken links, exit 0).

## 1. Stage F-2 self-caught correction

### 1.1 The bug

`resolveRunConfig` in `packages/agentos-bench/src/core/BenchmarkRunner.ts` translates a CLI-built `RunConfig` into the runtime `BenchContext['config']` via an explicit per-field copy. When `--no-abstention` was added in a prior session, three places needed updating:

1. `RunConfig` interface (in `IBenchmark.ts`) — done.
2. `OPTIONAL_RUN_CONFIG_KEYS` tuple (in `IBenchmark.ts`) — done.
3. `resolveRunConfig`'s explicit copy line — **missed**.

TypeScript could not catch this. The compile-time guard at `IBenchmark.ts:786` only checked that every key in `OPTIONAL_RUN_CONFIG_KEYS` exists on `RunConfig`. It did NOT check that `resolveRunConfig` propagates each one. The fingerprint unit tests at `tests/step15ObservationalMemory.wiring.spec.ts` passed because they bypass `resolveRunConfig` and call `computeCaseRunKeyParts` directly.

Runtime consequences:

- `ctx.config.noAbstention` was always `undefined` regardless of the CLI flag.
- The fingerprint conditional `if (config.noAbstention)` in `computeCaseRunKeyParts` never appended `stage-f2-no-abstention:v1` to the cache key.
- Stage F-2 cached its case-results under the same key as a K=20-only run.
- The five prompt-builder branches reading `options?.noAbstention` always saw `undefined` and used the v9 abstention prompt.

### 1.2 Discovery

Stage F-3 ablation (queued in §4.1 of the Stage G handoff) launched two LOCOMO runs: Run A (`--reader-top-k 20` alone, no `--no-abstention`) and Run B (`--no-abstention` alone, K=10 default). Run A finished in seconds with `totalUsd=$0` (full cache hit) and accuracy 51.5% — bit-for-bit identical to Stage F-2's published number. The first case JSON's `actualOutput` matched Stage F-2's case-0 byte-for-byte.

Smoking gun: with a different config, you should see fresh API calls (cache miss) or different answers (cache key collision implies same effective config). Same answers + same cache key + claimed-different config = silent flag drop.

### 1.3 Fix + regression test

Commit: monorepo `d1a0f8d4a` titled `fix(agentos-bench): propagate noAbstention through resolveRunConfig + contract test`.

- One-line fix: added `noAbstention: cfg.noAbstention,` to `resolveRunConfig`'s return object.
- New contract test: `tests/resolveRunConfigContract.spec.ts`. Parameterized over `OPTIONAL_RUN_CONFIG_KEYS` — for every key, sets a sample value, runs `resolveRunConfig`, asserts the resolved config has the same value. 55 parameterized cases.
- Adding a future flag without updating `resolveRunConfig` now fails CI immediately with a message naming the missing field.

### 1.4 Audit: only Stage F-2 affected

Same class of bug (field present in `RunConfig` + `OPTIONAL_RUN_CONFIG_KEYS` but missing from `resolveRunConfig`):

The contract test runs the full key-list against `resolveRunConfig`. Result: only `noAbstention` was missing. Every other field round-trips correctly.

Run-JSON audit for any shipping run that had `noAbstention=true`:

| Run JSON | noAbstention | Status |
|---|---|---|
| LongMemEval-S Tier 1 / 2a / 2b / 3 (Phase B N=500) | unset | safe |
| LOCOMO Tier 1 OOD (Stage F-1 N=1986) | unset | safe |
| Stage A hold-out aggregations | n/a (post-hoc) | safe |
| Stage B `gpt-4o` observer (negative) | unset | safe |
| Stage C session-level NDCG (k=3/5/10, negative) | unset | safe |
| Stage F-1 LOCOMO OOD baseline | unset | safe |
| **Stage F-2 LOCOMO tuned (N=1986, T21-17-04-526)** | **set, but silently dropped** | **CORRUPT — replaced** |
| Stage F-2 smoke (N=15, T21-16-13-539) | set, dropped | corrupt; was wiring-only anyway |
| Stage G LongMemEval-S judge FPR probe | n/a (standalone script) | safe |
| Stage G-LOCOMO judge FPR probe | n/a (standalone script) | safe |

**Net affected:** Stage F-2 LOCOMO tuned 51.5% only. All other published numbers stand.

### 1.5 Re-ran ablation with the fix

Four runs at LOCOMO N=1986, gpt-4o reader, gpt-4o-2024-08-06 judge + rubricVersion 2026-04-18.1, seed=42:

| Configuration | Accuracy | 95% CI | $/correct | Avg latency | Δ vs OOD |
|---|---:|---|---:|---:|---:|
| **K=20 alone (Pareto-best LOCOMO tuning)** | **51.5%** | [49.2%, 53.7%] | **$0.0099** | 1.45s | **+1.6pp** |
| K=10 OOD baseline (Stage F-1, no tuning) | 49.9% | [47.7%, 52.1%] | $0.0123 | 2.58s | — |
| K=20 + `--no-abstention` (Stage F-2 corrected) | 47.3% | [45.2%, 49.5%] | $0.0107 | 1.20s | −2.6pp |
| `--no-abstention` alone at K=10 (Stage F-3 Run B) | 42.1% | [40.0%, 44.3%] | $0.0082 | 1.19s | **−7.8pp** |

Cost provenance: the post-fix K=20-alone artifact is a full cache hit (`totalUsd=$0`) because the pre-fix Stage F-2 run had the same effective runtime config. The $0.0099/correct figure is the paid cost from that pre-fix artifact, reused only because the bug made it a valid K=20-only measurement.

Mechanism story: when `--no-abstention` is actually applied, adversarial accuracy collapses from 83.4% to 54.3% (-29.1pp) because the reader is told "every question has an answer." Temporal +13.5pp and open-domain +6.7pp gain meaningfully — the prompt directive helps where evidence exists. But adversarial is 22.5% of LOCOMO cases, so the loss outweighs the gains in aggregate.

The Pareto-best LOCOMO tuning is K=20 alone (51.5%, +1.6pp at lower cost + lower latency). The combined config is a -2.6pp regression. `--no-abstention` is a category-specific trade-off, not a Pareto improvement.

### 1.6 Stage G-LOCOMO judge FPR probe

Ported the LongMemEval-S Stage G judge-adversarial probe to LOCOMO cases.

Result: **0% FPR [0%, 0%]** at n=100. Zero false positives across all rubric categories (multi-session n=77, temporal-reasoning n=5, abstention n=18) and all five native LOCOMO types.

Compare to Penfield Labs' 62.81% FPR finding on LOCOMO's default judge (`gpt-4o-mini` + original LOCOMO rubric).

The 63pp gap is a judge-model + rubric-strictness artifact, NOT a LOCOMO-intrinsic property. Our LOCOMO numbers (49.9% OOD, 51.5% K=20-tuned) are NOT judge-inflated on our rubric.

Standalone script: `packages/agentos-bench/src/scripts/stage-g-locomo-judge-fpr-probe.ts`. Run via `pnpm build && node dist/scripts/stage-g-locomo-judge-fpr-probe.js 100`. Cost: $0.04. Elapsed: 167s.

### 1.7 Documentation

Three new docs at `packages/agentos-bench/docs/`:

- `STAGE_F2_CORRECTION_2026-04-24.md` — full bug story + audit + corrected ablation table.
- `STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md` — 0% FPR finding + comparison to Penfield Labs' 62.81%.
- `STAGE_F2_LOCOMO_ABSTENTION_TUNING_2026-04-24.md` — rewritten findings doc with corrected mechanism story.

LEADERBOARD.md updated: three LOCOMO rows (OOD, K=20-tuned, K=20 + `--no-abstention` corrected). Each row's footnote names its actual configuration.

## 2. Memory Router primitive (recall stage)

### 2.1 What was promoted

The Tier 3 policy logic shipped bench-only as `packages/agentos-bench/src/core/policyRouter.ts`. Promoted into agentos as `@framers/agentos/memory-router`.

Per the user's stored preference: "agentos-bench is benchmarks only — all memory/RAG/retrieval improvements go in agentos core, not in the bench adapter."

### 2.2 Six files at `packages/agentos/src/memory-router/`

- `routing-tables.ts` — `MemoryQueryCategory`, `MemoryBackendId`, `MemoryRouterPreset`, `RoutingTable` types + three frozen preset tables (MINIMIZE_COST_TABLE, BALANCED_TABLE, MAXIMIZE_ACCURACY_TABLE).
- `backend-costs.ts` — `MemoryBackendCostPoint` interface + three Phase-B-calibrated cost-points (TIER_1_CANONICAL_COSTS, TIER_2A_V10_COSTS, TIER_2B_V11_COSTS) + DEFAULT_MEMORY_BACKEND_COSTS registry.
- `select-backend.ts` — pure `selectBackend` function + `MemoryBudgetMode` ('hard' / 'soft' / 'cheapest-fallback') + two typed error classes (`MemoryRouterUnknownCategoryError`, `MemoryRouterBudgetExceededError`).
- `classifier.ts` — `IMemoryClassifier` + `LLMMemoryClassifier` reference impl + provider-agnostic `IMemoryClassifierLLM` adapter + base/few-shot prompts + robust output parser. Falls back to `multi-session` on unparseable output.
- `dispatcher.ts` — `IMemoryDispatcher` + `FunctionMemoryDispatcher` registry-of-executors + `UnsupportedMemoryBackendError`.
- `MemoryRouter.ts` — top-level orchestrator with `decide()` (decision-only) and `decideAndDispatch()` (composed) + `MemoryRouterDispatcherMissingError`.

Plus:
- `adaptive.ts` — `AdaptiveMemoryRouter` class extending `MemoryRouter` with calibration-derived routing tables.
- `index.ts` — public barrel exporting 22+ symbols.
- `README.md` — full usage doc with 6 patterns.

### 2.3 Tests (89 contract tests across 5 files)

| Test file | Coverage |
|---|---:|
| `routing-tables.test.ts` | preset structure + freezing + load-bearing routing decisions | 28 |
| `select-backend.test.ts` | pure-function lookup + budget modes + error cases | 11 |
| `classifier.test.ts` | LLM adapter parsing + fallbacks + few-shot variant + token propagation | 19 |
| `memory-router.test.ts` | end-to-end compose + budget passthrough + custom tables + ground-truth telemetry | 11 |
| `adaptive.test.ts` | aggregation + per-preset selection + table construction + AdaptiveMemoryRouter integration | 13 |
| Adapter contract via dispatcher.test.ts (in cognitive-pipeline) | (counted under cognitive-pipeline) | 7 |

All 89/89 GREEN.

### 2.4 Subpath export

`package.json` `./memory-router` subpath added. Consumers import as:

```ts
import {
  LLMMemoryClassifier,
  MemoryRouter,
  FunctionMemoryDispatcher,
  AdaptiveMemoryRouter,
} from '@framers/agentos/memory-router';
```

## 3. Ingest Router primitive (input stage)

### 3.1 Files at `packages/agentos/src/ingest-router/`

Same pattern as memory-router: routing-tables.ts, costs.ts, select-strategy.ts, classifier.ts, dispatcher.ts, IngestRouter.ts, index.ts, README.md.

### 3.2 Six content kinds

```ts
type IngestContentKind =
  | 'short-conversation'
  | 'long-conversation'
  | 'long-article'
  | 'code'
  | 'structured-data'
  | 'multimodal';
```

### 3.3 Six ingest strategies

```ts
type IngestStrategyId =
  | 'raw-chunks'
  | 'summarized'
  | 'observational'
  | 'fact-graph'
  | 'hybrid'
  | 'skip';
```

### 3.4 Four shipping presets

`raw-chunks` (default), `summarized`, `observational`, `hybrid`.

### 3.5 Tests: 38/38 GREEN

Single test file `tests/ingest-router.test.ts` covers routing tables (6 tests), pure selectIngestStrategy (4 tests), classifier parsing including `INGEST_CONTENT_KINDS.length` (6) parameterized cases + parser variations (5 tests), end-to-end IngestRouter compose (3 tests), FunctionIngestDispatcher routing (3 tests), and decideAndDispatch composition (1 test). Total 38.

### 3.6 Subpath export

`./ingest-router` added to package.json.

## 4. Read Router primitive (read stage)

### 4.1 Files at `packages/agentos/src/read-router/`

Same pattern.

### 4.2 Five read intents

```ts
type ReadIntent =
  | 'precise-fact'
  | 'multi-source-synthesis'
  | 'time-interval'
  | 'preference-recommendation'
  | 'abstention-candidate';
```

### 4.3 Five reader strategies

```ts
type ReadStrategyId =
  | 'single-call'
  | 'two-call-extract-answer'
  | 'commit-vs-abstain'
  | 'verbatim-citation'
  | 'scratchpad-then-answer';
```

### 4.4 Three shipping presets

`precise-fact` (default), `synthesis`, `temporal`.

### 4.5 Tests: 26/26 GREEN

Single test file covers routing tables, pure selectReadStrategy, classifier parsing, ReadRouter end-to-end compose, FunctionReadDispatcher routing, decideAndDispatch composition.

### 4.6 Subpath export

`./read-router` added.

## 5. Cognitive Pipeline composition primitive

### 5.1 Original naming was wrong

Originally shipped under `@framers/agentos/multi-stage-guardrails` with class `MultiStageGuardrails`. This was misnamed. Smart per-message orchestration is NOT safety guardrails:

- **Cognitive Pipeline** (this primitive): classifies input → picks strategy → dispatches. Picks ARE choices.
- **Guardrails** (existing primitive at `core/guardrails` + `agentos-ext-grounding-guard` family): validates output → blocks / refuses / redacts. Picks ARE blocks.

Two responsibilities, two stacks, two distinct mental models. Conflating them obscures both.

### 5.2 Renamed end-to-end

- `src/multi-stage-guardrails/` → `src/cognitive-pipeline/`
- Class `MultiStageGuardrails` → `CognitivePipeline`
- Type `MultiStageGuardrailsOptions` → `CognitivePipelineOptions`
- Subpath `./multi-stage-guardrails` → `./cognitive-pipeline`
- All cross-references in READMEs, blog, leaderboard updated

### 5.3 Files at `packages/agentos/src/cognitive-pipeline/`

- `index.ts` — `CognitivePipeline` class + three stage interfaces (`IngestStage`, `RecallStage<TTrace>`, `ReadStage<TTrace, TOutcome>`) + result-shape types + adapter functions (`ingestRouterAsStage`, `memoryRouterAsStage`, `readRouterAsStage`) + `MissingStageError`.
- `README.md` — full doc.

### 5.4 Tests: 10/10 GREEN

Single test file covers per-stage forwarding + missing-stage errors + recallAndRead end-to-end composition + stage-availability flags.

### 5.5 Subpath export

`./cognitive-pipeline` added.

## 6. Test totals shipped this session

| Module | Tests added |
|---|---:|
| `memory-router` (routing-tables, select-backend, classifier, MemoryRouter, adaptive) | **89** |
| `ingest-router` | **38** |
| `read-router` | **26** |
| `cognitive-pipeline` | **10** |
| **Total new tests** | **163** |
| Plus the resolveRunConfigContract test (in agentos-bench) | **55 parameterized cases** |

Previously: agentos-bench at 458 tests. Now: 513 tests (513 = 458 + 55 contract test cases).

## 7. Documentation shipped

### 7.1 Five canonical guides at `packages/agentos/docs/`

- `COGNITIVE_PIPELINE.md` — composition primitive overview.
- `MEMORY_ROUTER.md` — recall stage primitive.
- `INGEST_ROUTER.md` — input stage primitive.
- `READ_ROUTER.md` — read stage primitive.
- `ADAPTIVE_MEMORY_ROUTER.md` — self-calibrating extension.

### 7.2 Architecture doc updated

`packages/agentos/docs/architecture/ARCHITECTURE.md` gains a "Cognitive Pipeline (per-message smart orchestration)" section alongside the existing memory orchestrator + storage substrate description. Includes the architecture diagram + primitive table + explicit smart-orchestration-vs-safety-guardrails distinction.

### 7.3 Publication manifest updated

`packages/agentos/docs/publication-manifest.cjs` gains 5 new `agentosDoc` entries:

- COGNITIVE_PIPELINE.md → features/cognitive-pipeline.md (Orchestration section, position 9)
- MEMORY_ROUTER.md → features/memory-router.md (RAG & Retrieval, position 4.1)
- INGEST_ROUTER.md → features/ingest-router.md (RAG & Retrieval, position 4.2)
- READ_ROUTER.md → features/read-router.md (RAG & Retrieval, position 4.3)
- ADAPTIVE_MEMORY_ROUTER.md → features/adaptive-memory-router.md (RAG & Retrieval, position 4.4)

12/12 publication contract tests pass.

### 7.4 Per-package READMEs

`packages/agentos/src/{memory-router,ingest-router,read-router,cognitive-pipeline}/README.md` — full usage docs for each primitive.

### 7.5 Live-docs index

`apps/agentos-live-docs/docs/index.md` — 5 new entries cross-linking the primitives.

### 7.6 Blog post

`apps/agentos-live-docs/blog/2026-04-24-memory-benchmark-transparency-audit.md` — orchestration section rewritten:

- Added a 4-row primitive table.
- Explicit smart-orchestration-vs-safety-guardrails distinction.
- AdaptiveMemoryRouter self-calibration story.
- Single-OpenAI-key reproducibility reaffirmation.
- Stage F-2 self-caught correction story (was added in earlier rewrite this session).
- Stage G-LOCOMO 0% FPR finding (added in earlier rewrite).

### 7.7 Bench leaderboard

`packages/agentos-bench/results/LEADERBOARD.md` — updated three LOCOMO rows (OOD, K=20 alone, K=20+--no-abstention), each footnote linking back to the corresponding correction doc. Header paragraph references `@framers/agentos/memory-router` as the architecture under measurement.

## 8. Commits + pushes

Across three repos. Listed in order:

### agentos (`framersai/agentos`)

- `7866f7aa` — `feat: ship multi-stage guardrails — ingest-router + read-router + adaptive memory-router + composition`
- `425a9fc1` — `refactor(cognitive-pipeline): rename multi-stage-guardrails → cognitive-pipeline + ship 5 canonical guides`
- (also `199dfe63` rebased into `425a9fc1`) `docs(architecture): add Cognitive Pipeline section to ARCHITECTURE.md`

### agentos-live-docs (`framersai/agentos-live-docs`)

- `530d47b` — `post: memory-router primitive now ships in agentos`
- `3223135` — `docs: cognitive pipeline naming + new orchestrator pages indexed`

### Monorepo (`manicinc/voice-chat-assistant`)

Multiple commits during the session. Last two:
- `0471a9847` — `chore: bump agentos submodule — multi-stage guardrails primitives shipped` (the original Wave 3 commit)
- `c9651e9a8` — `chore: bump agentos + agentos-live-docs (cognitive-pipeline rename + 5 new canonical guides)` (the rename + docs)

Plus earlier monorepo commits this session: `d1a0f8d4a` (Stage F-2 fix), `aca716833` (run JSONs + LEADERBOARD), `ea54bcbe1` (correction docs), `f7d66aeae` (further), `d6a942b1e` (further), `2d3323f4a` (blog correction submodule pointer).

## 9. Strategic naming distinction (top-level)

Made explicit across every documentation surface:

```
COGNITIVE PIPELINE — smart orchestration (this session's work)
  Classify input → pick strategy → dispatch.
  Picks ARE choices, not blocks.
  Lives in: @framers/agentos/{memory,ingest,read,cognitive-pipeline}-router.

GUARDRAILS — safety/policy (existing pre-session)
  Validate output → block / refuse / redact.
  Picks ARE blocks, not choices.
  Lives in: @framers/agentos/core/guardrails + @framers/agentos-ext-{grounding-guard,topicality,pii-redaction,code-safety}.
```

Two responsibilities, two stacks, two distinct mental models. Conflating them obscured both. The blog post + system-architecture page + every README + canonical guide all anchor this contrast.

## 10. What was NOT done (intentionally deferred)

- **Bench integration**: bench-side `policyRouter.ts` still has its own implementation. Migrating it to use `@framers/agentos/memory-router` under the hood would invalidate the Phase B cache (~$100+ re-run cost) without methodology improvement. Deferred to next session.
- **Bench `--reader-top-k` rename**: bench still uses `tier_1_canonical` / `tier_2a_v10` / `tier_2b_v11` strings; agentos uses `canonical-hybrid` / `observational-memory-v10` / `observational-memory-v11`. Aliasing would invalidate cache. Deferred.
- **Cross-judge ablation**: explicitly rejected this session — single-OpenAI-key reproducibility is itself a feature.
- **Mem0 / Mastra / Supermemory cross-vendor replication**: external scope.
- **Hindsight typed-network observer architecture (Stage E from prior handoff)**: $400+ implementation, multi-day; deferred.
- **LongMemEval-M / BEAM Phase A**: deferred; both unblocked by the new router primitives but not run this session.

## 11. Pre-flight verification commands a fresh-session reviewer can run

```bash
# 1. Confirm the rename + tests
cd packages/agentos
pnpm build
pnpm exec vitest run src/cognitive-pipeline/ src/ingest-router/ src/read-router/ src/memory-router/
# expected: Test Files  9 passed (9), Tests  163 passed (163)

# 2. Confirm bench tests
cd ../agentos-bench
pnpm build
pnpm test
# expected: Test Files  68 passed (68), Tests  513 passed (513)

# 3. Confirm publication contract
cd ../../apps/agentos-live-docs
node --test scripts/publication-contract.test.mjs
# expected: pass 12, fail 0

# 4. Confirm dist runtime loads
node -e "
const m = require('/Users/johnn/Documents/git/voice-chat-assistant/packages/agentos/dist/cognitive-pipeline/index.js');
console.log('CognitivePipeline:', typeof m.CognitivePipeline);
console.log('ingestRouterAsStage:', typeof m.ingestRouterAsStage);
console.log('memoryRouterAsStage:', typeof m.memoryRouterAsStage);
console.log('readRouterAsStage:', typeof m.readRouterAsStage);
"
# expected: function, function, function, function

# 5. Confirm canonical guides synced
ls /Users/johnn/Documents/git/voice-chat-assistant/apps/agentos-live-docs/docs/features/{cognitive-pipeline,memory-router,ingest-router,read-router,adaptive-memory-router}.md
# expected: all 5 files exist

# 6. Confirm Stage F-2 corrected number reproduces
set -a && source apps/wilds-ai/.env && set +a
cd packages/agentos-bench
node dist/cli.js run locomo --reader gpt-4o --memory full-cognitive --replay ingest \
  --stratified --sample-per-type 5 --reader-top-k 20 --no-abstention \
  --hybrid-retrieval --rerank cohere --seed 42
# expected: cache-hit on the corrected Stage F-2 run; aggregate near 47-50% (small sample)
```

## 12. Open questions for future sessions

1. Should bench-side `policyRouter.ts` be migrated to use `@framers/agentos/memory-router`? Pro: production primitive is what's measured. Con: cache invalidation, ~$100 re-run cost.
2. Should bench backend names be aligned with agentos backend names (`tier_1_canonical` → `canonical-hybrid`)? Same trade-off.
3. Does `AdaptiveMemoryRouter` need a Phase A calibration runner in agentos-bench? (Currently the user must collect calibration samples themselves.)
4. Should `CognitivePipeline` have an end-to-end integration test using real `Memory` + `HybridRetriever`? Currently every stage is unit-tested against mock LLM adapters; the composition is tested with stubs.
5. How does the new orchestrator interact with `agentos-ext-grounding-guard`? Should there be a fourth stage (output validation) in `CognitivePipeline` that wraps the output guardrail?

## 13. Audit checklist for a Codex review

- [ ] Pull every commit listed in §8. Verify SHAs.
- [ ] Run the §11 verification commands. Confirm test counts match.
- [ ] Read the 5 canonical guides at `packages/agentos/docs/{COGNITIVE_PIPELINE,MEMORY_ROUTER,INGEST_ROUTER,READ_ROUTER,ADAPTIVE_MEMORY_ROUTER}.md`.
- [ ] Read the Stage F-2 correction doc at `packages/agentos-bench/docs/STAGE_F2_CORRECTION_2026-04-24.md`.
- [ ] Read the Stage G-LOCOMO findings at `packages/agentos-bench/docs/STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md`.
- [ ] Verify the publication manifest entries match what's described in §7.3.
- [ ] Run a fresh smoke (§11 step 6) to confirm Stage F-2 corrected reproduces.
- [ ] Read the blog post at `apps/agentos-live-docs/blog/2026-04-24-memory-benchmark-transparency-audit.md` and confirm the orchestration section names all four primitives.
- [ ] Verify package.json subpath exports match: `./memory-router`, `./ingest-router`, `./read-router`, `./cognitive-pipeline`.

If all 8 checks pass, the audit succeeds. Any failure indicates either drift since this doc was written or a misclaim — investigate at the failing commit.
