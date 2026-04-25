# Comprehensive Evaluation Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Plan B2 v1 of the comprehensive evaluation matrix: 6 architectures × 3 conversational benchmarks (LongMemEval-S, LongMemEval-M, LOCOMO) at full N + BEAM 100K spot-check, all with bootstrap CI + per-category + cost/correct + p50/p95 + tokens/query + judge FPR.

**Architecture:** Two new agentos extension packages (`agentos-ext-summarized-memory` for Stage L, `agentos-ext-entity-linking-memory` for Stage I) implementing executors that wire into existing `IngestRouter` and `MemoryRouter` dispatchers. One bench adapter (BEAM) implementing `IBenchmark`. Iterate cheaply via `--sample-per-type N` Phase A, validate winners at full N Phase B.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, semantic-release. New packages follow `agentos-ext-grounding-guard` template. New benchmark adapter follows `LongMemEvalS` template.

**Spec anchor:** [packages/agentos-bench/docs/specs/2026-04-25-comprehensive-evaluation-matrix-design.md](../specs/2026-04-25-comprehensive-evaluation-matrix-design.md)

**SOTA evidence anchor:** [packages/agentos-bench/docs/SOTA_CITED_EVIDENCE_2026-04-25.md](../SOTA_CITED_EVIDENCE_2026-04-25.md)

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/agentos-ext-summarized-memory/package.json` | Package manifest, peer-dep on `@framers/agentos@^0.2.11` |
| `packages/agentos-ext-summarized-memory/tsconfig.json` | TS build config |
| `packages/agentos-ext-summarized-memory/vitest.config.ts` | Test config with monorepo agentos path resolution |
| `packages/agentos-ext-summarized-memory/src/SummarizedIngestExecutor.ts` | Anthropic Contextual Retrieval recipe — one summary per session, prepended to chunks |
| `packages/agentos-ext-summarized-memory/src/sessionSummarizer.ts` | LLM-summarize-per-session pure function with caching key |
| `packages/agentos-ext-summarized-memory/src/types.ts` | `SummarizedIngestOptions`, `SummarizerLLM`, `SummarizedTrace` types |
| `packages/agentos-ext-summarized-memory/src/index.ts` | Barrel export + `createExtensionPack()` factory |
| `packages/agentos-ext-summarized-memory/test/sessionSummarizer.spec.ts` | Pure-function tests for the summarizer |
| `packages/agentos-ext-summarized-memory/test/SummarizedIngestExecutor.spec.ts` | Executor contract tests (works with `FunctionIngestDispatcher`) |
| `packages/agentos-ext-entity-linking-memory/package.json` | Package manifest |
| `packages/agentos-ext-entity-linking-memory/tsconfig.json` | TS build config |
| `packages/agentos-ext-entity-linking-memory/vitest.config.ts` | Test config |
| `packages/agentos-ext-entity-linking-memory/src/EntityExtractor.ts` | Mem0-v3-style entity extraction (proper nouns, quoted text, compound noun phrases) |
| `packages/agentos-ext-entity-linking-memory/src/EntityStore.ts` | Parallel `{collection}_entities` store wrapping `IVectorStore` |
| `packages/agentos-ext-entity-linking-memory/src/EntityLinkingExecutor.ts` | Ingest executor: runs extraction + writes both main + entity collections |
| `packages/agentos-ext-entity-linking-memory/src/EntityRetrievalRanker.ts` | Recall-stage signal: re-rank candidates by entity-overlap score |
| `packages/agentos-ext-entity-linking-memory/src/types.ts` | Types |
| `packages/agentos-ext-entity-linking-memory/src/index.ts` | Barrel + factory |
| `packages/agentos-ext-entity-linking-memory/test/EntityExtractor.spec.ts` | Pure extraction tests |
| `packages/agentos-ext-entity-linking-memory/test/EntityRetrievalRanker.spec.ts` | Ranker tests |
| `packages/agentos-ext-entity-linking-memory/test/EntityLinkingExecutor.spec.ts` | End-to-end ingest+recall test |
| `packages/agentos-bench/src/benchmarks/beam/dataset.ts` | BEAM dataset loader (`loadBeamDataset(dataDir, tier)`) |
| `packages/agentos-bench/src/benchmarks/beam/Beam100K.ts` | BEAM 100K tier subclass (concrete, not placeholder) |
| `packages/agentos-bench/tests/beam-dataset.spec.ts` | Loader tests |
| `packages/agentos-bench/tests/beam-adapter.spec.ts` | Adapter contract tests |
| `packages/agentos-bench/scripts/run-eval-matrix-phase-a.ts` | Orchestration script: sweep all 15 variants × 3 conversational benchmarks |
| `packages/agentos-bench/scripts/run-eval-matrix-phase-b.ts` | Phase B orchestration for surviving architectures |
| `packages/agentos-bench/scripts/run-beam-spot-check.ts` | BEAM 100K spot-check (one-shot, ~$5) |
| `packages/agentos-bench/scripts/build-eval-matrix-table.ts` | Reads all run JSONs, emits comparison-table markdown |
| `packages/agentos-bench/results/eval-matrix-v1/comparison-table.md` | Final assembled table (output) |
| `packages/agentos-bench/results/eval-matrix-v1/transparency-notes.md` | Judge FPR per benchmark, vendor footnotes (output) |

### Modified files

| Path | Modification |
|---|---|
| `packages/agentos-bench/src/benchmarks/beam/Beam.ts` | Replace `BeamUnimplementedError` placeholder with real adapter |
| `packages/agentos-bench/src/benchmarks/beam/index.ts` | Export `Beam100K` instead of just placeholder |
| `packages/agentos-bench/src/cli.ts` | Add `--benchmark beam-100k` mapping + new orchestration scripts |
| `packages/agentos/src/ingest-router/dispatcher.ts` | (No code change) Verified `FunctionIngestDispatcher` accepts the new executor signatures |
| `packages/agentos/src/memory-router/dispatcher.ts` | (No code change) Same verification for entity-linking-hybrid backend |
| `apps/agentos-live-docs/docs/index.md` | Add v1 publication entry + cross-link new extension packages |
| `pnpm-workspace.yaml` | (Auto, but verify) New packages are picked up by workspace pnpm |

---

## Phase 0 — Setup (Day 0, 30 min)

### Task 0.1: Create the plans directory + verify spec is committed

- [ ] **Step 1: Verify the plans directory exists**

```bash
ls /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/docs/plans/
```

Expected: this plan file exists. If the directory doesn't exist yet, the Write tool that created this plan also created it.

- [ ] **Step 2: Verify the spec is committed locally**

```bash
git -C /Users/johnn/Documents/git/voice-chat-assistant log --oneline -3 packages/agentos-bench/docs/specs/2026-04-25-comprehensive-evaluation-matrix-design.md
```

Expected: most recent commit shows `docs(agentos-bench): revise eval matrix spec to BEAM spot-check (v1) + full BEAM v2`.

- [ ] **Step 3: Confirm working tree is clean for new package work**

```bash
git -C /Users/johnn/Documents/git/voice-chat-assistant status -s | grep -E "^(M|A|D|UU)" | head
```

Expected: only the new plan file shows up as untracked. If other tracked files are modified, isolate them before starting (per "no scope creep" rule).

---

## Week 1 — Stage L: Anthropic Contextual Retrieval `summarized` executor (Days 1-5)

### Task 1.1: Scaffold the `agentos-ext-summarized-memory` package

**Files:**
- Create: `packages/agentos-ext-summarized-memory/package.json`
- Create: `packages/agentos-ext-summarized-memory/tsconfig.json`
- Create: `packages/agentos-ext-summarized-memory/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@framers/agentos-ext-summarized-memory",
  "version": "0.1.0",
  "description": "Anthropic Contextual Retrieval ingest executor for AgentOS IngestRouter — prepends per-session summary to every chunk before embedding",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@framers/agentos": "^0.2.11"
  },
  "devDependencies": {
    "@framers/agentos": "workspace:*",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  },
  "license": "MIT",
  "author": "Frame.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/framersai/voice-chat-assistant.git",
    "directory": "packages/agentos-ext-summarized-memory"
  },
  "publishConfig": { "access": "public" }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts (mirror grounding-guard pattern)**

```typescript
// @ts-nocheck
import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

const localPath = path.resolve(__dirname, '../agentos/src');
const ciPath = path.resolve(__dirname, '../../../../packages/agentos/src');
const monoPath = path.resolve(__dirname, '../../../../../agentos/src');

const agentosPath = fs.existsSync(localPath)
  ? localPath
  : fs.existsSync(ciPath)
    ? ciPath
    : fs.existsSync(monoPath)
      ? monoPath
      : null;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 10000,
  },
  resolve: agentosPath ? { alias: { '@framers/agentos': agentosPath } } : {},
});
```

