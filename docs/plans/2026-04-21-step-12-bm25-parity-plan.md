# Step 12 BM25 Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (user has banned subagents; do NOT use subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire BM25 parity for Observer/Reflector ADDITIVE mode in the LongMemEval-S bench adapter so reflection-derived traces become visible to the sparse-side retrieval stage, then run a Tier A kill-gated smoke to test whether this closes the Mastra gap (84.23%) or confirms reader-preference as the remaining RED root cause.

**Architecture:** Three-layer correction inside [packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts](../../src/benchmarks/longmemeval/LongMemEvalS.ts). Layer 1: per-session `flushReflection` with `scopeOverride: { scope: 'user', scopeId: 'bench' }`. Layer 2: index `encodedTraceIds` into `hybridBm25` via a new local helper. Layer 3: end-of-replay sweep over `store.listTraces({ scope: 'user', scopeId: 'bench' })` filtered by `provenance.sourceType === 'reflection'` with Set-based dedup. Bench-only change; no agentos submodule edits.

**Tech Stack:** TypeScript, vitest, `@framers/agentos` v0.1.255 (already pinned via monorepo submodule), Cohere rerank-v3.5 (existing), OpenAI gpt-4o reader/judge (existing).

**Spec:** [packages/agentos-bench/docs/specs/2026-04-21-step-12-bm25-parity-design.md](../specs/2026-04-21-step-12-bm25-parity-design.md)

**Commit discipline:** the user has instructed to hold all commits until final sign-off. Each "Stage" step below is a working-tree save point; we verify but do NOT `git commit` until explicit authorization. After the Tier A verdict, we'll present all staged changes for one combined review and commit.

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| [src/benchmarks/longmemeval/LongMemEvalS.ts](../../src/benchmarks/longmemeval/LongMemEvalS.ts) | Modify | Add `indexReflectionTracesIntoBm25` local helper + per-session block in both replay branches + end-of-replay sweep + `indexedReflectionIds` Set. ~40 LOC added. |
| [tests/step12BM25Parity.wiring.spec.ts](../../tests/step12BM25Parity.wiring.spec.ts) | Create | Three test groups: helper-level behavior, session-boundary wiring (verifies `flushReflection.encodedTraceIds` → `hybridBm25.addDocument`), and sweep orphan-detection (confirms `onTracesCreated`-style traces get caught). |
| [docs/STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md](../STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md) | Create | Post-run verdict doc with CIs, per-category breakdown, `evidenceOrigin`, stage metrics, comparison to Step 7 baseline, cost accounting, and rollback section. Template mirrors STEP_11 findings structure. |
| [docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](../RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md) | Modify | Integrate Step 12 verdict into §1 TL;DR, §4 pattern table, §7 scoreboard, §9 next-steps. |
| [docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md](../blog/2026-04-20-agentos-memory-longmemeval-rollout.md) | Modify | Add Step 12 paragraph to the negative-results section with its decisive data point. |
| [results/LEADERBOARD.md](../../results/LEADERBOARD.md) | Regenerate via CLI | Add Step 12 row. |
| [docs/COMPREHENSIVE_HANDOFF_2026-04-21.md](../COMPREHENSIVE_HANDOFF_2026-04-21.md) | Modify | Update §0 briefing, §2 timeline, §7 next-step candidates based on verdict. |

---

## Task 1: Add helper-function failing test

**Files:**
- Create: `packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts`

- [ ] **Step 1.1: Create test file with first failing contract**

