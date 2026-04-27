/**
 * @file resolveRunConfigContract.spec.ts
 * @description Contract test pinning resolveRunConfig as a complete passthrough
 * for every key in OPTIONAL_RUN_CONFIG_KEYS.
 *
 * Why this test exists: a class of latent bugs surfaced on 2026-04-24 where a
 * field added to RunConfig + OPTIONAL_RUN_CONFIG_KEYS was forgotten in
 * resolveRunConfig's explicit-field copy. The TypeScript guard at IBenchmark.ts
 * only checks that every OPTIONAL_RUN_CONFIG_KEY exists on RunConfig — it does
 * NOT check that resolveRunConfig propagates each one. The Stage F-2
 * --no-abstention flag was set on the CLI, dropped by resolveRunConfig, and
 * silently ignored at runtime; the LOCOMO tuned 51.5% number was actually
 * K=20-only because the prompt-builder branch reading ctx.config.noAbstention
 * always saw undefined. omRetrieverMsBm25Weight had the same bug but was
 * never used in a shipping run.
 *
 * The contract: for every key in OPTIONAL_RUN_CONFIG_KEYS, setting a sample
 * value on the input RunConfig MUST produce that same value on the resolved
 * BenchContext['config']. If a future field is added without updating
 * resolveRunConfig, this test fails immediately.
 */

import { describe, it, expect } from 'vitest';
import { resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import {
  OPTIONAL_RUN_CONFIG_KEYS,
  type RunConfig,
} from '../src/core/IBenchmark.js';

const base: RunConfig = {
  reader: 'gpt-4o',
  memoryMode: 'full-cognitive',
  replayMode: 'ingest',
};

/**
 * Sample value for each optional key. Keep one per key so a failure
 * message names the exact field that didn't round-trip. Values are picked
 * to be distinguishable from undefined / default values.
 */
const SAMPLES: Record<(typeof OPTIONAL_RUN_CONFIG_KEYS)[number], unknown> = {
  sampleN: 7,
  tags: ['contract'],
  seed: 1234,
  maxUsd: 99.99,
  retrievalProfile: 'balanced',
  adaptiveRetrieval: true,
  retrievalK: 12,
  stratified: true,
  samplePerType: 5,
  trackFootprint: true,
  ablateSignal: 'recency',
  ablateMechanism: 'spreading',
  rerank: { provider: 'cohere' },
  contextSummaryModel: 'gpt-5-mini',
  readerTopK: 17,
  judgeAdversarial: true,
  judgeAdversarialMaxProbes: 33,
  judgeAdversarialSynthModel: 'gpt-5-mini',
  bootstrapResamples: 5000,
  sessionRetrieval: true,
  sessionRetrievalTopSessions: 4,
  sessionRetrievalChunksPerSession: 2,
  hybridRetrieval: true,
  hyde: true,
  factSupersession: true,
  splitAmbiguous: 0.42,
  observerReflector: true,
  observerReflectorReplace: true,
  factGraphIngest: true,
  graphActivation: true,
  twoCallReader: true,
  observationalMemory: true,
  omBatchTokenTarget: 24000,
  omMode: 'batched',
  omReaderScaffold: true,
  omSynthesisModel: 'gpt-5-mini',
  omObserverModel: 'gpt-4o',
  omWithRetrieval: true,
  omDynamicRouter: true,
  omClassifierModel: 'gpt-5-mini',
  omClassifierFewshot: true,
  omGuidedRetrieval: true,
  omGuidedRetrievalK: 8,
  omRetrieverMsKOverride: 30,
  omRetrieverMsBm25Weight: 0.7,
  omRetrieverMsOverFetchMultiplier: 6,
  captureRetentionInputs: true,
  policyRouter: true,
  policyRouterPreset: 'minimize-cost',
  policyRouterBudgetPerQuery: 0.05,
  policyRouterBudgetMode: 'soft',
  retrievalConfigRouter: 'minimize-cost-augmented',
  embedderModel: 'text-embedding-3-small',
  sessionLevelNdcg: true,
  sessionLevelNdcgTopK: 5,
  noAbstention: true,
  entityLinking: 0.5,
  typedNetwork: 'minimal',
};

describe('resolveRunConfig contract: every OPTIONAL_RUN_CONFIG_KEY round-trips', () => {
  // Compile-time guard: SAMPLES must cover every key. Adding a key to
  // OPTIONAL_RUN_CONFIG_KEYS without adding a SAMPLES entry fails the
  // type check below at compile time. (TypeScript's exhaustive Record
  // type means missing keys produce a compile error.)
  it('SAMPLES covers every OPTIONAL_RUN_CONFIG_KEY', () => {
    for (const key of OPTIONAL_RUN_CONFIG_KEYS) {
      expect(SAMPLES[key]).toBeDefined();
    }
  });

  it.each(OPTIONAL_RUN_CONFIG_KEYS)(
    'resolveRunConfig propagates %s',
    (key) => {
      const sampleValue = SAMPLES[key];
      const input = { ...base, [key]: sampleValue } as RunConfig;
      const resolved = resolveRunConfig(input);
      expect(
        (resolved as unknown as Record<string, unknown>)[key],
      ).toEqual(sampleValue);
    },
  );
});
