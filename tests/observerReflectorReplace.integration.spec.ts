import { describe, it, expect } from 'vitest';
import { computeCaseRunKeyParts, resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

const baseConfig: RunConfig = {
  reader: 'gpt-4o',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
  observerReflector: true,
};

const keyCtx = {
  benchmarkId: 'longmemeval-s',
  benchmarkVersion: '1.0.0',
  caseId: 'case-1',
  judgeModel: 'gpt-4o',
  judgeRubricVersion: '2026-04-18.1',
};

describe('observer-reflector replace cache key fingerprint', () => {
  it('uses observer-reflector:on when replace is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const obsTag = runKeyParts.find(
      (p) => typeof p === 'string' && p.startsWith('observer-reflector:'),
    );
    expect(obsTag).toBe('observer-reflector:on');
  });

  it('uses observer-reflector:replace when replace is true', () => {
    const cfg = resolveRunConfig({ ...baseConfig, observerReflectorReplace: true });
    const { runKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const obsTag = runKeyParts.find(
      (p) => typeof p === 'string' && p.startsWith('observer-reflector:'),
    );
    expect(obsTag).toBe('observer-reflector:replace-v2');
    expect(cfg.observerReflectorReplace).toBe(true);
  });
});