```typescript
/**
 * @file step12BM25Parity.wiring.spec.ts
 * @description Wiring contracts for Step 12 — BM25 parity for
 * Observer/Reflector ADDITIVE mode. Pins three behaviors that the
 * LongMemEvalS bench adapter must honor:
 *
 *   1. `indexReflectionTracesIntoBm25` helper contract (this file).
 *   2. Session-boundary flushReflection → hybridBm25.addDocument wiring
 *      in ADDITIVE mode only.
 *   3. End-of-replay sweep catches orphan reflection traces that
 *      bypass flushReflection (e.g. ContextWindowManager.onTracesCreated).
 *
 * The helper is exported from LongMemEvalS.ts for direct unit testing;
 * the wiring tests use stubbed manager + hybridBm25 to assert call
 * patterns without firing real LLM calls.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BM25Index } from '@framers/agentos/rag/search/BM25Index';
import { indexReflectionTracesIntoBm25 } from '../src/benchmarks/longmemeval/LongMemEvalS.js';

describe('indexReflectionTracesIntoBm25 helper', () => {
  function stubBm25(): Pick<BM25Index, 'addDocument'> & { addDocument: ReturnType<typeof vi.fn> } {
    return { addDocument: vi.fn() };
  }

  function stubStore(traces: Record<string, { id: string; content: string }>) {
    return {
      getTrace: (id: string) => traces[id],
    };
  }

  it('adds every supplied id whose trace has non-empty content', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r1: { id: 'r1', content: 'Alice moved to Berlin' },
      r2: { id: 'r2', content: 'Alice prefers matcha' },
    });
    const indexed = new Set<string>();
    indexReflectionTracesIntoBm25(
      ['r1', 'r2'],
      store as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[1],
      bm25 as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[2],
      'session-tag-A',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(2);
    expect(bm25.addDocument).toHaveBeenCalledWith('r1', 'Alice moved to Berlin', { tag: 'session-tag-A' });
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'Alice prefers matcha', { tag: 'session-tag-A' });
    expect(indexed.has('r1')).toBe(true);
    expect(indexed.has('r2')).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run test — expect FAIL**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts`

Expected: FAIL with a TypeScript or resolver error about `indexReflectionTracesIntoBm25` not being exported from LongMemEvalS (the function does not exist yet).

- [ ] **Step 1.3: Stage (no commit)**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts
git status
# Expect: new file "packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts"
# DO NOT RUN git commit — user has instructed to hold all commits.
```

---

## Task 2: Implement helper to pass Task 1 test

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts` (add helper near other module-scope helpers, export it)

- [ ] **Step 2.1: Locate module-scope helpers**

Use Grep:

Pattern: `^function |^export function `
File: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

Expected: several existing helpers around lines 1200-1350 (`chunkSessionTurns`, `splitForEmbedding`, etc.). The new helper should live alongside them near the top of the cognitive path section.

- [ ] **Step 2.2: Add helper function + export**

Edit near existing module-scope helpers (above `runFullCognitiveCase` declaration, around line 1250 — pick the location by `git blame` / adjacent helper placement, do NOT hardcode a line number):

```typescript
/**
 * Step 12 helper — index reflection-derived trace IDs into the bench's
 * BM25 index so sparse retrieval sees them in ADDITIVE mode.
 *
 * Mirrors the REPLACEMENT-mode block at LongMemEvalS.ts:1443-1450 /
 * 1553-1560 but factored out so it can be unit-tested in isolation and
 * reused by both the per-session flushReflection call and the
 * end-of-replay sweep.
 *
 * `BM25Index.addDocument` is idempotent — it calls `removeDocument(id)`
 * internally before inserting — so re-indexing an id is safe but
 * wasteful. The `indexed` Set short-circuits previously-seen ids. Empty
 * or missing traces are silently skipped (BM25Index throws on empty
 * text; we pre-check to keep the helper no-throw).
 *
 * @param ids - Trace IDs to index. Typically `flushReflection.encodedTraceIds`
 *   or the filtered result of `store.listTraces(...)`.
 * @param store - MemoryStore exposing `getTrace(id)`.
 * @param hybridBm25 - Per-run BM25Index instance owned by the bench.
 * @param sessionTag - Tag applied to the BM25 document metadata so
 *   retrieval-time session filters match. Pass `'reflection-sweep'`
 *   for the end-of-replay sweep (no specific session).
 * @param indexed - Mutable Set tracking ids already indexed. Mutated
 *   in place; callers should pass a single Set across all invocations
 *   within one replay.
 */
export function indexReflectionTracesIntoBm25(
  ids: readonly string[],
  store: { getTrace?: (id: string) => { id: string; content: string } | undefined },
  hybridBm25: { addDocument: (id: string, text: string, metadata?: Record<string, unknown>) => void },
  sessionTag: string,
  indexed: Set<string>,
): void {
  for (const id of ids) {
    if (indexed.has(id)) continue;
    const trace = store.getTrace?.(id);
    if (!trace || !trace.content) continue;
    try {
      hybridBm25.addDocument(id, trace.content, { tag: sessionTag });
      indexed.add(id);
    } catch {
      // Non-critical: BM25Index throws only on empty id/text, both
      // guarded above. Catch is defensive for future changes.
    }
  }
}
```

- [ ] **Step 2.3: Run test — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts`

Expected: `1 test passed` (Task 1 contract).

- [ ] **Step 2.4: Run typecheck — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit (no TypeScript errors).

- [ ] **Step 2.5: Stage**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
git status --short | grep LongMemEvalS.ts
# Expect:  M packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
```

