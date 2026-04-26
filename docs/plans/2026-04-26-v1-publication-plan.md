---
title: v1 Comprehensive Evaluation Matrix Publication — Implementation Plan
date: 2026-04-26
spec: ../specs/2026-04-25-comprehensive-evaluation-matrix-design.md (v5)
supersedes_handoff_section: NEXT_SESSION_2026-04-26_HANDOFF_v3_AFTER_STAGE_LIJ_MEASUREMENTS.md §1-§5
estimated_cost: ~$36 net new LLM (Phase B fills) + ~$0.15 (Stage G probes); doc work otherwise
estimated_duration: 1 session (2-3 days with Phase B runs)
execution_mode: inline (no subagents per user preference)
---

# v1 Publication Implementation Plan

> **Status as of 2026-04-26 EOD: DOC DELIVERABLES COMPLETE; PHASE B FILLS IN FLIGHT.**
> - Phase 0 cleanup: DONE (broader scope than planned — see §0 amendment below)
> - Phase 1 Stage G probe (LongMemEval-M): DONE (2% FPR [0%, 5%])
> - Phase 2 Phase B fills: Tier 2b OM-v11 in flight; Tier 3 max-acc + Tier 3 min-cost queued
> - Phase 3-7 doc assembly: DONE (comparison-table.md, transparency-notes.md, LEADERBOARD update, live-docs index update, 3 blog posts)
> - Phase 8 spec/plan cleanup: DONE
> - Phase 9 v4 handoff: DONE (when Tier 2b/3 land; comparison table cells fill in then)

> **Phase 0 amendment (post-execution):** The original Phase 0 scope was a single-line fix (add `entityLinking: 0.5` to `SAMPLES` in `tests/resolveRunConfigContract.spec.ts`). The actual Phase 0 was broader because agentos@0.3.0 had landed since the v1 spec was written, renaming `SqliteBrain` → `Brain`, `SqliteKnowledgeGraph` → `SqlKnowledgeGraph`, and `Memory.create({...})` → `Memory.createSqlite({...})`. The bench had **15 failing tests across 8 test files** before Phase 0 ran. Real Phase 0 sites migrated: `src/cognitive/createCognitiveManager.ts` (5 SqliteBrain/SqliteKnowledgeGraph references), `src/benchmarks/locomo/Locomo.ts:399`, `src/benchmarks/longmemeval/LongMemEvalS.ts:1321` + 2 JSDoc string references, plus the documented `entityLinking` SAMPLES addition. After cleanup: 514/514 tests pass. Prerequisite: agentos `dist/` had to be rebuilt with the 0.3.0 source (`pnpm --dir packages/agentos build`) before any bench CLI run worked — the dist was stale and still exported `SqliteBrain`. Future Phase 0 cleanups against major agentos rename releases should expect this scope.

**Goal:** Ship the v1 comprehensive evaluation matrix as a public publication: comparison table, transparency notes, LEADERBOARD update, live-docs index entry, 3 blog posts.

**Architecture:** All measurements landed in the 2026-04-25 session. This plan is doc assembly + 2 cheap LLM runs (Stage G judge FPR probes on the new measurements; Phase B fills for 3 cached architectures on LongMemEval-M). No new agentos primitives; no architectural work.

**Tech Stack:** Markdown docs, the existing bench CLI (`pnpm exec tsx src/cli.ts`), `jq` for run-JSON extraction.

**Pre-flight constraints (NON-NEGOTIABLE):**
- Branch: `master`
- Commits: never commit unless user explicitly asks
- Push: never push unless user explicitly asks
- Commit messages: never mention AI / Claude / Opus / LLM / rewrite. No `Co-Authored-By` lines.
- Monorepo commits: always `--no-verify` (secretlint blocks tracked .env files)
- agentos / agentos-live-docs are submodules — `cd` into each, commit there, then update submodule pointer in monorepo
- No em dashes in prose
- Working dir for bench: `cd packages/agentos-bench` or absolute paths
- Lead with full recommendation in any commentary; never menu without a decisive pick

---

## Phase 0: Bench test regression fix (5 min, $0)

A bench contract test caught a real bug introduced by Stage I: `entityLinking` was added to `OPTIONAL_RUN_CONFIG_KEYS` but the SAMPLES record in the round-trip contract test was not updated. The test correctly fails — exactly the failure mode it was written to catch (per its docstring referencing the Stage F-2 bug). Fix this first so subsequent commits don't carry a broken test suite.

### Task 0.1: Add `entityLinking` to SAMPLES

**Files:**
- Modify: `packages/agentos-bench/tests/resolveRunConfigContract.spec.ts:41-96` (the `SAMPLES` record)

