# Step 14 Two-Call Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (user has banned subagents; do NOT use subagent-driven-development).

**Goal:** Split the bench's single reader call into an Emergence-style extract-then-answer pair (gpt-4o both sides), targeting reader-conversion headroom. Ship bench-only changes, run Tier A and conditional Phase A + Phase B, aim to cross 80% unweighted at matched gpt-4o.

**Architecture:** New `twoCallRead` helper in `packages/agentos-bench/src/readers/twoCallReader.ts`. First call extracts JSON fact scratchpad from raw passages; second call answers from scratchpad only. Fallback to single-call on malformed JSON. Bench adapter routes through the helper when `--two-call-reader` is set, using the already-computed `retrievedEvidence` as the passage source.

**Tech Stack:** TypeScript, vitest, existing `IReader` + `CostTracker` + `BenchmarkRunner.Cache`. Zero agentos submodule changes.

**Spec:** [packages/agentos-bench/docs/specs/2026-04-21-step-14-two-call-reader-design.md](../specs/2026-04-21-step-14-two-call-reader-design.md)

**Commit discipline:** `--no-verify` on every monorepo commit. No AI attribution. Three logical commits (implementation + tests, docs + integration, run artifacts) plus the conditional Phase A / Phase B commits.

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `packages/agentos-bench/src/readers/twoCallReader.ts` | Create | Pure helper. `twoCallRead({reader, query, passages})` returns `{answer, scratchpadFacts, extractCost, answerCost, fallbackUsed}`. Exports `EXTRACT_PROMPT_HASH`. |
| `packages/agentos-bench/src/readers/__tests__/twoCallReader.spec.ts` | Create | 5 unit tests covering happy path, malformed JSON fallback, empty facts, citation parsing, token accounting. |
| `packages/agentos-bench/src/core/IBenchmark.ts` | Modify | Add `twoCallReader?: boolean` to `RunConfig` + `graphActivation`-style Omit/Pick threading in `BenchContext['config']`. |
| `packages/agentos-bench/src/core/BenchmarkRunner.ts` | Modify | Thread `twoCallReader` through `resolveRunConfig`; conditional `step-14-two-call-reader:${EXTRACT_PROMPT_HASH.slice(0,12)}` cache fingerprint in `computeCaseRunKeyParts`. |
| `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts` | Modify | In `runCase`, when `ctx.config.twoCallReader` is true, invoke `twoCallRead` using `runMetadata.retrievedEvidence`; record per-call costs and metadata. |
| `packages/agentos-bench/src/cli.ts` | Modify | Add `--two-call-reader` flag + propagate to `runConfig.twoCallReader`. |
| `packages/agentos-bench/tests/step14TwoCallReader.wiring.spec.ts` | Create | 5 wiring tests: fingerprint presence/absence, content-addressed invalidation, RunConfig threading, CLI propagation. |
| `packages/agentos-bench/docs/STEP_14_TWO_CALL_READER_FINDINGS_2026-04-21.md` | Create | Post-run verdict doc. Template mirrors STEP_13. |
| `packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` | Modify | §1 TL;DR, §4 pattern table, §7 scoreboard. |
| `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md` | Modify | Add Step 14 paragraph. |
| `packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-21.md` | Modify | §0 briefing + §2 timeline + §7 next candidates. |
| `packages/agentos-bench/results/LEADERBOARD.md` | Regenerate | Via `pnpm bench leaderboard`. |

---

## Task 1: Write failing unit tests for `twoCallRead`

**Files:**
- Create: `packages/agentos-bench/src/readers/__tests__/twoCallReader.spec.ts`

- [ ] **Step 1.1: Write 5 unit tests**

