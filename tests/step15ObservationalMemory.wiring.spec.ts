/**
 * @file step15ObservationalMemory.wiring.spec.ts
 * @description Wiring contracts for Step 15 Observational Memory rollout.
 * Pins cache-fingerprint presence/absence, content-addressed invalidation
 * via OM_PROMPT_HASH, and RunConfig threading.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import { OM_PROMPT_HASH } from '../src/observational-memory/prompts.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('Step 15 cache fingerprint', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('adds step-15-om:{hash12} when flag on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observationalMemory: true },
      'case-1',
    );
    const tag = `step-15-om:${OM_PROMPT_HASH.slice(0, 12)}`;
    expect(runKeyParts).toContain(tag);
    expect(resultKeyParts).toContain(tag);
  });

  it('omits step-15-om fingerprint when flag off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observationalMemory: false },
      'case-1',
    );
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om'))).toBe(false);
  });

  it('omits step-15-om fingerprint when flag undefined', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om'))).toBe(false);
  });
});

describe('Step 15 RunConfig threading', () => {
  it('preserves observationalMemory: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
    } as RunConfig);
    expect(cfg.observationalMemory).toBe(true);
  });

  it('observationalMemory defaults to undefined when absent', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
    } as RunConfig);
    expect(cfg.observationalMemory).toBeUndefined();
  });
});

describe('OM_PROMPT_HASH stability', () => {
  it('is a 64-char hex SHA-256', () => {
    expect(OM_PROMPT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
});