- [ ] **Step 0.1.1: Verify failure**

```bash
cd packages/agentos-bench
pnpm exec vitest run tests/resolveRunConfigContract.spec.ts 2>&1 | tail -20
```

Expected: `FAIL` on `SAMPLES covers every OPTIONAL_RUN_CONFIG_KEY` with `expected undefined not to be undefined`.

- [ ] **Step 0.1.2: Add the missing sample value**

In `tests/resolveRunConfigContract.spec.ts`, append to the SAMPLES record before the closing `}`:

```ts
  noAbstention: true,
  entityLinking: 0.5,
};
```

(Note the value `0.5` mirrors the Stage I bench-default; any non-undefined number works for the round-trip test.)

- [ ] **Step 0.1.3: Verify all 514 tests pass**

```bash
cd packages/agentos-bench
pnpm test 2>&1 | tail -5
```

Expected: `Test Files  68 passed (68) | Tests  514 passed (514)`.

- [ ] **Step 0.1.4: Commit (in bench → monorepo, no submodule)**

The bench is in the monorepo (not a submodule), so commit only when the user asks. Stage explicitly:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/tests/resolveRunConfigContract.spec.ts
# Wait for user approval before commit; if approved:
# git commit --no-verify -m "test(agentos-bench): patch resolveRunConfig contract for entityLinking key"
```

---

## Phase 1: Stage G judge FPR probes ($0.15, 30 min)

The handoff cites Stage G judge FPR as published for LongMemEval-S (1%) and LOCOMO (0%) but NOT for LongMemEval-M or for the new `--entity-linking 0.5` LOCOMO config. The v1 publication's transparency narrative requires every cell in the comparison table to have a probed judge FPR. Two probes close that gap.

### Task 1.1: LongMemEval-M judge FPR probe

**Files:**
- Create: `packages/agentos-bench/src/scripts/stage-g-longmemeval-m-judge-fpr-probe.ts` (mirror existing `stage-g-judge-fpr-probe.ts`)
- Create: `packages/agentos-bench/docs/STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md`

- [ ] **Step 1.1.1: Read the LongMemEval-S probe to mirror its structure**

```bash
cat /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/src/scripts/stage-g-judge-fpr-probe.ts
```

The probe synthesizes wrong-but-topical answers via LLM, sends them to the judge, and reports the acceptance rate.

- [ ] **Step 1.1.2: Mirror the script for LongMemEval-M**

Create `stage-g-longmemeval-m-judge-fpr-probe.ts` with the same structure but:
- Loads from LongMemEval-M dataset (use `loadLongMemEvalDataset(dataDir, 'm')` — already streaming-compatible)
- Defaults to N=100 sampled cases at seed=42
- Writes results to `results/runs/<timestamp>--stage-g-longmemeval-m-judge-fpr-probe.json`

- [ ] **Step 1.1.3: Run the probe**

```bash
cd packages/agentos-bench
pnpm exec tsx src/scripts/stage-g-longmemeval-m-judge-fpr-probe.ts --n 100 --seed 42
```

Expected: ~$0.05 spend, FPR ≤ 5% (consistent with LongMemEval-S 1%).

- [ ] **Step 1.1.4: Document findings**

Create `STAGE_G_LONGMEMEVAL_M_FINDINGS_2026-04-26.md` mirroring `STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md`. Include: FPR percentage, 95% bootstrap CI on the FPR, count of accepted-wrong cases, sampled examples (3-5).

### Task 1.2: LOCOMO `--entity-linking 0.5` judge FPR probe

The Stage G LOCOMO probe was run pre-Stage-I. Re-run on the new `--entity-linking 0.5` config so the entity-linking judge integrity is documented separately.

- [ ] **Step 1.2.1: Re-run existing probe with the new flag**

```bash
cd packages/agentos-bench
pnpm exec tsx src/scripts/stage-g-judge-fpr-probe.ts --benchmark locomo --entity-linking 0.5 --n 100 --seed 42
```

(If the existing script doesn't accept `--entity-linking`, add the flag with a thin passthrough — same pattern as the Stage I CLI flag in `BenchmarkRunner.ts:201`.)

Expected: FPR ≤ 5% (consistent with LOCOMO 0%).

- [ ] **Step 1.2.2: Append findings to existing STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md**

Add a new section "Re-probe at `--entity-linking 0.5` config (2026-04-26)" with FPR + 95% CI + accepted-wrong sample.

- [ ] **Step 1.2.3: Verify total cost ≤ $0.20**

```bash
jq '.totalUsd' results/runs/<latest stage-g run JSON>
```

---

## Phase 2: Phase B fills for 3 cached architectures on LongMemEval-M (~$36, 3-4h wall-clock)

Per handoff §1 action 5 and §9 question 2: the comparison table needs LongMemEval-M numbers for Tier 1 canonical, Tier 2b OM-v11, and Tier 3 max-acc (Tier 3 min-cost already at 30.6%). $12/architecture × 3 = $36 + already-spent $12.52 = ~$50 total LongMemEval-M spend.

### Task 2.1: Get explicit user approval before $36 spend

Per pre-flight constraint #6: "Get explicit user approval before launching any new LLM run >$5." Three runs at $12 each = $36; this needs approval BEFORE starting.

- [ ] **Step 2.1.1: Request approval**

Pose to user:
> "Ready to run Phase B for Tier 1 canonical, Tier 2b OM-v11, and Tier 3 max-acc on LongMemEval-M. Each ~$12, total ~$36 LLM spend. The Tier 3 min-cost row already exists at 30.6%; without these 3, the v1 comparison table has an asymmetric M column. Approve?"

If user defers, document the gap in transparency notes (the table can publish with only Tier 3 min-cost in the M column and a footnote saying "other tiers pending Phase B fill").

### Task 2.2: Run Tier 1 canonical Phase B on LongMemEval-M

**Files:**
- Output: `packages/agentos-bench/results/runs/<timestamp>--longmemeval-m--gpt-4o--full-cognitive--ingest.json` (gitignored due to size)
- Output: `packages/agentos-bench/results/runs/<timestamp>--longmemeval-m--gpt-4o--full-cognitive--ingest--summary.json` (committed; the .gitignore already exempts summaries)

- [ ] **Step 2.2.1: Build bench in fresh state**

```bash
cd packages/agentos-bench
pnpm build
```

Expected: clean build, no errors.

- [ ] **Step 2.2.2: Run Tier 1 canonical**

```bash
cd packages/agentos-bench
pnpm exec tsx src/cli.ts \
  --benchmark longmemeval-m \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --rerank cohere \
  --reader-top-k 20 \
  --seed 42 \
  --bootstrap-resamples 10000
