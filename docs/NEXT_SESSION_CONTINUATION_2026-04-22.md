# Fresh-Session Continuation Handoff — 2026-04-22

**Status at handoff:** Step 15 Observational Memory GREEN-soft at Tier A, 75.0% unweighted (18/24) CI [58.3%, 91.7%]. First architectural win since Step 3 Hybrid (73.2% N=500 canonical shipping). Target: 80%+ at Phase B N=500. Gap is diagnosed. Path forward is concrete.

This document is self-contained for a fresh Claude Code session. Read it end-to-end, then paste the continuation prompt at the bottom into a new session.

---

## 0. The one-paragraph summary

After 10 consecutive RED/null retrieval-layer experiments (Steps 2-14), we pulled Mastra's actual source code and discovered their architecture is fundamentally different: they DON'T retrieve at query time. They compress raw conversation messages into a dense observation log (Observer + Reflector LLMs), then put the full log in the reader's context. No BM25, no dense search, no rerank, no top-K. Step 15 ported their architecture verbatim (Apache 2.0, verbatim prompts + thresholds) and hit 75% at Tier A — first win in 11 experiments. Single-session categories all sweep at 100%; cross-session (multi-session 25%, temporal 50%) regress because our Observer runs per-session in parallel while Mastra's runs on rolling token-windows that span sessions. **Fix that, hit 80%+.**

---

## 1. What is shipping on master right now

**Canonical (Tier 1 shipping default, untouched):** Step 3 HybridRetriever at 73.2% unweighted [69.2%, 77.0%] on LongMemEval-S Phase B N=500, gpt-4o reader + gpt-4o judge, $0.0213 per correct answer. Canonical run JSON: `packages/agentos-bench/results/runs/2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

**Opt-in via flags (default off, ship as `--`-prefix CLI options):**
- `--observational-memory` (Step 15, GREEN-soft at Tier A N=24 = 75.0%)
- `--two-call-reader` (Step 14 RED)
- `--graph-activation` (Step 13 RED)
- `--fact-graph-ingest` (Step 9 RED)
- `--observer-reflector` + `--observer-reflector-replace` (Steps 7/8 RED)
- `--hybrid-retrieval` (Step 3, shipping in Tier 1)
- `--rerank cohere` (Step 0 baseline component)
- `--context-summary <model>` (Anthropic Sep 2024 contextual retrieval)

**Agentos submodule** at v0.1.255+post-push commits. Includes the Step 13 silent-sixth-signal fix (`HeuristicEntityExtractor` + `enableGraphActivation` in `CognitiveMemoryConfig`) and the earlier `REFLECTOR_PROMPT_HASH` export.

**Monorepo + bench tests:** 85/85 pass across Phase 1 metrics + Steps 12/13/14/15 wiring + unit tests for all new helpers. Typecheck clean in both agentos and bench.

---

## 2. What Step 15 ported from Mastra (concrete file map)

Source: [github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory](https://github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory) (Apache 2.0).

**Local references already pulled (read these first — do NOT re-fetch):**
- `packages/agentos-bench/.firecrawl/mastra-om/constants.ts` — Mastra's thresholds + reader context templates + continuation hint. 121 lines.
- `packages/agentos-bench/.firecrawl/mastra-om/observer-agent.ts` — OBSERVER_EXTRACTION_INSTRUCTIONS (lines 17-264), OBSERVER_OUTPUT_FORMAT_BASE (lines 274-327), OBSERVER_GUIDELINES (lines 333-349), buildObserverSystemPrompt + parse helpers. 1,460 lines.
- `packages/agentos-bench/.firecrawl/mastra-om/reflector-agent.ts` — buildReflectorSystemPrompt (lines 33-128), compression levels, parse helpers. 380 lines.
- `packages/agentos-bench/.firecrawl/mastra-om/observational-memory.ts` — main orchestration (3596 lines; KEY FILE for Step 15 v2 batching).
- `packages/agentos-bench/.firecrawl/mastra-om/thresholds.ts` — token-threshold logic (186 lines).

**Ported into our codebase:**
- `packages/agentos-bench/src/observational-memory/prompts.ts` — verbatim OBSERVER_EXTRACTION_INSTRUCTIONS + OBSERVER_OUTPUT_FORMAT + OBSERVER_GUIDELINES + buildObserverSystemPrompt + buildReflectorSystemPrompt + OBSERVATION_CONTEXT_PROMPT + OBSERVATION_CONTEXT_INSTRUCTIONS + OBSERVATION_CONTINUATION_HINT + OM_DEFAULTS + OM_PROMPT_HASH.
- `packages/agentos-bench/src/observational-memory/runner.ts` — runObserverOnSession, runReflectorOnLog, `ingestSessions` (bounded-parallel per-session observer + single reflection pass), buildOmReaderSystemPrompt, extractObservationsBlock parser.
- `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts::runCase` — OM branch that bypasses retrieval entirely.
- `packages/agentos-bench/tests/observationalMemory.unit.spec.ts` (13 tests) + `tests/step15ObservationalMemory.wiring.spec.ts` (6 tests).

**NOT ported (the architectural gap for Step 15 v2):**
- Rolling token-window batching (instead of per-session). Mastra's `observational-memory.ts` has `bufferTokens` (0.2 × messageTokens = 6k-token buffer) + `bufferActivation` (0.8 × = 24k activation point). Their observer fires when unobserved-message-tokens cross ~24k, not when a session ends. THIS IS THE FIX for Step 15 v2.
- Thread attribution / multi-thread variants. We're single-thread so this is not needed.
- Recall tool. Mastra optionally exposes a `recall(cursor, page)` tool for exact-content lookups. We didn't implement it because Mastra's 84.23% gpt-4o result doesn't require it.
- `model-context.ts` / `operation-registry.ts` / `buffering-coordinator.ts` internals. Over-engineered for our bench use case.

---

## 3. Step 15 v2 — cross-session observer batching

**Goal:** lift multi-session (25% → 60%+) and temporal-reasoning (50% → 80%+) by letting the Observer see cross-session context. Single-session categories stay at 100% (already at ceiling).

**Current code (the bug):**

[packages/agentos-bench/src/observational-memory/runner.ts::ingestSessions](../src/observational-memory/runner.ts):

```typescript
// CURRENT: parallel per-session
for each session in sessions:
  call runObserverOnSession(session)  // ONE session's messages per call
