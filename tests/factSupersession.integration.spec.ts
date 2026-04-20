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

describe('fact-supersession cache key fingerprint', () => {
  it('does NOT append when factSupersession is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const has = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('fact-supersession:'),
    );
    expect(has(runKeyParts)).toBe(false);
    expect(has(resultKeyParts)).toBe(false);
  });

  it('appends fact-supersession:llm fingerprint when enabled', () => {
    const cfg = resolveRunConfig({ ...baseConfig, factSupersession: true });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const tag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('fact-supersession:'),
    );
    expect(tag(runKeyParts)).toBe('fact-supersession:llm');
    expect(tag(resultKeyParts)).toBe('fact-supersession:llm');
  });

  it('plumbing: factSupersession propagates through resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, factSupersession: true });
    expect(cfg.factSupersession).toBe(true);
  });
});