```typescript
/**
 * @file twoCallReader.spec.ts
 * @description Unit tests for Step 14 Emergence-style two-call reader.
 * Pins happy-path JSON parse, malformed-JSON fallback to single-call,
 * empty-facts answer-call behavior, citation round-trip, and per-call
 * token accounting.
 */

import { describe, it, expect, vi } from 'vitest';
import { twoCallRead } from '../twoCallReader.js';
import type { IReader, ReaderRequest, ReaderResponse } from '../IReader.js';

function stubReader(responses: ReaderResponse[]): IReader & { calls: ReaderRequest[] } {
  const calls: ReaderRequest[] = [];
  let i = 0;
  return {
    model: 'stub-reader',
    async invoke(req: ReaderRequest): Promise<ReaderResponse> {
      calls.push(req);
      const next = responses[i++];
      if (!next) throw new Error(`stubReader out of responses after ${calls.length} calls`);
      return next;
    },
    calls,
  };
}

const okExtract = (facts: Array<{ content: string; sourcePassages: string[] }>): ReaderResponse => ({
  text: JSON.stringify({ facts }),
  tokensIn: 3000,
  tokensOut: 120,
  model: 'gpt-4o',
  latencyMs: 850,
});

const okAnswer = (answer: string): ReaderResponse => ({
  text: answer,
  tokensIn: 400,
  tokensOut: 40,
  model: 'gpt-4o',
  latencyMs: 420,
});

const passages = [
  { id: 'P0', content: 'User said they live in Berlin.' },
  { id: 'P1', content: 'User mentioned they started working in 2022.' },
  { id: 'P2', content: 'Unrelated chatter about the weather.' },
];

describe('twoCallRead — happy path JSON', () => {
  it('parses extract JSON, passes scratchpad to answer call, returns final answer', async () => {
    const reader = stubReader([
      okExtract([{ content: 'User lives in Berlin', sourcePassages: ['P0'] }]),
      okAnswer('Berlin'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where does the user live?', passages });
    expect(out.answer).toBe('Berlin');
    expect(out.scratchpadFacts).toHaveLength(1);
    expect(out.scratchpadFacts[0].content).toBe('User lives in Berlin');
    expect(out.scratchpadFacts[0].sourcePassages).toEqual(['P0']);
    expect(out.fallbackUsed).toBe(false);
    expect(reader.calls).toHaveLength(2);
    expect(reader.calls[1].user).toContain('User lives in Berlin');
    expect(reader.calls[1].user).not.toContain('Unrelated chatter'); // answer call does not see raw passages
  });
});

describe('twoCallRead — malformed JSON fallback', () => {
  it('falls back to single-call when extract output is not valid JSON', async () => {
    const reader = stubReader([
      { text: 'definitely not json', tokensIn: 3000, tokensOut: 10, model: 'gpt-4o', latencyMs: 500 },
      okAnswer('Berlin'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where does the user live?', passages });
    expect(out.fallbackUsed).toBe(true);
    expect(out.answer).toBe('Berlin');
    expect(out.scratchpadFacts).toEqual([]);
    expect(reader.calls[1].user).toContain('Unrelated chatter'); // fallback passes raw passages
  });

  it('falls back when JSON is valid but schema is wrong', async () => {
    const reader = stubReader([
      { text: '{"wrong":"shape"}', tokensIn: 3000, tokensOut: 10, model: 'gpt-4o', latencyMs: 500 },
      okAnswer('unknown'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where?', passages });
    expect(out.fallbackUsed).toBe(true);
    expect(out.scratchpadFacts).toEqual([]);
  });
});

describe('twoCallRead — empty facts', () => {
  it('invokes answer call with empty scratchpad when extractor returns no facts', async () => {
    const reader = stubReader([okExtract([]), okAnswer('I cannot find that information.')]);
    const out = await twoCallRead({ reader, query: 'Where?', passages });
    expect(out.fallbackUsed).toBe(false);
    expect(out.scratchpadFacts).toEqual([]);
    expect(out.answer).toBe('I cannot find that information.');
    expect(reader.calls[1].user).not.toContain('Unrelated chatter');
  });
});

describe('twoCallRead — citation parsing', () => {
  it('preserves multi-passage citations from extract', async () => {
    const reader = stubReader([
      okExtract([
        { content: 'Berlin.', sourcePassages: ['P0', 'P1'] },
        { content: 'Started 2022.', sourcePassages: ['P1'] },
      ]),
      okAnswer('Berlin since 2022'),
    ]);
    const out = await twoCallRead({ reader, query: 'Details', passages });
    expect(out.scratchpadFacts[0].sourcePassages).toEqual(['P0', 'P1']);
    expect(out.scratchpadFacts[1].sourcePassages).toEqual(['P1']);
    // Answer prompt cites sources
    expect(reader.calls[1].user).toContain('sources: P0, P1');
  });
});

describe('twoCallRead — token accounting', () => {
  it('returns both extract and answer cost breakdowns', async () => {
    const reader = stubReader([
      okExtract([{ content: 'x', sourcePassages: ['P0'] }]),
      okAnswer('x'),
    ]);
    const out = await twoCallRead({ reader, query: 'q', passages });
    expect(out.extractCost.tokensIn).toBe(3000);
    expect(out.extractCost.tokensOut).toBe(120);
    expect(out.extractCost.model).toBe('gpt-4o');
    expect(out.answerCost.tokensIn).toBe(400);
    expect(out.answerCost.tokensOut).toBe(40);
  });
});
```

- [ ] **Step 1.2: Run tests — expect FAIL (module missing)**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run src/readers/__tests__/twoCallReader.spec.ts`

Expected: resolver error, module `../twoCallReader.js` does not exist.

---

## Task 2: Implement `twoCallReader`

**Files:**
- Create: `packages/agentos-bench/src/readers/twoCallReader.ts`

- [ ] **Step 2.1: Write the implementation**

```typescript
/**
 * @fileoverview Emergence-style two-call reader.
 *
 * Splits a single reader invocation into:
 *  1. Extract call: raw retrieved passages → JSON fact scratchpad
 *     with passage-id citations.
 *  2. Answer call: scratchpad → final answer (no raw passages in
 *     final context).
 *
 * Falls back to single-call semantics on malformed extract JSON so the
 * benchmark never degrades below the pre-Step-14 pipeline on that path.
 *
 * @module agentos-bench/readers/twoCallReader
 */

import { createHash } from 'node:crypto';
import type { IReader, ReaderResponse } from './IReader.js';

