/**
 * @file step12BM25Parity.wiring.spec.ts
 * @description Wiring contracts for Step 12 — BM25 parity for
 * Observer/Reflector ADDITIVE mode. Pins three behaviors that the
 * LongMemEvalS bench adapter must honor:
 *
 *   1. `indexReflectionTracesIntoBm25` helper contract — every supplied
 *      trace id with non-empty content is added to BM25 with the caller
 *      tag; the shared Set dedups; missing/empty traces are skipped.
 *   2. Session-boundary flushReflection → hybridBm25.addDocument wiring
 *      in ADDITIVE mode (tested indirectly via the helper contracts +
 *      integration spec).
 *   3. End-of-replay sweep catches orphan reflection traces that
 *      bypass flushReflection (e.g. ContextWindowManager.onTracesCreated).
 *
 * The helper is exported from LongMemEvalS.ts for direct unit testing;
 * the sweep filter contract is inlined in the test so any divergence
 * between the test's filter loop and `replayForCognitive`'s is a bug.
 */

import { describe, it, expect, vi } from 'vitest';
import { indexReflectionTracesIntoBm25 } from '../src/benchmarks/longmemeval/LongMemEvalS.js';
import { computeCaseRunKeyParts } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

interface StubBm25 {
  addDocument: ReturnType<typeof vi.fn>;
}

function stubBm25(): StubBm25 {
  return { addDocument: vi.fn() };
}

function stubStore(
  traces: Record<string, { id: string; content: string }>,
): { getTrace: (id: string) => { id: string; content: string } | undefined } {
  return {
    getTrace: (id: string) => traces[id],
  };
}

describe('indexReflectionTracesIntoBm25 helper', () => {
  it('adds every supplied id whose trace has non-empty content', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r1: { id: 'r1', content: 'Alice moved to Berlin' },
      r2: { id: 'r2', content: 'Alice prefers matcha' },
    });
    const indexed = new Set<string>();
    indexReflectionTracesIntoBm25(
      ['r1', 'r2'],
      store,
      bm25,
      'session-tag-A',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(2);
    expect(bm25.addDocument).toHaveBeenCalledWith('r1', 'Alice moved to Berlin', { tag: 'session-tag-A' });
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'Alice prefers matcha', { tag: 'session-tag-A' });
    expect(indexed.has('r1')).toBe(true);
    expect(indexed.has('r2')).toBe(true);
  });

  it('skips ids already present in the indexed Set', () => {
    const bm25 = stubBm25();
    const store = stubStore({
      r1: { id: 'r1', content: 'already indexed' },
      r2: { id: 'r2', content: 'fresh' },
    });
    const indexed = new Set<string>(['r1']);
    indexReflectionTracesIntoBm25(
      ['r1', 'r2'],
      store,
      bm25,
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
      store,
      bm25,
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
      store,
      bm25,
      'session-tag-D',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(indexed.has('missing')).toBe(false);
    expect(indexed.has('r2')).toBe(true);
  });
});

describe('end-of-replay sweep filter contract', () => {
  it('indexes only reflection-sourced traces not already in Set', () => {
    const bm25 = stubBm25();
    const allTraces = [
      { id: 'raw1', content: 'User: hello', provenance: { sourceType: 'user_statement' } },
      { id: 'r1', content: 'User moved to Berlin', provenance: { sourceType: 'reflection' } },
      { id: 'r2', content: 'User prefers matcha', provenance: { sourceType: 'reflection' } },
      { id: 'r3', content: 'System message', provenance: { sourceType: 'system' } },
    ];
    const indexed = new Set<string>(['r1']); // r1 already indexed via prior flushReflection
    const store = {
      listTraces: (): typeof allTraces => allTraces,
      getTrace: (id: string) => allTraces.find((t) => t.id === id),
    };

    // Sweep logic — inlined here to pin the contract. Any divergence
    // between this loop and the one in LongMemEvalS.ts::replayForCognitive
    // is a bug. Keep this mirrored with Task 7 implementation.
    const orphanIds: string[] = [];
    for (const trace of store.listTraces()) {
      if (trace.provenance.sourceType !== 'reflection') continue;
      if (indexed.has(trace.id)) continue;
      orphanIds.push(trace.id);
    }
    expect(orphanIds).toEqual(['r2']);

    indexReflectionTracesIntoBm25(
      orphanIds,
      store,
      bm25,
      'reflection-sweep',
      indexed,
    );
    expect(bm25.addDocument).toHaveBeenCalledTimes(1);
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'User prefers matcha', { tag: 'reflection-sweep' });
    expect(indexed.has('r2')).toBe(true);
  });
});

describe('Step 12 cache-key fingerprint contract', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: 'cohere',
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    observerReflector: false,
    observerReflectorReplace: false,
    readerTopK: 10,
  } as RunConfig;

  it('adds step-12-bm25-parity-sweep when observer-reflector ADDITIVE is enabled', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observerReflector: true, observerReflectorReplace: false },
      'case-1',
    );
    expect(runKeyParts).toContain('step-12-bm25-parity-sweep');
    expect(resultKeyParts).toContain('step-12-bm25-parity-sweep');
  });

  it('omits step-12-bm25-parity-sweep when observer-reflector REPLACEMENT is enabled', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observerReflector: true, observerReflectorReplace: true },
      'case-1',
    );
    expect(runKeyParts).not.toContain('step-12-bm25-parity-sweep');
    expect(resultKeyParts).not.toContain('step-12-bm25-parity-sweep');
  });

  it('omits step-12-bm25-parity-sweep when observer-reflector is disabled', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observerReflector: false },
      'case-1',
    );
    expect(runKeyParts).not.toContain('step-12-bm25-parity-sweep');
    expect(resultKeyParts).not.toContain('step-12-bm25-parity-sweep');
  });
});
