import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('hybrid-retrieval cache key fingerprint', () => {
  it('does NOT append when hybridRetrieval is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const hasHR = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('hybrid-retrieval:'),
    );
    expect(hasHR(runKeyParts)).toBe(false);
    expect(hasHR(resultKeyParts)).toBe(false);
  });

  it('appends hybrid-retrieval:rrf fingerprint when enabled', () => {
    const cfg = resolveRunConfig({ ...baseConfig, hybridRetrieval: true });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const tag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('hybrid-retrieval:'),
    );
    expect(tag(runKeyParts)).toBe('hybrid-retrieval:rrf');
    expect(tag(resultKeyParts)).toBe('hybrid-retrieval:rrf');
  });

  it('plumbing: hybridRetrieval propagates through resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, hybridRetrieval: true });
    expect(cfg.hybridRetrieval).toBe(true);
  });
});

describe('hybrid-retrieval mutex', () => {
  it('LongMemEvalS runFullCognitiveCase throws documented mutex error when both flags set', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/benchmarks/longmemeval/LongMemEvalS.ts'),
      'utf8',
    );
    expect(src).toContain(
      '--hybrid-retrieval and --session-retrieval are mutually exclusive',
    );
  });
});
