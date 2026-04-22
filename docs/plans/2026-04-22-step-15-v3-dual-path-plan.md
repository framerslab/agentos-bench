# Step 15 v3 Implementation Plan — Dual-Path Observer

> Execute inline via `superpowers:executing-plans`. No subagents. No worktrees (monorepo has submodules).

**Goal:** Run the Observer per-session AND in 24k-token batches in parallel, concatenate both observation logs into the reader's context. Restores v1 per-session fidelity while keeping v2 cross-session encoding.

**Architecture:** Single `ingestSessions` accepts `omMode: 'per-session' | 'batched' | 'dual-path'`. Default `dual-path` runs both passes through a shared worker pool at concurrency 6. Three-value mode fingerprint in cache.

**Tech Stack:** Same as v2. No new deps. Observer stays `gpt-5-mini`. Build-from-source TypeScript.

**Design:** [docs/specs/2026-04-22-step-15-v3-dual-path-observer-design.md](../specs/2026-04-22-step-15-v3-dual-path-observer-design.md).

**Commits:** Only when user approves. Proposed set at end of this plan.

---

## File map

| File | Change |
|---|---|
| `src/observational-memory/runner.ts` | Add `OmIngestMode` type; extend `IngestSessionsArgs.omMode`; split `ingestSessions` into per-session pass, batched pass, dual-path coordinator with section headers; update `OmIngestResult`. |
| `src/core/IBenchmark.ts` | Add `OmIngestMode` export + `RunConfig.omMode?: OmIngestMode` + include in `BenchContext['config']` Pick. |
| `src/core/BenchmarkRunner.ts` | Propagate `omMode` in `resolveRunConfig`. Replace `step-15-om-batching:v2:{target}` tag with `step-15-om-config:{mode}:{target}`. |
| `src/cli.ts` | Add `--om-mode <mode>` option with allowlist validator. Wire `opts.omMode` → `runConfig.omMode`. |
| `src/benchmarks/longmemeval/LongMemEvalS.ts` | Pass `omMode: ctx.config.omMode ?? 'dual-path'` to `ingestSessions`. Record in per-case metadata. |
| `tests/observationalMemory.unit.spec.ts` | Add 7 unit tests (dual-path / per-session / batched modes + header structure). |
| `tests/step15ObservationalMemory.wiring.spec.ts` | Add 5 wiring tests (mode threading + fingerprint). Update 1 existing test for tag name change. |

---

## Task 0: Baseline

- [ ] **Step 1: Clean git state + 32 OM tests pass**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && \
  pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts && \
  pnpm typecheck
```
Expected: `Tests 32 passed (32)`, typecheck exit 0.

---

## Task 1: Add `OmIngestMode` type + runner branching

**Files:** `src/observational-memory/runner.ts`, `tests/observationalMemory.unit.spec.ts`

**Context:** Introduce the 3-mode switch. `per-session` mode restores v1; `batched` mode keeps v2; `dual-path` mode runs both. Export the type so it can be imported by `IBenchmark.ts`.

- [ ] **Step 1: Write the 3 failing mode-branching tests**

Append to `tests/observationalMemory.unit.spec.ts` after the `describe('ingestSessions — batched observer calls', ...)` block:

```typescript
describe('ingestSessions — mode: per-session (v1 restoration)', () => {
  it('invokes observer once per session and emits no cross-session header', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: `fact ${i}` }],
    }));
    const responses = Array.from({ length: 10 }, () =>
      mkResponse('<observations>\n* 🔴 per-session fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'per-session',
      observerConcurrency: 1,
    });
    expect(reader.calls).toHaveLength(5);
    expect(result.finalLog).not.toContain('## Cross-session patterns');
    expect(result.finalLog).not.toContain('## Per-session observations');
  });
});

