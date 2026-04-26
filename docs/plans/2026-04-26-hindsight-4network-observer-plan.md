---
title: Stage E: Hindsight 4-Network Typed Observer (Implementation Plan v3)
date: 2026-04-26 (v1), 2026-04-25 revision v2 (phasing rewrite + bench-vs-core), 2026-04-25 revision v3 (rebased after concurrent shipping of Phase 4.1-4.3 + TypedNetworkRetriever)
spec: ../specs/2026-04-26-hindsight-4network-observer-design.md
estimated_cost: $321-371 LLM (ex-shipping) plus $500-800 with cushion
estimated_duration: ~5-7 working days remaining (Phases 1-3, 4.1, 4.2, 4.3 + TypedNetworkRetriever shipped)
execution_mode: inline (no subagents per user preference)
---

# Stage E: Hindsight 4-Network Typed Observer Plan

**Goal:** Run the Phase 4c smoke against the shipped option-B baseline (TypedNetworkRetriever appending to canonical pool), measure Phase A on LongMemEval-S N=54, gate on the +2pp criterion. If Phase A passes, ship to Phase B. If Phase A is +0 to +2pp, escalate to Phase 4.4 (4-way RRF + budget-split prompt blocks per spec §4.2.B). If Phase A negatives, publish as third negative result and ship the typed-network primitives as opt-in core (already shipped in agentos@0.4.0).

**Architecture (3 sentences):** Phase 4.1 (config + manager wiring), 4.2 (encode runs observer), 4.3 MVP (retrieve runs spreading activation + surfaces top-10 in `diagnostics.retrievedTypedFacts`), and TypedNetworkRetriever (canonical-shaped adapter) all SHIPPED in agentos@0.4.0. Bench-side LongMemEvalS uses TypedNetworkRetriever to append typed facts to the canonical retrieval pool with bank-prefixed content (option B per spec §4.2.A). Phase 4.4 (conditional, gated on Phase 6 outcome) replaces the seed-then-spread MVP with 4-signal RRF inside `manager.retrieve()` and adds a `[Typed memory]` reader-prompt block at the configured `budgetSplit` fraction (option A per spec §4.2.B).

