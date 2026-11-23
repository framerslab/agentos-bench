/**
 * @file readerTopK.spec.ts
 * @description Regression tests for the `--reader-top-k` CLI flag and
 * its propagation through RunConfig → BenchContext → case-run cache key.
 *
 * Pins three invariants:
 *   (a) Propagation: RunConfig.readerTopK survives resolveRunConfig
 *       and lands on BenchContext.config.readerTopK.
 *   (b) Cache-key divergence: distinct readerTopK values produce
 *       distinct case-run cache keys for the same case.
 *   (c) An unset readerTopK adds no part to the cache key.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';
import { hashKey } from '../src/core/Cache.js';
import { AGENTOS_VERSION } from '../src/drivers/constants.js';

const baseConfig: RunConfig = {
  reader: 'gpt-5-mini',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
};

const fixture = {
  benchmarkId: 'longmemeval-s',
  benchmarkVersion: '1.0.0',
  caseId: 'test-case-001',
  judgeModel: 'gpt-4o',
  judgeRubricVersion: '2026-04-18.1',
};

it('keys both case caches on the installed AgentOS version without a driver', () => {
  const config = resolveRunConfig(baseConfig);
  expect(config.driver).toBeUndefined();

  const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(config, fixture);
  const agentosTag = `agentos@${AGENTOS_VERSION}`;
  expect(runKeyParts).toContain(agentosTag);
  expect(resultKeyParts).toContain(agentosTag);
});

describe('readerTopK propagation + cache-key invariants', () => {
  it('(a) RunConfig.readerTopK survives resolveRunConfig', () => {
    const cfg = resolveRunConfig({ ...baseConfig, readerTopK: 15 });
    expect(cfg.readerTopK).toBe(15);

    const cfgUnset = resolveRunConfig(baseConfig);
    expect(cfgUnset.readerTopK).toBeUndefined();
  });

  it('(b) distinct readerTopK values produce distinct case-run cache keys', () => {
    const ctx10 = resolveRunConfig({ ...baseConfig, readerTopK: 10 });
    const ctx15 = resolveRunConfig({ ...baseConfig, readerTopK: 15 });
    const ctxNone = resolveRunConfig(baseConfig);

    const { runKeyParts: parts10 } = computeCaseRunKeyParts(ctx10, fixture);
    const { runKeyParts: parts15 } = computeCaseRunKeyParts(ctx15, fixture);
    const { runKeyParts: partsNone } = computeCaseRunKeyParts(ctxNone, fixture);

    const hash10 = hashKey(...parts10);
    const hash15 = hashKey(...parts15);
    const hashNone = hashKey(...partsNone);

    expect(hash10).not.toBe(hash15);
    expect(hash10).not.toBe(hashNone);
    expect(hash15).not.toBe(hashNone);

    // Cache-result keys diverge on the same axis.
    const { resultKeyParts: resParts10 } = computeCaseRunKeyParts(ctx10, fixture);
    const { resultKeyParts: resParts15 } = computeCaseRunKeyParts(ctx15, fixture);
    expect(hashKey(...resParts10)).not.toBe(hashKey(...resParts15));
  });

  it('(c) an unset readerTopK adds no part to either cache key', () => {
    const ctxNone = resolveRunConfig(baseConfig);
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(ctxNone, fixture);

    // None of the emitted parts should contain a readerTopK fingerprint.
    const joinedRun = runKeyParts.map(String).join('|');
    expect(joinedRun).not.toContain('topk:');
    const joinedResult = resultKeyParts.map(String).join('|');
    expect(joinedResult).not.toContain('topk:');

    // An empty placeholder would also change the cache hash.
    expect(runKeyParts).toHaveLength(14);
    expect(resultKeyParts).toHaveLength(16);
  });
});