describe('ingestSessions — mode: batched (v2 preservation)', () => {
  it('invokes observer once per batch with default 24k target', async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const responses = Array.from({ length: 25 }, () =>
      mkResponse('<observations>\n* 🔴 batched fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'batched',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    expect(reader.calls.length).toBeGreaterThan(1);
    expect(reader.calls.length).toBeLessThan(sessions.length);
    expect(result.finalLog).not.toContain('## Per-session observations');
    expect(result.finalLog).not.toContain('## Cross-session patterns');
  });
});

describe('ingestSessions — mode: dual-path (v3 default)', () => {
  it('invokes observer per-session AND per-batch, emits both section headers', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    // 5 per-session calls + some batched calls. Over-provision responses.
    const responses = Array.from({ length: 20 }, () =>
      mkResponse('<observations>\n* 🔴 fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'dual-path',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    // Per-session pass = 5 calls. Batched pass over ~100k tokens at 24k target = ~5 batches.
    // Total calls should be roughly per-session count + batch count.
    expect(reader.calls.length).toBeGreaterThanOrEqual(sessions.length);
    expect(result.finalLog).toContain('## Per-session observations');
    expect(result.finalLog).toContain('## Cross-session patterns');
  });

  it('sums observer tokens across both passes', async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const responses = Array.from({ length: 10 }, () =>
      mkResponse('<observations>\n* 🔴 fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'dual-path',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    // Per call: tokensIn=1000, tokensOut=200. Total should be calls × those values.
    expect(result.observerTokensIn).toBe(reader.calls.length * 1000);
    expect(result.observerTokensOut).toBe(reader.calls.length * 200);
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm vitest run tests/observationalMemory.unit.spec.ts -t "mode:" 2>&1 | tail -15
```
Expected: FAIL on `omMode` not existing in `IngestSessionsArgs` (TS error) or mode branches not implemented.

- [ ] **Step 3: Implement the mode branching in `runner.ts`**

Update `IngestSessionsArgs` to include `omMode`:

```typescript
export type OmIngestMode = 'per-session' | 'batched' | 'dual-path';

export interface IngestSessionsArgs {
  observerReader: IReader;
  sessions: readonly OmSession[];
  reflectionTokenThreshold?: number;
  observerConcurrency?: number;
  batchTokenTarget?: number;
  /**
   * Step 15 v3: ingest mode.
   * - per-session: one Observer call per session (v1 semantics).
   * - batched: one Observer call per token-bounded batch (v2 semantics).
   * - dual-path: BOTH per-session and batched passes run in parallel,
   *   logs concatenated into the reader's context (v3 default).
   * Default: 'dual-path'.
   */
  omMode?: OmIngestMode;
}
```

Rewrite the `ingestSessions` body to split the observer work into two helpers and a dispatcher:

```typescript
async function runPerSessionPass(
  observerReader: IReader,
  sessions: readonly OmSession[],
  observerConcurrency: number,
): Promise<{ batches: OmObservationBatch[]; tokensIn: number; tokensOut: number }> {
  const batches: OmObservationBatch[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const queue = [...sessions];
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, observerConcurrency);
  const slot = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      try {
        const batch = await runObserverOnSession({ reader: observerReader, session: next });
        batches.push(batch);
        tokensIn += batch.tokensIn;
        tokensOut += batch.tokensOut;
      } catch {
        // Skip failed session.
      }
    }
  };
  for (let i = 0; i < limit; i++) workers.push(slot());
  await Promise.all(workers);
  return { batches, tokensIn, tokensOut };
}

async function runBatchedPass(
  observerReader: IReader,
  sessions: readonly OmSession[],
  batchTokenTarget: number,
  observerConcurrency: number,
): Promise<{ batches: OmObservationBatch[]; tokensIn: number; tokensOut: number }> {
  const partitions = partitionSessionsIntoBatches(sessions, batchTokenTarget);
  const batches: OmObservationBatch[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const queue = [...partitions];
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, observerConcurrency);
  const slot = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || next.length === 0) continue;
      try {
        const batch = await runObserverOnBatch({ reader: observerReader, batch: next });
        batches.push(batch);
        tokensIn += batch.tokensIn;
        tokensOut += batch.tokensOut;
      } catch {
        // Skip failed batch.
      }
    }
  };
  for (let i = 0; i < limit; i++) workers.push(slot());
  await Promise.all(workers);
  return { batches, tokensIn, tokensOut };
}

function concatenateBlocks(batches: OmObservationBatch[]): string {
  const blocks: string[] = [];
  for (const batch of batches) {
    const inner = extractObservationsBlock(batch.rawOutput);
    blocks.push(inner ?? stripWrappers(batch.rawOutput));
  }
  return blocks.join('\n\n');
}

export async function ingestSessions(args: IngestSessionsArgs): Promise<OmIngestResult> {
  const {
    observerReader,
    sessions,
    reflectionTokenThreshold = OM_DEFAULTS.reflection.observationTokens,
    observerConcurrency = 6,
    batchTokenTarget = 24_000,
    omMode = 'dual-path',
  } = args;

  let perSessionBatches: OmObservationBatch[] = [];
  let batchedBatches: OmObservationBatch[] = [];
  let observerTokensIn = 0;
  let observerTokensOut = 0;

  if (omMode === 'per-session') {
    const r = await runPerSessionPass(observerReader, sessions, observerConcurrency);
    perSessionBatches = r.batches;
    observerTokensIn += r.tokensIn;
    observerTokensOut += r.tokensOut;
  } else if (omMode === 'batched') {
    const r = await runBatchedPass(observerReader, sessions, batchTokenTarget, observerConcurrency);
    batchedBatches = r.batches;
    observerTokensIn += r.tokensIn;
    observerTokensOut += r.tokensOut;
  } else {
    // dual-path: run both in parallel through independent worker pools,
    // each at the full concurrency so total wall time stays near either
    // single-pass mode. Total inflight peak = observerConcurrency × 2.
    const [perSession, batched] = await Promise.all([
      runPerSessionPass(observerReader, sessions, observerConcurrency),
      runBatchedPass(observerReader, sessions, batchTokenTarget, observerConcurrency),
    ]);
    perSessionBatches = perSession.batches;
    batchedBatches = batched.batches;
    observerTokensIn = perSession.tokensIn + batched.tokensIn;
    observerTokensOut = perSession.tokensOut + batched.tokensOut;
  }

  const perSessionLog = perSessionBatches.length > 0 ? concatenateBlocks(perSessionBatches) : '';
  const batchedLog = batchedBatches.length > 0 ? concatenateBlocks(batchedBatches) : '';

  let consolidatedLog: string;
  if (omMode === 'dual-path') {
    consolidatedLog = `## Per-session observations\n\n${perSessionLog}\n\n## Cross-session patterns\n\n${batchedLog}`;
  } else if (omMode === 'per-session') {
    consolidatedLog = perSessionLog;
  } else {
    consolidatedLog = batchedLog;
  }

  const reflections: OmReflectionResult[] = [];
  let reflectorTokensIn = 0;
  let reflectorTokensOut = 0;

  if (approxTokens(consolidatedLog) > reflectionTokenThreshold) {
    try {
      const reflection = await runReflectorOnLog({
        reader: observerReader,
        observationLog: consolidatedLog,
      });
      reflections.push(reflection);
      reflectorTokensIn += reflection.tokensIn;
      reflectorTokensOut += reflection.tokensOut;
      const reflectedInner = extractObservationsBlock(reflection.rawOutput);
      consolidatedLog = reflectedInner ?? stripWrappers(reflection.rawOutput);
    } catch {
      // Keep raw log.
    }
  }

  // Legacy `observationBatches` alias: whichever pass fired, or both
  // concatenated for dual-path, so downstream code relying on this
  // field (metrics, metadata) doesn't break.
  const observationBatches: OmObservationBatch[] = [...perSessionBatches, ...batchedBatches];

  return {
    observationBatches,
    perSessionBatches,
    batchedBatches,
    reflections,
    finalLog: consolidatedLog,
    observerTokensIn,
    observerTokensOut,
    reflectorTokensIn,
    reflectorTokensOut,
  };
}
```

Update `OmIngestResult`:

```typescript
export interface OmIngestResult {
  /** Combined observer batches from all passes (per-session + batched). */
  observationBatches: OmObservationBatch[];
  /** Per-session pass output only. Empty when omMode is 'batched'. */
  perSessionBatches: OmObservationBatch[];
  /** Batched pass output only. Empty when omMode is 'per-session'. */
  batchedBatches: OmObservationBatch[];
  reflections: OmReflectionResult[];
  finalLog: string;
  observerTokensIn: number;
  observerTokensOut: number;
  reflectorTokensIn: number;
  reflectorTokensOut: number;
}
```

- [ ] **Step 4: Run tests GREEN**

```bash
pnpm vitest run tests/observationalMemory.unit.spec.ts -t "mode:" 2>&1 | tail -12
```
Expected: `Tests 4 passed (4)`.

- [ ] **Step 5: Regression — update v2 tests for mode shape if needed**

Run full OM suite:

```bash
pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts 2>&1 | tail -12
```

Expected: `Tests 36 passed (36)` (32 existing + 4 new). If any existing test breaks on `observationBatches` length expectations, the legacy alias (`observationBatches = [...perSessionBatches, ...batchedBatches]`) preserves the old behavior. Existing `happy path`, `reflection trigger`, and `observer failure tolerance` tests use `batchTokenTarget: 1` which falls into the batched path by default; they should still pass without modification.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```
Expected: exit 0.

---

## Task 2: Thread `omMode` through RunConfig

**Files:** `src/core/IBenchmark.ts`, `src/core/BenchmarkRunner.ts`, `tests/step15ObservationalMemory.wiring.spec.ts`

- [ ] **Step 1: Write 2 failing wiring tests**

Append to `tests/step15ObservationalMemory.wiring.spec.ts` after the existing `describe('Step 15 v2 batching: RunConfig threading', ...)`:

```typescript
describe('Step 15 v3 mode: RunConfig threading', () => {
  it('preserves explicit omMode: dual-path', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omMode: 'dual-path',
    } as RunConfig);
    expect(cfg.omMode).toBe('dual-path');
  });

  it('preserves explicit omMode: per-session', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omMode: 'per-session',
    } as RunConfig);
    expect(cfg.omMode).toBe('per-session');
  });
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL on `omMode` not in `RunConfig`.

- [ ] **Step 3: Implement**

In `src/core/IBenchmark.ts`, add after `omBatchTokenTarget?: number`:

```typescript
/**
 * Step 15 v3: observer ingest mode.
 * - per-session: one call per session (v1 behavior).
 * - batched: one call per 24k-token batch (v2 behavior).
 * - dual-path: both passes in parallel, logs concatenated (v3 default).
 */
omMode?: OmIngestMode;
```

Export the type at top of `IBenchmark.ts`:

```typescript
export type OmIngestMode = 'per-session' | 'batched' | 'dual-path';
```

Include `'omMode'` in both `Pick<>` clauses of `BenchContext['config']` (both the `Omit` and the `Pick` lists around lines 483 and 519 — same pattern as `omBatchTokenTarget`).

In `src/core/BenchmarkRunner.ts`, add after `omBatchTokenTarget`:

```typescript
// Step-15 v3: observer ingest mode (per-session | batched | dual-path).
omMode: cfg.omMode,
```

- [ ] **Step 4: Run GREEN**

Expected: 2 passed.

- [ ] **Step 5: Typecheck + regression**

```bash
pnpm typecheck && \
  pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts 2>&1 | tail -10
```
Expected: 38/38 passed.

---

## Task 3: Update cache fingerprint to `step-15-om-config:{mode}:{target}`

**Files:** `src/core/BenchmarkRunner.ts`, `tests/step15ObservationalMemory.wiring.spec.ts`

- [ ] **Step 1: Update the v2 fingerprint tests + add 3 new mode tests**

In `tests/step15ObservationalMemory.wiring.spec.ts`, find the existing `describe('Step 15 v2 batching: cache fingerprint', ...)` block and REPLACE its four tests with:

```typescript
describe('Step 15 v3 cache fingerprint', () => {
  const baseV3Config: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
    observationalMemory: true,
  } as RunConfig;

  it('tags dual-path default with step-15-om-config:dual-path:24000', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(baseV3Config, 'case-1');
    expect(runKeyParts).toContain('step-15-om-config:dual-path:24000');
    expect(resultKeyParts).toContain('step-15-om-config:dual-path:24000');
  });

  it('tags explicit batched mode with step-15-om-config:batched:{target}', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'batched', omBatchTokenTarget: 16_000 },
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-config:batched:16000');
  });

  it('tags per-session mode with step-15-om-config:per-session:{target}', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'per-session' },
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-config:per-session:24000');
  });

  it('fingerprint differs across the three modes', () => {
    const a = computeCaseRunKeyParts({ ...baseV3Config, omMode: 'per-session' }, 'case-1').runKeyParts;
    const b = computeCaseRunKeyParts({ ...baseV3Config, omMode: 'batched' }, 'case-1').runKeyParts;
    const c = computeCaseRunKeyParts({ ...baseV3Config, omMode: 'dual-path' }, 'case-1').runKeyParts;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  it('omits config tag when observationalMemory is false', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: false,
        omMode: 'dual-path',
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om-config')),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run RED**

Expected: 5 fail on old `step-15-om-batching:v2:...` tag being present instead of new tag.

- [ ] **Step 3: Update `computeCaseRunKeyParts`**

In `src/core/BenchmarkRunner.ts`, find the v2 block and REPLACE:

```typescript
const batchTokenTarget = config.omBatchTokenTarget ?? 24_000;
const batchTag = `step-15-om-batching:v2:${batchTokenTarget}`;
runKeyParts.push(batchTag);
resultKeyParts.push(batchTag);
```

With:

```typescript
// Step-15 v3: observer ingest config. Mode + batch target both feed the
// tag so per-session / batched / dual-path variants, AND different batch
// targets, all cache independently. Replaces the Step-15 v2
// step-15-om-batching:v2:{target} tag.
const omMode = config.omMode ?? 'dual-path';
const batchTokenTarget = config.omBatchTokenTarget ?? 24_000;
const configTag = `step-15-om-config:${omMode}:${batchTokenTarget}`;
runKeyParts.push(configTag);
resultKeyParts.push(configTag);
```

- [ ] **Step 4: GREEN + regression**

```bash
pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts 2>&1 | tail -10
```
Expected: all pass (38 + 5 new - 4 replaced = 39). Typecheck clean.

---

## Task 4: CLI `--om-mode` flag

**Files:** `src/cli.ts`

- [ ] **Step 1: Add option + wire to RunConfig**

In `src/cli.ts`, after the existing `--om-batch-tokens` option:

```typescript
.option(
  '--om-mode <mode>',
  'Step 15 v3: observer ingest mode. Values: per-session (v1 behavior, one call per session), batched (v2 behavior, one call per 24k-token batch), dual-path (v3 default, both passes in parallel). Only effective with --observational-memory.',
  (value: string) => {
    if (value !== 'per-session' && value !== 'batched' && value !== 'dual-path') {
      throw new Error(`--om-mode must be per-session | batched | dual-path, got "${value}"`);
    }
    return value;
  },
)
```

Wire in the action handler (next to `omBatchTokenTarget: opts.omBatchTokens`):

```typescript
omMode: opts.omMode,
```

- [ ] **Step 2: Build + verify help surface**

```bash
pnpm build && pnpm bench run --help 2>&1 | grep -E "om-mode|om-batch-tokens"
```
Expected: both flags appear.

- [ ] **Step 3: Typecheck + regression**

```bash
pnpm typecheck && \
  pnpm vitest run tests/observationalMemory.unit.spec.ts tests/step15ObservationalMemory.wiring.spec.ts 2>&1 | tail -5
```
Expected: 39 passed, typecheck clean.

---

## Task 5: Wire `omMode` into `LongMemEvalS.runCase`

**Files:** `src/benchmarks/longmemeval/LongMemEvalS.ts`

- [ ] **Step 1: Pass `omMode` to `ingestSessions`**

In `src/benchmarks/longmemeval/LongMemEvalS.ts`, find the current block (around line 266-271):

```typescript
const ingest = await ingestSessions({
  observerReader,
  sessions,
  observerConcurrency: 4,
  batchTokenTarget: ctx.config.omBatchTokenTarget ?? 24_000,
});
```

Replace with:

```typescript
const ingest = await ingestSessions({
  observerReader,
  sessions,
  observerConcurrency: 6,
  batchTokenTarget: ctx.config.omBatchTokenTarget ?? 24_000,
  omMode: ctx.config.omMode ?? 'dual-path',
});
```

- [ ] **Step 2: Surface `omMode` + per-pass counts in metadata**

After the existing `runMetadata.omBatchTokenTarget = ...` line, add:

```typescript
runMetadata.omMode = ctx.config.omMode ?? 'dual-path';
runMetadata.omPerSessionBatches = ingest.perSessionBatches.length;
runMetadata.omBatchedBatches = ingest.batchedBatches.length;
```

Keep the existing `runMetadata.omObservationBatches = ingest.observationBatches.length;` line — it's now the combined total, consistent with legacy consumers.

- [ ] **Step 3: Typecheck + regression**

```bash
pnpm typecheck && pnpm vitest run 2>&1 | tail -7
```
Expected: full bench suite green (320+ tests).

---

## Task 6: Final verification

- [ ] **Step 1: Full bench suite + typecheck**

```bash
pnpm typecheck && pnpm vitest run
```
Expected: all pass.

- [ ] **Step 2: Dry-run at dual-path (smoke the code path, no API cost)**

First delete the previous Task 9 dry-run cache entries from yesterday + today to avoid mock-answer replay (fingerprint change in Task 3 should orphan them but be safe):

```bash
for f in $(find data/cache/case-run -type f -newermt "2026-04-22 02:00:00"); do
  if grep -q "dry-run mock answer" "$f" 2>/dev/null; then rm "$f"; fi
done
```

Then dry-run:

```bash
pnpm build && \
  set -a && source ../../apps/wilds-ai/.env && set +a && \
  pnpm bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory --om-mode dual-path --om-batch-tokens 24000 \
    --stratified --sample-per-type 1 \
    --bootstrap-resamples 100 --seed 42 \
    --max-usd 10 --dry-run 2>&1 | tail -15
```
Expected: `accuracy=100.0%` (MockReader answers always pass), 6 cases, no errors. Run JSON writes with per-case metadata including `omMode: 'dual-path'`, `omPerSessionBatches: ~50`, `omBatchedBatches: ~5`.

- [ ] **Step 3: Clean dry-run cache before Tier A**

```bash
for f in $(find data/cache/case-run -type f -newermt "2026-04-22 04:00:00"); do
  if grep -q "dry-run mock answer" "$f" 2>/dev/null; then rm "$f"; fi
done
```

---

## Task 7: Tier A live smoke

- [ ] **Step 1: Fire Tier A**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && \
  set -a && source apps/wilds-ai/.env && set +a && \
  OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  pnpm --filter @framers/agentos-bench bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-mode dual-path \
    --om-batch-tokens 24000 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 15 > /tmp/tier-a-v3.log 2>&1 &
```

Expected cost: $5-7. Expected duration: 40-50 min.

- [ ] **Step 2: Evaluate kill gate**

| Metric | Threshold | Outcome |
|---|---:|---|
| Unweighted | ≥ 78% | ? |
| Multi-session | ≥ 50% | ? |
| Single-session-user | ≥ 90% | ? |
| Single-session-assistant | ≥ 90% | ? |
| Single-session-preference | ≥ 90% | ? |

If all five pass → Phase A. If ANY single-session threshold fails → STOP, dual-path does not preserve v1 fidelity, pivot to Option 3 (Gemini observer). If unweighted or multi-session fails → STOP, document.

---

## Task 8: Findings doc (regardless of outcome)

Write `packages/agentos-bench/docs/STEP_15_V3_DUAL_PATH_FINDINGS_YYYY-MM-DD.md` using the v2 findings doc as template. Record verdict + per-category + cost + recommendations. Update umbrella doc if Phase B ran.

---

## Proposed commits (await explicit user approval)

```
feat(bench): Step 15 v3 — dual-path observer (per-session + batched)

Runs the Observer on two parallel passes per case: per-session (v1 fidelity)
and 24k-token batched (v2 cross-session encoding). Logs are concatenated
into the reader's context under "## Per-session observations" +
"## Cross-session patterns" section headers.

New type: OmIngestMode = 'per-session' | 'batched' | 'dual-path'.
New CLI flag: --om-mode (default dual-path).
New RunConfig field: omMode.
Cache fingerprint tag: step-15-om-config:{mode}:{target}
(replaces step-15-om-batching:v2:{target}).
Observer concurrency default bumped 4 → 6 to absorb the 2x call count
while keeping wall time near v2's envelope.

Tests: 12 new (7 unit + 5 wiring) + 4 existing v2 fingerprint tests
updated for new tag naming. Full bench suite green. Typecheck clean.

Design: docs/specs/2026-04-22-step-15-v3-dual-path-observer-design.md
Plan:   docs/plans/2026-04-22-step-15-v3-dual-path-plan.md
```

```
bench: Step 15 v3 Tier A — {verdict} at {accuracy}%
...  (fill in from run results)
```

---

End of plan.
