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

describe('hyde cache key fingerprint', () => {
  it('does NOT append when hyde is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const hasHyde = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('hyde:'),
    );
    expect(hasHyde(runKeyParts)).toBe(false);
    expect(hasHyde(resultKeyParts)).toBe(false);
  });

  it('appends hyde:enabled fingerprint when enabled', () => {
    const cfg = resolveRunConfig({ ...baseConfig, hyde: true });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const tag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('hyde:'),
    );
    expect(tag(runKeyParts)).toBe('hyde:enabled');
    expect(tag(resultKeyParts)).toBe('hyde:enabled');
  });

  it('plumbing: hyde propagates through resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, hyde: true });
    expect(cfg.hyde).toBe(true);
  });
});