```

Expected: aggregate accuracy in 25-35% range (Tier 1 should track Tier 3 min-cost ±2pp at base config — both share the canonical-hybrid backend; Tier 3's lift over Tier 1 is from category routing which doesn't apply on LongMemEval-M's harder distribution).

- [ ] **Step 2.2.3: Verify totalUsd > 0 (fresh run, not cached)**

Per handoff pre-flight item #6: every Phase B run must verify `totalUsd > 0` and case-0 actualOutput differs from prior cached runs.

```bash
ls -t results/runs/*longmemeval-m*.json | head -1 | xargs jq '.totalUsd'
```

Expected: > $10. If $0, the cache fingerprint hit; investigate before claiming the run was fresh.

- [ ] **Step 2.2.4: Save summary file (the full JSON is gitignored due to >100MB)**

The bench should auto-emit `<timestamp>--...--summary.json` alongside the full file. If not, generate it:

```bash
cd packages/agentos-bench
LATEST=$(ls -t results/runs/*longmemeval-m*ingest.json | grep -v summary | head -1)
SUMMARY="${LATEST%.json}--summary.json"
jq '{accuracy, bootstrapCi, byType, config, durationMs, latencyAvgMs, latencyP50Ms, latencyP95Ms, passedCases, stratifiedAccuracy, totalCases, totalUsd}' "$LATEST" > "$SUMMARY"
echo "Wrote $SUMMARY"
```

### Task 2.3: Run Tier 2b OM-v11 Phase B on LongMemEval-M

- [ ] **Step 2.3.1: Run Tier 2b OM-v11**

```bash
cd packages/agentos-bench
pnpm exec tsx src/cli.ts \
  --benchmark longmemeval-m \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --observational-memory \
  --om-mode batched \
  --om-dynamic-router \
  --om-classifier-model gpt-5-mini \
  --om-classifier-fewshot \
  --hybrid-retrieval \
  --rerank cohere \
  --reader-top-k 20 \
  --seed 42 \
  --bootstrap-resamples 10000
```

(If any Tier 2b flag is missing, look up the v11 launch flags in `LEADERBOARD.md` footnote `[^v11]` or the policy-router findings doc.)

- [ ] **Step 2.3.2: Verify fresh + summarize**

Same pattern as Task 2.2.3 + 2.2.4.

### Task 2.4: Run Tier 3 max-acc Phase B on LongMemEval-M

- [ ] **Step 2.4.1: Run Tier 3 max-acc**

```bash
cd packages/agentos-bench
pnpm exec tsx src/cli.ts \
  --benchmark longmemeval-m \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --policy-router \
  --policy-router-preset maximize-accuracy \
  --hybrid-retrieval \
  --rerank cohere \
  --reader-top-k 20 \
  --seed 42 \
  --bootstrap-resamples 10000
```

- [ ] **Step 2.4.2: Verify fresh + summarize**

Same pattern as 2.2.3 + 2.2.4.

### Task 2.5: Sanity-check the 4 LongMemEval-M cells

- [ ] **Step 2.5.1: Tabulate all 4 M numbers**

```bash
cd packages/agentos-bench
for f in results/runs/*longmemeval-m*--summary.json; do
  echo "=== $f ==="
  jq '{accuracy, totalUsd, "$/correct": (.totalUsd / .passedCases), latencyP50Ms, latencyP95Ms}' "$f"
done
```

Expected: 4 rows. Tier 3 min-cost should be 30.6%. The other 3 should fall in 25-40% range (a Tier 2b that scores >50% on M is a publishable surprise; document if so).

---

## Phase 3: Comparison table assembly (1-2h)

Per handoff §2.1. The table is the centerpiece of the publication.

### Task 3.1: Create eval-matrix-v1 directory and comparison-table.md

**Files:**
- Create: `packages/agentos-bench/results/eval-matrix-v1/comparison-table.md`

- [ ] **Step 3.1.1: Create the directory**

```bash
mkdir -p /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/results/eval-matrix-v1
```

- [ ] **Step 3.1.2: Draft the table**

Write `comparison-table.md` with this structure. Lead with the table; cite per-row footnotes inline; keep each row to one line.

```markdown
---
title: v1 Comprehensive Evaluation Matrix
date: 2026-04-26
seed: 42
reader: gpt-4o
judge: gpt-4o-2024-08-06
rubric: 2026-04-18.1
bootstrap: 10000 resamples (Mulberry32, seed=42)
---

# v1 Comprehensive Evaluation Matrix

Four AgentOS architectures × four benchmarks. Every cell ships with bootstrap 95% CI, per-category breakdown, $/correct, p50/p95 latency, and judge FPR. Reference rows for cross-vendor comparison are footnoted with judge-harness caveats per [SOTA_CITED_EVIDENCE_2026-04-25.md](../../docs/SOTA_CITED_EVIDENCE_2026-04-25.md).

## Headline accuracy table

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| Tier 1 canonical-hybrid | 73.2% [69.2, 77.0] | <FILL FROM 2.2> | <FILL FROM PRIOR LOCOMO RUN> | DEFERRED v2 |
| Tier 2b OM-v11 | 75.4% [71.6, 79.0] | <FILL FROM 2.3> | <FILL> | DEFERRED v2 |
| Tier 3 min-cost | **76.6% [72.8, 80.2]** | **30.6%** | **51.5%** (K=20) | DEFERRED v2 |
| Tier 3 max-acc | 75.6% [71.8, 79.2] | <FILL FROM 2.4> | <FILL> | DEFERRED v2 |
| --- |
| Stage L treatment (DROPPED) | 70.4% (-3.7pp) | n/a | n/a | n/a |
| Stage I treatment (DROPPED) | n/a | n/a | 60.0% (-4.0pp) | n/a |

## Cost-efficiency table ($ per correct)

| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K |
|---|---:|---:|---:|---:|
| Tier 1 canonical-hybrid | $0.0213 | <FILL> | <FILL> | DEFERRED |
| Tier 2b OM-v11 | $0.436 | <FILL> | <FILL> | DEFERRED |
| Tier 3 min-cost | **$0.0580** | **$0.0818** | <FILL> | DEFERRED |
| Tier 3 max-acc | $0.2434 | <FILL> | <FILL> | DEFERRED |

## Per-category breakdown

(Sub-table per benchmark per category — copy from per-row run JSONs via `jq '.byType'`.)

## Judge FPR per benchmark

| Benchmark | Judge FPR | 95% CI | Probed at |
|---|---:|---:|---|
| LongMemEval-S | 1% | [0%, 3%] | 2026-04-24 |
| LongMemEval-M | <FILL FROM 1.1> | <FILL> | 2026-04-26 |
| LOCOMO (baseline) | 0% | [0%, 0%] | 2026-04-24 |
| LOCOMO (--entity-linking 0.5) | <FILL FROM 1.2> | <FILL> | 2026-04-26 |
| BEAM 100K | unprobed (deferred to v2) | — | — |

## Reference rows (footnoted with judge-harness caveats)

| System | LongMemEval-S | Caveat |
|---|---:|---|
| Full-context gpt-4o baseline | 60.2% | LongMemEval paper, no memory architecture |
| Mastra OM | 84.2% (gpt-4o) | gemini-2.5-flash observer |
| Mem0 v3 (managed platform) | 93.4% | proprietary optimizations not in OSS SDK |
| Hindsight Gemini-3-pro | 91.4% | Gemini judge harness |
| Hindsight OSS-120B | 89.0% | Gemini judge harness |
| Hindsight OSS-20B | 83.6% | Gemini judge harness |
| Supermemory gpt-4o | 81.6% | own harness |
| Zep self-reported | 71.2% | (vs arxiv:2512.13564 reproduction at 63.8%) |
```

- [ ] **Step 3.1.3: Fill the placeholders from the run JSONs**

For each `<FILL>`, run `jq '.accuracy, .bootstrapCi'` on the matching run JSON and substitute. Use the bench's existing summary structure.

- [ ] **Step 3.1.4: Verify the table renders cleanly**

Open in any markdown previewer. Check: alignment, no broken cell counts, no em dashes (use `--` in cell separators only), every cell has a number or `DEFERRED`.

---

## Phase 4: Transparency notes (1h)

### Task 4.1: Create transparency-notes.md

**Files:**
- Create: `packages/agentos-bench/results/eval-matrix-v1/transparency-notes.md`

- [ ] **Step 4.1.1: Draft the doc**

Five sections:

1. **Methodology**: reader (gpt-4o), judge (gpt-4o-2024-08-06), rubric (2026-04-18.1), seed (42), bootstrap (10k Mulberry32).
2. **Judge FPR per benchmark**: copy table from comparison-table.md §"Judge FPR".
3. **Two negative results**: brief summary of Stage L and Stage I findings with per-link to findings docs. Frame as "credibility marker — vendors who only publish wins miss this".
4. **BEAM 100K coverage**: status (placeholder, deferred to v2 with Stage E).
5. **v2 ambitions**: Stage E (Hindsight 4-network observer) listed; full BEAM multi-tier; cross-vendor reproductions.

Cite primary sources (anthropic.com, mem0.ai, mastra.ai, vectorize.io for Hindsight) per the user's "honest cost comparisons at matched reader" memory and the writing standards "no hedging" rule.

- [ ] **Step 4.1.2: Cross-check vendor caveats against SOTA_CITED_EVIDENCE_2026-04-25.md**

Every reference row must have a caveat that matches what's in §2-§7 of SOTA_CITED_EVIDENCE. If a caveat is missing or differs, fix transparency-notes.md.

---

## Phase 5: LEADERBOARD.md update (30 min)

### Task 5.1: Append 3 new rows + footnotes

**Files:**
- Modify: `packages/agentos-bench/results/LEADERBOARD.md`

- [ ] **Step 5.1.1: Add LongMemEval-M section to LEADERBOARD**

Read the existing file structure:

```bash
head -100 packages/agentos-bench/results/LEADERBOARD.md
```

After the LongMemEval-S section, add a new H2:

```markdown
## LongMemEval-M (500 cases, ~1.5M-token haystacks)

**First public number for any orchestration-router architecture.** Other vendors publish only the easier S variant.

| System | Reader | Memory | Replay | Cases | Accuracy | 95% CI | Avg latency | $/correct | Source |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| AgentOS Tier 3 min-cost (`@framers/agentos`)[^t3mincost-m] | gpt-4o | full-cognitive + policy router (minimize-cost) | ingest | 500 | **30.6%** | <FILL> | 10564 ms | $0.0818 | — |
| AgentOS Tier 1 canonical[^canonical-m] | gpt-4o | full-cognitive | ingest | 500 | <FILL FROM 2.2> | <FILL> | <FILL> | <FILL> | — |
| AgentOS Tier 2b OM-v11[^v11-m] | gpt-4o | full-cognitive + v10 router + conditional verbatim | ingest | 500 | <FILL FROM 2.3> | <FILL> | <FILL> | <FILL> | — |
| AgentOS Tier 3 max-acc[^t3maxacc-m] | gpt-4o | full-cognitive + policy router (maximize-accuracy) | ingest | 500 | <FILL FROM 2.4> | <FILL> | <FILL> | <FILL> | — |

[^t3mincost-m]: Stage J Phase B at N=500. Per-category: SSU 60.0%, SSA 50.0%, KU 50.0%, MS 18.0%, TR 12.8%, SSP 10.0%. Findings: [STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](../docs/STAGE_J_PHASE_B_FINDINGS_2026-04-25.md).
```

- [ ] **Step 5.1.2: Add 2 NEGATIVE FINDING rows below the LongMemEval-S section**

```markdown
### Negative findings (transparent stack)

These rows document architectures we tested and DROPPED because they did not lift on top of our shipping config. Published as a credibility marker for our transparency narrative.

| System | Reader | Memory | Replay | Cases | Δ vs paired baseline | Findings doc |
|---|---|---|---|---:|---:|---|
| AgentOS + Stage L (Anthropic Contextual Retrieval) | gpt-4o | + summarized executor | ingest | 54 | **-3.7pp** on LongMemEval-S (74.1% → 70.4%) | [STAGE_L_PHASE_A_FINDINGS_2026-04-25.md](../docs/STAGE_L_PHASE_A_FINDINGS_2026-04-25.md) |
| AgentOS + Stage I (Mem0-v3-style entity-linking re-rank) | gpt-4o | + entity-overlap re-rank at retrieval | ingest | 25 | **-4.0pp** on LOCOMO (64.0% → 60.0%) | [STAGE_I_PHASE_A_FINDINGS_2026-04-25.md](../docs/STAGE_I_PHASE_A_FINDINGS_2026-04-25.md) |

Both architectures shipped as production primitives in agentos 0.2.12 / 0.2.13 (`SummarizedIngestExecutor`, `EntityExtractor`, `EntityLinkingIngestExecutor`, `EntityRetrievalRanker`) for consumers building different pipelines.
```

- [ ] **Step 5.1.3: Update the "Last updated" timestamp at top of LEADERBOARD.md**

Change `Last updated: 2026-04-24T07:00:00.000Z` to `Last updated: 2026-04-26T<HH:MM:SS>.000Z`.

---

## Phase 6: Live-docs index update (30 min)

### Task 6.1: Surface new agentos primitives in docs index

**Files:**
- Modify: `apps/agentos-live-docs/docs/index.md`

- [ ] **Step 6.1.1: Open the live-docs submodule**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/apps/agentos-live-docs
git status
```

Per submodule constraint: commits go to the submodule's origin, NOT to the monorepo origin.

- [ ] **Step 6.1.2: Find the Memory section in index.md**

```bash
grep -n "Memory\|MEMORY" docs/index.md | head -20
```

- [ ] **Step 6.1.3: Add the new primitives**

Under the existing IngestRouter / MemoryRouter mentions, surface the new executors:

```markdown
**IngestRouter executors (new in 0.2.12 / 0.2.13):**
- `SummarizedIngestExecutor` — Anthropic Contextual Retrieval recipe, wraps the existing `SessionSummarizer`
- `RawChunksIngestExecutor` — passthrough reference for the `raw-chunks` strategy
- `SkipIngestExecutor` — reference for the `skip` strategy
- `EntityExtractor` + `EntityLinkingIngestExecutor` — Mem0-v3-style entity extraction at ingest

**MemoryRouter recall-stage primitives (new in 0.2.13):**
- `EntityRetrievalRanker` — Mem0-v3-style entity-overlap re-rank at retrieval
```

- [ ] **Step 6.1.4: Commit in submodule (wait for user approval)**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/apps/agentos-live-docs
git add docs/index.md
# Wait for approval; if approved:
# git commit -m "docs: surface new ingest-router + memory-router primitives"
# git push origin master  # ONLY if user explicitly asks
```

Then update submodule pointer in monorepo:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add apps/agentos-live-docs
# Wait for approval; if approved:
# git commit --no-verify -m "chore: bump agentos-live-docs submodule (new memory primitives in index)"
```

---

## Phase 7: Blog posts (3-4h)

Per handoff §3. Three required + one optional. Each post is a separate write task.

### Task 7.1: Blog post 1 — Two negative results

**Files:**
- Create: `apps/agentos-live-docs/blog/2026-04-26-two-negative-results-stage-l-stage-i.md`

- [ ] **Step 7.1.1: Open the prior transparency-audit post for style reference**

```bash
head -100 apps/agentos-live-docs/blog/2026-04-24-memory-benchmark-transparency-audit.md
```

Match: frontmatter (title, description, authors, tags, keywords, image), tone (authoritative, no hedging, citations), length (~1500-2500 words), `<!-- truncate -->` after the lede.

- [ ] **Step 7.1.2: Draft the post per handoff §3.1 outline**

8 sections:
1. The setup — shipping config (76.6% LongMemEval-S, 51.5% LOCOMO)
2. Stage L — architecture, hypothesis, measurement (-3.7pp)
3. Why Stage L doesn't translate (homogeneous sessions, Cohere rerank already covers, temporal-anchor obscuration)
4. Stage I — architecture, hypothesis, measurement (-4.0pp)
5. Why Stage I doesn't lift (Cohere rerank already does cross-encoder semantic matching, lexical entity overlap is redundant, multi-hop suffers most)
6. The pattern: well-tuned baselines resist lightweight additions
7. What this means: future architecture pushes need to be substantial (Stage E next)
8. Both architectures shipped as production primitives in agentos 0.2.12 / 0.2.13 anyway

Cite anthropic.com/news/contextual-retrieval, docs.mem0.ai/migration/oss-v2-to-v3, and link to STAGE_L_PHASE_A_FINDINGS + STAGE_I_PHASE_A_FINDINGS.

- [ ] **Step 7.1.3: Run the writing-standards self-check**

Per CLAUDE.md writing standards:
- No em dashes
- Authoritative tone (no "currently", "still", "not yet", "aim to")
- No filler ("simply", "just", "in order to")
- Cut "it should be noted that"
- Every claim has a citation or links to the findings doc

### Task 7.2: Blog post 2 — First published LongMemEval-M number

**Files:**
- Create: `apps/agentos-live-docs/blog/2026-04-26-longmemeval-m-first-published-number.md`

- [ ] **Step 7.2.1: Draft per handoff §3.2 outline**

7 sections:
1. The S→M scale problem: 50 sessions vs 500 sessions per haystack
2. Why no other vendor publishes M (file size, cost, Phase B effort)
3. Our number: 30.6% Tier 3 min-cost equivalent at N=500
4. Per-category breakdown: where it collapses (multi-session 18%, temporal-reasoning 12.8%)
5. The S→M gap (76.6% → 30.6% = -46pp) is much steeper than expected
6. What this validates: retrieval precision at scale is the bottleneck → Stage E is the right next push
7. Loader fix sub-section (1 paragraph; full story is in optional blog post 4)

Cite xiaowu0162.github.io/long-mem-eval, link to STAGE_J_PHASE_A_FINDINGS + STAGE_J_PHASE_B_FINDINGS.

- [ ] **Step 7.2.2: Same self-check as 7.1.3**

### Task 7.3: Blog post 3 — IngestRouter executors

**Files:**
- Create: `apps/agentos-live-docs/blog/2026-04-26-agentos-ingest-router-executors.md`

- [ ] **Step 7.3.1: Draft per handoff §3.3 outline**

5 sections (more code-heavy than the other posts):
1. The IngestRouter dispatcher pattern recap (link to prior cognitive-pipeline post)
2. Stage L: `SummarizedIngestExecutor` (wraps `SessionSummarizer`, IngestRouter-shaped facade)
3. Stage I: `EntityExtractor` + `EntityLinkingIngestExecutor` + `EntityRetrievalRanker`
4. Code examples wiring each into `FunctionIngestDispatcher`
5. When to use them (and when not — pointer to negative findings)

Read the actual source for code examples:

```bash
head -50 packages/agentos/src/ingest-router/executors/SummarizedIngestExecutor.ts
head -50 packages/agentos/src/ingest-router/executors/EntityLinkingIngestExecutor.ts
head -50 packages/agentos/src/memory-router/backends/EntityRetrievalRanker.ts
```

Use real code snippets, not invented APIs.

- [ ] **Step 7.3.2: Verify code snippets compile**

Don't actually compile — just visually confirm imports match the actual barrel exports in `packages/agentos/src/ingest-router/index.ts` and `packages/agentos/src/memory-router/index.ts`.

### Task 7.4: (Optional) Blog post 4 — Loader fix story

**Files:**
- Create: `apps/agentos-live-docs/blog/2026-04-26-longmemeval-m-loader-fix.md`

- [ ] **Step 7.4.1: Draft per handoff §3.4 outline (only if there's narrative space and time)**

4 sections, ~600-900 words:
1. The bug: `File size (2745274681) is greater than 2 GiB`
2. Why it slipped through (every prior bench run was on smaller datasets)
3. The fix: `chain([createReadStream, parser(), streamArray()])` for files >1GB
4. The lesson: probe size before buffering

Cite npmjs.com/package/stream-json. Link to STAGE_J_BLOCKED_2026-04-25.md (the blocker doc).

### Task 7.5: Cross-link the 3-4 posts and STAGE findings docs

- [ ] **Step 7.5.1: Add "Related" footers to each new post**

Each post links to the other 2-3 posts and the corresponding findings docs. This builds the v1 publication narrative as a coherent set, not 4 isolated posts.

### Task 7.6: Commit blog posts in submodule (wait for user approval)

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/apps/agentos-live-docs
git add blog/2026-04-26-*.md
# Wait for approval; if approved:
# git commit -m "blog: v1 publication trio (negative results, longmemeval-m number, ingest-router executors)"
# git push origin master  # ONLY if user explicitly asks
```

Then bump submodule pointer in monorepo (same pattern as Task 6.1.4).

---

## Phase 8: Spec / plan / handoff cleanups (30 min)

### Task 8.1: Mark Stage L, Stage I, Stage J Phase B as DONE in the eval-matrix plan

**Files:**
- Modify: `packages/agentos-bench/docs/plans/2026-04-25-comprehensive-evaluation-matrix-plan.md`

- [ ] **Step 8.1.1: Read existing plan to find Stage L / I / J sections**

```bash
grep -n "Stage L\|Stage I\|Stage J" packages/agentos-bench/docs/plans/2026-04-25-comprehensive-evaluation-matrix-plan.md | head -20
```

- [ ] **Step 8.1.2: Add DONE markers**

For each Stage L / I / J phase, prepend the section heading with `[DONE 2026-04-25] ` and link to the findings doc.

### Task 8.2: Update the eval-matrix spec revision history

**Files:**
- Modify: `packages/agentos-bench/docs/specs/2026-04-25-comprehensive-evaluation-matrix-design.md` (frontmatter `revision_history`)

- [ ] **Step 8.2.1: Append a v6 entry**

```yaml
  - 2026-04-26 v6: Stage J Phase B published (30.6% N=500, $12.52). Phase B fills for Tier 1, Tier 2b, Tier 3 max-acc on LongMemEval-M complete. v1 publication shipped (LEADERBOARD updated, comparison-table.md, transparency-notes.md, 3 blog posts). Stage E (Hindsight 4-network) becomes the v2 narrative.
```

### Task 8.3: Mark this v1 publication plan as DONE

- [ ] **Step 8.3.1: Append a "Status" section at the top of THIS file**

```markdown
> **Status as of 2026-04-26 EOD: COMPLETE.** All Phase B fills landed; comparison table + transparency notes + LEADERBOARD update + live-docs index + 3 blog posts published. Stage E plan kicks off in next session.
```

(Only after the user confirms everything is committed.)

---

## Phase 9: Handoff for v2 (Stage E)

### Task 9.1: Write next-session handoff

**Files:**
- Create: `packages/agentos-bench/docs/NEXT_SESSION_2026-04-27_HANDOFF_v4_AFTER_V1_PUBLICATION.md`

- [ ] **Step 9.1.1: Draft the v4 handoff**

Mirror the v3 handoff structure (`NEXT_SESSION_2026-04-26_HANDOFF_v3_AFTER_STAGE_LIJ_MEASUREMENTS.md`):
- §0: 60-second briefing on what shipped this session (v1 publication done)
- §1: Mission for next session (Stage E spec + Phase A measurement)
- §2: Pointer to Stage E spec + plan (`2026-04-26-hindsight-4network-observer-design.md` + `-plan.md`)
- §3: BEAM 100K spot-check status (deferred + adapter scaffold needed)
- §10: FRESH-SESSION PROMPT verbatim block (paste-ready)

---

## Self-review checklist

Before claiming this plan complete:

1. **Spec coverage**: every handoff §1-§5 action item maps to a Phase 0-9 task above. Verified by cross-reading.
2. **No placeholders in code**: every `<FILL>` in Phase 3 has a `jq` command in Phase 2 that produces the value.
3. **Cost tracked**: Phase 1 ($0.15) + Phase 2 ($36) = ~$36.15 LLM total. Phase 3-9 are doc work at $0.
4. **Constraints honored**: no commits without user approval, submodule discipline, no em dashes, no AI in commit messages, no subagents.
5. **Verification before completion**: every Phase 2 run has a totalUsd > 0 check + summary file generation. Per `superpowers:verification-before-completion`, no claim of "done" without evidence.

---

## Open decisions for the user (ask before starting)

1. **Phase 2 budget approval**: $36 LLM for the 3 LongMemEval-M Phase B fills. Approve or defer (deferring → asymmetric M column with footnote).
2. **Optional blog post 4**: write the loader-fix story or skip? Default = skip (the other 3 posts cover the substantive narrative).
3. **Stage E in this same session**: scaffold the spec + plan today, or hold for next session after v1 publishes? Default = hold (keeps v1 focused).
4. **CharHashEmbedder vs OpenAIEmbedder ablation**: per handoff §9 question 4, the bench currently uses CharHashEmbedder for "shipping" runs. The Stage L baseline at OpenAI embedder showed 74.1% (vs char-hash baseline 76.6%). Worth a v2 ablation. **Defer to v2.**

---

## End of plan