---

## Task 3: Helper — idempotency + empty-content skip tests

**Files:**
- Modify: `packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts`

- [ ] **Step 3.1: Add idempotency test**

Append inside the `describe('indexReflectionTracesIntoBm25 helper', ...)` block:

```typescript
  it('skips ids already present in the indexed Set', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r1: { id: 'r1', content: 'already indexed' },
      r2: { id: 'r2', content: 'fresh' },
    });
    const indexed = new Set<string>(['r1']);
    indexReflectionTracesIntoBm25(
      ['r1', 'r2'],
      store as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[1],
      bm25 as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[2],
      'session-tag-B',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'fresh', { tag: 'session-tag-B' });
  });

  it('skips ids whose trace has empty content', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r1: { id: 'r1', content: '' },
      r2: { id: 'r2', content: 'real content' },
    });
    const indexed = new Set<string>();
    indexReflectionTracesIntoBm25(
      ['r1', 'r2'],
      store as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[1],
      bm25 as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[2],
      'session-tag-C',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'real content', { tag: 'session-tag-C' });
    expect(indexed.has('r1')).toBe(false);
  });

  it('skips ids not present in the store', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r2: { id: 'r2', content: 'real' },
    });
    const indexed = new Set<string>();
    indexReflectionTracesIntoBm25(
      ['missing', 'r2'],
      store as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[1],
      bm25 as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[2],
      'session-tag-D',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(indexed.has('missing')).toBe(false);
    expect(indexed.has('r2')).toBe(true);
  });
```

