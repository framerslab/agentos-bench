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

describe('session-retrieval cache key fingerprint', () => {
  it('does NOT append fingerprint when sessionRetrieval is false/undefined', () => {
    const cfg = resolveRunConfig({ ...baseConfig });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const hasSR = (k: unknown[]) => k.some(
      (p) => typeof p === 'string' && p.startsWith('session-retrieval:'),
    );
    expect(hasSR(runKeyParts)).toBe(false);
    expect(hasSR(resultKeyParts)).toBe(false);
  });

  it('appends fingerprint when sessionRetrieval is true', () => {
    const cfg = resolveRunConfig({
      ...baseConfig,
      sessionRetrieval: true,
      sessionRetrievalTopSessions: 5,
      sessionRetrievalChunksPerSession: 3,
    });
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, keyCtx);
    const srTag = (k: unknown[]) => k.find(
      (p) => typeof p === 'string' && p.startsWith('session-retrieval:'),
    );
    expect(srTag(runKeyParts)).toBe('session-retrieval:k=5,m=3');
    expect(srTag(resultKeyParts)).toBe('session-retrieval:k=5,m=3');
  });

  it('fingerprint includes K and M values — K=3,M=4 hashes differently from K=5,M=3', () => {
    const cfgA = resolveRunConfig({
      ...baseConfig, sessionRetrieval: true,
      sessionRetrievalTopSessions: 3, sessionRetrievalChunksPerSession: 4,
    });
    const cfgB = resolveRunConfig({
      ...baseConfig, sessionRetrieval: true,
      sessionRetrievalTopSessions: 5, sessionRetrievalChunksPerSession: 3,
    });
    const kA = computeCaseRunKeyParts(cfgA, keyCtx).runKeyParts;
    const kB = computeCaseRunKeyParts(cfgB, keyCtx).runKeyParts;
    const tagA = kA.find((p) => typeof p === 'string' && p.startsWith('session-retrieval:'));
    const tagB = kB.find((p) => typeof p === 'string' && p.startsWith('session-retrieval:'));
    expect(tagA).not.toBe(tagB);
  });

  it('plumbing: RunConfig fields propagate through resolveRunConfig', () => {
    const cfg = resolveRunConfig({
      ...baseConfig,
      sessionRetrieval: true,
      sessionRetrievalTopSessions: 7,
      sessionRetrievalChunksPerSession: 4,
    });
    expect(cfg.sessionRetrieval).toBe(true);
    expect(cfg.sessionRetrievalTopSessions).toBe(7);
    expect(cfg.sessionRetrievalChunksPerSession).toBe(4);
  });
});
