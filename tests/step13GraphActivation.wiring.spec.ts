/**
 * @file step13GraphActivation.wiring.spec.ts
 * @description Wiring contracts for Step 13 graph-activation rollout.
 * Pins the cache fingerprint presence/absence, RunConfig threading,
 * and agentos barrel re-export of the heuristic extractor + slugifier.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import { extractEntities, slugifyEntityId } from '@framers/agentos/memory';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('Step 13 graph-activation cache fingerprint', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('adds step-13-graph-activation:v1 when flag on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, graphActivation: true },
      'case-1',
    );
    expect(runKeyParts).toContain('step-13-graph-activation:v1');
    expect(resultKeyParts).toContain('step-13-graph-activation:v1');
  });

  it('omits step-13-graph-activation:v1 when flag off', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, graphActivation: false },
      'case-1',
    );
    expect(runKeyParts).not.toContain('step-13-graph-activation:v1');
    expect(resultKeyParts).not.toContain('step-13-graph-activation:v1');
  });

  it('omits step-13-graph-activation:v1 when flag undefined', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      baseConfig,
      'case-1',
    );
    expect(runKeyParts).not.toContain('step-13-graph-activation:v1');
    expect(resultKeyParts).not.toContain('step-13-graph-activation:v1');
  });
});

describe('Step 13 resolveRunConfig threading', () => {
  it('preserves graphActivation: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      graphActivation: true,
    } as RunConfig);
    expect(cfg.graphActivation).toBe(true);
  });

  it('defaults graphActivation to undefined when absent (resolveRunConfig passes through)', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
    } as RunConfig);
    expect(cfg.graphActivation).toBeUndefined();
  });
});

describe('@framers/agentos memory exports extractor', () => {
  it('extractEntities returns entity labels from real text', () => {
    const out = extractEntities('Alice met Bob in Berlin on 2024-03-15 and paid $350,000');
    expect(out).toContain('Alice');
    expect(out).toContain('Berlin');
    expect(out).toContain('2024-03-15');
    expect(out).toContain('$350,000');
  });

  it('slugifyEntityId produces deterministic slug IDs', () => {
    expect(slugifyEntityId('Wells Fargo')).toBe('wells-fargo');
    expect(slugifyEntityId('$350,000')).toBe('350000');
  });
});