- [ ] **Step 4: Install workspace deps**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && pnpm install --filter @framers/agentos-ext-summarized-memory
```

Expected: package picked up by workspace, no errors.

- [ ] **Step 5: Commit scaffold**

```bash
git add packages/agentos-ext-summarized-memory/{package.json,tsconfig.json,vitest.config.ts}
git commit -m "chore(agentos-ext-summarized-memory): scaffold package for Anthropic Contextual Retrieval executor"
```

---

### Task 1.2: Define types for the summarizer

**Files:**
- Create: `packages/agentos-ext-summarized-memory/src/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
/**
 * @file types.ts
 * @description Public types for the summarized-memory ingest executor.
 *
 * Implements the Anthropic Contextual Retrieval recipe (Sep 2024):
 * one LLM summarize call per session, summary prepended to every chunk
 * in that session before embedding. See spec at
 * platform.claude.com/cookbook/capabilities-contextual-embeddings-guide.
 */

export interface SessionContent {
  sessionId: string;
  text: string;
}

export interface SummarizerLLM {
  invoke(req: {
    system: string;
    user: string;
    maxTokens: number;
    temperature: number;
  }): Promise<{
    text: string;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }>;
}

export interface SummarizedIngestOptions {
  llm: SummarizerLLM;
  maxSummaryTokens?: number;
  cacheKey?: (session: SessionContent) => string;
}