**Tech Stack:** TypeScript (ESM), `zod` for schema validation, `vitest` for TDD, existing `IEmbeddingManager` (typed-fact embeddings inherit the manager's embedder per spec §4.2.2), OpenAI gpt-5-mini for extraction (gpt-4o for reader/judge ablations).

## Status as of 2026-04-25 v3 (read this before starting Phase 4c)

**SHIPPED in `framersai/agentos@230c6aea` (package version 0.4.0):**

| Phase | Commit | What |
|---|---|---|
| 1 | `ebdf5654` | Pure-code primitives: `types.ts`, `TypedNetworkStore.ts`, `TemporalIntervalOverlap.ts` |
| 2 | `ee8f4632` | `TypedNetworkObserver.ts` + 6-step extraction prompt + zod schema |
| 3 | `d8678495` | `TypedSpreadingActivation.ts` (Eq. 12) + `FourWayRrf.ts` |
| 4.1 | `cac63c2` | `CognitiveMemoryConfig.typedNetwork` field + manager wiring + accessors |
| 4.2 | `a604d86` | `manager.encode()` runs observer + addFact, errors logged via stderr |
| 4.3 | `d0ab11c5` | `manager.retrieve()` MVP: collect seed entities, spread, top-10 facts via `diagnostics.retrievedTypedFacts` |
| (export) | `db9ea8b9` | Subpath export for typed-network module |
| (fix) | `64a5e69` | retrievedTypedFacts inside diagnostics + ScoredMemoryTrace import |
| (fix) | `cf045fa2` | Unblock CI build (TS errors in 0.3.4) |
| (release) | `99a8bb51` | 0.4.0 |
| 4-adapter | `230c6aea` | `TypedNetworkRetriever`: ScoredMemoryTrace[] adapter, 15 unit tests |

**Tests as of HEAD `230c6aea`:** 75/75 typed-network tests passing in agentos.

**SHIPPED in monorepo commit `ef65cbf9e` (v1 publication, earlier this week):**
- `packages/agentos-bench/src/cli.ts:696-701`: `--typed-network <variant>` flag
- `packages/agentos-bench/src/core/IBenchmark.ts:707-722, :814`: `RunConfig.typedNetwork` + `OPTIONAL_RUN_CONFIG_KEYS`
- `packages/agentos-bench/src/core/BenchmarkRunner.ts:202-204, :657-663`: `resolveRunConfig` propagation + cache fingerprint
- `packages/agentos-bench/tests/resolveRunConfigContract.spec.ts:97`: SAMPLES update
- `packages/agentos-bench/src/cognitive/createCognitiveManager.ts:387-401`: handle.typedNetworkStore / Observer / SpreadingActivation are passthrough accessors backed by `manager.getTypedNetworkStore()` etc. (the elegant bridge the other session built)
- `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts:1568-1617`: typed-network config

**UNCOMMITTED in working tree (other session, do NOT touch):**
- `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts:1730-1762`: bench retrieval integration via TypedNetworkRetriever
- `packages/agentos-bench/docs/NEXT_SESSION_2026-04-27_HANDOFF_v4_AFTER_V1_PUBLICATION.md`: "0.3a Stage E retrieval integration COMPLETE" section
- `packages/agentos-bench/results/LEADERBOARD.md`
- `packages/agentos-bench/results/eval-matrix-v1/comparison-table.md`

**Pre-flight: bench tests = 515/515 passing; agentos typed-network tests = 75/75 passing (verified 2026-04-25 22:36).**

**NOT SHIPPED (this plan's targets):**
- 5-case smoke run at `--typed-network full` against shipped option-B baseline (Phase 4c)
- Phase A measurement on LongMemEval-S N=54 stratified at minimal + full (Phase 5)
- Phase 4.4 (4-way RRF + budget-split prompt blocks) as conditional escalation per Phase 6
- Locomo adapter mirror (deferred to Phase 7)
- COHERE_API_KEY in monorepo `.env` (blocks Phase A)

**Pre-flight constraints (NON-NEGOTIABLE):**
- Branch: `master`
- Commits: never commit unless user explicitly asks
- Push: never push unless user explicitly asks
- Commit messages: never mention AI / Claude / Opus / LLM / rewrite. No `Co-Authored-By` lines.
- agentos is a submodule, `cd packages/agentos`, commit there, push to `framersai/agentos`, then update submodule pointer in monorepo
- agentos-bench is in the monorepo root (NOT a submodule); commit explicitly-staged files only with `--no-verify`
- TDD discipline: failing test FIRST, then minimal implementation, then refactor. Skipping the failing-test step disqualifies the work as TDD.
- No subagents
- No worktrees with submodules
- Get explicit user approval before launching any new LLM run >$5

---

## Phase 0: Spec approval + plan kickoff (1 day, $0)

### Task 0.1: Read the spec end-to-end at max reasoning

- [ ] **Step 0.1.1: Re-read the spec**

```bash
cat /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md | wc -l
```

Expected: ~250 lines. Read at maximum reasoning per the user's CLAUDE.md "Self-Review Before Implementation" rule.

- [ ] **Step 0.1.2: Verify all referenced files exist**

For each anchor in spec §11:
```bash
ls /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos/src/memory/retrieval/graph/SpreadingActivation.ts
ls /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos/src/memory/CognitiveMemoryManager.ts
ls /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/docs/SOTA_CITED_EVIDENCE_2026-04-25.md
```

If any missing, halt and surface to user.

- [ ] **Step 0.1.3: Get explicit user approval before any code**

Pose to user:
> "Stage E spec ready at `packages/agentos-bench/docs/specs/2026-04-26-hindsight-4network-observer-design.md`. 4 typed networks (W/E/O/S), $500-800 budget, 2-3 weeks. Approve scaffolding the agentos-core module + bench wiring + Phase A measurement?"

If no approval, halt entire plan.

---

## Phase 1: Pure-code primitives (no LLM) (3 days, $0)

### Task 1.1: TDD `types.ts`

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/types.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/__tests__/types.test.ts`

- [ ] **Step 1.1.1: Write the failing test**

```ts
// types.test.ts
import { describe, it, expect } from 'vitest';
import {
  type BankId,
  type TypedFact,
  type TypedEdge,
  type EdgeKind,
  isBankId,
  BANK_IDS,
} from '../types.js';

describe('typed-network types', () => {
  it('BANK_IDS contains exactly the 4 typed banks', () => {
    expect(BANK_IDS).toEqual(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']);
  });

  it('isBankId narrows correctly for valid banks', () => {
    expect(isBankId('WORLD')).toBe(true);
    expect(isBankId('OPINION')).toBe(true);
    expect(isBankId('NONSENSE')).toBe(false);
  });

  it('TypedFact has required fields per Eq. 1', () => {
    const fact: TypedFact = {
      id: 'f1',
      bank: 'WORLD',
      text: 'Berlin is in Germany',
      embedding: [0.1, 0.2, 0.3],
      temporal: { start: '2026-04-26', end: '2026-04-26', mention: '2026-04-26' },
      participants: [],
      reasoningMarkers: [],
      entities: ['Berlin', 'Germany'],
      confidence: 1.0,
    };
    expect(fact.bank).toBe('WORLD');
  });
});
```

- [ ] **Step 1.1.2: Run test, verify it fails**

```bash
cd packages/agentos
pnpm exec vitest run src/memory/retrieval/typed-network/__tests__/types.test.ts
```

Expected: FAIL with "Cannot find module '../types.js'".

- [ ] **Step 1.1.3: Write minimal implementation**

```ts
// types.ts
export const BANK_IDS = ['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION'] as const;
export type BankId = (typeof BANK_IDS)[number];

export function isBankId(s: string): s is BankId {
  return (BANK_IDS as readonly string[]).includes(s);
}

export const EDGE_KINDS = ['temporal', 'semantic', 'entity', 'causal'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface TypedFact {
  id: string;
  bank: BankId;
  text: string;
  embedding: number[];
  temporal: { start?: string; end?: string; mention: string };
  participants: { name: string; role: string }[];
  reasoningMarkers: string[];
  entities: string[];
  confidence: number;
  /** Optional auxiliary metadata. */
  metadata?: Record<string, unknown>;
}

export interface TypedEdge {
  fromFactId: string;
  toFactId: string;
  kind: EdgeKind;
  weight: number;
}
```

- [ ] **Step 1.1.4: Run test, verify it passes**

```bash
cd packages/agentos
pnpm exec vitest run src/memory/retrieval/typed-network/__tests__/types.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 1.1.5: Commit (in agentos submodule, await user approval)**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos
git add src/memory/retrieval/typed-network/types.ts src/memory/retrieval/typed-network/__tests__/types.test.ts
# Wait for user approval; if approved:
# git commit -m "feat(memory/typed-network): types for 4-bank fact + typed edge"
```

### Task 1.2: TDD `TypedNetworkStore.ts`

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/TypedNetworkStore.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/__tests__/TypedNetworkStore.test.ts`

- [ ] **Step 1.2.1: Write failing test**

```ts
// TypedNetworkStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TypedNetworkStore } from '../TypedNetworkStore.js';
import type { TypedFact } from '../types.js';

describe('TypedNetworkStore', () => {
  let store: TypedNetworkStore;
  const fact: TypedFact = {
    id: 'f1',
    bank: 'WORLD',
    text: 'Berlin is in Germany',
    embedding: [0.1, 0.2, 0.3],
    temporal: { mention: '2026-04-26' },
    participants: [],
    reasoningMarkers: [],
    entities: ['Berlin', 'Germany'],
    confidence: 1.0,
  };

  beforeEach(() => {
    store = new TypedNetworkStore();
  });

  it('starts with 0 facts in every bank', () => {
    expect(store.getBank('WORLD').size).toBe(0);
    expect(store.getBank('EXPERIENCE').size).toBe(0);
    expect(store.getBank('OPINION').size).toBe(0);
    expect(store.getBank('OBSERVATION').size).toBe(0);
  });

  it('addFact routes to the correct bank', () => {
    store.addFact(fact);
    expect(store.getBank('WORLD').size).toBe(1);
    expect(store.getBank('EXPERIENCE').size).toBe(0);
  });

  it('getFact retrieves by id', () => {
    store.addFact(fact);
    const got = store.getFact('f1');
    expect(got?.text).toBe('Berlin is in Germany');
  });

  it('addEdge creates bidirectional entity edges', () => {
    store.addFact(fact);
    store.addFact({ ...fact, id: 'f2', text: 'Germany is in Europe' });
    store.addEdge({ fromFactId: 'f1', toFactId: 'f2', kind: 'entity', weight: 1.0 });
    expect(store.getEdges('f1')).toHaveLength(1);
    // Bidirectional: f2 also sees an edge to f1
    expect(store.getEdges('f2')).toHaveLength(1);
  });
});
```

- [ ] **Step 1.2.2: Run test, verify it fails**

Expected: FAIL on "Cannot find module".

- [ ] **Step 1.2.3: Write minimal implementation**

```ts
// TypedNetworkStore.ts
import type { BankId, TypedFact, TypedEdge } from './types.js';
import { BANK_IDS } from './types.js';

export class TypedNetworkStore {
  private readonly facts = new Map<string, TypedFact>();
  private readonly banks: Record<BankId, Set<string>>;
  private readonly edgesFrom = new Map<string, TypedEdge[]>();

  constructor() {
    this.banks = Object.fromEntries(
      BANK_IDS.map((b) => [b, new Set<string>()]),
    ) as Record<BankId, Set<string>>;
  }

  addFact(fact: TypedFact): void {
    this.facts.set(fact.id, fact);
    this.banks[fact.bank].add(fact.id);
  }

  getFact(id: string): TypedFact | undefined {
    return this.facts.get(id);
  }

  getBank(bank: BankId): Set<string> {
    return this.banks[bank];
  }

  addEdge(edge: TypedEdge): void {
    this.appendEdge(edge.fromFactId, edge);
    // Per Hindsight Eq. 12 + entity bidirectionality, edges are bidirectional.
    this.appendEdge(edge.toFactId, {
      fromFactId: edge.toFactId,
      toFactId: edge.fromFactId,
      kind: edge.kind,
      weight: edge.weight,
    });
  }

  getEdges(factId: string): TypedEdge[] {
    return this.edgesFrom.get(factId) ?? [];
  }

  private appendEdge(fromId: string, edge: TypedEdge): void {
    const list = this.edgesFrom.get(fromId) ?? [];
    list.push(edge);
    this.edgesFrom.set(fromId, list);
  }
}
```

- [ ] **Step 1.2.4: Run test, verify it passes (4 tests)**

- [ ] **Step 1.2.5: Commit**

```bash
cd packages/agentos
git add src/memory/retrieval/typed-network/TypedNetworkStore.ts src/memory/retrieval/typed-network/__tests__/TypedNetworkStore.test.ts
# Wait for approval; if approved:
# git commit -m "feat(memory/typed-network): in-memory 4-bank store + bidirectional edges"
```

### Task 1.3: TDD `TemporalIntervalOverlap.ts`

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/TemporalIntervalOverlap.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/__tests__/TemporalIntervalOverlap.test.ts`

- [ ] **Step 1.3.1: Write failing test**

```ts
// TemporalIntervalOverlap.test.ts
import { describe, it, expect } from 'vitest';
import { rankByTemporalOverlap } from '../TemporalIntervalOverlap.js';
import type { TypedFact } from '../types.js';

const make = (id: string, start: string, end: string): TypedFact => ({
  id,
  bank: 'WORLD',
  text: id,
  embedding: [],
  temporal: { start, end, mention: start },
  participants: [],
  reasoningMarkers: [],
  entities: [],
  confidence: 1.0,
});

describe('rankByTemporalOverlap', () => {
  it('ranks facts that overlap query timestamp higher', () => {
    const facts: TypedFact[] = [
      make('a', '2026-01-01', '2026-01-31'),
      make('b', '2026-04-01', '2026-04-30'),
      make('c', '2026-03-01', '2026-05-31'),
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15');
    expect(ranked[0].id).toBe('b'); // tightest overlap
    expect(ranked[1].id).toBe('c'); // wider overlap
    expect(ranked[2].id).toBe('a'); // no overlap
  });

  it('handles facts without temporal range (mention only)', () => {
    const facts: TypedFact[] = [
      { ...make('a', '', ''), temporal: { mention: '2026-01-01' } },
      { ...make('b', '', ''), temporal: { mention: '2026-04-15' } },
    ];
    const ranked = rankByTemporalOverlap(facts, '2026-04-15');
    expect(ranked[0].id).toBe('b'); // exact match on mention
  });
});
```

- [ ] **Step 1.3.2-1.3.5: Implement, run, verify, commit (same pattern)**

```ts
// TemporalIntervalOverlap.ts
import type { TypedFact } from './types.js';

export function rankByTemporalOverlap(
  facts: TypedFact[],
  queryTimestamp: string,
): TypedFact[] {
  const queryMs = Date.parse(queryTimestamp);
  if (Number.isNaN(queryMs)) return [...facts];

  const scored = facts.map((f) => ({
    fact: f,
    score: scoreOverlap(f, queryMs),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.fact);
}

function scoreOverlap(fact: TypedFact, queryMs: number): number {
  const start = fact.temporal.start ? Date.parse(fact.temporal.start): NaN;
  const end = fact.temporal.end ? Date.parse(fact.temporal.end): NaN;
  const mention = Date.parse(fact.temporal.mention);

  if (!Number.isNaN(start) && !Number.isNaN(end)) {
    if (queryMs >= start && queryMs <= end) {
      // Inside the interval; tighter intervals score higher
      const width = Math.max(1, end - start);
      return 1.0 / (1 + width / 86_400_000);
    }
    // Outside: distance penalty
    const dist = Math.min(Math.abs(queryMs - start), Math.abs(queryMs - end));
    return 1.0 / (1 + dist / 86_400_000);
  }

  // Fallback: distance from mention timestamp
  const dist = Math.abs(queryMs - mention);
  return 1.0 / (1 + dist / 86_400_000);
}
```

Run + commit per pattern.

---

## Phase 2: TypedNetworkObserver (LLM extraction) (2 days, $1)

### Task 2.1: Write the extraction prompt + zod schema

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/prompts/extraction-prompt.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/prompts/extraction-schema.ts`

- [ ] **Step 2.1.1: Author the prompt verbatim from spec §6**

```ts
// extraction-prompt.ts
export const TYPED_EXTRACTION_SYSTEM_PROMPT = `You are an information extractor for a typed memory network. Process the conversation below into structured facts.

For each fact, perform these six steps:

1. COREFERENCE: resolve "he/she/they/it/this/that" to the actual referent.
2. TEMPORAL: normalize times to ISO 8601. Extract ranges as (start, end) when applicable.
3. PARTICIPANTS: list every named participant and their role.
4. REASONING: preserve any explicit reasoning marker (because, since, therefore, etc.) verbatim.
5. FACT TYPE: classify into ONE of:
   - WORLD: objective facts about the external world
   - EXPERIENCE: biographical / first-person events
   - OPINION: claims with confidence < 1.0
   - OBSERVATION: preference-neutral summaries of entities
6. ENTITIES: list every named entity (proper nouns, organizations, places, products).

Output JSON matching the schema strictly. Do not add commentary.`;

export function buildExtractionUserPrompt(sessionText: string): string {
  return `CONVERSATION:\n<<<\n${sessionText}\n>>>`;
}
```

- [ ] **Step 2.1.2: Author the zod schema**

```ts
// extraction-schema.ts
import { z } from 'zod';

export const TypedExtractionSchema = z.object({
  facts: z.array(
    z.object({
      text: z.string().min(1),
      bank: z.enum(['WORLD', 'EXPERIENCE', 'OPINION', 'OBSERVATION']),
      temporal: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
        mention: z.string(),
      }),
      participants: z.array(
        z.object({ name: z.string(), role: z.string() }),
      ),
      reasoning_markers: z.array(z.string()),
      entities: z.array(z.string()),
      confidence: z.number().min(0).max(1).default(1.0),
    }),
  ),
});

export type TypedExtractionOutput = z.infer<typeof TypedExtractionSchema>;
```

### Task 2.2: TDD `TypedNetworkObserver.ts`

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/TypedNetworkObserver.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/__tests__/TypedNetworkObserver.test.ts`

- [ ] **Step 2.2.1: Write failing test (mocked LLM)**

```ts
// TypedNetworkObserver.test.ts
import { describe, it, expect } from 'vitest';
import { TypedNetworkObserver } from '../TypedNetworkObserver.js';

describe('TypedNetworkObserver', () => {
  it('parses LLM output into TypedFact[]', async () => {
    const mockLlm = async () => JSON.stringify({
      facts: [{
        text: 'Berlin is in Germany',
        bank: 'WORLD',
        temporal: { mention: '2026-04-26' },
        participants: [],
        reasoning_markers: [],
        entities: ['Berlin', 'Germany'],
        confidence: 1.0,
      }],
    });
    const obs = new TypedNetworkObserver({ llm: { invoke: mockLlm } });
    const facts = await obs.extract('User: Where is Berlin? Assistant: In Germany.', 'session-1');
    expect(facts).toHaveLength(1);
    expect(facts[0].bank).toBe('WORLD');
    expect(facts[0].entities).toContain('Berlin');
    expect(facts[0].id).toMatch(/^session-1/);
  });

  it('throws on invalid LLM output (zod validation)', async () => {
    const mockLlm = async () => '{"facts": [{"text": ""}]}'; // missing required fields
    const obs = new TypedNetworkObserver({ llm: { invoke: mockLlm } });
    await expect(obs.extract('blah', 'session-2')).rejects.toThrow();
  });
});
```

- [ ] **Step 2.2.2: Implement**

```ts
// TypedNetworkObserver.ts
import { TypedExtractionSchema } from './prompts/extraction-schema.js';
import {
  TYPED_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from './prompts/extraction-prompt.js';
import type { TypedFact } from './types.js';

export interface ITypedExtractionLLM {
  invoke(args: { system: string; user: string; maxTokens: number; temperature: number }): Promise<string>;
}

export class TypedNetworkObserver {
  constructor(private readonly opts: { llm: ITypedExtractionLLM }) {}

  async extract(sessionText: string, sessionId: string): Promise<TypedFact[]> {
    const raw = await this.opts.llm.invoke({
      system: TYPED_EXTRACTION_SYSTEM_PROMPT,
      user: buildExtractionUserPrompt(sessionText),
      maxTokens: 4096,
      temperature: 0,
    });
    const parsed = TypedExtractionSchema.parse(JSON.parse(raw));
    return parsed.facts.map((f, idx) => ({
      id: `${sessionId}-fact-${idx}`,
      bank: f.bank,
      text: f.text,
      embedding: [], // populated by IEmbeddingManager downstream
      temporal: f.temporal,
      participants: f.participants,
      reasoningMarkers: f.reasoning_markers,
      entities: f.entities,
      confidence: f.confidence,
    }));
  }
}
```

- [ ] **Step 2.2.3: Run + commit**

### Task 2.3: 5-case smoke run with real LLM

- [ ] **Step 2.3.1: Get user approval ($1 spend)**

> "Smoke test of TypedNetworkObserver with real gpt-5-mini on 5 LongMemEval-S sessions, ~$1. Approve?"

- [ ] **Step 2.3.2: Run smoke script**

Create `packages/agentos-bench/src/scripts/smoke-typed-network-observer.ts`:

```ts
// Loads 5 cases from LongMemEval-S, runs TypedNetworkObserver on each,
// pretty-prints the extracted facts, asserts that every case produces ≥ 1 fact
// per bank (or documents which banks are empty).
```

```bash
cd packages/agentos-bench
pnpm exec tsx src/scripts/smoke-typed-network-observer.ts --n 5 --observer gpt-5-mini
```

Expected: $1, 5+ facts per case, even bank distribution (or documented imbalance).

---

## Phase 3: TypedSpreadingActivation + FourWayRrf (2 days, $0)

### Task 3.1: TDD `TypedSpreadingActivation.ts`

Per spec §2.4.1 Eq. 12. Implementation should match the reference `SpreadingActivation` pattern but with typed-edge multipliers `μ(ℓ)`.

- [ ] **Step 3.1.1: Write failing test for Eq. 12 numerics**

```ts
// TypedSpreadingActivation.test.ts
import { describe, it, expect } from 'vitest';
import { TypedSpreadingActivation } from '../TypedSpreadingActivation.js';
import { TypedNetworkStore } from '../TypedNetworkStore.js';
import type { TypedFact } from '../types.js';

const makeFact = (id: string, bank: 'WORLD' = 'WORLD'): TypedFact => ({
  id, bank, text: id, embedding: [], temporal: { mention: '2026-04-26' },
  participants: [], reasoningMarkers: [], entities: [], confidence: 1.0,
});

describe('TypedSpreadingActivation Eq. 12', () => {
  it('seeds activate at 1.0', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    expect(result.get('a')).toBe(1.0);
  });

  it('typed-edge multiplier μ scales the activation', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    // entity edges have μ = 1.0 (paper); decay δ = 0.5
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    // a=1.0 (seed), b = 1.0 * 1.0 * 0.5 * 1.0 = 0.5
    expect(result.get('b')).toBe(0.5);
  });

  it('temporal edges use the cited multiplier', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'temporal', weight: 0.8 });
    const act = new TypedSpreadingActivation({ decay: 0.5, edgeMultipliers: { temporal: 0.7, semantic: 0.6, entity: 1.0, causal: 1.0 } });
    const result = act.spread(store, ['a'], { maxDepth: 3 });
    // b = 1.0 * 0.8 (edge weight) * 0.5 (decay) * 0.7 (μ for temporal) = 0.28
    expect(result.get('b')).toBeCloseTo(0.28, 5);
  });

  it('respects maxDepth cutoff', () => {
    const store = new TypedNetworkStore();
    store.addFact(makeFact('a'));
    store.addFact(makeFact('b'));
    store.addFact(makeFact('c'));
    store.addEdge({ fromFactId: 'a', toFactId: 'b', kind: 'entity', weight: 1.0 });
    store.addEdge({ fromFactId: 'b', toFactId: 'c', kind: 'entity', weight: 1.0 });
    const act = new TypedSpreadingActivation({ decay: 0.5 });
    const result = act.spread(store, ['a'], { maxDepth: 1 });
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(false); // depth 2, cutoff at 1
  });
});
```

- [ ] **Step 3.1.2: Implement (BFS with Eq. 12)**

```ts
// TypedSpreadingActivation.ts
import type { TypedNetworkStore } from './TypedNetworkStore.js';
import type { EdgeKind } from './types.js';

export interface TypedSpreadingActivationOptions {
  decay: number;
  edgeMultipliers?: Record<EdgeKind, number>;
}

const DEFAULT_MULTIPLIERS: Record<EdgeKind, number> = {
  temporal: 0.7,
  semantic: 0.6,
  entity: 1.0,
  causal: 1.0,
};

export class TypedSpreadingActivation {
  constructor(private readonly opts: TypedSpreadingActivationOptions) {}

  spread(
    store: TypedNetworkStore,
    seedIds: string[],
    options: { maxDepth: number; activationThreshold?: number },
  ): Map<string, number> {
    const μ = this.opts.edgeMultipliers ?? DEFAULT_MULTIPLIERS;
    const threshold = options.activationThreshold ?? 0.05;
    const activations = new Map<string, number>(seedIds.map((id) => [id, 1.0]));

    for (let depth = 0; depth < options.maxDepth; depth++) {
      const next = new Map<string, number>(activations);
      for (const [factId, currentAct] of activations) {
        for (const edge of store.getEdges(factId)) {
          const candidate = currentAct * edge.weight * this.opts.decay * μ[edge.kind];
          if (candidate < threshold) continue;
          // Eq. 12 uses max over incoming edges
          const existing = next.get(edge.toFactId) ?? 0;
          if (candidate > existing) next.set(edge.toFactId, candidate);
        }
      }
      // No change → break early
      if (next.size === activations.size && [...next.entries()].every(([k, v]) => activations.get(k) === v)) break;
      // Replace activations for next iteration
      for (const [k, v] of next) activations.set(k, v);
    }

    return activations;
  }
}
```

- [ ] **Step 3.1.3: Run + commit (4 tests pass)**

### Task 3.2: TDD `FourWayRrf.ts`

- [ ] **Step 3.2.1: Write failing test**

```ts
// FourWayRrf.test.ts
import { describe, it, expect } from 'vitest';
import { fourWayRrf } from '../FourWayRrf.js';

describe('fourWayRrf', () => {
  it('computes RRF score with k=60', () => {
    // Fact 'a' is rank 1 in semantic, rank 2 in BM25, rank 1 in graph, rank 1 in temporal
    // RRF(a) = 1/(60+1) + 1/(60+2) + 1/(60+1) + 1/(60+1) ≈ 4 * (1/61) - small correction
    const result = fourWayRrf({
      semantic: ['a', 'b', 'c'],
      bm25: ['b', 'a', 'c'],
      graphActivation: ['a', 'c', 'b'],
      temporalOverlap: ['a', 'b', 'c'],
    }, { k: 60 });
    expect(result[0]).toBe('a');
    expect(result.length).toBe(3);
  });

  it('handles facts present in only some rankings', () => {
    const result = fourWayRrf({
      semantic: ['a', 'b'],
      bm25: ['a'],
      graphActivation: [],
      temporalOverlap: ['b'],
    });
    // 'a' wins (in 2 strong rankings)
    expect(result[0]).toBe('a');
  });
});
```

- [ ] **Step 3.2.2: Implement**

```ts
// FourWayRrf.ts
export interface FourWayRrfInput {
  semantic: string[];
  bm25: string[];
  graphActivation: string[];
  temporalOverlap: string[];
}

export function fourWayRrf(
  input: FourWayRrfInput,
  options: { k?: number } = {},
): string[] {
  const k = options.k ?? 60;
  const scores = new Map<string, number>();

  for (const ranking of [input.semantic, input.bm25, input.graphActivation, input.temporalOverlap]) {
    ranking.forEach((id, idx) => {
      const rank = idx + 1;
      const contribution = 1.0 / (k + rank);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
```

- [ ] **Step 3.2.3: Run + commit**

---

## Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever (SHIPPED, no action)

Per the Status header, all of the following landed in agentos@0.4.0 (HEAD `230c6aea`) and the bench-side LongMemEvalS integration is uncommitted in another concurrent session's working tree:

- Phase 4.1 (`cac63c2`): `CognitiveMemoryConfig.typedNetwork` field + manager wiring + accessors `getTypedNetworkStore()` / `getTypedNetworkObserver()` / `getTypedNetworkSpreadingActivation()`
- Phase 4.2 (`a604d86`): `manager.encode()` calls observer.extract + addFact, errors logged via stderr
- Phase 4.3 (`d0ab11c5`): `manager.retrieve()` MVP runs spreading activation, surfaces top-10 facts via `diagnostics.retrievedTypedFacts` (no 4-way RRF; no composite score fusion)
- TypedNetworkRetriever (`230c6aea`): adapter producing `ScoredMemoryTrace[]` for the bench's canonical pool; `extractQueryEntities` + `typedFactToScoredTrace` helpers; 15 contract tests
- Bench wiring at `LongMemEvalS:1730-1762` (uncommitted): instantiates `TypedNetworkRetriever`, appends top-K typed traces to canonical pool

NO ACTION required in this plan for Phases 4.1-4.3 + adapter. The Phase 4c smoke and Phase A measurement run against this shipped option-B baseline.

---

## Phase 4.4 (CONDITIONAL escalation, gated on Phase 6): 4-way RRF + budget-split prompt blocks (2 days, $0)

Per spec §4.2.B + the d0ab11c5 commit message: "Phase 4.3 IS AN MVP. Fusion (4-way RRF + weighted merge with the existing scored list) lands in a follow-up iteration once Phase 4.4 wires the bench reader to consume typed facts directly."

Activated only if Phase 6 outcome is +0 to +2pp (Phase A on shipped option B does not clear the +2pp gate). Skipped if Phase A clears (proceed directly to Phase 7 / Phase B). Skipped if Phase A negatives below baseline (publish 3rd negative result, ship typed-network as opt-in primitive, abandon Phase 4.4).

### Task 4.4.1: Extend `TypedNetworkConfig` with Phase 4.4 fields

**Files:**
- Modify: `packages/agentos/src/memory/core/config.ts` (add `edgeMultipliers`, `rrfK`, `activationThreshold`, `budgetSplit`, `extractionMaxTokens`, `extractionTemperature`, `retrievalMode` fields per spec §4.2.1)

- [ ] **Step 4.4.1.1: TDD: write failing test for the extended config**

```ts
// packages/agentos/src/memory/__tests__/typed-network-config-v44.test.ts
import { describe, it, expect } from 'vitest';
import type { CognitiveMemoryConfig } from '../core/config.js';

describe('TypedNetworkConfig v3 + Phase 4.4 fields', () => {
  it('accepts the extended Phase 4.4 surface', () => {
    const cfg: Partial<CognitiveMemoryConfig> = {
      typedNetwork: {
        variant: 'full',
        observerLLM: { invoke: async () => '{"facts":[]}' },
        edgeMultipliers: { entity: 1, causal: 1, temporal: 0.7, semantic: 0.6 },
        rrfK: 60,
        activationThreshold: 0.05,
        budgetSplit: { traces: 0.5, typedFacts: 0.5 },
        extractionMaxTokens: 4096,
        extractionTemperature: 0,
        retrievalMode: 'budget-split',
      },
    };
    expect(cfg.typedNetwork?.retrievalMode).toBe('budget-split');
    expect(cfg.typedNetwork?.budgetSplit?.traces).toBe(0.5);
  });

  it('validates budgetSplit fractions sum to 1.0', () => {
    // The validator (introduced in Task 4.4.2) throws on bad budgetSplit
    // (e.g. {traces: 0.3, typedFacts: 0.5} = 0.8). Specific test runs in 4.4.2.
  });
});
```

- [ ] **Step 4.4.1.2: Implement extended fields per spec §4.2.1 Phase 4.4 additions block**

- [ ] **Step 4.4.1.3: Run test, expect PASS; commit (await user approval)**

### Task 4.4.2: Add `validateTypedNetworkConfig(cfg)` runtime validator

**Files:**
- Create: `packages/agentos/src/memory/retrieval/typed-network/validation.ts`
- Create: `packages/agentos/src/memory/retrieval/typed-network/__tests__/validation.test.ts`

- [ ] **Step 4.4.2.1: TDD: write failing test for validator**

Tests cover:
- `budgetSplit` fractions sum to 1.0 (within 1e-6 epsilon); throws `BudgetSplitError` otherwise
- `decay`, `activationThreshold`, `extractionTemperature` ∈ valid ranges
- `rrfK > 0`, `maxDepth >= 1`, `extractionMaxTokens >= 1`
- `retrievalMode` is one of the literal values

- [ ] **Step 4.4.2.2: Implement validator**

- [ ] **Step 4.4.2.3: Wire validator call into `manager.initialize()` when `config.typedNetwork` is set**

- [ ] **Step 4.4.2.4: Run tests, commit**

### Task 4.4.3: Replace seed-then-spread MVP with 4-signal RRF inside `manager.retrieve()`

**Files:**
- Modify: `packages/agentos/src/memory/CognitiveMemoryManager.ts` (replace lines ~777-813, the Phase 4.3 MVP block, with the 4-signal pipeline guarded by `retrievalMode === 'budget-split'`; preserve seed-then-spread MVP for `retrievalMode === 'pool-append'` back-compat)

- [ ] **Step 4.4.3.1: TDD: write failing test for 4-signal pipeline**

```ts
// packages/agentos/src/memory/__tests__/typed-network-retrieve-rrf.test.ts
describe('CognitiveMemoryManager.retrieve 4-way RRF (Phase 4.4)', () => {
  it('runs 4-signal RRF when retrievalMode=budget-split + variant=full', async () => {
    // Pre-populate store with 5 facts in different banks + entity overlaps.
    // Issue retrieve('Berlin docker'); expect diagnostics.retrievedTypedFacts
    // ordered by RRF fusion of (semantic, BM25, graph, temporal).
  });

  it('preserves shipped seed-then-spread MVP when retrievalMode=pool-append', async () => {
    // Same fixture. Verify back-compat behavior is unchanged.
  });

  it('minimal variant returns top-N by semantic only, both retrievalModes', async () => {
    // ...
  });
});
```

- [ ] **Step 4.4.3.2: Implement: add private helpers `rankBySemantic`, `rankByBm25` (in-memory), gate the new pipeline behind `config.typedNetwork?.retrievalMode === 'budget-split'`. Preserve the existing seed-then-spread block for the default `pool-append` mode.**

- [ ] **Step 4.4.3.3: Run tests, commit**

### Task 4.4.4: Bench formats `[Typed memory]` reader-prompt block

**Files:**
- Create: `packages/agentos-bench/src/benchmarks/longmemeval/formatTypedFactsBlock.ts` (helper)
- Modify: `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts` (gate `[Typed memory]` block behind `retrievalMode === 'budget-split'`; preserve TypedNetworkRetriever pool-append for `pool-append` mode)
- Create: `packages/agentos-bench/tests/formatTypedFactsBlock.spec.ts`

- [ ] **Step 4.4.4.1: TDD: write failing test for formatter**

Test cases:
- Formats facts as `- [BANK | confidence=N.NN] <text> (entities: ...; participants: ...; <ISO temporal>)`
- Truncates to a token budget (use existing token estimator if present; else `Math.floor(budget * 4)` chars)
- Empty facts → empty string
- Wraps in `[Typed memory]
<formatted>
[/Typed memory]` markers

- [ ] **Step 4.4.4.2: Implement the formatter**

- [ ] **Step 4.4.4.3: Wire bench reader prompt:**

When `config.typedNetwork?.retrievalMode === 'budget-split'`:
1. Skip the TypedNetworkRetriever pool-append at LongMemEvalS:1730-1762 (the other session's wiring)
2. Compute `tracesBudget = totalMemoryBudget * config.typedNetwork.budgetSplit.traces`
3. Compute `typedFactsBudget = totalMemoryBudget * config.typedNetwork.budgetSplit.typedFacts`
4. Truncate the existing trace context to `tracesBudget`
5. Append `formatTypedFactsBlock(retrieval.diagnostics.retrievedTypedFacts ?? [], typedFactsBudget)`

- [ ] **Step 4.4.4.4: Run bench tests, expect all pass + 3 new = 518 tests**

- [ ] **Step 4.4.4.5: Commit**

### Task 4.4.5: Re-run Phase 4c smoke at `--typed-network full --retrieval-mode budget-split`

Same procedure as the original Phase 4c (below), but with the Phase 4.4 path active. Verify:
- 4-way RRF fusion produces a different ranking than seed-then-spread MVP
- Reader prompt visibly contains `[Typed memory]` block
- Run JSON metadata reflects `stage-e-typed-network:full:retrieval-mode-budget-split:v44`

### Task 4.4.6: Re-run Phase A at `--typed-network full --retrieval-mode budget-split`

Same procedure as the original Phase 5 (below). Compare:
- Phase A result vs original Phase A on shipped option B
- Per-category breakdown (which categories benefit from RRF + budget-split)

If Phase A on Phase 4.4 clears +2pp gate, proceed to Phase B. If not, publish two negative-result paths (option B + option A) and ship both as opt-in primitives.

---

## Phase 4c: Smoke ($1-5, 30 min)

Gated on EXPLICIT user approval before run. Targets the SHIPPED option-B baseline (Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever pool-append). Re-run on Phase 4.4 path is Task 4.4.5 above (only if Phase 6 escalates).

### Task 4c.1: Pose to user

> "Stage E Phase 4c smoke: 6 LongMemEval-S cases (one per category) at `--typed-network full`, single seed, gpt-5-mini observer + gpt-4o reader. Estimated cost $1-5. Verifies typed facts extracted, spreading activation runs, TypedNetworkRetriever appends typed facts to canonical pool with `sourceType: 'typed_network'`, run JSON metadata reflects the `stage-e-typed-network:full:v1` cache fingerprint. Approve?"

### Task 4c.2: Run the smoke

- [ ] **Step 4c.2.1: Verify env keys**

```bash
grep -E "^OPENAI_API_KEY=" /Users/johnn/Documents/git/super-cloud-mcps/.env | head -1
# COHERE_API_KEY not required for smoke (no rerank); needed for Phase A.
```

- [ ] **Step 4c.2.2: Run with `--sample-per-type 1` (6 cases) for one per LongMemEval-S category**

```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm --dir packages/agentos-bench exec tsx src/cli.ts run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --typed-network full \
  --hybrid-retrieval \
  --sample-per-type 1 \
  --seed 42 \
  --concurrency 1
```

- [ ] **Step 4c.2.3: Verify the run JSON**

```bash
ls -lt packages/agentos-bench/results/runs/*--longmemeval-s--*--ingest.json | head -1
# In the latest, check:
# - totalUsd > 0 (fresh run, not full cache hit)
# - retrievedEvidence (or similar) contains entries with sourceType: 'typed_network'
# - case metadata contains entries with content prefixed `[WORLD]` / `[EXPERIENCE]` / etc.
# - cache fingerprint includes 'stage-e-typed-network:full:v1'
```

- [ ] **Step 4c.2.4: Document outcome**

Append to `packages/agentos-bench/docs/STAGE_E_PHASE_4C_SMOKE_<DATE>.md` (new doc):
- Cases run, totalUsd, accuracy (informational; smoke not statistically meaningful)
- Sample of typed facts extracted by `TypedNetworkObserver` per session
- Sample of spreading-activation result from `manager.retrieve()` `diagnostics.retrievedTypedFacts`
- Sample of `ScoredMemoryTrace[]` produced by `TypedNetworkRetriever` (note `[BANK]` content prefixes)
- Pass/fail per spec §8 smoke gate

- [ ] **Step 4c.2.5: If smoke passes, request Phase A approval**

```
"Stage E Phase 4c smoke passed. Approve $30 Phase A on LongMemEval-S N=54 stratified at minimal + full variants?"
```

- [ ] **Step 4c.2.6: If smoke fails, debug and re-run**

Fail signals: empty typedFacts, observer extraction errors, BM25 returning empty rankings on populated data, fused ranking collapsed to a single duplicated fact, etc.

---

## Phase 4d (parallel, optional): M-tuned Phase B at LongMemEval-M N=500 ($50, 1 day)

Independent of Stage E. Runs at the existing M-tuned config (`--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`) at full N=500 to ship a v2 publication data point regardless of Stage E outcome.

Gated on Cohere key + remote machine + explicit user approval.

### Task 4d.1: Pose to user

> "M-tuned Phase B: full N=500 on LongMemEval-M with `--rerank-candidate-multiplier 5 --reader-top-k 50 --hyde`. Estimated $50. Independent of Stage E; ships v2 publication data point either way. Requires Cohere key + remote 32 GB+ machine. Approve?"

### Task 4d.2: Verify Cohere key + machine

```bash
grep -E "^COHERE_API_KEY=" /Users/johnn/Documents/git/voice-chat-assistant/.env || echo "MISSING. surface to user"
# Check disk + RAM headroom on target machine
```

### Task 4d.3: Run

```bash
pnpm --dir packages/agentos-bench exec tsx src/cli.ts \
  --benchmark longmemeval-m \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --rerank cohere \
  --rerank-candidate-multiplier 5 \
  --reader-top-k 50 \
  --hyde \
  --seed 42 \
  --bootstrap-resamples 10000 \
  --concurrency 1
```

### Task 4d.4: Update LEADERBOARD + comparison-table with the Phase B number

Replace the M-tuned row's `_PENDING_` cells with the measured Phase B accuracy + 95% CI + per-category breakdown.

---

## Phase 5: Phase A measurement on LongMemEval-S (1 day, $30)

### Task 5.1: Get user approval ($30 spend)

- [ ] **Step 5.1.1: Pose to user**

> "Stage E Phase A: LongMemEval-S N=54 stratified at `--typed-network minimal` and `--typed-network full`. Two runs at ~$15 each = $30 total. Tier 3 min-cost baseline is 76.6%, decision gate is ≥ 78.6% point estimate to proceed to Phase B. Approve?"

### Task 5.2: Run Phase A at `--typed-network minimal`

- [ ] **Step 5.2.1: Run**

```bash
NODE_OPTIONS="--max-old-space-size=8192" pnpm --dir packages/agentos-bench exec tsx src/cli.ts run longmemeval-s \
  --reader gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --typed-network minimal \
  --hybrid-retrieval \
  --rerank cohere \
  --reader-top-k 20 \
  --sample-per-type 9 \
  --seed 42 \
  --bootstrap-resamples 10000 \
  --concurrency 1
```

- [ ] **Step 5.2.2: Verify totalUsd > 0 (fresh run)**

### Task 5.3: Run Phase A at `--typed-network full`

- [ ] **Step 5.3.1: Run (same command, swap `minimal` for `full`)**

### Task 5.4: Decision gate (spec §8)

- [ ] **Step 5.4.1: Compare against baseline**

```bash
jq '.accuracy' packages/agentos-bench/results/runs/<typed-network minimal Phase A summary>
jq '.accuracy' packages/agentos-bench/results/runs/<typed-network full Phase A summary>
# Baseline: 76.6% (Tier 3 min-cost on LongMemEval-S Phase B)
```

Decision rule (per spec §8 v3):
- **Either variant ≥ 78.6%**: proceed to Phase 6 (Phase B) at the higher one. Skip Phase 4.4.
- **Best variant +0 to +2pp (i.e. 76.6%-78.6%)**: ESCALATE to Phase 4.4 (4-way RRF + budget-split). Implement Phase 4.4 per Tasks 4.4.1-4.4.4 above, run smoke (Task 4.4.5), then re-run Phase A (Task 4.4.6). If the Phase 4.4 Phase A clears 78.6%, proceed to Phase 6. If not, publish two-path negative result and ship typed-network as opt-in primitive.
- **Best variant ≤ baseline**: HALT. Publish as third negative result, ship typed-network primitives as opt-in core (already shipped). Abandon Phase 4.4 + Phase B.

- [ ] **Step 5.4.2: Document Phase A findings**

Create `packages/agentos-bench/docs/STAGE_E_PHASE_A_FINDINGS_<DATE>.md` mirroring the Stage L / Stage I findings doc structure. Include: setup, results (both variants), per-category breakdown, comparison vs baseline, decision gate outcome, what to do next.

---

## Phase 7: Phase B (full N) on each benchmark (2 days, $290, only if Phase A or Phase 4.4 Phase A passes)

(Numbering matches spec §5 Phase 7. Plan v2 had this as Phase 6; renumbered in v3 for consistency with the spec.)

### Task 7.1: Get explicit user approval ($290 spend)

### Task 7.2: Run Phase B on LongMemEval-S N=500

### Task 7.3: Run Phase B on LongMemEval-M N=500

### Task 7.4: Run Phase B on LOCOMO N=1986

### Task 7.5: Document Phase B findings + LEADERBOARD update + spec revision

(Detailed sub-steps mirror v1 publication plan Phase 5 LEADERBOARD update.)

### Task 7.6: Locomo adapter mirror

Add typed-network retrieval integration to `packages/agentos-bench/src/benchmarks/locomo/Locomo.ts`, mirroring LongMemEvalS:1730-1762 (TypedNetworkRetriever pool-append) plus, if Phase 4.4 was activated, the budget-split formatter wiring.

---

## Phase 8: v2 Publication (1 day, $0)

If Phase B successful:

### Task 7.1: Write v2 publication blog post

**Files:**
- Create: `apps/agentos-live-docs/blog/2026-05-XX-stage-e-hindsight-typed-network.md`

Outline (1500-2500 words):
1. The setup, v1 baseline (76.6% / 51.5% / 30.6%)
2. Why we needed Stage E, Stage L + Stage I both negative; precision-bound categories at M scale
3. The 4 typed networks, World, Experience, Opinion, Observation (verbatim from Hindsight paper)
4. The 6-step extraction pipeline + JSON schema
5. The retrieval, typed spreading activation + 4-way RRF
6. Phase A → Phase B, the decision gate + measurements
7. Comparison vs Hindsight (vendor-bias caveat: Gemini judge)
8. What this means: third negative result OR new shipping default OR new opt-in tier (depends on Phase B)

### Task 7.2: Cross-link with v1 publication and findings docs

---

## Self-review checklist (v3)

1. **Spec coverage**: every spec §4-§10 deliverable maps to a plan task. Phases 1-3 + 4.1-4.3 + TypedNetworkRetriever shipped (no plan action). Phase 4c smoke + Phase 5 Phase A + Phase 6 decision (in Task 5.4) + Phase 7 Phase B + Phase 8 publication remaining. Phase 4.4 (4-way RRF + budget-split) is conditional on Phase 6 outcome.
2. **No placeholders**: no `<FILL>` markers, no `TBD`. The phase status table uses TODO/OPTIONAL/DONE explicitly.
3. **TDD discipline**: Phases 1-3 + 4.1-4.3 + TypedNetworkRetriever followed failing-test-first (shipped, 75 tests). Phase 4.4 tasks 4.4.1 / 4.4.2 / 4.4.3 / 4.4.4 each have a failing-test step BEFORE the implementation step. Phase 4c smoke + Phase 5 Phase A are verification-only (no new code).
4. **Cost tracked**: shipped ($0) + 4c ($1-5) + 4d ($50, optional) + 5 ($30) + 4.4 ($0 + extra Phase A re-measure $30 if escalated) + 7 ($290) = $321-406. Cushion to $500-800.
5. **Constraints honored**: no commits without user approval, no subagents, no worktrees with submodules, no AI in commit messages, no em dashes (verified via grep), agentos commits in submodule then bump pointer in monorepo with `--no-verify`.
6. **Verification before completion**: every Phase 5/7 run has totalUsd > 0 check; Phase 4c smoke has explicit verification of typed-fact extraction + spreading-activation result + TypedNetworkRetriever pool-append visibility in run JSON.
7. **Decision gate enforced**: Phase 4c → Phase 5 gated on smoke pass. Phase 5 → {Phase 7, Phase 4.4 escalation, halt} gated on Phase A point estimate per spec §8 v3. Phase 4.4 → Phase 7 gated on Phase 4.4 Phase A re-measure ≥ 78.6%. Phase 7 → opt-in ship gated on aggregate ≥ 78.6% with CI lower bound ≥ 76.6%. Opt-in → flip-default gated on Pareto-dominance over Tier 3 min-cost on ≥ 3 of 6 categories AND cost-per-correct ≤ $0.0580.
8. **Universal-default policy**: typed-network OFF by default until both flip-default criteria pass at Phase 7. Today's Tier 3 min-cost (76.6% LongMemEval-S) shipping default unchanged.
9. **Embedder coherence**: shipped Phase 4.2 + Phase 4.4 retrieval inherit the manager's `IEmbeddingManager` for typed-fact embeddings. No separate embedder configuration footgun.
10. **Concurrent-session safety**: this plan does NOT touch files owned by the other concurrent session (LongMemEvalS:1730-1762, v4 handoff, LEADERBOARD, comparison-table) until those are committed. Phase 4.4 Task 4.4.4 will modify LongMemEvalS but only after the other session lands their changes.

---

## Open decisions for the user (ask before starting)

The shipped state (Phase 4.1, 4.2, 4.3 + TypedNetworkRetriever + bench retrieval pool-append) is the option-B baseline. Live decisions for v3:

1. **Phase 4c smoke**: $1-5 spend, 6 cases (one per LongMemEval-S category) at `--typed-network full`. Approve to run as soon as the other concurrent session commits their bench-side LongMemEvalS changes?
2. **Phase 4d M-tuned parallel run**: $50 at Cohere key + remote machine. Independent of Stage E; ships v2 publication data point regardless of Stage E outcome. Run now (after Cohere key in env), after Phase 4c, or skip?
3. **Phase 5 Phase A**: $30 LongMemEval-S N=54 stratified at `--typed-network minimal` and `--typed-network full`. Approve when 4c smoke passes? (Requires Cohere key.)
4. **Phase 4.4 escalation**: pre-approve the 4-way RRF + budget-split implementation if Phase A on shipped option B is +0 to +2pp? Or pause for re-approval at Phase 5.4 decision gate?
5. **Observer-model ablation**: gpt-5-mini default. Add gpt-4o ablation at +$200 if Phase A negatives at gpt-5-mini? (Default: yes, cheaper to find out at Phase A than at Phase 7.)
6. **CharHash vs OpenAI embedder**: typed-fact embeddings inherit the manager's embedder per spec §4.2.2. Phase A primary at CharHash (shipping config); paired OpenAI ablation at +$10 if Phase A negatives. Approve the conditional ablation?

---

## End of plan
