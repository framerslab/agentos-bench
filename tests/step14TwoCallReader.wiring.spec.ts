/**
 * @file step14TwoCallReader.wiring.spec.ts
 * @description Wiring contracts for Step 14 two-call reader rollout.
 * Pins cache-fingerprint presence/absence, content-addressed
 * invalidation via EXTRACT_PROMPT_HASH, and RunConfig threading.
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
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-14-two-call-reader'))).toBe(false);
  });

  it('omits step-14-two-call-reader fingerprint when flag undefined', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-14-two-call-reader'))).toBe(false);
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
