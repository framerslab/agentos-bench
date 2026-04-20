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

describe('split-ambiguous cache key fingerprint', () => {
  it('does NOT append when splitAmbiguous is undefined or 0', () => {
    const cfgUndef = resolveRunConfig({ ...baseConfig });
    const cfgZero = resolveRunConfig({ ...baseConfig, splitAmbiguous: 0 });
    const has = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('split-ambiguous:'),
    );
    const { runKeyParts: ru } = computeCaseRunKeyParts(cfgUndef, keyCtx);
    const { runKeyParts: rz } = computeCaseRunKeyParts(cfgZero, keyCtx);
    expect(has(ru)).toBe(false);
    expect(has(rz)).toBe(false);
  });

  it('appends split-ambiguous:<threshold> fingerprint when > 0', () => {
    const cfg = resolveRunConfig({ ...baseConfig, splitAmbiguous: 0.3 });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const tag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('split-ambiguous:'),
    );
    expect(tag(runKeyParts)).toBe('split-ambiguous:0.3');
    expect(tag(resultKeyParts)).toBe('split-ambiguous:0.3');
  });
});