concatenate observation blocks → final log
```

**Fix:** roll sessions into token-bounded batches before each observer call.

```typescript
// TARGET: rolling token window matching Mastra's bufferActivation
batches = []
currentBatch = []
currentTokens = 0
for each session in sessions:
  sessionTokens = approxTokens(formatSessionForObserver(session))
  if currentTokens + sessionTokens > 24_000 && currentBatch.length > 0:
    batches.push(currentBatch)
    currentBatch = []
    currentTokens = 0
  currentBatch.push(session)
  currentTokens += sessionTokens
if currentBatch.length > 0:
  batches.push(currentBatch)

for each batch in batches:
  transcript = batch.map(formatSessionForObserver).join('\n\n')
  call observer with transcript  // SPANS sessions
```

**Config:** new `batchTokenTarget` option (default 24_000, matching Mastra's `messageTokens * bufferActivation` = 30_000 * 0.8 = 24_000). Expose via the observer runner + optionally CLI as `--om-batch-tokens`.

**Expected effect:**
- Fewer observer calls per case. Current: ~49 per-session calls. New: ~3-8 multi-session batches.
- Each batch's observer sees 5-15 sessions' messages. Temporal patterns (user said X on date A, then Y on date B) encode into one observation block.
- Cross-session reasoning improves because the Observer can explicitly note "in session 12 the user mentioned...; in session 18 they updated to...".

**Budget:** $0 implementation (pure refactor of ingestSessions). Tier A v2 at ~$3-5 (cheaper than v1 because fewer observer calls per case).

**Kill criterion for Step 15 v2:** unweighted ≥ 78% at Tier A AND multi-session ≥ 50% (doubled from 25%). If either fails, the batching fix didn't close the gap and we need to look at Mastra's thread attribution or recall tool next.

**Tests needed:**
- Unit: `ingestSessions` produces fewer, larger batches when given many small sessions. Confirm each batch's token count stays under the target.
- Unit: when one large session exceeds the target alone, it gets its own batch (no split mid-session).
- Regression: existing 19 OM tests still pass.

---

## 4. Where Step 15 v2 might fall short (and what else to try)

If Step 15 v2 lifts multi-session but temporal stays flat, the gap is likely:

1. **Observer model tier.** Mastra uses gemini-2.5-flash. We use gpt-5-mini. Gemini 2.5 flash is probably better at temporal reasoning. Options:
   - Get a Gemini API key (set `GEMINI_API_KEY` in `apps/wilds-ai/.env`). Add a Gemini reader to `packages/agentos-bench/src/readers/`. Currently the bench only has OpenAI + Anthropic readers.
   - OR upgrade observer to gpt-4o (expensive: would 5× the ingest cost).

2. **Observation date headers.** Mastra's Observer emits observations grouped by `Date: Dec 4, 2025` headers and time stamps per observation `(14:30) User stated X. (meaning Dec 5, 2025)`. Our bench passes session dates to the Observer but the output quality of date grouping depends on the Observer LLM's compliance. Test: spot-check the observation log for date headers.

3. **Recall tool**. For explicit-date-lookup questions ("when did user go to the dentist?"), the reader might benefit from a `recall` tool that fetches the raw session messages by observation-ID range. Mastra has this. Their 84.23% at gpt-4o likely uses it for a few edge cases. Implementation cost: medium.

---

## 5. Other SOTA systems worth research (queue for next session)

Step 15 ported Mastra. The remaining three systems in the published leaderboard haven't been studied at source-code level:

| System | gpt-4o score | Openness | Research priority |
|---|---:|---|---|
| **Supermemory** | 81.60% | github.com/supermemoryai/supermemory open-source | HIGH — between Mastra (84%) and us (75%); different architecture |
| **Hindsight** | unknown gpt-4o score | unknown open status | MEDIUM — beat Mastra on multi-session |
| **EmergenceMem Internal** | 86.00% | closed | LOW — can't reproduce |

**Research actions for next session:**
1. Invoke `deep-research` skill: "Research Supermemory's memory architecture at github.com/supermemoryai/supermemory. What's their ingest pipeline? Do they retrieve at query time? What's their Observer/chunker? What reader prompt shape do they use? Get exact source code details."
2. Then: "Research Hindsight's memory system. They score 91.4% at gemini-3-pro and beat Mastra on multi-session. What's the approach?"
3. If Step 15 v2 lifts us to 78-82%, these become the next ports. If v2 hits 83%+, we might already be at frontier for our infra tier.

---

## 6. Critical gotchas from this session (read before touching anything)

### 6.1 Firecrawl credits exhausted

The skill `firecrawl:firecrawl` credits ran out mid-research. Use `curl` to Tavily API directly (key in `apps/wilds-ai/.env` as `TAVILY_API_KEY`) with `include_raw_content: true`, or use `WebFetch` / `curl` to `raw.githubusercontent.com` for source-code fetches.

### 6.2 No Gemini API key

Mastra uses `gemini-2.5-flash`. We substituted `gpt-5-mini`. To match exactly, add `GEMINI_API_KEY` to `apps/wilds-ai/.env` and build a GeminiReader. Not strictly required for Step 15 v2.

### 6.3 Vitest only scans tests/

`vitest.config.ts` has `include: ['tests/**/*.spec.ts']`. Unit tests for new modules MUST live under `packages/agentos-bench/tests/` (e.g., `tests/observationalMemory.unit.spec.ts`), NOT `src/**/__tests__/`. Otherwise `pnpm vitest run` doesn't find them.

### 6.4 Monorepo root typecheck hits wunderland-sol ENAMETOOLONG

Always `cd packages/agentos-bench && pnpm typecheck` or `cd packages/agentos && pnpm typecheck`. Never `pnpm typecheck` from monorepo root.

### 6.5 Bench cache caches FAILED case results

If Tier A errors (e.g., OPENAI_API_KEY issue, malformed JSON), the case-level error gets cached. A subsequent re-run with the same cache key REPLAYS the error at $0 cost and the run "completes" in seconds with 0 correct. Detection: look at `avgLatencyMs` (< 5s = cache replay), `totalUsd` ($0 = cache replay), case-0 `error` field. Fix: bump the content-addressed cache fingerprint (the `OM_PROMPT_HASH` in prompts.ts auto-handles this for Step 15 specifically) OR delete `data/cache/case-run/` entries with a targeted `find -newermt`.

### 6.6 Monorepo commit rules (user's standing instructions)

- Always `--no-verify` on commits (monorepo secretlint blocks on tracked `.env` files).
- NEVER mention AI, Claude, Opus, or rewrite in commit messages.
- NEVER use `Co-Authored-By` lines.
- Master branch only.
- Push submodule commits IMMEDIATELY after committing them, before bumping the monorepo pointer.
- Never stash/reset — other sessions may be active.
- Only commit when explicitly asked. User said "commit and push" for this rollout, which stays in scope; new architectural experiments should ask fresh.

### 6.7 Bench env sourcing

Source the env in the SAME bash call that runs the bench, AND pass explicit env vars:

```bash
set -a && source apps/wilds-ai/.env && set +a
OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  LONGMEMEVAL_S_PATH="$(pwd)/data/longmemeval/longmemeval_s.json" \
  pnpm bench run longmemeval-s ...
