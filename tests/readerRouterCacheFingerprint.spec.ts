/**
 * @file readerRouterCacheFingerprint.spec.ts
 * @description Cache-fingerprint contracts for the per-category reader-tier
 * router. Two latent classes of bug this test pins:
 *
 * 1. The reader-router fingerprint must partition by preset id (covered by
 *    BenchmarkRunner adding `reader-router:<preset>` to runKeyParts +
 *    resultKeyParts when readerRouter is set).
 *
 * 2. THE CLASSIFIER MODEL (`omClassifierModel`) must be in the fingerprint
 *    whenever a router consumes its output to make per-case dispatch
 *    decisions. Today omDynamicRouter and retrievalConfigRouter include
 *    the classifier model in their fingerprints, but policyRouter and
 *    readerRouter do NOT — meaning a run with `--policy-router
 *    --om-classifier-model gpt-4o` cache-hits on the prior gpt-5-mini-
 *    classifier results, silently replaying the wrong dispatch decisions.
 *    Discovered 2026-04-28 when a Phase A probe of `--reader-router ...
 *    --om-classifier-model gpt-4o` returned IDENTICAL aggregate (85.2%) to
 *    the gpt-5-mini-classifier probe with `totalUsd=$0.0000` (100% cache
 *    hit on incompatible cached answers).
 *
 * The fix: include `om-classifier:<model>` in the cache fingerprint
 * whenever (policyRouter || readerRouter) AND omClassifierModel is
 * non-default. Conditional append so existing cache buckets stay
 * untouched.
 */

import { describe, expect, it } from 'vitest';
import { computeCaseRunKeyParts } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

const baseConfig: RunConfig = {
  reader: 'gpt-4o',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
  rerank: { provider: 'cohere' },
  hybridRetrieval: true,
  embedderModel: 'text-embedding-3-small',
} as RunConfig;

describe('reader router cache fingerprint', () => {
  it('appends `reader-router:<preset>` when readerRouter is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, readerRouter: 'min-cost-best-cat-2026-04-28' } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('reader-router:min-cost-best-cat-2026-04-28');
    expect(resultKeyParts).toContain('reader-router:min-cost-best-cat-2026-04-28');
  });

  it('omits the reader-router tag when readerRouter is unset (baseline preserved)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(
      runKeyParts.some(
        (p) => typeof p === 'string' && p.startsWith('reader-router:'),
      ),
    ).toBe(false);
  });
});

describe('classifier-model cache fingerprint (policyRouter)', () => {
  const policyConfig: RunConfig = {
    ...baseConfig,
    policyRouter: true,
    policyRouterPreset: 'minimize-cost',
  } as RunConfig;

  it('partitions cache by classifier model when policyRouter is on AND classifier is overridden to gpt-4o', () => {
    const { runKeyParts: gpt5miniParts } = computeCaseRunKeyParts(
      policyConfig,
      'case-1',
    );
    const { runKeyParts: gpt4oParts } = computeCaseRunKeyParts(
      { ...policyConfig, omClassifierModel: 'gpt-4o' } as RunConfig,
      'case-1',
    );

    // The two configs MUST produce different cache keys, otherwise a
    // gpt-4o-classifier run silently cache-hits on a gpt-5-mini-classifier
    // run's stale dispatch decisions.
    expect(gpt4oParts).not.toEqual(gpt5miniParts);

    // The gpt-4o variant's fingerprint must explicitly tag the classifier.
    expect(
      gpt4oParts.some(
        (p) => typeof p === 'string' && p.includes('om-classifier:gpt-4o'),
      ),
    ).toBe(true);
  });

  it('omits the classifier tag when policyRouter is on but classifier is the default gpt-5-mini (baseline preserved)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(policyConfig, 'case-1');
    expect(
      runKeyParts.some(
        (p) => typeof p === 'string' && p.startsWith('om-classifier:'),
      ),
    ).toBe(false);
  });
});

describe('classifier-model cache fingerprint (readerRouter)', () => {
  const readerRouterConfig: RunConfig = {
    ...baseConfig,
    readerRouter: 'min-cost-best-cat-2026-04-28',
  } as RunConfig;

  it('partitions cache by classifier model when readerRouter is on AND classifier is overridden', () => {
    const { runKeyParts: gpt5miniParts } = computeCaseRunKeyParts(
      readerRouterConfig,
      'case-1',
    );
    const { runKeyParts: gpt4oParts } = computeCaseRunKeyParts(
      { ...readerRouterConfig, omClassifierModel: 'gpt-4o' } as RunConfig,
      'case-1',
    );

    expect(gpt4oParts).not.toEqual(gpt5miniParts);
    expect(
      gpt4oParts.some(
        (p) => typeof p === 'string' && p.includes('om-classifier:gpt-4o'),
      ),
    ).toBe(true);
  });
});