- [ ] **Step 3.2: Run — expect all 4 tests pass**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts`

Expected: `4 tests passed`.

- [ ] **Step 3.3: Stage**

```bash
git add packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts
```

---

## Task 4: Sweep-filter contract test

**Files:**
- Modify: `packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts`

The sweep logic itself is a few lines inlined into `replayForCognitive`; we pin its filter contract (only `sourceType === 'reflection'` + in the right scope + not already indexed) as a standalone test over a fake store.

- [ ] **Step 4.1: Add sweep filter test**

Append a new `describe` block:

```typescript
describe('end-of-replay sweep filter contract', () => {
  it('indexes only reflection-sourced traces not already in Set', () => {
    const bm25 = { addDocument: vi.fn() };
    const allTraces = [
      { id: 'raw1', content: 'User: hello', provenance: { sourceType: 'user_statement' } },
      { id: 'r1', content: 'User moved to Berlin', provenance: { sourceType: 'reflection' } },
      { id: 'r2', content: 'User prefers matcha', provenance: { sourceType: 'reflection' } },
      { id: 'r3', content: 'System message', provenance: { sourceType: 'system' } },
    ];
    const indexed = new Set<string>(['r1']); // r1 already indexed via flushReflection
    const store = {
      listTraces: () => allTraces,
      getTrace: (id: string) => allTraces.find((t) => t.id === id),
    };

    // Sweep logic — inlined to match what replayForCognitive runs.
    // Kept here in the test to serve as the contract; any divergence
    // between this loop and the one in LongMemEvalS.ts is a bug.
    const orphanIds: string[] = [];
    for (const trace of store.listTraces()) {
      if (trace.provenance.sourceType !== 'reflection') continue;
      if (indexed.has(trace.id)) continue;
      orphanIds.push(trace.id);
    }
    expect(orphanIds).toEqual(['r2']);

    indexReflectionTracesIntoBm25(
      orphanIds,
      store as unknown as Parameters<typeof indexReflectionTracesIntoBm25>[1],
      bm25,
      'reflection-sweep',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'User prefers matcha', { tag: 'reflection-sweep' });
    expect(indexed.has('r2')).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run — expect pass**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts`

Expected: `5 tests passed`.

- [ ] **Step 4.3: Stage**

```bash
git add packages/agentos-bench/tests/step12BM25Parity.wiring.spec.ts
```

---

## Task 5: Wire Layer 1+2 into `replayForCognitive` (observe branch)

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 5.1: Locate the observe-branch REPLACEMENT block**

Use Read with `offset=1435, limit=25` on LongMemEvalS.ts to confirm the exact current content at the insertion point. Expected lines:

```
      // Step 8: REPLACEMENT mode session boundary. Force reflection over
      // accumulated pending notes; encode reflection-derived traces;
      // index them into BM25 so sparse retrieval sees them too.
      if (observerReflectorReplaceEnabled) {
        try {
          const flush = await handle.manager.flushReflection(
            neutralMood,
            { scope: 'user', scopeId: 'bench' },
          );
          if (hybridBm25 && flush.encodedTraceIds.length > 0) {
            const store = handle.manager.getStore();
            for (const id of flush.encodedTraceIds) {
              const trace = store.getTrace?.(id);
              if (trace && trace.content) {
                hybridBm25.addDocument(id, trace.content, { tag: sessionTag });
              }
            }
          }
        } catch {
          // Flush errors non-critical; next session can still produce reflections.
        }
      }
```

- [ ] **Step 5.2: Add Step 12 ADDITIVE block directly below the REPLACEMENT block**

Use Edit:

```typescript
// Before:
      }
      // Step 9: fact-graph session boundary. Extract tuples from the

// After:
      }
      // Step 12: ADDITIVE-mode BM25 parity. Mirrors the REPLACEMENT
      // block above but runs when observer is enabled AND replace is
      // NOT. Keeps raw chunks indexed in BM25 (unchanged) while also
      // adding reflection-derived traces. Uses the local helper +
      // shared `indexedReflectionIds` Set for O(1) dedup.
      if (
        observerReflectorEnabled &&
        !observerReflectorReplaceEnabled &&
        hybridBm25
      ) {
        try {
          const flush = await handle.manager.flushReflection(
            neutralMood,
            { scope: 'user', scopeId: 'bench' },
          );
          indexReflectionTracesIntoBm25(
            flush.encodedTraceIds,
            handle.manager.getStore(),
            hybridBm25,
            sessionTag,
            indexedReflectionIds,
          );
        } catch {
          // Flush errors non-critical; next session can still produce reflections.
        }
      }
      // Step 9: fact-graph session boundary. Extract tuples from the
```

- [ ] **Step 5.3: Declare `indexedReflectionIds` Set at replay scope**

Scroll up to the top of `replayForCognitive` (around line 1280, identified by the `async function replayForCognitive(` signature). Add after the existing state initializations (where `sessionsContextualized` etc. are declared):

```typescript
  // Step 12 — reflection IDs already indexed into hybridBm25. Shared
  // across the per-session flushReflection calls (both observe and
  // ingest branches) and the end-of-replay sweep so we dedup cheaply.
  const indexedReflectionIds: Set<string> = new Set();
```

- [ ] **Step 5.4: Run typecheck — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit.

- [ ] **Step 5.5: Stage**

```bash
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
```

---

## Task 6: Wire Layer 1+2 into `replayForCognitive` (ingest branch)

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 6.1: Locate the ingest-branch REPLACEMENT block**

Use Read with `offset=1545, limit=25` on LongMemEvalS.ts. Expected content is the symmetric block at lines 1547-1565 (structure identical to observe-branch).

- [ ] **Step 6.2: Add Step 12 ADDITIVE block directly below ingest-branch REPLACEMENT**

Use Edit:

```typescript
// Before:
      }
      // Step 9: fact-graph session boundary (ingest branch). Mirrors

// After:
      }
      // Step 12: ADDITIVE-mode BM25 parity (ingest branch). Symmetric
      // with the observe-branch block above.
      if (
        observerReflectorEnabled &&
        !observerReflectorReplaceEnabled &&
        hybridBm25
      ) {
        try {
          const flush = await handle.manager.flushReflection(
            neutralMood,
            { scope: 'user', scopeId: 'bench' },
          );
          indexReflectionTracesIntoBm25(
            flush.encodedTraceIds,
            handle.manager.getStore(),
            hybridBm25,
            sessionTag,
            indexedReflectionIds,
          );
        } catch {
          // Flush errors non-critical; next session can still produce reflections.
        }
      }
      // Step 9: fact-graph session boundary (ingest branch). Mirrors
```

- [ ] **Step 6.3: Run typecheck — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit.

- [ ] **Step 6.4: Stage**

```bash
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
```

---

## Task 7: Wire Layer 3 (end-of-replay sweep)

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 7.1: Find the end of `replayForCognitive`**

Use Grep:
Pattern: `^  return {|^  return \{`
File: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

Expected: one or more matches near the end of `replayForCognitive`. The sweep must fire BEFORE the function returns its replay summary.

- [ ] **Step 7.2: Insert sweep block**

Just before the `return` statement that closes `replayForCognitive` (verify via Read with an offset near the end of the function), insert:

```typescript
  // Step 12 Layer 3 — end-of-replay reflection-trace sweep.
  // Catches traces encoded via observer auto-trigger OR
  // ContextWindowManager.onTracesCreated — both paths bypass
  // flushReflection and therefore the session-boundary blocks above.
  // Idempotent via `indexedReflectionIds` Set; safe no-op if no
  // orphan reflection traces exist.
  if (
    observerReflectorEnabled &&
    !observerReflectorReplaceEnabled &&
    hybridBm25
  ) {
    const store = handle.manager.getStore();
    const scoped = store.listTraces({
      scope: 'user',
      scopeId: 'bench',
      activeOnly: true,
    });
    const orphanIds: string[] = [];
    for (const trace of scoped) {
      if (trace.provenance.sourceType !== 'reflection') continue;
      if (indexedReflectionIds.has(trace.id)) continue;
      orphanIds.push(trace.id);
    }
    indexReflectionTracesIntoBm25(
      orphanIds,
      store,
      hybridBm25,
      'reflection-sweep',
      indexedReflectionIds,
    );
  }
```

- [ ] **Step 7.3: Run typecheck — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit. If the `provenance` property requires a deeper type path (e.g. via `MemoryTrace.provenance?.sourceType`), match the existing pattern in LongMemEvalS.ts — Grep for `provenance.sourceType` to confirm the property access is `trace.provenance.sourceType`.

- [ ] **Step 7.4: Run full Step 12 test file**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts`

Expected: `5 tests passed`.

- [ ] **Step 7.5: Stage**

```bash
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
```

---

## Task 8: Phase 1 infrastructure regression

**Files:**
- (none; this is a verification step)

- [ ] **Step 8.1: Run Phase 1 tests + Step 12 wiring together**

Run:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm vitest run \
  tests/resultStoreNRegression.spec.ts \
  tests/computePairedMcNemar.spec.ts \
  tests/computeEvidenceProvenance.spec.ts \
  tests/computeRetrievalStageMetrics.spec.ts \
  tests/factGraph.wiring.spec.ts \
  tests/redactSecretsFromConfig.spec.ts \
  tests/readerTopK.spec.ts \
  tests/step12BM25Parity.wiring.spec.ts
```

Expected: **8 files, 42 tests passed** (37 pre-existing + 5 new).

- [ ] **Step 8.2: If any fail, halt and diagnose**

Do not proceed to the cost run. Investigate via Read + Grep. Confirm the failing test's assertion matches the spec's stated behavior. Fix inline; re-run.

---

## Task 9: Preflight dry-run (verify config, cache state, cost)

**Files:**
- (none)

- [ ] **Step 9.1: Source the wilds-ai env**

Run:

```bash
set -a
source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env
set +a
env | grep -E 'OPENAI_API_KEY|COHERE_API_KEY' | head -2 | sed 's/=.*/=<set>/'
```

Expected: both lines visible as `OPENAI_API_KEY=<set>` and `COHERE_API_KEY=<set>`.

- [ ] **Step 9.2: Preflight the Tier A command with `--dry-run`**

Run:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
LONGMEMEVAL_S_PATH="${LONGMEMEVAL_S_PATH:-$HOME/Documents/git/voice-chat-assistant/data/longmemeval/longmemeval_s.json}" \
pnpm bench run \
  --benchmark longmemeval-s \
  --reader gpt-4o \
  --judge gpt-4o \
  --mode full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --context-summary gpt-5-mini \
  --observer-reflector \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 \
  --seed 42 \
  --max-usd 10 \
  --dry-run
```

Expected: preflight prints cost estimate (likely ~$3-5 for N=24 actual). Confirms cache-key fingerprint differs from any prior Step 7 / Step 11 cached run (Step 12 adds a new wiring path; if the cache-key hashes the configuration including wiring flags, it will differ). If cost estimate is > $8, HALT and investigate.

- [ ] **Step 9.3: If cache hit predicted, force-invalidate**

If the preflight reports that cached answers will be replayed at $0 cost, Step 12's new code path may not be exercised — halt, add a cache-key fingerprint element for Step 12 (e.g., include `step-12-bm25-parity:v1` in the bench cache-key via `BenchmarkRunner.resolveRunConfig`), re-run preflight. Mirror what Step 11 did for `REFLECTOR_PROMPT_HASH`.

NOTE: the BM25-parity change does not alter the reflector prompt text, so `REFLECTOR_PROMPT_HASH`-based cache invalidation will not trigger. A dedicated fingerprint element is required. This is similar to the Step 11 cache-hit bug; do not ignore.

- [ ] **Step 9.4: Add Step 12 cache-key fingerprint if needed**

If Step 9.3 confirms cache hit: Grep for `reflector-prompt:` in `src/core/BenchmarkRunner.ts` to find the existing fingerprint block. Add `step-12-bm25-parity:v1` alongside. Re-run typecheck + preflight.

---

## Task 10: Tier A smoke run

**Files:**
- (none for the run itself; findings doc written in Task 11)

- [ ] **Step 10.1: Execute Tier A**

Run (drop `--dry-run`):

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
LONGMEMEVAL_S_PATH="${LONGMEMEVAL_S_PATH:-$HOME/Documents/git/voice-chat-assistant/data/longmemeval/longmemeval_s.json}" \
pnpm bench run \
  --benchmark longmemeval-s \
  --reader gpt-4o \
  --judge gpt-4o \
  --mode full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --context-summary gpt-5-mini \
  --observer-reflector \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 \
  --seed 42 \
  --max-usd 10 \
  2>&1 | tee results/runs/step-12-tier-a-log.txt
```

Expected: run completes in 10-25 minutes. Final summary line includes unweighted accuracy + total cost + bootstrap CI.

- [ ] **Step 10.2: Verify summary.json N-regression guard held**

Run:

```bash
python3 -c "
import json
d = json.load(open('results/summary.json'))
r = d['latest']['longmemeval-s|gpt-4o|full-cognitive|ingest']
assert r['totalCases'] == 500, f'REGRESSION: summary.json clobbered to N={r[\"totalCases\"]}'
assert abs(r['accuracy'] - 0.732) < 0.001, f'REGRESSION: canonical acc changed to {r[\"accuracy\"]}'
print(f'OK: canonical row preserved at N={r[\"totalCases\"]} acc={r[\"accuracy\"]}')
"
```

Expected: `OK: canonical row preserved at N=500 acc=0.732`.

- [ ] **Step 10.3: Locate the Step 12 run JSON**

Run:

```bash
ls -la results/runs/*.json | tail -3
```

Expected: the most recent file with a `2026-04-21T..` timestamp. Record its filename for use in the findings doc.

- [ ] **Step 10.4: Parse the run JSON**

Run:

```bash
LATEST=$(ls -t results/runs/2026-04-2[12]T*longmemeval-s--gpt-4o--full-cognitive--ingest.json | head -1)
python3 -c "
import json
d = json.load(open('$LATEST'))
print(f'N={d[\"totalCases\"]}')
print(f'unweighted={d[\"accuracy\"]:.3f} CI=[{d[\"accuracyCI\"][\"ciLo\"]:.3f}, {d[\"accuracyCI\"][\"ciHi\"]:.3f}]')
print(f'weighted={d.get(\"weightedAccuracy\", \"n/a\")}')
print(f'cost=\${d[\"totalUsd\"]:.3f}')
print(f'cost/correct=\${d[\"totalUsd\"]/(d[\"accuracy\"]*d[\"totalCases\"]):.4f}')
print(f'evidenceOrigin={d.get(\"evidenceOrigin\", {})}')
print('stage_recall:', {k: v.get('meanRecallAtK', 'n/a') for k, v in d.get('retrievalStageMetrics', {}).items()})
for cat, m in d.get('stratifiedAccuracy', {}).get('byType', {}).items():
    print(f'  {cat:30s} n={m[\"n\"]:3d} acc={m[\"accuracy\"]:.3f}')
"
```

Record the output. This drives the findings doc.

---

## Task 11: Write findings doc

**Files:**
- Create: `packages/agentos-bench/docs/STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md`

- [ ] **Step 11.1: Render findings from the Task 10.4 output**

Template (mirrors [STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md](../STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md) — structural clone, different content):

```markdown
# Step 12 Findings — BM25 Parity for Observer/Reflector ADDITIVE Mode

**Date:** 2026-04-21
**Scope:** Wire reflection-derived traces into the bench's BM25 index
in ADDITIVE mode so sparse-side retrieval sees them. Three-layer
correction: per-session `flushReflection` with scopeOverride,
`encodedTraceIds` indexing, end-of-replay sweep over
`sourceType === 'reflection'`.
**Spec:** [specs/2026-04-21-step-12-bm25-parity-design.md](specs/2026-04-21-step-12-bm25-parity-design.md)
**Plan:** [plans/2026-04-21-step-12-bm25-parity-plan.md](plans/2026-04-21-step-12-bm25-parity-plan.md)
**Baseline:** Step 7 ADDITIVE at 62.5% N=24.
**Kill gate:** unweighted ≥ 82.5% at Tier A.

---

## Verdict: [GREEN / PARTIAL / RED — fill from Task 10.4]

[Fill unweighted + CI + delta vs Step 7 vs Tier 1 smoke 87.5%]

### Per-category
[Fill table from Task 10.4]

### Bootstrap 95% CI
[Fill from Task 10.4]

### Cost
[Fill from Task 10.4]

---

## Decisive data point: evidence-provenance

[Fill `evidenceOrigin` — interpretation depends on the counts]

- If `reflection > 0`: "Step 12 succeeded at making reflection traces visible to retrieval. The reader [did / did not] convert visibility into accuracy."
- If `reflection: 0`: "Even with BM25 parity, the reader ignores reflection traces when raw chunks are available. Observer/Reflector line closes for benchmark-accuracy purposes; remains viable for production workloads where raw chunks are ephemeral."

### Stage-level retrieval metrics

[Fill from Task 10.4 `retrievalStageMetrics`]

---

## Root cause analysis

[Based on verdict: either "reflection traces now indexed but not load-bearing" OR "first GREEN observer variant; investigate what made the difference"]

---

## What ships

- BM25 parity helper (`indexReflectionTracesIntoBm25`) + ADDITIVE-mode session-boundary + end-of-replay sweep wiring in [LongMemEvalS.ts](../src/benchmarks/longmemeval/LongMemEvalS.ts). 5 new unit tests pin the contracts.
- Step 12 cache-key fingerprint element (if Task 9.4 required it).

## What does NOT ship

- No production default flip (Tier 1 Hybrid remains 73.2% shipping).
- No agentos submodule changes.
- No CLI flag additions (existing `--observer-reflector` continues to control ADDITIVE vs REPLACEMENT semantics).

---

## Pattern update

[If RED: "n=8 RED pattern confirmed — LLM content transformation regresses even with BM25 visibility fixed." If GREEN: "Pattern-breaking result: first Observer/Reflector variant to exceed Tier 1 smoke. Additive-signal path viable when sparse visibility matches dense." If PARTIAL: describe nuance.]

---

## Commits

[List the agentos-bench commits introduced by this spec once authorized. Track separately from agentos submodule (unchanged).]

---

## Rollback

Not required. All changes are strictly additive and gated behind
`--observer-reflector` (ADDITIVE). REPLACEMENT-mode behavior unchanged.
Tier 1 shipping default unchanged.

---

## Recommendation

[Based on verdict, recommend next step. If RED, close Observer/Reflector line + recommend Step 13 graph-activation wire-up or Step 10 two-call reader. If GREEN, recommend Phase A N=102 + paired McNemar vs Step 7 before default flip.]

End of Step 12 findings.
```

- [ ] **Step 11.2: Fill the template with Task 10.4 numbers**

Read Task 10.4 output. Substitute concrete numbers for every bracketed placeholder. Double-check no `[TBD]` or `[Fill...]` remains.

- [ ] **Step 11.3: Stage**

```bash
git add packages/agentos-bench/docs/STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md
```

---

## Task 12: Integrate into umbrella + blog + leaderboard

**Files:**
- Modify: `packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md`
- Modify: `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md`
- Regenerate: `packages/agentos-bench/results/LEADERBOARD.md`
- Modify: `packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-21.md`

- [ ] **Step 12.1: Umbrella findings §1 TL;DR**

Read the current §1 TL;DR; add one bullet for Step 12 verdict (mirror how Step 11 was added). Update the "Total measurement cost" running total. Update the "n=7 RED pattern" to "n=8 RED or null" if applicable.

- [ ] **Step 12.2: Umbrella §4 pattern table**

Add a new row for Step 12 under the "what NOT to re-test" table. Columns: Pattern / Evidence / Don't retry unless. Evidence cites the Step 12 run JSON filename + `evidenceOrigin` counts.

- [ ] **Step 12.3: Umbrella §7 scoreboard**

Add Step 12 row to the "running scoreboard" table. Keep the same column structure.

- [ ] **Step 12.4: Umbrella §9 next-steps**

Update the next-steps section: if RED, remove Step 12 from "what to try next" and add the findings-doc recommendation. If GREEN, update to "Step 12 Phase A underway."

- [ ] **Step 12.5: Blog post integration**

Add one paragraph in the negative-results narrative (or positive-results if GREEN). Cite the decisive data point from §Decisive data point of the findings doc. Link to the findings doc inline. Maintain the existing no-em-dash rule.

- [ ] **Step 12.6: Regenerate LEADERBOARD.md**

Run:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench report leaderboard 2>&1 | tail -20
```

Expected: leaderboard CLI writes `results/LEADERBOARD.md` with the Step 12 row added.

- [ ] **Step 12.7: COMPREHENSIVE_HANDOFF_2026-04-21.md updates**

Update §0 briefing (add Step 12 verdict line), §2 timeline (add Step 12 session entry), §4 pattern table (add Step 12 row), §7 next-step candidates (remove Step 12 from "recommended"; add whatever the findings doc recommends next).

- [ ] **Step 12.8: Stage all doc updates**

```bash
git add \
  packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md \
  packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
  packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-21.md \
  packages/agentos-bench/results/LEADERBOARD.md
```

---

## Task 13: Fold the stale narrower handoff

**Files:**
- Modify: `packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md`

- [ ] **Step 13.1: Replace with redirect pointer**

The current `NEXT_SESSION_HANDOFF.md` is stale (labeled "end of Steps 1-8 session"). Since [COMPREHENSIVE_HANDOFF_2026-04-21.md](../COMPREHENSIVE_HANDOFF_2026-04-21.md) now covers Steps 1-12, replace the body with a short redirect:

```markdown
# AgentOS Memory Rollout — Next Session Handoff

**Status:** superseded by
[COMPREHENSIVE_HANDOFF_2026-04-21.md](./COMPREHENSIVE_HANDOFF_2026-04-21.md)
as of 2026-04-21.

Use the comprehensive handoff as the single source of truth for
continuing this rollout. The comprehensive doc covers all content
previously duplicated here plus the post-Step-11 work (Step 12 BM25
parity + audit findings for Step 13 graph-activation wire-up +
remaining architectural primitives).

For the continuation prompt, see §1 of the comprehensive handoff.
```

- [ ] **Step 13.2: Stage**

```bash
git add packages/agentos-bench/docs/NEXT_SESSION_HANDOFF.md
```

---

## Task 14: Final verification before sign-off

**Files:**
- (none; this is a verification gate)

- [ ] **Step 14.1: Re-run full test suite**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step12BM25Parity.wiring.spec.ts tests/resultStoreNRegression.spec.ts tests/computePairedMcNemar.spec.ts tests/computeEvidenceProvenance.spec.ts tests/computeRetrievalStageMetrics.spec.ts tests/factGraph.wiring.spec.ts tests/redactSecretsFromConfig.spec.ts tests/readerTopK.spec.ts`

Expected: 42/42 pass.

- [ ] **Step 14.2: Typecheck agentos-bench**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit.

- [ ] **Step 14.3: Typecheck agentos**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos && pnpm typecheck`

Expected: clean exit (agentos was untouched, so this should remain GREEN).

- [ ] **Step 14.4: git status + staged diff review**

Run:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git status --short
echo "---"
git diff --cached --stat
```

Expected:
- All Step 12 files staged (source, test, findings, umbrella, blog, leaderboard, handoff, next-session-handoff, spec, plan).
- No agentos submodule changes staged.
- No untracked config or secret files.

- [ ] **Step 14.5: Summarize for user sign-off**

Present to the user:
- Verdict (GREEN / PARTIAL / RED with numbers).
- All staged changes (git status output).
- Proposed commit structure (1-3 logical commits separating: (a) Step 12 implementation + tests, (b) Step 12 findings doc, (c) umbrella/blog/handoff integration).
- Ask permission before running `git commit`.

---

## Self-review notes

1. **Spec coverage:** every section of [2026-04-21-step-12-bm25-parity-design.md](../specs/2026-04-21-step-12-bm25-parity-design.md) maps to a task above. §3-5 architecture + code sketches → Tasks 2, 5, 6, 7. §6 testing → Tasks 1, 3, 4, 8. §7 measurement → Tasks 9, 10. §9 expected outcomes → Task 11 findings doc. §12 out-of-scope audit findings → Task 13 stale-handoff cleanup (remaining audits are future-spec material, not this plan's scope).
2. **Placeholder scan:** every step has concrete code or command. No "TBD", "write tests for the above", "similar to Task N".
3. **Type consistency:** `indexReflectionTracesIntoBm25` signature is defined once (Task 2) and called verbatim in Tasks 5, 6, 7, and tested in Tasks 1, 3, 4. `indexedReflectionIds` is declared once (Task 5.3) and shared across 5.2, 6.2, 7.2.
4. **Commit discipline:** every task uses `git add` only (not `git commit`). Final sign-off step (14.5) asks user permission before committing. Matches user's standing rule.
5. **No em dashes** in prose. Exception: the existing handoff text being cited keeps its punctuation; we do not modify unrelated punctuation.

---

End of Step 12 plan.