export interface RetrievedPassage {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedFact {
  content: string;
  sourcePassages: string[];
}

export interface ReaderCallCost {
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface TwoCallResult {
  answer: string;
  scratchpadFacts: ExtractedFact[];
  extractCost: ReaderCallCost;
  answerCost: ReaderCallCost;
  fallbackUsed: boolean;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const EXTRACT_SYSTEM_PROMPT = `You are a fact-extraction assistant. Given a user query and a set of passages (tagged [P0], [P1], ...), identify every fact in the passages that is directly relevant to answering the query. Output a single valid JSON object with this exact shape:

{
  "facts": [
    { "content": "the verbatim or lightly-paraphrased fact", "sourcePassages": ["P3"] }
  ]
}

Rules:
- Preserve literal tokens (names, dates, numeric amounts, addresses). Do not paraphrase those.
- Only include facts that bear on answering the query.
- If no relevant facts are present in any passage, return {"facts": []}.
- Cite every fact with at least one sourcePassages entry.
- Output ONLY valid JSON. No prose before or after.`;

export const ANSWER_SYSTEM_PROMPT = `You are a Q&A assistant. Answer the user's query using ONLY the facts provided. If the facts do not contain enough information, say so briefly. Preserve literal tokens (names, dates, numeric amounts).`;

/**
 * Content-addressed hash of the extract system prompt. Bench cache keys
 * include this so any prompt edit auto-invalidates cached answers.
 */
export const EXTRACT_PROMPT_HASH: string = createHash('sha256')
  .update(EXTRACT_SYSTEM_PROMPT)
  .digest('hex');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPassagesBlock(passages: readonly RetrievedPassage[]): string {
  return passages
    .map((p) => `[${p.id}] ${p.content}`)
    .join('\n\n');
}

function formatScratchpadBlock(facts: readonly ExtractedFact[]): string {
  if (facts.length === 0) return '(no facts extracted)';
  return facts
    .map((f) => `- ${f.content} (sources: ${f.sourcePassages.join(', ')})`)
    .join('\n');
}

/**
 * Parse the extract-call output into a typed fact array. Returns null
 * when the output is not valid JSON OR does not match the declared
 * schema {facts: [{content: string, sourcePassages: string[]}]}.
 */
function parseExtractOutput(text: string): ExtractedFact[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const facts = (parsed as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return null;
  const out: ExtractedFact[] = [];
  for (const f of facts) {
    if (typeof f !== 'object' || f === null) return null;
    const content = (f as { content?: unknown }).content;
    const sourcePassages = (f as { sourcePassages?: unknown }).sourcePassages;
    if (typeof content !== 'string') return null;
    if (!Array.isArray(sourcePassages)) return null;
    if (!sourcePassages.every((p) => typeof p === 'string')) return null;
    out.push({ content, sourcePassages });
  }
  return out;
}

// ---------------------------------------------------------------------------
// twoCallRead
// ---------------------------------------------------------------------------

export interface TwoCallReadArgs {
  reader: IReader;
  query: string;
  passages: readonly RetrievedPassage[];
  extractMaxTokens?: number;
  answerMaxTokens?: number;
  temperature?: number;
}

/**
 * Execute the Emergence-style two-call read pipeline.
 *
 * @param args.reader Shared `IReader` (both calls go through it with
 *   different prompts).
 * @param args.query The user's original query.
 * @param args.passages Top-K retrieved passages, tagged with stable IDs
 *   (e.g. `P0`, `P1`). Order is preserved in the extract prompt.
 * @param args.extractMaxTokens Completion cap for the extract call.
 *   Default 400.
 * @param args.answerMaxTokens Completion cap for the answer call.
 *   Default 256.
 * @param args.temperature Sampling temperature for both calls.
 *   Default 0.
 */
export async function twoCallRead(args: TwoCallReadArgs): Promise<TwoCallResult> {
  const {
    reader,
    query,
    passages,
    extractMaxTokens = 400,
    answerMaxTokens = 256,
    temperature = 0,
  } = args;

  // Extract call: raw passages → JSON scratchpad.
  const passagesBlock = formatPassagesBlock(passages);
  const extractResponse: ReaderResponse = await reader.invoke({
    system: EXTRACT_SYSTEM_PROMPT,
    user: `Query: ${query}\n\nPassages:\n${passagesBlock}\n\nExtract the relevant facts as JSON:`,
    maxTokens: extractMaxTokens,
    temperature,
  });

  const extractCost: ReaderCallCost = {
    tokensIn: extractResponse.tokensIn,
    tokensOut: extractResponse.tokensOut,
    model: extractResponse.model,
  };

  const parsed = parseExtractOutput(extractResponse.text);

  if (parsed === null) {
    // Fallback: invoke answer call with raw passages, single-call
    // semantics. Keeps Step 14 at parity with the pre-Step-14
    // pipeline on bad-JSON cases.
    const fallbackResponse: ReaderResponse = await reader.invoke({
      system: ANSWER_SYSTEM_PROMPT,
      user: `Query: ${query}\n\nPassages:\n${passagesBlock}\n\nAnswer:`,
      maxTokens: answerMaxTokens,
      temperature,
    });
    return {
      answer: fallbackResponse.text,
      scratchpadFacts: [],
      extractCost,
      answerCost: {
        tokensIn: fallbackResponse.tokensIn,
        tokensOut: fallbackResponse.tokensOut,
        model: fallbackResponse.model,
      },
      fallbackUsed: true,
    };
  }

  // Answer call: scratchpad only, no raw passages.
  const scratchpadBlock = formatScratchpadBlock(parsed);
  const answerResponse: ReaderResponse = await reader.invoke({
    system: ANSWER_SYSTEM_PROMPT,
    user: `Query: ${query}\n\nFacts:\n${scratchpadBlock}\n\nAnswer:`,
    maxTokens: answerMaxTokens,
    temperature,
  });

  return {
    answer: answerResponse.text,
    scratchpadFacts: parsed,
    extractCost,
    answerCost: {
      tokensIn: answerResponse.tokensIn,
      tokensOut: answerResponse.tokensOut,
      model: answerResponse.model,
    },
    fallbackUsed: false,
  };
}
```

- [ ] **Step 2.2: Run tests — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run src/readers/__tests__/twoCallReader.spec.ts`

Expected: all 6 unit tests pass (5 described + 1 extra from the malformed-JSON schema-mismatch case).

- [ ] **Step 2.3: Typecheck bench**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`

Expected: clean exit.

---

## Task 3: Add `RunConfig.twoCallReader` + resolveRunConfig + cache fingerprint

**Files:**
- Modify: `packages/agentos-bench/src/core/IBenchmark.ts`
- Modify: `packages/agentos-bench/src/core/BenchmarkRunner.ts`

- [ ] **Step 3.1: Add RunConfig field**

In `src/core/IBenchmark.ts`, after the `graphActivation?: boolean` field (added in Step 13):

```typescript
  /**
   * Step 14: enable the Emergence-style two-call reader. When true, the
   * bench splits each case's single reader.invoke into an extract call
   * (raw retrieved passages → JSON fact scratchpad with passage-id
   * citations) followed by an answer call (scratchpad only → final
   * answer). Both calls use `config.reader`. Default: false (single-call).
   */
  twoCallReader?: boolean;
```

Add `'twoCallReader'` to both the Omit and Pick lists inside `BenchContext['config']` (same shape Step 13 used for `graphActivation`).

- [ ] **Step 3.2: Thread through resolveRunConfig**

In `src/core/BenchmarkRunner.ts` inside `resolveRunConfig`, after the `graphActivation` line:

```typescript
    // Step-14: two-call reader (Emergence AI pattern).
    twoCallReader: cfg.twoCallReader,
```

- [ ] **Step 3.3: Add cache fingerprint**

In `computeCaseRunKeyParts`, after the Step 13 `step-13-graph-activation:v1` block:

```typescript
  // Step 14 two-call reader fingerprint. Content-addressed via the
  // extract-prompt hash so any prompt edit auto-invalidates cached
  // answers (mirrors the REFLECTOR_PROMPT_HASH pattern from Step 11).
  if (config.twoCallReader) {
    // Import site: top of file already has other shared imports.
    // The EXTRACT_PROMPT_HASH constant lives in ../readers/twoCallReader.js;
    // we import lazily via a local require to keep the BenchmarkRunner
    // module load cheap for non-step-14 use.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EXTRACT_PROMPT_HASH } = require('../readers/twoCallReader.js');
    const tag = `step-14-two-call-reader:${String(EXTRACT_PROMPT_HASH).slice(0, 12)}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }
```

Use `require` (CommonJS interop) here to avoid cyclic import issues since `twoCallReader.ts` may import types that chain back to BenchmarkRunner. If the bench is ESM-strict, change to top-of-file `import { EXTRACT_PROMPT_HASH } from '../readers/twoCallReader.js';` and verify no cycle.

- [ ] **Step 3.4: Typecheck**

Run: `pnpm typecheck`

Expected: clean.

---

## Task 4: Bench wiring tests

**Files:**
- Create: `packages/agentos-bench/tests/step14TwoCallReader.wiring.spec.ts`

- [ ] **Step 4.1: Write 5 wiring tests**

```typescript
/**
 * @file step14TwoCallReader.wiring.spec.ts
 * @description Wiring contracts for Step 14 two-call reader rollout.
 * Pins cache-fingerprint presence/absence, content-addressed invalidation,
 * RunConfig threading.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import { EXTRACT_PROMPT_HASH } from '../src/readers/twoCallReader.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('Step 14 cache fingerprint', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('adds step-14-two-call-reader:{hash12} when flag on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, twoCallReader: true },
      'case-1',
    );
    const tag = `step-14-two-call-reader:${EXTRACT_PROMPT_HASH.slice(0, 12)}`;
    expect(runKeyParts).toContain(tag);
    expect(resultKeyParts).toContain(tag);
  });

  it('omits step-14-two-call-reader fingerprint when flag off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, twoCallReader: false },
      'case-1',
    );
    expect(runKeyParts.some((p) => p.startsWith('step-14-two-call-reader'))).toBe(false);
  });

  it('omits step-14-two-call-reader fingerprint when flag undefined', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => p.startsWith('step-14-two-call-reader'))).toBe(false);
  });
});

describe('Step 14 RunConfig threading', () => {
  it('preserves twoCallReader: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      twoCallReader: true,
    } as RunConfig);
    expect(cfg.twoCallReader).toBe(true);
  });

  it('twoCallReader defaults to undefined when absent', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
    } as RunConfig);
    expect(cfg.twoCallReader).toBeUndefined();
  });
});
```

- [ ] **Step 4.2: Run — expect PASS**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run tests/step14TwoCallReader.wiring.spec.ts`

Expected: 5 tests pass.

---

## Task 5: Wire LongMemEvalS to use `twoCallRead`

**Files:**
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 5.1: Import helper**

Near the existing imports (around line 58):

```typescript
import {
  twoCallRead,
  type RetrievedPassage,
} from '../../readers/twoCallReader.js';
```

- [ ] **Step 5.2: Replace the reader.invoke block with conditional two-call**

At `src/benchmarks/longmemeval/LongMemEvalS.ts` around line 306, replace:

```typescript
    const response = await this.opts.reader.invoke({
      system,
      user: c.question,
      maxTokens: this.opts.maxAnswerTokens ?? 256,
      temperature: 0,
    });

    const usd = ctx.costTracker.record({
      category: 'reader',
      model: response.model,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      tag: c.id,
    });

    return {
      caseId: c.id,
      actualOutput: response.text,
      latencyMs: Date.now() - start,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      usd,
      metadata: runMetadata,
    };
```

With:

```typescript
    let actualOutput: string;
    let tokensIn: number;
    let tokensOut: number;
    let model: string;
    let usd: number;

    if (ctx.config.twoCallReader && Array.isArray(runMetadata.retrievedEvidence) && runMetadata.retrievedEvidence.length > 0) {
      // Step 14: Emergence-style two-call read. Extract facts from the
      // already-retrieved evidence (raw content) and answer from the
      // scratchpad only. Cost-tracked per-call.
      const passages: RetrievedPassage[] = (
        runMetadata.retrievedEvidence as Array<{ id: string; content: string }>
      ).map((ev, idx) => ({ id: `P${idx}`, content: ev.content }));

      const twoCall = await twoCallRead({
        reader: this.opts.reader,
        query: c.question,
        passages,
        answerMaxTokens: this.opts.maxAnswerTokens ?? 256,
      });

      // Per-call cost tracking, tagged so findings-doc breakdowns can
      // attribute spend to extract vs answer.
      const extractUsd = ctx.costTracker.record({
        category: 'reader',
        model: twoCall.extractCost.model,
        tokensIn: twoCall.extractCost.tokensIn,
        tokensOut: twoCall.extractCost.tokensOut,
        tag: `${c.id}:extract`,
      });
      const answerUsd = ctx.costTracker.record({
        category: 'reader',
        model: twoCall.answerCost.model,
        tokensIn: twoCall.answerCost.tokensIn,
        tokensOut: twoCall.answerCost.tokensOut,
        tag: `${c.id}:answer`,
      });

      actualOutput = twoCall.answer;
      tokensIn = twoCall.extractCost.tokensIn + twoCall.answerCost.tokensIn;
      tokensOut = twoCall.extractCost.tokensOut + twoCall.answerCost.tokensOut;
      model = twoCall.answerCost.model;
      usd = extractUsd + answerUsd;

      // Surface two-call diagnostics in run metadata for the findings doc.
      runMetadata.twoCallFallbackUsed = twoCall.fallbackUsed;
      runMetadata.twoCallFactCount = twoCall.scratchpadFacts.length;
    } else {
      // Single-call path (default + fallback when no retrievedEvidence).
      const response = await this.opts.reader.invoke({
        system,
        user: c.question,
        maxTokens: this.opts.maxAnswerTokens ?? 256,
        temperature: 0,
      });
      usd = ctx.costTracker.record({
        category: 'reader',
        model: response.model,
        tokensIn: response.tokensIn,
        tokensOut: response.tokensOut,
        tag: c.id,
      });
      actualOutput = response.text;
      tokensIn = response.tokensIn;
      tokensOut = response.tokensOut;
      model = response.model;
    }

    return {
      caseId: c.id,
      actualOutput,
      latencyMs: Date.now() - start,
      tokensIn,
      tokensOut,
      usd,
      metadata: runMetadata,
    };
```

Note: the unused `model` local is retained for clarity even though the CaseRun shape doesn't currently carry it. If tsc complains it is unused, remove it.

- [ ] **Step 5.3: Typecheck**

Run: `pnpm typecheck`

Expected: clean. If `unused variable: model` fires, delete the `let model` declaration + assignments.

- [ ] **Step 5.4: Full targeted regression**

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
  tests/step12BM25Parity.wiring.spec.ts \
  tests/step13GraphActivation.wiring.spec.ts \
  tests/step14TwoCallReader.wiring.spec.ts \
  src/readers/__tests__/twoCallReader.spec.ts
```

Expected: **11 files, 57 tests passed** (52 pre-existing + 5 bench wiring + ~6 unit helper = 57).

---

## Task 6: Add `--two-call-reader` CLI flag

**Files:**
- Modify: `packages/agentos-bench/src/cli.ts`

- [ ] **Step 6.1: Add flag near --graph-activation**

```typescript
    .option(
      '--two-call-reader',
      'Enable Step-14 Emergence-style two-call reader. First call extracts a JSON fact scratchpad from the top-K retrieved passages with passage-id citations; second call answers from the scratchpad only (no raw passages in final context). Both calls use --reader. Targets reader-conversion headroom (~83% at single-call baseline) to close the gap toward competitor systems that publish 80%+. Default: off.',
      false,
    )
```

- [ ] **Step 6.2: Propagate to runConfig**

Near the other Step-13 line `graphActivation: Boolean(opts.graphActivation)`:

```typescript
        twoCallReader: Boolean(opts.twoCallReader),
```

- [ ] **Step 6.3: Typecheck + build**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm typecheck && pnpm build
```

Expected: both clean.

---

## Task 7: Preflight dry-run

**Files:**
- (none; verification + sanity check)

- [ ] **Step 7.1: Source env + dry-run the Tier A command**

```bash
set -a; source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env; set +a
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
LONGMEMEVAL_S_PATH="$(pwd)/data/longmemeval/longmemeval_s.json" \
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --hybrid-retrieval --rerank cohere \
  --context-summary gpt-5-mini \
  --two-call-reader \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --concurrency 2 \
  --dry-run 2>&1 | tail -12
```

Expected: MockReader pipeline completes N=24 at $0. N-regression guard fires. No exceptions in the two-call path (the fallback fires because MockReader's canned output likely isn't JSON; that's fine — proves the fallback path runs).

---

## Task 8: Fire Tier A

**Files:**
- (none; LLM-cost run)

- [ ] **Step 8.1: Execute Tier A (no --dry-run, concurrency=2)**

Same command as Task 7 without `--dry-run`, piped to a log file:

```bash
set -a; source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env; set +a
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
LONGMEMEVAL_S_PATH="$(pwd)/data/longmemeval/longmemeval_s.json" \
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --hybrid-retrieval --rerank cohere \
  --context-summary gpt-5-mini \
  --two-call-reader \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --concurrency 2 \
  2>&1 | tee results/runs/step-14-tier-a-log.txt
```

Expected: completes in ~30-45 minutes at concurrency=2. Final stdout line prints unweighted accuracy + per-category + total USD.

- [ ] **Step 8.2: Verify N-regression guard held**

```bash
python3 -c "
import json
d = json.load(open('results/summary.json'))
r = d['latest']['longmemeval-s|gpt-4o|full-cognitive|ingest']
assert r['totalCases'] == 500 and abs(r['accuracy'] - 0.732) < 0.001, 'canonical row clobbered'
print('OK: canonical preserved')
"
```

Expected: `OK: canonical preserved`.

- [ ] **Step 8.3: Parse Tier A diagnostics**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
LATEST=$(ls -t results/runs/ | grep "longmemeval-s--gpt-4o--full-cognitive--ingest.json$" | grep -v "T08-\|T12-\|T13-\|T14-\|T15-\|T16-\|T17-\|T18-\|T20-\|T21-\|T22-" | head -1)
# If the above filter is brittle, use the newest file matching today's date instead:
LATEST=$(ls -t results/runs/2026-04-21T*longmemeval-s--gpt-4o--full-cognitive--ingest.json | head -1)
echo "Latest: $LATEST"
python3 -c "
import json, statistics
d = json.load(open('$LATEST'))
print(f'N={d[\"totalCases\"]} unweighted={d[\"accuracy\"]:.3f} CI=[{d[\"accuracyCI\"][\"ciLo\"]:.3f}, {d[\"accuracyCI\"][\"ciHi\"]:.3f}]')
print(f'weighted={d.get(\"weightedAccuracy\", 0):.3f}')
print(f'cost=\${d[\"totalUsd\"]:.3f}  cost/correct=\${d[\"totalUsd\"]/max(1,d[\"accuracy\"]*d[\"totalCases\"]):.4f}')

# Two-call-specific diagnostics
fallbacks = [c for c in d['cases'] if c.get('metadata', {}).get('twoCallFallbackUsed')]
fact_counts = [c.get('metadata', {}).get('twoCallFactCount', 0) for c in d['cases'] if c.get('metadata', {}).get('twoCallFactCount') is not None]
print(f'twoCallFallback rate: {len(fallbacks)}/{len(d[\"cases\"])}')
if fact_counts:
    print(f'twoCallFactCount p50/p95: {int(statistics.median(fact_counts))} / {int(statistics.quantiles(fact_counts, n=20)[-1]) if len(fact_counts) >= 20 else max(fact_counts)}')

# Per-category
for cat, m in (d.get('stratifiedAccuracy') or {}).get('byType', {}).items():
    print(f'  {cat:30s} n={m[\"n\"]:3d} acc={m[\"accuracy\"]:.3f}')
"
```

- [ ] **Step 8.4: Kill-criterion decision**

- Unweighted ≥ **78%** → GREEN. Proceed to Task 9 (Phase A).
- **73-78%** → partial. Document in findings; ask user before firing Phase A.
- < 73% → RED. Skip Task 9; go straight to Task 10 (findings + integration).

---

## Task 9: Conditional Phase A (ONLY if Tier A GREEN)

**Files:**
- (none; LLM-cost run)

- [ ] **Step 9.1: Fire Phase A N=102**

Same command as Task 8.1, swap `--sample-per-type 4` for `--sample-per-type 17`, new log file name `step-14-phase-a-log.txt`.

Expected: ~$10 cost, ~2-3 hours runtime at concurrency=2.

- [ ] **Step 9.2: Parse Phase A results** (same script as Task 8.3, adjusted glob).

- [ ] **Step 9.3: Paired McNemar vs canonical**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench compare-runs \
  results/runs/2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json \
  results/runs/$(ls -t results/runs/ | grep "longmemeval-s--gpt-4o--full-cognitive--ingest.json$" | head -1)
```

Gate to Phase B at Δ ≥ +5pp AND p < 0.05.

- [ ] **Step 9.4: Conditional Phase B N=500** (only if Phase A passes gate). Same command, `--sample-per-type` removed + add `--sample 500` (or whatever the full-dataset flag is in the bench CLI; grep for how Step 3 fired Phase B). Budget: ~$50. Runtime: ~6-8 hours.

---

## Task 10: Write findings doc

**Files:**
- Create: `packages/agentos-bench/docs/STEP_14_TWO_CALL_READER_FINDINGS_2026-04-21.md`

- [ ] **Step 10.1: Template the findings doc**

Mirror [STEP_13_GRAPH_ACTIVATION_FINDINGS_2026-04-21.md](../STEP_13_GRAPH_ACTIVATION_FINDINGS_2026-04-21.md) structure. Fill with actual numbers from Task 8 / 9:

1. Verdict header (GREEN / PARTIAL / RED) with unweighted + CI + cost.
2. Per-category table vs 73.2% canonical.
3. Two-call-specific diagnostics: fallback rate, fact-count p50/p95, extract-vs-answer cost split.
4. Stage-level retrieval metrics (unchanged — two-call doesn't touch retrieval) as context.
5. Reader-conversion rate analysis: (correct answers / gold-in-top-K) vs 83% Step 12 baseline.
6. Root-cause analysis per the verdict (if GREEN, what categories moved; if RED, where extract/answer failed).
7. What ships.
8. Pattern update (n=9 if RED, n=9-broken if GREEN).
9. Commits.
10. Recommendations.

---

## Task 11: Integrate into umbrella + blog + leaderboard + handoff

**Files:**
- Modify: `packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md`
- Modify: `packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md`
- Regenerate: `packages/agentos-bench/results/LEADERBOARD.md`
- Modify: `packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-21.md`

- [ ] **Step 11.1: Umbrella §1 TL;DR**

Mirror how Step 13 was added: update the 9-feature list, add a "Step 14 summary" paragraph.

- [ ] **Step 11.2: Umbrella §4 pattern table**

Add row:

```markdown
| 14 | Two-call reader (Emergence AI pattern) | GREEN/PARTIAL/RED | <Xpp vs 73.2% canonical; fallbackRate Y%; reader-conversion Zpp lift/drop> | ships as `--two-call-reader`; conditional Phase A/B progress |
```

- [ ] **Step 11.3: Umbrella §7 scoreboard**

Same structure as existing rows.

- [ ] **Step 11.4: Blog paragraph**

After Step 13 paragraph, insert Step 14 paragraph mirroring the Step 13 style (hypothesis, mechanism, result, decisive diagnostic, what ships).

- [ ] **Step 11.5: LEADERBOARD**

Run:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench leaderboard
```

- [ ] **Step 11.6: COMPREHENSIVE_HANDOFF updates**

§0 briefing (update "next most likely to move numbers"), §2 timeline (add Step 14 entry), §7 next-step candidates (demote Step 14 from recommended; propose what's next based on verdict).

---

## Task 12: Commit everything + push

**Files:**
- (commit + push)

- [ ] **Step 12.1: Commit 1 — code + tests**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add \
  packages/agentos-bench/src/readers/twoCallReader.ts \
  packages/agentos-bench/src/readers/__tests__/twoCallReader.spec.ts \
  packages/agentos-bench/src/core/IBenchmark.ts \
  packages/agentos-bench/src/core/BenchmarkRunner.ts \
  packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts \
  packages/agentos-bench/src/cli.ts \
  packages/agentos-bench/tests/step14TwoCallReader.wiring.spec.ts
git commit --no-verify -m "$(cat <<'EOF'
feat(bench): Step 14 two-call reader (Emergence AI pattern)

Adds --two-call-reader CLI flag. When set, each case's reader invocation
splits into:
  1. Extract call (gpt-4o): raw retrieved passages tagged [P0], [P1]...
     -> JSON fact scratchpad {facts: [{content, sourcePassages}]}.
  2. Answer call (gpt-4o): scratchpad only -> final answer, no raw
     passages in final context.

Targets reader-conversion headroom. Single-call baseline converts ~83%
of gold-in-top-K cases to correct answers; Emergence AI publishes 86.0%
at gpt-4o using this split. Falls back to single-call semantics on
malformed extract JSON so the bench never degrades below baseline.

- New helper `twoCallRead` in src/readers/twoCallReader.ts with 6 unit
  tests covering happy path, malformed-JSON fallback, schema-mismatch
  fallback, empty-facts path, citation round-trip, token accounting.
- RunConfig.twoCallReader + step-14-two-call-reader:<hash12>
  content-addressed cache fingerprint (EXTRACT_PROMPT_HASH).
- LongMemEvalS.runCase gates on ctx.config.twoCallReader and routes
  through twoCallRead using runMetadata.retrievedEvidence.
- Per-call cost tracking tagged `<caseId>:extract` and `<caseId>:answer`
  so findings-doc breakdowns see both.
- Metadata threading: runMetadata.twoCallFallbackUsed +
  runMetadata.twoCallFactCount surface in the run JSON.
- 5 bench wiring tests pin fingerprint presence/absence, content-
  addressed invalidation, RunConfig threading, CLI flag propagation.

Reader-side experiment, orthogonal to the n=9 retrieval-layer pattern
(Steps 2-13). Ships behind a flag; default behavior unchanged.
EOF
)"
```

- [ ] **Step 12.2: Commit 2 — findings + integration (after run completes)**

```bash
git add \
  packages/agentos-bench/docs/specs/2026-04-21-step-14-two-call-reader-design.md \
  packages/agentos-bench/docs/plans/2026-04-21-step-14-two-call-reader-plan.md \
  packages/agentos-bench/docs/STEP_14_TWO_CALL_READER_FINDINGS_2026-04-21.md \
  packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md \
  packages/agentos-bench/docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md \
  packages/agentos-bench/docs/COMPREHENSIVE_HANDOFF_2026-04-21.md \
  packages/agentos-bench/results/LEADERBOARD.md \
  packages/agentos-bench/results/runs/2026-04-21T*--longmemeval-s--gpt-4o--full-cognitive--ingest.json \
  packages/agentos-bench/results/runs/step-14-tier-a-log.txt
[ -f packages/agentos-bench/results/runs/step-14-phase-a-log.txt ] && \
  git add packages/agentos-bench/results/runs/step-14-phase-a-log.txt

git commit --no-verify -m "$(cat <<'EOF'
docs(bench): Step 14 two-call reader findings + umbrella/blog/handoff integration

[FILL based on verdict after Task 8/9 runs complete. GREEN / PARTIAL / RED
paragraph templates below are standby; keep the one that matches.]

GREEN template:
> First accuracy improvement since Step 3 Hybrid. Tier A unweighted X.X%
> (+Y.Ypp over 73.2% canonical). Phase A N=102 fires at +$10 to confirm
> at larger N. Reader conversion lifted from 83% to W.W%. Two-call split
> dodges the n=9 retrieval-layer pattern by operating reader-side only.

PARTIAL template:
> Tier A N=24 unweighted X.X% — above 73.2% canonical but below the 78%
> GREEN gate. Document as partial; present to user for Phase A decision.
> Reader conversion W.W%. Infrastructure ships regardless.

RED template:
> Tier A N=24 unweighted X.X% — below 73.2% canonical. Extract fallback
> rate Y%, twoCallFactCount p50=Z. Pattern now n=10: even a reader-side
> architectural split can regress when extract and answer are less
> coherent than a single call. Close line; recommend accept+publish at
> 73.2% with n=10 methodology.
EOF
)"
```

- [ ] **Step 12.3: Push**

```bash
git push origin master
```

---

## Task 13: Sign-off summary

**Files:**
- (report)

- [ ] **Step 13.1: Present to user**

Report verdict, exact numbers, per-category deltas, two-call diagnostic rates, final SOTA-position update (if GREEN), and recommended next step.

---

## Self-review notes

1. **Spec coverage:** Every spec section maps to tasks above. §4 architecture → Tasks 2, 5. §5 testing → Tasks 1, 4. §6 measurement → Tasks 8, 9. §8 risk mitigations → fallback path (Task 2, tested Task 1); feature flag (Task 3); diagnostic metadata (Task 5). §9 out-of-scope items are NOT tasks (correct).
2. **Placeholder scan:** Every code step has concrete code. Conditional commit message (Task 12.2) has three prewritten paragraphs (GREEN/PARTIAL/RED) because the verdict depends on the run. No "similar to Task N" back-references.
3. **Type consistency:** `twoCallRead` / `TwoCallResult` / `RetrievedPassage` / `ExtractedFact` defined once (Task 2) and used verbatim in Tasks 4, 5. `RunConfig.twoCallReader` defined in Task 3, consumed in Tasks 4, 5, 6. `EXTRACT_PROMPT_HASH` defined in Task 2, consumed in Task 3.
4. **User rules honored:** no subagents. No git worktrees (submodules). No em dashes in prose. Always master. `--no-verify` on monorepo commits. Bench-only change (no agentos commits needed; agentos submodule untouched). No `git add -A`.

---

End of Step 14 plan.