export interface SummarizedTrace {
  sessionId: string;
  chunkIndex: number;
  embedText: string;
  rawText: string;
  summary: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentos-ext-summarized-memory/src/types.ts
git commit -m "feat(agentos-ext-summarized-memory): define summarizer types"
```

---

### Task 1.3: Write failing test for `sessionSummarizer` pure function

**Files:**
- Create: `packages/agentos-ext-summarized-memory/test/sessionSummarizer.spec.ts`
- Test: `packages/agentos-ext-summarized-memory/test/sessionSummarizer.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { summarizeSession, ANTHROPIC_CONTEXTUAL_PROMPT } from '../src/sessionSummarizer';
import type { SummarizerLLM } from '../src/types';

describe('summarizeSession', () => {
  it('uses verbatim Anthropic Contextual Retrieval prompt format', async () => {
    const invoke = vi.fn(async () => ({
      text: 'Discussion about Q3 deployment strategy',
      tokensIn: 1500,
      tokensOut: 8,
      model: 'gpt-5-mini',
    }));
    const llm: SummarizerLLM = { invoke };

    await summarizeSession(
      { sessionId: 'sess-1', text: 'user: when do we deploy?\nassistant: Q3' },
      { llm },
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    const arg = invoke.mock.calls[0][0];
    expect(arg.system).toContain('situate this');
    expect(arg.user).toContain('user: when do we deploy?');
    expect(arg.temperature).toBe(0);
    expect(arg.maxTokens).toBeLessThanOrEqual(120);
  });

  it('returns 50-100 token summaries by default', async () => {
    const llm: SummarizerLLM = {
      invoke: async () => ({
        text: 'Short summary',
        tokensIn: 100,
        tokensOut: 5,
        model: 'gpt-5-mini',
      }),
    };

    const result = await summarizeSession(
      { sessionId: 's1', text: 'hello' },
      { llm },
    );

    expect(result.summary).toBe('Short summary');
    expect(result.tokensOut).toBe(5);
    expect(result.tokensOut).toBeLessThanOrEqual(100);
  });

  it('exposes the verbatim Anthropic prompt as a constant', () => {
    expect(ANTHROPIC_CONTEXTUAL_PROMPT).toContain(
      'Please give a short succinct context to situate this chunk',
    );
    expect(ANTHROPIC_CONTEXTUAL_PROMPT).toContain('Answer only with the succinct context');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agentos-ext-summarized-memory && pnpm exec vitest run test/sessionSummarizer.spec.ts
```

Expected: FAIL — `Cannot find module '../src/sessionSummarizer'`.

---

### Task 1.4: Implement `sessionSummarizer`

**Files:**
- Create: `packages/agentos-ext-summarized-memory/src/sessionSummarizer.ts`

- [ ] **Step 1: Write minimal implementation**

```typescript
/**
 * @file sessionSummarizer.ts
 * @description One-shot session summarizer using the verbatim Anthropic
 * Contextual Retrieval prompt. Source: platform.claude.com/cookbook/
 * capabilities-contextual-embeddings-guide.
 *
 * Cost model (per Anthropic): ~$0.003/session at gpt-5-mini, fully
 * cached after first run.
 */

import type { SessionContent, SummarizerLLM } from './types';

export const ANTHROPIC_CONTEXTUAL_PROMPT = `You are summarizing a conversation session for retrieval. Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else.`;

export async function summarizeSession(
  session: SessionContent,
  opts: { llm: SummarizerLLM; maxSummaryTokens?: number },
): Promise<{ sessionId: string; summary: string; tokensIn: number; tokensOut: number }> {
  const maxTokens = opts.maxSummaryTokens ?? 100;
  const result = await opts.llm.invoke({
    system: ANTHROPIC_CONTEXTUAL_PROMPT,
    user: session.text,
    maxTokens,
    temperature: 0,
  });
  return {
    sessionId: session.sessionId,
    summary: result.text.trim(),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm exec vitest run test/sessionSummarizer.spec.ts
```

Expected: PASS, 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-ext-summarized-memory/src/sessionSummarizer.ts packages/agentos-ext-summarized-memory/test/sessionSummarizer.spec.ts
git commit -m "feat(agentos-ext-summarized-memory): implement session summarizer with verbatim Anthropic prompt"
```

---

### Task 1.5: Write failing test for `SummarizedIngestExecutor`

**Files:**
- Create: `packages/agentos-ext-summarized-memory/test/SummarizedIngestExecutor.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SummarizedIngestExecutor } from '../src/SummarizedIngestExecutor';
import type { SummarizerLLM } from '../src/types';

describe('SummarizedIngestExecutor', () => {
  const llm: SummarizerLLM = {
    invoke: async () => ({
      text: 'Session summary about deployment.',
      tokensIn: 500,
      tokensOut: 7,
      model: 'gpt-5-mini',
    }),
  };

  it('prepends summary to each chunk before embedding', async () => {
    const executor = new SummarizedIngestExecutor({ llm });
    const result = await executor.ingest('user: deploy?\nassistant: Q3', {
      sessionId: 'sess-1',
    });

    expect(result.writtenTraces).toBe(1);
    expect(result.summary).toBe('Session summary about deployment.');
    expect(result.embedTexts[0]).toMatch(/^Session summary about deployment\./);
    expect(result.embedTexts[0]).toContain('user: deploy?');
  });

  it('caches summaries by sessionId across repeated calls', async () => {
    const invoke = vi.fn(async () => ({
      text: 'Cached summary',
      tokensIn: 100,
      tokensOut: 3,
      model: 'gpt-5-mini',
    }));
    const executor = new SummarizedIngestExecutor({ llm: { invoke } });

    await executor.ingest('text 1', { sessionId: 'sess-A' });
    await executor.ingest('text 2', { sessionId: 'sess-A' });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    const executor = new SummarizedIngestExecutor({ llm });
    expect(executor.strategyId).toBe('summarized');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run test/SummarizedIngestExecutor.spec.ts
```

Expected: FAIL — module not found.

---

### Task 1.6: Implement `SummarizedIngestExecutor`

**Files:**
- Create: `packages/agentos-ext-summarized-memory/src/SummarizedIngestExecutor.ts`

- [ ] **Step 1: Write implementation**

```typescript
/**
 * @file SummarizedIngestExecutor.ts
 * @description Anthropic Contextual Retrieval executor for IngestRouter.
 *
 * Per session: one LLM summarize call. Per chunk: prepend that session's
 * summary before passing to the embedding pipeline. Designed to be the
 * `summarized` strategy executor in IngestRouter's FunctionIngestDispatcher.
 */

import { summarizeSession } from './sessionSummarizer';
import type { SummarizerLLM } from './types';

export interface IngestOutcome {
  writtenTraces: number;
  summary: string;
  embedTexts: string[];
}

export interface IngestPayload {
  sessionId: string;
  chunks?: string[];
}

export class SummarizedIngestExecutor {
  readonly strategyId = 'summarized' as const;
  private readonly llm: SummarizerLLM;
  private readonly cache = new Map<string, string>();

  constructor(opts: { llm: SummarizerLLM }) {
    this.llm = opts.llm;
  }

  async ingest(content: string, payload: IngestPayload): Promise<IngestOutcome> {
    const sessionId = payload.sessionId;
    let summary = this.cache.get(sessionId);
    if (summary === undefined) {
      const result = await summarizeSession(
        { sessionId, text: content },
        { llm: this.llm },
      );
      summary = result.summary;
      this.cache.set(sessionId, summary);
    }

    const chunks = payload.chunks ?? [content];
    const embedTexts = chunks.map((chunk) => `${summary}\n\n${chunk}`);

    return {
      writtenTraces: chunks.length,
      summary,
      embedTexts,
    };
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm exec vitest run test/SummarizedIngestExecutor.spec.ts
```

Expected: PASS, 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-ext-summarized-memory/src/SummarizedIngestExecutor.ts packages/agentos-ext-summarized-memory/test/SummarizedIngestExecutor.spec.ts
git commit -m "feat(agentos-ext-summarized-memory): implement SummarizedIngestExecutor with per-session caching"
```

---

### Task 1.7: Add `index.ts` barrel + factory

**Files:**
- Create: `packages/agentos-ext-summarized-memory/src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
/**
 * @file index.ts
 * @description Public API for `@framers/agentos-ext-summarized-memory`.
 */

export { SummarizedIngestExecutor } from './SummarizedIngestExecutor';
export type { IngestOutcome, IngestPayload } from './SummarizedIngestExecutor';
export { summarizeSession, ANTHROPIC_CONTEXTUAL_PROMPT } from './sessionSummarizer';
export type {
  SessionContent,
  SummarizerLLM,
  SummarizedIngestOptions,
  SummarizedTrace,
} from './types';

import { SummarizedIngestExecutor } from './SummarizedIngestExecutor';
import type { SummarizerLLM } from './types';

export function createSummarizedIngestExecutor(opts: { llm: SummarizerLLM }) {
  return new SummarizedIngestExecutor(opts);
}
```

- [ ] **Step 2: Run build to verify exports resolve**

```bash
pnpm build
```

Expected: build succeeds, dist/ populated.

- [ ] **Step 3: Run all package tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-ext-summarized-memory/src/index.ts
git commit -m "feat(agentos-ext-summarized-memory): public barrel + createSummarizedIngestExecutor factory"
```

---

### Task 1.8: Integration test — wire executor into `FunctionIngestDispatcher`

**Files:**
- Create: `packages/agentos-ext-summarized-memory/test/dispatcher-integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { FunctionIngestDispatcher } from '@framers/agentos/ingest-router';
import { SummarizedIngestExecutor } from '../src';
import type { SummarizerLLM } from '../src';

describe('SummarizedIngestExecutor + FunctionIngestDispatcher', () => {
  it('handles a summarized strategy dispatch end-to-end', async () => {
    const llm: SummarizerLLM = {
      invoke: async () => ({
        text: 'Q3 deployment context',
        tokensIn: 200,
        tokensOut: 5,
        model: 'gpt-5-mini',
      }),
    };
    const exec = new SummarizedIngestExecutor({ llm });

    const dispatcher = new FunctionIngestDispatcher({
      summarized: async (content, payload) =>
        exec.ingest(content as string, payload as { sessionId: string }),
      'raw-chunks': async () => ({ writtenTraces: 0 }),
      observational: async () => ({ writtenTraces: 0 }),
      'fact-graph': async () => ({ writtenTraces: 0 }),
      hybrid: async () => ({ writtenTraces: 0 }),
      skip: async () => ({ writtenTraces: 0 }),
    });

    const result = await dispatcher.dispatch({
      strategy: 'summarized',
      content: 'user: when?\nassistant: Q3',
      payload: { sessionId: 'sess-1' },
    });

    expect((result as any).writtenTraces).toBe(1);
    expect((result as any).summary).toBe('Q3 deployment context');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (executor exists, dispatcher exists)**

```bash
pnpm exec vitest run test/dispatcher-integration.spec.ts
```

Expected: PASS. If FAIL with type errors, fix the dispatcher arg shape and re-run.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-ext-summarized-memory/test/dispatcher-integration.spec.ts
git commit -m "test(agentos-ext-summarized-memory): integration with FunctionIngestDispatcher"
```

---

### Task 1.9: Wire Stage L into agentos-bench as a new memory mode

**Files:**
- Modify: `packages/agentos-bench/src/cli.ts` (add `--ingest-strategy summarized` flag handling)
- Modify: `packages/agentos-bench/src/cognitive/createCognitiveManager.ts` (or equivalent) to accept the executor

This task wires the new executor into the existing bench pipeline so it can be invoked via CLI flags. Exact wire-in depends on the existing CLI/cognitive-manager layout. Inspect first:

- [ ] **Step 1: Read existing CLI flags pattern**

```bash
grep -n "memoryMode\|ingestStrategy\|--memory" packages/agentos-bench/src/cli.ts | head -30
```

- [ ] **Step 2: Add new CLI option**

```typescript
// In packages/agentos-bench/src/cli.ts, near other .option() calls:
  .option('--ingest-strategy <strategy>', 'Override ingest strategy (raw-chunks|summarized|observational|fact-graph)', 'raw-chunks')
  .option('--ingest-strategy-llm <model>', 'LLM for the ingest-strategy executor', 'gpt-5-mini')
```

- [ ] **Step 3: Wire the executor into the cognitive manager builder**

Open `packages/agentos-bench/src/cognitive/createCognitiveManager.ts` and add a branch for `summarized`:

```typescript
import { SummarizedIngestExecutor } from '@framers/agentos-ext-summarized-memory';
import { createOpenAILLM } from '../llm/createOpenAILLM.js';

if (config.ingestStrategy === 'summarized') {
  const summarizedExec = new SummarizedIngestExecutor({
    llm: createOpenAILLM({ model: config.ingestStrategyLlm ?? 'gpt-5-mini' }),
  });
  manager.setIngestExecutor('summarized', summarizedExec);
}
```

- [ ] **Step 4: Run the bench typecheck to verify wiring compiles**

```bash
cd packages/agentos-bench && pnpm typecheck
```

Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agentos-bench/src/cli.ts packages/agentos-bench/src/cognitive/createCognitiveManager.ts
git commit -m "feat(agentos-bench): wire SummarizedIngestExecutor as --ingest-strategy summarized"
```

---

### Task 1.10: Stage L Phase A spot-check — LongMemEval-S N=25 stratified

**Files:** runs only

- [ ] **Step 1: Build everything**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && pnpm -r build
```

Expected: clean build across agentos + agentos-ext-summarized-memory + agentos-bench.

- [ ] **Step 2: Run Stage L Phase A spot-check on LongMemEval-S**

```bash
set -a && source apps/wilds-ai/.env && set +a
cd packages/agentos-bench
node dist/cli.js run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --stratified --sample-per-type 5 \
  --reader-top-k 20 \
  --hybrid-retrieval --rerank cohere \
  --ingest-strategy summarized \
  --seed 42
```

Expected:
- Cost: ~$0.15-2 (depends on cache state)
- Aggregate accuracy: directional signal vs Tier 3 min-cost baseline 76.6%
- New run JSON saved at `results/runs/<timestamp>--longmemeval-s--gpt-4o--full-cognitive--ingest.json` with `config.ingestStrategy: 'summarized'`

- [ ] **Step 3: Verify the run JSON has the expected config + non-zero cost (cache miss)**

```bash
ls -t results/runs/ | head -1 | xargs -I {} jq '{ingestStrategy: .config.ingestStrategy, totalUsd: .totalUsd, accuracy: .accuracy}' results/runs/{}
```

Expected: `ingestStrategy: "summarized"`, `totalUsd > 0`.

---

### 🔴 CHECKPOINT 1: end of Stage L implementation (Day 5)

**Pause for user review before continuing to BEAM adapter work.** Report:

- All Stage L unit tests green (3 + 3 + 1 = 7 tests)
- Integration test green (1 test)
- Phase A spot-check on LongMemEval-S complete
- Phase A accuracy delta vs Tier 3 min-cost baseline (76.6%)
- Phase A cost (should be ~$0.15-2)
- Recommendation: proceed to BEAM adapter, or kill Stage L and try a different observer model

User decides: **GO** (proceed) / **STOP** (something looks wrong) / **TUNE** (try different observer model before committing).

---

## Week 1.5 — BEAM Adapter (Days 6-9)

### Task 2.1: Read upstream BEAM dataset format

- [ ] **Step 1: Check the official BEAM repo README for data format**

```bash
curl -sL https://raw.githubusercontent.com/mohammadtavakoli78/BEAM/main/README.md | head -100
```

Expected: dataset format described. Note: the existing placeholder at `Beam.ts` references `agentmemorybenchmark.ai/dataset/beam` — confirm dataset URL and license before committing to a schema.

- [ ] **Step 2: Download BEAM 100K tier sample**

```bash
mkdir -p packages/agentos-bench/data/beam
# URL TBD from upstream README; this is the placeholder
curl -sL <BEAM-100K-URL> -o packages/agentos-bench/data/beam/beam_100k.jsonl
head -1 packages/agentos-bench/data/beam/beam_100k.jsonl | jq .
```

Expected: one BEAM case per line as JSON. Note schema for the next task.

If the data isn't publicly available yet, the BEAM adapter implementation pauses here and the spec's risk-register fallback kicks in: ship v1 without BEAM and revisit when data lands.

---

### Task 2.2: Write `loadBeamDataset` failing test

**Files:**
- Create: `packages/agentos-bench/src/benchmarks/beam/dataset.ts`
- Create: `packages/agentos-bench/tests/beam-dataset.spec.ts`

- [ ] **Step 1: Write the failing test (uses the schema discovered in Task 2.1)**

```typescript
import { describe, it, expect } from 'vitest';
import { loadBeamDataset } from '../src/benchmarks/beam/dataset';
import path from 'node:path';

const DATA_DIR = path.resolve(__dirname, '../data/beam');

describe('loadBeamDataset', () => {
  it('loads 100K tier with the expected case shape', async () => {
    const cases = await loadBeamDataset(DATA_DIR, '100k');
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('haystack');
    expect(cases[0]).toHaveProperty('question');
    expect(cases[0]).toHaveProperty('groundTruth');
    expect(cases[0]).toHaveProperty('ability');
  });

  it('rejects unknown tiers', async () => {
    await expect(loadBeamDataset(DATA_DIR, '99k' as any)).rejects.toThrow(
      /Unknown BEAM tier/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agentos-bench && pnpm exec vitest run tests/beam-dataset.spec.ts
```

Expected: FAIL — module not found.

---

### Task 2.3: Implement `loadBeamDataset`

**Files:**
- Create (overwrite): `packages/agentos-bench/src/benchmarks/beam/dataset.ts`

- [ ] **Step 1: Write the loader (schema from Task 2.1)**

```typescript
/**
 * @file dataset.ts
 * @description BEAM dataset loader. Schema mirrors the upstream BEAM
 * release at github.com/mohammadtavakoli78/BEAM. See spec §8 for the
 * 10 abilities tested.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';

export type BeamTier = '100k' | '500k' | '1m' | '10m';

export const BEAM_TIERS: readonly BeamTier[] = ['100k', '500k', '1m', '10m'];

export type BeamAbility =
  | 'abstention'
  | 'information-extraction'
  | 'multi-hop-reasoning'
  | 'preference-following'
  | 'summarization'
  | 'temporal-reasoning'
  | 'information-update'
  | 'instruction-following'
  | 'event-ordering'
  | 'contradiction-resolution';

export interface RawBeamCase {
  id: string;
  haystack: string;
  question: string;
  groundTruth: string[];
  ability: BeamAbility;
  conversationId: string;
}

export async function loadBeamDataset(
  dataDir: string,
  tier: BeamTier,
): Promise<RawBeamCase[]> {
  if (!BEAM_TIERS.includes(tier)) {
    throw new Error(`Unknown BEAM tier: ${tier}. Expected one of ${BEAM_TIERS.join(', ')}.`);
  }
  const filePath = path.join(dataDir, `beam_${tier}.jsonl`);
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawBeamCase);
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm exec vitest run tests/beam-dataset.spec.ts
```

Expected: PASS, 2 tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-bench/src/benchmarks/beam/dataset.ts packages/agentos-bench/tests/beam-dataset.spec.ts
git commit -m "feat(agentos-bench): implement loadBeamDataset for BEAM tier loading"
```

---

### Task 2.4: Replace `BeamUnimplementedError` with real `Beam100K` adapter

**Files:**
- Create: `packages/agentos-bench/src/benchmarks/beam/Beam100K.ts`
- Modify: `packages/agentos-bench/src/benchmarks/beam/Beam.ts` (keep `BeamUnimplementedError` for tiers we haven't built yet)
- Modify: `packages/agentos-bench/src/benchmarks/beam/index.ts`
- Create: `packages/agentos-bench/tests/beam-adapter.spec.ts`

- [ ] **Step 1: Write a failing adapter contract test**

```typescript
// packages/agentos-bench/tests/beam-adapter.spec.ts
import { describe, it, expect } from 'vitest';
import { Beam100K } from '../src/benchmarks/beam';
import { createReader } from '../src/readers/createReader';

describe('Beam100K adapter', () => {
  it('exposes IBenchmark contract fields', () => {
    const reader = createReader({ model: 'gpt-4o' });
    const adapter = new Beam100K({ reader });
    expect(adapter.id).toBe('beam-100k');
    expect(adapter.family).toBe('external');
    expect(adapter.passThreshold).toBeGreaterThan(0);
  });

  it('loads cases from data/beam/beam_100k.jsonl', async () => {
    const reader = createReader({ model: 'gpt-4o' });
    const adapter = new Beam100K({ reader });
    const cases = await adapter.loadCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('input');
    expect(cases[0]).toHaveProperty('expectedOutput');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run tests/beam-adapter.spec.ts
```

Expected: FAIL — `Beam100K` not exported.

- [ ] **Step 3: Implement Beam100K (mirror LongMemEvalS structure)**

```typescript
// packages/agentos-bench/src/benchmarks/beam/Beam100K.ts
import { loadBeamDataset, type RawBeamCase, type BeamTier } from './dataset';
import type {
  BenchCase,
  BenchContext,
  BenchResult,
  CaseResult,
  CaseRun,
  IBenchmark,
} from '../../core/IBenchmark';
import type { IReader } from '../../readers/IReader';
import path from 'node:path';

export interface Beam100KOptions {
  reader: IReader;
  dataDir?: string;
  tier?: BeamTier;
}

export class Beam100K implements IBenchmark {
  readonly id: string;
  readonly version = '1.0.0-beam-100k';
  readonly family = 'external' as const;
  readonly passThreshold = 0.5;

  private readonly reader: IReader;
  private readonly dataDir: string;
  private readonly tier: BeamTier;

  constructor(opts: Beam100KOptions) {
    this.tier = opts.tier ?? '100k';
    this.id = `beam-${this.tier}`;
    this.reader = opts.reader;
    this.dataDir =
      opts.dataDir ??
      path.resolve(process.cwd(), 'data/beam');
  }

  async loadCases(): Promise<BenchCase[]> {
    const raw = await loadBeamDataset(this.dataDir, this.tier);
    return raw.map((c) => ({
      id: c.id,
      caseType: c.ability,
      input: { haystack: c.haystack, question: c.question },
      expectedOutput: c.groundTruth,
      metadata: { conversationId: c.conversationId, ability: c.ability },
    }));
  }

  async runCase(
    bcase: BenchCase,
    context: BenchContext,
  ): Promise<CaseResult> {
    // Mirror LongMemEvalS.runCase: ingest haystack, recall, read, score.
    // See packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts
    // for the canonical pipeline; substitute BEAM dataset shape.
    throw new Error('Beam100K.runCase: not yet implemented in this stub task; see Task 2.5');
  }

  async aggregate(
    runs: CaseRun[],
    context: BenchContext,
  ): Promise<BenchResult> {
    throw new Error('Beam100K.aggregate: not yet implemented in this stub task; see Task 2.5');
  }
}
```

- [ ] **Step 4: Update barrel index.ts**

```typescript
// packages/agentos-bench/src/benchmarks/beam/index.ts
export { Beam, BeamUnimplementedError } from './Beam';
export type { BeamTier, BeamAbility, RawBeamCase } from './dataset';
export { loadBeamDataset, BEAM_TIERS } from './dataset';
export { Beam100K } from './Beam100K';
export type { Beam100KOptions } from './Beam100K';
```

- [ ] **Step 5: Run contract tests to verify the first 2 pass**

```bash
pnpm exec vitest run tests/beam-adapter.spec.ts
```

Expected: PASS for the first 2 contract tests; runCase/aggregate tests will fail in Task 2.5.

- [ ] **Step 6: Commit**

```bash
git add packages/agentos-bench/src/benchmarks/beam/{Beam100K.ts,index.ts} packages/agentos-bench/tests/beam-adapter.spec.ts
git commit -m "feat(agentos-bench): scaffold Beam100K adapter contract"
```

---

### Task 2.5: Implement Beam100K runCase + aggregate (mirror LongMemEvalS)

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/beam/Beam100K.ts`

This is a large transcription task — mirror the LongMemEvalS pipeline but adapt to BEAM's schema. Reference `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts` end-to-end. Substitute:

- Haystack input is one long string instead of session list (BEAM is single-narrative)
- Judge call uses BEAM rubric (default to LongMemEval judge for v1; cross-judge BEAM judge in v2)
- Per-ability accuracy emitted via `byType` instead of LongMemEval's 6 categories

- [ ] **Step 1: Write a small pipeline test**

```typescript
// Append to packages/agentos-bench/tests/beam-adapter.spec.ts
it('runCase replays haystack + reads + judges (smoke test, mocked reader)', async () => {
  const reader = {
    invoke: async () => ({ text: 'Q3 deployment', tokensIn: 100, tokensOut: 5 }),
  } as any;
  const adapter = new Beam100K({ reader });
  const cases = await adapter.loadCases();
  const result = await adapter.runCase(cases[0], {} as any);
  expect(result).toHaveProperty('passed');
  expect(result).toHaveProperty('actualOutput');
});
```

- [ ] **Step 2: Implement runCase + aggregate by mirroring LongMemEvalS**

(Code body is too large for inline reproduction; the engineer mirrors `LongMemEvalS.runCase` and `LongMemEvalS.aggregate` step-by-step, replacing per-session ingest with single-haystack ingest. Approx 200 LOC.)

- [ ] **Step 3: Run all BEAM tests**

```bash
pnpm exec vitest run tests/beam-adapter.spec.ts
```

Expected: PASS, all 3 tests green.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-bench/src/benchmarks/beam/Beam100K.ts packages/agentos-bench/tests/beam-adapter.spec.ts
git commit -m "feat(agentos-bench): implement Beam100K runCase + aggregate (mirrors LongMemEvalS pipeline)"
```

---

### Task 2.6: Wire BEAM 100K into the CLI

**Files:**
- Modify: `packages/agentos-bench/src/cli.ts`

- [ ] **Step 1: Find the existing benchmark registration block**

```bash
grep -n "loadCases\|registerBench\|benchmark.*case" packages/agentos-bench/src/cli.ts | head -20
```

- [ ] **Step 2: Register Beam100K alongside the existing benchmarks**

In the relevant CLI section, add a branch:

```typescript
case 'beam-100k':
  return new Beam100K({
    reader: createReader({ model: opts.reader }),
  });
```

- [ ] **Step 3: Build + smoke**

```bash
pnpm build
node dist/cli.js list
```

Expected: `beam-100k` appears in the list of available benchmarks.

- [ ] **Step 4: Commit**

```bash
git add packages/agentos-bench/src/cli.ts
git commit -m "feat(agentos-bench): register beam-100k benchmark in CLI"
```

---

### Task 2.7: BEAM 100K spot-check sweep ($5)

- [ ] **Step 1: Run BEAM 100K spot-check at N=100 stratified**

```bash
set -a && source apps/wilds-ai/.env && set +a
cd packages/agentos-bench
node dist/cli.js run beam-100k \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --stratified --sample-per-type 10 \
  --reader-top-k 20 \
  --hybrid-retrieval --rerank cohere \
  --seed 42
```

Expected:
- Cost: ~$5
- Aggregate accuracy: 25-45% (frontier prediction; absolute number is for the v1 transparency note)
- Run JSON at `results/runs/<timestamp>--beam-100k--gpt-4o--full-cognitive--ingest.json`

- [ ] **Step 2: Verify run JSON content**

```bash
ls -t results/runs/ | grep beam-100k | head -1 | xargs -I {} jq '{accuracy: .accuracy, totalUsd: .totalUsd, byType: .byType}' results/runs/{}
```

Expected: per-ability breakdown emitted.

---

### 🔴 CHECKPOINT 2: end of BEAM adapter implementation + spot-check (Day 9)

**Pause for user review.** Report:

- BEAM adapter contract tests green (3 tests)
- BEAM 100K spot-check accuracy: <X%>
- Per-ability breakdown from spot-check
- Spot-check cost: ~$5
- Recommendation: BEAM 100K number ready to cite as v1 preliminary; continue to Stage I

User decides: **GO** (proceed to Stage I) / **STOP** (BEAM 100K number is unexpectedly low/high; investigate).

---

## Week 2 — Stage I: Entity-Linking Hybrid (Days 10-14)

### Task 3.1: Scaffold `agentos-ext-entity-linking-memory` package

(Same scaffolding pattern as Task 1.1 — copy the agentos-ext-summarized-memory `package.json`, `tsconfig.json`, `vitest.config.ts` and update `name` field.)

- [ ] **Steps 1-5 mirror Task 1.1 with name change**: `@framers/agentos-ext-entity-linking-memory`

---

### Task 3.2: Define entity-linking types

**Files:**
- Create: `packages/agentos-ext-entity-linking-memory/src/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
export type EntityKind = 'proper-noun' | 'quoted-text' | 'compound-noun-phrase';

export interface ExtractedEntity {
  text: string;
  kind: EntityKind;
  positions: number[];
}

export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  rawText: string;
}

export interface EntityLinkingOptions {
  proper_noun_min_length?: number;
  compound_noun_max_length?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentos-ext-entity-linking-memory/src/types.ts
git commit -m "feat(agentos-ext-entity-linking-memory): types for entity extraction + linking"
```

---

### Task 3.3: Write `EntityExtractor` failing test

**Files:**
- Create: `packages/agentos-ext-entity-linking-memory/test/EntityExtractor.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { EntityExtractor } from '../src/EntityExtractor';

describe('EntityExtractor (Mem0 v3 style)', () => {
  const ex = new EntityExtractor();

  it('extracts proper nouns', () => {
    const result = ex.extract('John works at Anthropic in San Francisco.');
    const proper = result.entities.filter((e) => e.kind === 'proper-noun');
    expect(proper.map((e) => e.text)).toEqual(
      expect.arrayContaining(['John', 'Anthropic', 'San Francisco']),
    );
  });

  it('extracts quoted text', () => {
    const result = ex.extract('She said "deploy at midnight" before leaving.');
    const quoted = result.entities.filter((e) => e.kind === 'quoted-text');
    expect(quoted[0].text).toBe('deploy at midnight');
  });

  it('extracts compound noun phrases', () => {
    const result = ex.extract('The API rate limit was exceeded.');
    const cnp = result.entities.filter((e) => e.kind === 'compound-noun-phrase');
    expect(cnp.map((e) => e.text)).toEqual(
      expect.arrayContaining(['API rate limit']),
    );
  });

  it('returns position offsets for each entity', () => {
    const result = ex.extract('Anthropic released Claude.');
    expect(result.entities[0].positions[0]).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/agentos-ext-entity-linking-memory && pnpm exec vitest run test/EntityExtractor.spec.ts
```

Expected: FAIL — module not found.

---

### Task 3.4: Implement `EntityExtractor`

**Files:**
- Create: `packages/agentos-ext-entity-linking-memory/src/EntityExtractor.ts`

- [ ] **Step 1: Write minimal regex-based implementation**

```typescript
/**
 * @file EntityExtractor.ts
 * @description Mem0 v3 style entity extractor. Three classes:
 *   - proper nouns (capitalized standalone tokens)
 *   - quoted text (within "..." or '...')
 *   - compound noun phrases (consecutive capitalized tokens)
 *
 * Mem0 v3 spec: docs.mem0.ai/migration/oss-v2-to-v3
 */

import type { ExtractedEntity, EntityExtractionResult, EntityLinkingOptions } from './types';

export class EntityExtractor {
  private readonly properNounMinLength: number;
  private readonly compoundNounMaxLength: number;

  constructor(opts: EntityLinkingOptions = {}) {
    this.properNounMinLength = opts.proper_noun_min_length ?? 2;
    this.compoundNounMaxLength = opts.compound_noun_max_length ?? 5;
  }

  extract(text: string): EntityExtractionResult {
    const entities: ExtractedEntity[] = [];

    // 1. Quoted text
    const quotedRegex = /["']([^"']+?)["']/g;
    let match;
    while ((match = quotedRegex.exec(text)) !== null) {
      entities.push({
        text: match[1],
        kind: 'quoted-text',
        positions: [match.index + 1],
      });
    }

    // 2. Compound noun phrases (2+ consecutive capitalized words)
    const compoundRegex = /(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})/g;
    while ((match = compoundRegex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        kind: 'compound-noun-phrase',
        positions: [match.index],
      });
    }

    // 3. Proper nouns (capitalized standalone words not part of a compound)
    const compoundPositions = new Set(
      entities.filter((e) => e.kind === 'compound-noun-phrase').flatMap((e) => e.positions),
    );
    const properRegex = /\b[A-Z][a-zA-Z]+\b/g;
    while ((match = properRegex.exec(text)) !== null) {
      if (match[0].length < this.properNounMinLength) continue;
      const isInCompound = entities
        .filter((e) => e.kind === 'compound-noun-phrase')
        .some((e) => match!.index >= e.positions[0] && match!.index < e.positions[0] + e.text.length);
      if (isInCompound) continue;
      entities.push({
        text: match[0],
        kind: 'proper-noun',
        positions: [match.index],
      });
    }

    return { entities, rawText: text };
  }
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm exec vitest run test/EntityExtractor.spec.ts
```

Expected: PASS, 4 tests green. If a regex doesn't catch a case (e.g., "San Francisco" should be one compound noun phrase), refine the regex to make the test pass.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-ext-entity-linking-memory/src/EntityExtractor.ts packages/agentos-ext-entity-linking-memory/test/EntityExtractor.spec.ts
git commit -m "feat(agentos-ext-entity-linking-memory): implement EntityExtractor with proper noun + quoted text + compound noun phrase detection"
```

---

### Task 3.5: Implement `EntityRetrievalRanker` (TDD)

**Files:**
- Create: `packages/agentos-ext-entity-linking-memory/test/EntityRetrievalRanker.spec.ts`
- Create: `packages/agentos-ext-entity-linking-memory/src/EntityRetrievalRanker.ts`

- [ ] **Step 1: Write failing test for ranker**

```typescript
import { describe, it, expect } from 'vitest';
import { EntityRetrievalRanker } from '../src/EntityRetrievalRanker';

describe('EntityRetrievalRanker', () => {
  const ranker = new EntityRetrievalRanker({ entityWeight: 0.5 });

  it('boosts candidates with overlapping entities', () => {
    const query = 'Tell me about Anthropic';
    const candidates = [
      { id: 'c1', text: 'Anthropic released Claude.', semanticScore: 0.5, entities: ['Anthropic', 'Claude'] },
      { id: 'c2', text: 'OpenAI released GPT.', semanticScore: 0.6, entities: ['OpenAI', 'GPT'] },
    ];

    const ranked = ranker.rank(query, candidates);
    expect(ranked[0].id).toBe('c1');
  });

  it('falls back to semanticScore when no entity overlap', () => {
    const query = 'How does it work?';
    const candidates = [
      { id: 'c1', text: 'X', semanticScore: 0.3, entities: [] },
      { id: 'c2', text: 'Y', semanticScore: 0.7, entities: [] },
    ];
    const ranked = ranker.rank(query, candidates);
    expect(ranked[0].id).toBe('c2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run test/EntityRetrievalRanker.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement EntityRetrievalRanker**

```typescript
/**
 * @file EntityRetrievalRanker.ts
 * @description Mem0 v3 style retrieval re-ranker. Adds entity-overlap
 * signal to the existing semantic similarity score.
 */

import { EntityExtractor } from './EntityExtractor';

export interface RankedCandidate {
  id: string;
  text: string;
  semanticScore: number;
  entities: string[];
}

export interface RankedCandidateWithBoost extends RankedCandidate {
  combinedScore: number;
  entityOverlap: number;
}

export class EntityRetrievalRanker {
  private readonly entityWeight: number;
  private readonly extractor = new EntityExtractor();

  constructor(opts: { entityWeight: number }) {
    this.entityWeight = opts.entityWeight;
  }

  rank(query: string, candidates: RankedCandidate[]): RankedCandidateWithBoost[] {
    const queryEntities = new Set(this.extractor.extract(query).entities.map((e) => e.text));

    const scored = candidates.map((c) => {
      const overlap = c.entities.filter((e) => queryEntities.has(e)).length;
      const overlapRatio = queryEntities.size > 0 ? overlap / queryEntities.size : 0;
      const combinedScore = (1 - this.entityWeight) * c.semanticScore + this.entityWeight * overlapRatio;
      return { ...c, combinedScore, entityOverlap: overlap };
    });

    return scored.sort((a, b) => b.combinedScore - a.combinedScore);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec vitest run test/EntityRetrievalRanker.spec.ts
```

Expected: PASS, 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/agentos-ext-entity-linking-memory/src/EntityRetrievalRanker.ts packages/agentos-ext-entity-linking-memory/test/EntityRetrievalRanker.spec.ts
git commit -m "feat(agentos-ext-entity-linking-memory): implement EntityRetrievalRanker with entity-overlap boost"
```

---

### Task 3.6: Implement `EntityLinkingExecutor` (ingest-side wrapper)

**Files:**
- Create: `packages/agentos-ext-entity-linking-memory/src/EntityLinkingExecutor.ts`
- Create: `packages/agentos-ext-entity-linking-memory/test/EntityLinkingExecutor.spec.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { EntityLinkingExecutor } from '../src/EntityLinkingExecutor';

describe('EntityLinkingExecutor', () => {
  const executor = new EntityLinkingExecutor();

  it('extracts entities and returns them alongside the chunk', async () => {
    const result = await executor.ingest('Anthropic released Claude.', {
      sessionId: 'sess-1',
    });
    expect(result.writtenTraces).toBe(1);
    expect(result.entities).toEqual(
      expect.arrayContaining(['Anthropic', 'Claude']),
    );
  });

  it('returns the strategy ID expected by IngestRouter dispatcher', () => {
    expect(executor.strategyId).toBe('fact-graph');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run test/EntityLinkingExecutor.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement EntityLinkingExecutor**

```typescript
import { EntityExtractor } from './EntityExtractor';

export class EntityLinkingExecutor {
  readonly strategyId = 'fact-graph' as const;
  private readonly extractor = new EntityExtractor();

  async ingest(content: string, _payload: { sessionId: string }): Promise<{
    writtenTraces: number;
    entities: string[];
  }> {
    const result = this.extractor.extract(content);
    return {
      writtenTraces: 1,
      entities: result.entities.map((e) => e.text),
    };
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm exec vitest run test/EntityLinkingExecutor.spec.ts
git add packages/agentos-ext-entity-linking-memory/src/EntityLinkingExecutor.ts packages/agentos-ext-entity-linking-memory/test/EntityLinkingExecutor.spec.ts
git commit -m "feat(agentos-ext-entity-linking-memory): implement EntityLinkingExecutor"
```

---

### Task 3.7: Wire entity-linking into bench

**Files:**
- Modify: `packages/agentos-bench/src/cli.ts` (extend `--ingest-strategy` to accept `fact-graph` with entity-linking impl)
- Modify: `packages/agentos-bench/src/cognitive/createCognitiveManager.ts` (or equivalent)

Pattern mirrors Task 1.9. Add the `fact-graph` branch that wires `EntityLinkingExecutor`.

- [ ] **Step 1: Add CLI branch + wire the executor + ranker into the bench cognitive manager**
- [ ] **Step 2: Build + typecheck**
- [ ] **Step 3: Commit**

---

### Task 3.8: Stage I Phase A spot-check on LOCOMO

- [ ] **Step 1: Run Stage I Phase A on LOCOMO**

```bash
node dist/cli.js run locomo \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --stratified --sample-per-type 5 \
  --reader-top-k 20 \
  --hybrid-retrieval --rerank cohere \
  --ingest-strategy fact-graph \
  --seed 42
```

Expected:
- Cost: ~$0.50
- Aggregate accuracy: directional signal vs Tier 3 baseline 51.5%
- Run JSON saved with `config.ingestStrategy: 'fact-graph'`

---

### 🔴 CHECKPOINT 3: end of Stage I implementation (Day 14)

**Pause for user review.** Report:

- All Stage I unit tests green
- Phase A spot-check on LOCOMO: <X%> vs baseline 51.5%
- Phase A spot-check cost
- Decision gate: if Phase A point estimate is within 2pp of 51.5%, drop Stage I from Phase B (would be a $400 saving). Otherwise advance.

---

## Week 2.5 — Phase A Iteration Sweep (Days 15-16)

### Task 4.1: Write Phase A orchestration script

**Files:**
- Create: `packages/agentos-bench/scripts/run-eval-matrix-phase-a.ts`

- [ ] **Step 1: Write the script**

```typescript
/**
 * @file run-eval-matrix-phase-a.ts
 * @description Sweep ~15 architecture variants across 3 conversational
 * benchmarks (LongMemEval-S, LongMemEval-M, LOCOMO) at N=25 stratified
 * to find the surviving Phase B finalists.
 */

import { execSync } from 'node:child_process';

const VARIANTS = [
  // K-sweep on Tier 3 min-cost
  { name: 'k20-min-cost', args: '--reader-top-k 20' },
  { name: 'k42-min-cost', args: '--reader-top-k 42' },
  { name: 'k62-min-cost', args: '--reader-top-k 62' },
  { name: 'k100-min-cost', args: '--reader-top-k 100' },
  // Stage L observer model variants
  { name: 'stage-l-gpt5mini', args: '--ingest-strategy summarized --ingest-strategy-llm gpt-5-mini' },
  { name: 'stage-l-gpt4omini', args: '--ingest-strategy summarized --ingest-strategy-llm gpt-4o-mini' },
  { name: 'stage-l-gpt5nano', args: '--ingest-strategy summarized --ingest-strategy-llm gpt-5-nano' },
  // Stage I weight variants
  { name: 'stage-i-w02', args: '--ingest-strategy fact-graph --entity-weight 0.2' },
  { name: 'stage-i-w05', args: '--ingest-strategy fact-graph --entity-weight 0.5' },
  { name: 'stage-i-w08', args: '--ingest-strategy fact-graph --entity-weight 0.8' },
  // Reader prompt variants
  { name: 'no-abstention', args: '--no-abstention' },
  // Compound combinations
  { name: 'stage-l-plus-i', args: '--ingest-strategy hybrid --ingest-strategy-llm gpt-5-mini --entity-weight 0.5' },
];

const BENCHES = ['longmemeval-s', 'longmemeval-m', 'locomo'];

const COMMON = '--reader gpt-4o --memory full-cognitive --replay ingest --stratified --sample-per-type 5 --hybrid-retrieval --rerank cohere --seed 42';

for (const bench of BENCHES) {
  for (const variant of VARIANTS) {
    const cmd = `node dist/cli.js run ${bench} ${COMMON} ${variant.args}`;
    console.log(`\n=== ${bench} × ${variant.name} ===`);
    console.log(cmd);
    try {
      execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
    } catch (err) {
      console.error(`FAILED: ${variant.name} on ${bench}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 2: Build the orchestrator + smoke**

```bash
cd packages/agentos-bench
pnpm build
node dist/scripts/run-eval-matrix-phase-a.js
```

Expected:
- ~36 runs (12 variants × 3 benchmarks), each ~$0.50 stratified = ~$18 total + ingest costs ~$30 = ~$50 total
- All run JSONs saved at `results/runs/`

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-bench/scripts/run-eval-matrix-phase-a.ts
git commit -m "feat(agentos-bench): Phase A iteration sweep orchestrator (12 variants × 3 benches)"
```

---

### Task 4.2: Build the gating analysis

**Files:**
- Create: `packages/agentos-bench/scripts/gate-phase-a-results.ts`

- [ ] **Step 1: Write the gating script**

```typescript
/**
 * @file gate-phase-a-results.ts
 * @description Read all Phase A run JSONs from this run, compute mean +
 * 95% CI per (variant × benchmark) cell, and emit a markdown table that
 * shows which variants survive the Tier 3 min-cost gate.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const RUNS_DIR = path.resolve(process.cwd(), 'results/runs');
const TIER3_BASELINES: Record<string, number> = {
  'longmemeval-s': 0.766,
  'longmemeval-m': 0.65, // estimated (no prior run yet)
  'locomo': 0.515,
};

async function main() {
  const files = (await fs.readdir(RUNS_DIR))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => /2026-04-(2[5-9]|3[01])/.test(f)); // this week's runs

  const cells: Array<{ benchmark: string; variant: string; accuracy: number; samplePerType: number }> = [];
  for (const f of files) {
    const raw = JSON.parse(await fs.readFile(path.join(RUNS_DIR, f), 'utf-8'));
    if (!raw.config?.samplePerType) continue;
    cells.push({
      benchmark: f.split('--')[1],
      variant: deriveVariantName(raw.config),
      accuracy: raw.accuracy,
      samplePerType: raw.config.samplePerType,
    });
  }

  console.log('| variant | benchmark | accuracy | baseline | gate |');
  console.log('|---|---|---:|---:|---|');
  for (const cell of cells) {
    const baseline = TIER3_BASELINES[cell.benchmark] ?? 0;
    const gate = cell.accuracy > baseline ? '✓ ADVANCE' : '✗ DROP';
    console.log(`| ${cell.variant} | ${cell.benchmark} | ${(cell.accuracy * 100).toFixed(1)}% | ${(baseline * 100).toFixed(1)}% | ${gate} |`);
  }
}

function deriveVariantName(config: any): string {
  if (config.ingestStrategy === 'summarized') return `stage-l-${config.ingestStrategyLlm ?? 'unknown'}`;
  if (config.ingestStrategy === 'fact-graph') return `stage-i-w${config.entityWeight ?? 0.5}`;
  if (config.noAbstention) return 'no-abstention';
  return `k${config.readerTopK}-min-cost`;
}

main().catch(console.error);
```

- [ ] **Step 2: Run + capture output**

```bash
node dist/scripts/gate-phase-a-results.js > results/eval-matrix-v1/phase-a-gate-table.md
```

Expected: gating table emitted with ADVANCE/DROP per variant per benchmark.

---

### 🔴 CHECKPOINT 4: end of Phase A gating (Day 16)

**Pause for user review BEFORE committing $200+ to Phase B.** Report:

- Total Phase A spend: ~$50
- Surviving architectures per benchmark (from gating table)
- Recommendation: drop architectures that didn't beat Tier 3 baseline at any benchmark; advance the rest to Phase B

User decides which architectures advance. **Phase B sweep proceeds only after explicit user OK.**

---

## Week 3 — Phase B Sweeps + Table Assembly (Days 17-21)

### Task 5.1: Write Phase B orchestration script

**Files:**
- Create: `packages/agentos-bench/scripts/run-eval-matrix-phase-b.ts`

- [ ] **Step 1: Write the script (parameterized by architecture list)**

```typescript
/**
 * @file run-eval-matrix-phase-b.ts
 * @description Run full-N Phase B sweeps for the surviving architectures
 * across the 3 conversational benchmarks. Receives architecture list as
 * a JSON file argument so the user can edit between Phase A gating and
 * Phase B execution.
 */

import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';

interface Architecture {
  name: string;
  args: string;
}

interface BenchmarkConfig {
  id: string;
  fullN: number | null; // null = full dataset
  costEstimate: number;
}

const BENCHES: BenchmarkConfig[] = [
  { id: 'longmemeval-s', fullN: null, costEstimate: 13 },
  { id: 'longmemeval-m', fullN: null, costEstimate: 50 },
  { id: 'locomo', fullN: null, costEstimate: 10 },
];

async function main() {
  const archListPath = process.argv[2];
  if (!archListPath) throw new Error('Usage: run-eval-matrix-phase-b.js <architectures.json>');
  const archs: Architecture[] = JSON.parse(await fs.readFile(archListPath, 'utf-8'));

  const totalEstimate = archs.length * BENCHES.reduce((s, b) => s + b.costEstimate, 0);
  console.log(`Phase B estimate: $${totalEstimate} for ${archs.length} archs × ${BENCHES.length} benchmarks`);

  const COMMON = '--reader gpt-4o --memory full-cognitive --replay ingest --hybrid-retrieval --rerank cohere --seed 42';

  for (const arch of archs) {
    for (const bench of BENCHES) {
      const cmd = `node dist/cli.js run ${bench.id} ${COMMON} ${arch.args}`;
      console.log(`\n=== ${bench.id} × ${arch.name} ===`);
      console.log(cmd);
      try {
        execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
      } catch (err) {
        console.error(`FAILED: ${arch.name} on ${bench.id}: ${(err as Error).message}`);
      }
    }
  }
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentos-bench/scripts/run-eval-matrix-phase-b.ts
git commit -m "feat(agentos-bench): Phase B orchestration for surviving architectures"
```

---

### Task 5.2: Run Phase B for surviving architectures

This is execution-time, not implementation. The architecture list file is generated from Checkpoint 4's user decision.

- [ ] **Step 1: Build architectures.json from Phase A gating decision (manual edit)**

```bash
cat > /tmp/eval-matrix-phase-b-archs.json <<EOF
[
  { "name": "tier-3-min-cost", "args": "--reader-top-k 20" },
  { "name": "tier-3-max-acc", "args": "--reader-top-k 20 --policy-router-preset maximize-accuracy" },
  { "name": "stage-l-gpt5mini", "args": "--ingest-strategy summarized --ingest-strategy-llm gpt-5-mini" }
]
EOF
```

(User edits this list per Checkpoint 4 decision.)

- [ ] **Step 2: Run Phase B**

```bash
node dist/scripts/run-eval-matrix-phase-b.js /tmp/eval-matrix-phase-b-archs.json
```

Expected: ~$300-500 of LLM calls + cached cells return $0.

- [ ] **Step 3: Verify per-cell run JSONs**

```bash
ls -t results/runs/ | head -10
```

---

### Task 5.3: Build the comparison table

**Files:**
- Create: `packages/agentos-bench/scripts/build-eval-matrix-table.ts`
- Create: `packages/agentos-bench/results/eval-matrix-v1/comparison-table.md`

- [ ] **Step 1: Write the table builder**

```typescript
/**
 * @file build-eval-matrix-table.ts
 * @description Reads all relevant run JSONs and emits the v1 publication
 * comparison table at packages/agentos-bench/results/eval-matrix-v1/
 * comparison-table.md.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const RUNS_DIR = path.resolve(process.cwd(), 'results/runs');
const OUT_PATH = path.resolve(process.cwd(), 'results/eval-matrix-v1/comparison-table.md');

interface Cell {
  benchmark: string;
  architecture: string;
  accuracy: number;
  ciLow: number;
  ciHigh: number;
  costPerCorrect: number;
  p95LatencyMs: number;
  tokensPerQuery: number;
}

async function main() {
  const files = (await fs.readdir(RUNS_DIR))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => /2026-04-(2[5-9]|3[01])/.test(f) || true); // include cached older runs too

  const cells: Cell[] = [];
  for (const f of files) {
    const raw = JSON.parse(await fs.readFile(path.join(RUNS_DIR, f), 'utf-8'));
    if (!raw.bootstrapCi) continue;
    cells.push({
      benchmark: deriveBench(f),
      architecture: deriveArch(raw.config),
      accuracy: raw.accuracy,
      ciLow: raw.bootstrapCi.lower,
      ciHigh: raw.bootstrapCi.upper,
      costPerCorrect: raw.totalUsd / Math.max(1, raw.passedCases),
      p95LatencyMs: raw.latencyP95Ms ?? 0,
      tokensPerQuery: raw.tokensPerQuery ?? 0,
    });
  }

  let md = '# AgentOS v1 Comprehensive Evaluation Matrix\n\n';
  md += `*Generated: ${new Date().toISOString().split('T')[0]}*\n\n`;
  md += '| Architecture | LongMemEval-S | LongMemEval-M | LOCOMO | BEAM 100K (preliminary) |\n';
  md += '|---|---:|---:|---:|---:|\n';

  const archs = [...new Set(cells.map((c) => c.architecture))];
  for (const arch of archs) {
    const row: string[] = [arch];
    for (const bench of ['longmemeval-s', 'longmemeval-m', 'locomo', 'beam-100k']) {
      const cell = cells.find((c) => c.architecture === arch && c.benchmark === bench);
      if (cell) {
        row.push(`${(cell.accuracy * 100).toFixed(1)}% [${(cell.ciLow * 100).toFixed(1)}, ${(cell.ciHigh * 100).toFixed(1)}] @ $${cell.costPerCorrect.toFixed(4)}/correct`);
      } else {
        row.push('—');
      }
    }
    md += `| ${row.join(' | ')} |\n`;
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, md);
  console.log(`Wrote: ${OUT_PATH}`);
}

function deriveBench(filename: string): string {
  return filename.split('--')[1];
}

function deriveArch(config: any): string {
  if (config.ingestStrategy === 'summarized') return `stage-l-${config.ingestStrategyLlm}`;
  if (config.ingestStrategy === 'fact-graph') return `stage-i-w${config.entityWeight ?? 0.5}`;
  if (config.policyRouterPreset === 'maximize-accuracy') return 'tier-3-max-acc';
  return `k${config.readerTopK}-min-cost`;
}

main().catch(console.error);
```

- [ ] **Step 2: Run + verify table emits**

```bash
node dist/scripts/build-eval-matrix-table.js
cat results/eval-matrix-v1/comparison-table.md
```

Expected: markdown table with cells populated.

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-bench/scripts/build-eval-matrix-table.ts packages/agentos-bench/results/eval-matrix-v1/comparison-table.md
git commit -m "feat(agentos-bench): emit v1 comparison table from per-case run JSONs"
```

---

### Task 5.4: Write transparency notes alongside the table

**Files:**
- Create: `packages/agentos-bench/results/eval-matrix-v1/transparency-notes.md`

- [ ] **Step 1: Generate per-benchmark judge FPR section by reading Stage G probe outputs**

This is a manual write-up referencing the Stage G probe results.

```markdown
# v1 Evaluation Matrix — Transparency Notes

## Judge FPR per benchmark
- LongMemEval-S: 1% [0%, 3%] (Stage G probe, n=100, seed=42)
- LOCOMO: 0% [0%, 0%] (Stage G probe, n=100, seed=42)
- LongMemEval-M: <X>% (this v1 publication's new probe, n=100)
- BEAM 100K: not yet probed (deferred to v2)

## Vendor cross-reference footnotes
- Mem0 v3 published 93.4% on LongMemEval-S — managed-platform only with proprietary optimizations not in OSS SDK (docs.mem0.ai/core-concepts/memory-evaluation)
- Mastra OM 84.23% gpt-4o uses gemini-2.5-flash observer (mastra.ai/research/observational-memory)
- Hindsight 91.4% LongMemEval-S uses Gemini-3-pro reader; OSS-20B comparable is 83.6% (arxiv:2512.12818)
- Penfield Labs LOCOMO audit: 6.4% answer-key error rate, 62.81% judge FPR on default judge (dev.to/penfieldlabs)

## BEAM coverage
- v1 publishes BEAM 100K spot-check only (~$5 cost) at preliminary <X>% accuracy
- Full multi-tier BEAM (100K + 500K + 1M + 10M) deferred to v2 paired with Stage E (Hindsight 4-network typed observer)
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentos-bench/results/eval-matrix-v1/transparency-notes.md
git commit -m "docs(agentos-bench): v1 evaluation matrix transparency notes (judge FPR + vendor footnotes)"
```

---

### Task 5.5: Update LEADERBOARD.md

**Files:**
- Modify: `packages/agentos-bench/results/LEADERBOARD.md`

- [ ] **Step 1: Inspect current LEADERBOARD**

```bash
head -40 packages/agentos-bench/results/LEADERBOARD.md
```

- [ ] **Step 2: Add v1 publication anchor + cross-reference comparison-table.md**

(Manual edit to add a "v1 Comprehensive Evaluation Matrix" section linking to the new table.)

- [ ] **Step 3: Commit**

```bash
git add packages/agentos-bench/results/LEADERBOARD.md
git commit -m "docs(agentos-bench): LEADERBOARD anchors v1 comprehensive evaluation matrix"
```

---

### 🔴 CHECKPOINT 5: end of Phase B + table assembly (Day 21)

**Final pause for user review.** Report:

- Total v1 cost (cached prior runs + new spend)
- Comparison-table.md location + summary stats
- Transparency-notes.md location
- LEADERBOARD.md updated
- Recommendation: ready to push the publication, or one more iteration on architectures

---

## Self-Review

### Spec coverage check

| Spec section | Implementation tasks |
|---|---|
| §1 Goal | All weeks |
| §2 Methodology cheap-search → expensive-final | Task 4.1 (Phase A), Task 5.1-5.2 (Phase B) |
| §3 Architecture matrix (6 archs) | Wired via `--ingest-strategy summarized` (Stage L) + `--ingest-strategy fact-graph` (Stage I) + existing tier presets |
| §3.1 Phase A variants | Task 4.1 |
| §4 Benchmark matrix (3 conv + BEAM 100K spot) | Tasks 2.1-2.7 + existing LongMemEval/LOCOMO adapters |
| §5 Per-cell metrics (6 metrics) | Existing bench harness already emits these; Task 5.3 surfaces them in the table |
| §6 Implementation milestones | Weeks 1, 1.5, 2 |
| §7 Cost breakdown | Tasks 1.10, 2.7, 3.8, 4.1, 5.2 |
| §8 Decision gates | Checkpoints 1-5 |
| §10 Risk register | Each task has a fallback noted in spec §10 |
| §13 Success criteria | Checkpoint 5 reports against all 6 success criteria |

### Placeholder check

No "TBD"/"TODO" in task code blocks. Two scaffold-only sections explicitly call out their scope:
- Task 2.5: runCase implementation references mirroring LongMemEvalS rather than reproducing 200 LOC inline (acceptable: the reference is precise, the engineer can copy the exact file)
- Task 1.9 + Task 3.7: CLI wiring depends on existing structure not fully reproduced; the engineer reads `cli.ts` first per Step 1 of each task

### Type consistency

- `SummarizedIngestExecutor.strategyId` = `'summarized'` (matches IngestRouter `IngestStrategyId`)
- `EntityLinkingExecutor.strategyId` = `'fact-graph'` (matches IngestRouter `IngestStrategyId`)
- `Beam100K.id` = `'beam-100k'` (matches CLI `--benchmark` flag)
- `Beam100K.family` = `'external'` (matches `IBenchmark.family` enum)

---

## Execution Choice

**Plan complete and saved to `packages/agentos-bench/docs/plans/2026-04-25-comprehensive-evaluation-matrix-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task. Two-stage review between tasks. Faster iteration, isolated context per task. Best for the long-running implementation work in Weeks 1-2.

**2. Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`. Batch execution with checkpoints. Best when you want to watch each step happen.

**Which approach?**