```

---

## 7. Directory map for the new session

```
packages/agentos-bench/
├── src/
│   ├── observational-memory/
│   │   ├── prompts.ts          ← Mastra Observer + Reflector prompts (Apache 2.0)
│   │   ├── runner.ts           ← ingestSessions (FIX THIS for Step 15 v2)
│   │   └── index.ts            ← barrel
│   ├── readers/
│   │   ├── twoCallReader.ts    ← Step 14 (RED)
│   │   └── createReader.ts     ← OpenAI + Anthropic (add Gemini here)
│   ├── benchmarks/longmemeval/LongMemEvalS.ts ← runCase OM branch at line ~248
│   ├── core/BenchmarkRunner.ts ← resolveRunConfig + computeCaseRunKeyParts
│   └── cli.ts                  ← flag definitions
├── tests/
│   ├── observationalMemory.unit.spec.ts    (13 tests)
│   ├── step15ObservationalMemory.wiring.spec.ts  (6 tests)
│   └── [many more — all in tests/ NOT src/]
├── docs/
│   ├── STEP_15_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-21.md  ← read this
│   ├── RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md            ← full rollout history
│   ├── COMPREHENSIVE_HANDOFF_2026-04-21.md                  ← prior handoff
│   ├── NEXT_SESSION_CONTINUATION_2026-04-22.md              ← THIS FILE
│   ├── blog/2026-04-20-agentos-memory-longmemeval-rollout.md ← publishable blog
│   ├── specs/2026-04-21-step-{N}-*-design.md                ← spec docs
│   └── plans/2026-04-21-step-{N}-*-plan.md                  ← plan docs
├── results/
│   ├── LEADERBOARD.md           ← regenerated via `pnpm bench leaderboard`
│   └── runs/*.json              ← every Tier A / Phase A / Phase B run
└── .firecrawl/mastra-om/        ← Mastra source copies (READ THESE instead of re-fetching)
```

---

## 8. Superpowers workflow (user's standing instruction)

For ANY new architectural experiment in the next session, follow the discipline:

1. **`superpowers:brainstorming`** — explore approach, propose 2-3 options with tradeoffs, get user approval before any implementation. Do NOT skip even for "simple" changes.
2. **`superpowers:writing-plans`** — turn approved design into a TDD-ordered task-by-task plan. Save at `docs/plans/YYYY-MM-DD-<topic>-plan.md`.
3. **`superpowers:executing-plans`** — execute the plan inline (user has banned subagents). DO NOT use `subagent-driven-development`. DO NOT use `using-git-worktrees` (user has submodules).
4. **`superpowers:verification-before-completion`** — before declaring GREEN or claiming anything, run verification commands and confirm output.
5. **`superpowers:requesting-code-review`** — before merging any major milestone.
6. **`superpowers:receiving-code-review`** — when user pushes back on anything, pause and think before implementing.

For research phases:
- **`deep-research`** — multi-source search + Cohere reranking. Already used for Mastra; use for Supermemory + Hindsight next.
- **`firecrawl:firecrawl`** — web scraping (watch credit balance).

Pull competitor source code via `curl raw.githubusercontent.com/...` when possible — faster than Firecrawl and doesn't burn credits.

---

## 9. Concrete first actions for the new session

Do NOT rebuild context. Do NOT re-run prior experiments. Do:

1. **Read this file end-to-end.**
2. **Read `STEP_15_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-21.md`** for the full Tier A diagnostics.
3. **Verify git + tests state** (Task 0):
   ```bash
   cd /Users/johnn/Documents/git/voice-chat-assistant
   git log --oneline -5        # should see 7347c4a982 + a5f3c945d8 at top (Step 15)
   git status --short | head -10
   cd packages/agentos-bench
   pnpm typecheck              # must be clean
   pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts
   # expect 19/19 pass
   ```
4. **Invoke `superpowers:brainstorming`** to design Step 15 v2 (cross-session observer batching). Present the 24k-token rolling-window batching as the recommended approach with alternatives (per-session = current / per-everything-if-under-threshold / explicit token-target). Ask for user approval.
5. **Invoke `superpowers:writing-plans`** after design approval — TDD-ordered tasks for the batching fix + Tier A v2 + conditional Phase A.
6. **Invoke `superpowers:executing-plans`** — execute task-by-task.

Budget headroom: ~$100-200 remaining (user said "hundreds" was fine; ~$37 spent so far). Expected Step 15 v2 total (implementation + Tier A + Phase A + Phase B if GREEN): ~$150.

---

## 10. Continuation prompt (paste into fresh session)

```
Continue the AgentOS memory rollout. Read the fresh-session handoff at
packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_2026-04-22.md
end-to-end before doing anything.

Step 15 landed GREEN-soft: 75.0% at Tier A N=24, above the 73.2% canonical.
First architectural win since Step 3 Hybrid. The handoff documents the
concrete Step 15 v2 fix (cross-session observer batching) that should
lift us from 75% toward 80-83%.

After reading the handoff:

1. Verify git state + test suite (19/19 OM tests + 85/85 overall should
   pass). Report any drift.
2. Read STEP_15_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-21.md for the
   full Tier A diagnostics and the architectural-gap analysis.
3. Read the local Mastra source copies at packages/agentos-bench/
   .firecrawl/mastra-om/ (observational-memory.ts is the key file for
   batching logic) — do NOT re-fetch from GitHub, Firecrawl credits
   are exhausted.
4. Invoke superpowers:brainstorming to design Step 15 v2 (cross-session
   observer batching via 24k-token rolling window). Get user approval
   before implementing.
5. Invoke superpowers:writing-plans after approval.
6. Invoke superpowers:executing-plans to execute.
7. After Step 15 v2 Tier A, if GREEN, fire Phase A N=102 to confirm.
   If still GREEN at Phase A, fire Phase B N=500 for a publication-
   grade number.

Honor ~/.claude/CLAUDE.md global rules: no em dashes, no subagents,
no worktrees with submodules, --no-verify on monorepo commits, master
branch, no AI attribution in commit messages.

If Step 15 v2 plateaus below 80%, pivot to researching Supermemory
(81.6% gpt-4o, github.com/supermemoryai/supermemory) via deep-research
skill. Port their architecture as Step 16.
```

---

## 11. Budget + state-snapshot

**Spent so far (rollout total):** ~$36.60
- Steps 1-9: $26.53
- Step 11: $1.45
- Step 12: $1.84
- Step 13: $0.42
- Step 14: $2.08
- Step 15: $4.28

**Headroom:** "hundreds" per user → ~$100-200 remaining budget.

**Planned upcoming spend (if Step 15 v2 ladder fires all tiers):**
- Step 15 v2 Tier A: ~$5
- Step 15 v2 Phase A N=102: ~$20
- Step 15 v2 Phase B N=500: ~$100
- Total: ~$125

---

End of continuation handoff. New session: start with §9 actions.
