import { describe, it, expect } from 'vitest';
import { computeCaseRunKeyParts, resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

const baseConfig: RunConfig = {
  reader: 'gpt-4o',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
};

const keyCtx = {
  benchmarkId: 'longmemeval-s',
  benchmarkVersion: '1.0.0',
  caseId: 'case-1',
  judgeModel: 'gpt-4o',
  judgeRubricVersion: '2026-04-18.1',
};

describe('observer-reflector cache key fingerprint', () => {
  it('does NOT append when observerReflector is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const has = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('observer-reflector:'),
    );
    expect(has(runKeyParts)).toBe(false);
    expect(has(resultKeyParts)).toBe(false);
  });

  it('appends observer-reflector:on fingerprint when enabled', () => {
    const cfg = resolveRunConfig({ ...baseConfig, observerReflector: true });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const tag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('observer-reflector:'),
    );
    expect(tag(runKeyParts)).toBe('observer-reflector:on');
    expect(tag(resultKeyParts)).toBe('observer-reflector:on');
  });

  it('plumbing: observerReflector propagates through resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, observerReflector: true });
    expect(cfg.observerReflector).toBe(true);
  });
});
