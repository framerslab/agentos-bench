/**
 * @file step15ObservationalMemory.wiring.spec.ts
 * @description Wiring contracts for Step 15 Observational Memory rollout.
 * Pins cache-fingerprint presence/absence, content-addressed invalidation
 * via OM_PROMPT_HASH, and RunConfig threading.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunConfig,
  computeCaseRunKeyParts,
} from '../src/core/BenchmarkRunner.js';
import { OM_PROMPT_HASH } from '../src/observational-memory/prompts.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('Step 19 conditional retriever tuning fingerprints', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('appends step-19a-ms-k:{n} when omRetrieverMsKOverride is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsKOverride: 30 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19a-ms-k:30');
    expect(resultKeyParts).toContain('step-19a-ms-k:30');
  });

  it('appends step-19b-ms-bm25:{w} when omRetrieverMsBm25Weight is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsBm25Weight: 0.7 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19b-ms-bm25:0.70');
    expect(resultKeyParts).toContain('step-19b-ms-bm25:0.70');
  });

  it('appends step-19c-ms-overfetch:{m} when omRetrieverMsOverFetchMultiplier is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsOverFetchMultiplier: 6.0 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19c-ms-overfetch:6.0');
    expect(resultKeyParts).toContain('step-19c-ms-overfetch:6.0');
  });

  it('omits all Step 19 tags when none set (baseline preserved)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-19'))).toBe(false);
  });

  it('combines all three Step 19 tags when all are set', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        ...baseConfig,
        omRetrieverMsKOverride: 30,
        omRetrieverMsBm25Weight: 0.7,
        omRetrieverMsOverFetchMultiplier: 6.0,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19a-ms-k:30');
    expect(runKeyParts).toContain('step-19b-ms-bm25:0.70');
    expect(runKeyParts).toContain('step-19c-ms-overfetch:6.0');
  });
});

describe('Step 18 retention-instrumentation cache fingerprint', () => {
  it('appends retention-instrumentation:v1 to both keys for canonical config', () => {
    const cfg: RunConfig = {
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      rerank: { provider: 'cohere' },
      contextSummary: 'gpt-5-mini',
      hybridRetrieval: true,
      readerTopK: 10,
    } as RunConfig;
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, 'case-1');
    expect(runKeyParts).toContain('retention-instrumentation:v1');
    expect(resultKeyParts).toContain('retention-instrumentation:v1');
  });

  it('appends retention-instrumentation:v1 to both keys for v10 router config', () => {
    const cfg: RunConfig = {
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      rerank: { provider: 'cohere' },
      contextSummary: 'gpt-5-mini',
      hybridRetrieval: true,
      readerTopK: 10,
      observationalMemory: true,
      omMode: 'dual-path',
      omReaderScaffold: true,
      omObserverModel: 'gpt-4o',
      omDynamicRouter: true,
      omClassifierFewshot: true,
    } as RunConfig;
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(cfg, 'case-1');
    expect(runKeyParts).toContain('retention-instrumentation:v1');
    expect(resultKeyParts).toContain('retention-instrumentation:v1');
  });
});

describe('Step 15 cache fingerprint', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('adds step-15-om:{hash12} when flag on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observationalMemory: true },
      'case-1',
    );
    const tag = `step-15-om:${OM_PROMPT_HASH.slice(0, 12)}`;
    expect(runKeyParts).toContain(tag);
    expect(resultKeyParts).toContain(tag);
  });

  it('omits step-15-om fingerprint when flag off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, observationalMemory: false },
      'case-1',
    );
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om'))).toBe(false);
  });

  it('omits step-15-om fingerprint when flag undefined', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om'))).toBe(false);
  });
});

describe('Step 15 RunConfig threading', () => {
  it('preserves observationalMemory: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
    } as RunConfig);
    expect(cfg.observationalMemory).toBe(true);
  });

  it('observationalMemory defaults to undefined when absent', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
    } as RunConfig);
    expect(cfg.observationalMemory).toBeUndefined();
  });
});

describe('OM_PROMPT_HASH stability', () => {
  it('is a 64-char hex SHA-256', () => {
    expect(OM_PROMPT_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Step 15 v2 batching: RunConfig threading', () => {
  it('preserves explicit omBatchTokenTarget', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omBatchTokenTarget: 16_000,
    } as RunConfig);
    expect(cfg.omBatchTokenTarget).toBe(16_000);
  });

  it('omBatchTokenTarget defaults to undefined when absent from RunConfig', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
    } as RunConfig);
    expect(cfg.omBatchTokenTarget).toBeUndefined();
  });
});

describe('Step 15 v4a scaffold: RunConfig threading + fingerprint', () => {
  it('resolveRunConfig preserves omReaderScaffold: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omReaderScaffold: true,
    } as RunConfig);
    expect(cfg.omReaderScaffold).toBe(true);
  });

  it('resolveRunConfig preserves omReaderScaffold: false', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omReaderScaffold: false,
    } as RunConfig);
    expect(cfg.omReaderScaffold).toBe(false);
  });

  it('fingerprint includes step-15-om-scaffold:v4a when scaffold on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omReaderScaffold: true,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-scaffold:v4a');
    expect(resultKeyParts).toContain('step-15-om-scaffold:v4a');
  });

  it('fingerprint omits scaffold tag when scaffold off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omReaderScaffold: false,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om-scaffold')),
    ).toBe(false);
  });
});

describe('Step 15 v4b hierarchical: RunConfig + fingerprint', () => {
  it('resolveRunConfig preserves omSynthesisModel', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omMode: 'hierarchical',
      omSynthesisModel: 'gpt-4o',
    } as RunConfig);
    expect(cfg.omSynthesisModel).toBe('gpt-4o');
    expect(cfg.omMode).toBe('hierarchical');
  });

  it('fingerprint includes step-15-om-synthesis:{model} for hierarchical mode', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omMode: 'hierarchical',
        omSynthesisModel: 'gpt-4o',
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-synthesis:gpt-4o');
    expect(resultKeyParts).toContain('step-15-om-synthesis:gpt-4o');
  });

  it('synthesis fingerprint changes with model', () => {
    const a = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omMode: 'hierarchical',
        omSynthesisModel: 'gpt-4o',
      } as RunConfig,
      'case-1',
    );
    const b = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omMode: 'hierarchical',
        omSynthesisModel: 'gpt-5-mini',
      } as RunConfig,
      'case-1',
    );
    expect(a.runKeyParts).not.toEqual(b.runKeyParts);
  });

  it('synthesis fingerprint omitted for non-hierarchical modes', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omMode: 'batched',
        omSynthesisModel: 'gpt-4o',
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om-synthesis')),
    ).toBe(false);
  });
});

describe('Step 16 OM+Retrieval: RunConfig + fingerprint', () => {
  it('resolveRunConfig preserves omWithRetrieval: true', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omWithRetrieval: true,
    } as RunConfig);
    expect(cfg.omWithRetrieval).toBe(true);
  });

  it('fingerprint includes step-16-om-retrieval:v1 when on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omWithRetrieval: true,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-16-om-retrieval:v1');
    expect(resultKeyParts).toContain('step-16-om-retrieval:v1');
  });

  it('fingerprint omits step-16 tag when omWithRetrieval is off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omWithRetrieval: false,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-16-om-retrieval')),
    ).toBe(false);
  });

  it('fingerprint omits step-16 tag when observationalMemory is false (even if retrieval on)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: false,
        omWithRetrieval: true,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-16-om-retrieval')),
    ).toBe(false);
  });
});

describe('Step 15 v3 mode: RunConfig threading', () => {
  it('preserves explicit omMode: dual-path', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omMode: 'dual-path',
    } as RunConfig);
    expect(cfg.omMode).toBe('dual-path');
  });

  it('preserves explicit omMode: per-session', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omMode: 'per-session',
    } as RunConfig);
    expect(cfg.omMode).toBe('per-session');
  });
});

describe('Step 15 v3 cache fingerprint', () => {
  const baseV3Config: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
    observationalMemory: true,
  } as RunConfig;

  it('tags dual-path default with step-15-om-config:dual-path:24000', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(baseV3Config, 'case-1');
    expect(runKeyParts).toContain('step-15-om-config:dual-path:24000');
    expect(resultKeyParts).toContain('step-15-om-config:dual-path:24000');
  });

  it('tags explicit batched mode with step-15-om-config:batched:{target}', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'batched', omBatchTokenTarget: 16_000 },
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-config:batched:16000');
  });

  it('tags per-session mode with step-15-om-config:per-session:{target}', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'per-session' },
      'case-1',
    );
    expect(runKeyParts).toContain('step-15-om-config:per-session:24000');
  });

  it('fingerprint differs across the three modes', () => {
    const a = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'per-session' },
      'case-1',
    ).runKeyParts;
    const b = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'batched' },
      'case-1',
    ).runKeyParts;
    const c = computeCaseRunKeyParts(
      { ...baseV3Config, omMode: 'dual-path' },
      'case-1',
    ).runKeyParts;
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  it('omits config tag when observationalMemory is false', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: false,
        omMode: 'dual-path',
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-15-om-config')),
    ).toBe(false);
  });
});

describe('Step 16c router: RunConfig + fingerprint v2', () => {
  it('resolveRunConfig preserves omDynamicRouter: true when set', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omDynamicRouter: true,
    } as RunConfig);
    expect(cfg.omDynamicRouter).toBe(true);
  });

  it('resolveRunConfig defaults omDynamicRouter to false when omitted', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
    } as RunConfig);
    expect(cfg.omDynamicRouter).toBe(false);
  });

  it('fingerprint includes step-16c-router:v2 when omDynamicRouter is on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omDynamicRouter: true,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-16c-router:v2');
    expect(resultKeyParts).toContain('step-16c-router:v2');
  });

  it('fingerprint omits the router tag when omDynamicRouter is off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omDynamicRouter: false,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-16c-router')),
    ).toBe(false);
  });

  it('fingerprint omits the router tag when observationalMemory is off (even if router on)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: false,
        omDynamicRouter: true,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-16c-router')),
    ).toBe(false);
  });

  it('resolveRunConfig preserves omClassifierModel when set', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omDynamicRouter: true,
      omClassifierModel: 'gpt-4o',
    } as RunConfig);
    expect(cfg.omClassifierModel).toBe('gpt-4o');
  });

  it('fingerprint includes step-16c-classifier:{model} when classifier model is overridden', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omDynamicRouter: true,
        omClassifierModel: 'gpt-4o',
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-16c-classifier:gpt-4o');
    expect(resultKeyParts).toContain('step-16c-classifier:gpt-4o');
  });

  it('fingerprint omits step-16c-classifier tag when classifier is the default gpt-5-mini', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omDynamicRouter: true,
        // omClassifierModel omitted — default
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-16c-classifier')),
    ).toBe(false);
  });
});

describe('Step 17 OM-guided retrieval: RunConfig + fingerprint', () => {
  it('resolveRunConfig preserves omGuidedRetrieval and omGuidedRetrievalK', () => {
    const cfg = resolveRunConfig({
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      observationalMemory: true,
      omGuidedRetrieval: true,
      omGuidedRetrievalK: 7,
    } as RunConfig);
    expect(cfg.omGuidedRetrieval).toBe(true);
    expect(cfg.omGuidedRetrievalK).toBe(7);
  });

  it('fingerprint includes step-17-om-guided:v2 when omGuidedRetrieval is on', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omGuidedRetrieval: true,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-17-om-guided:v2');
    expect(resultKeyParts).toContain('step-17-om-guided:v2');
  });

  it('fingerprint includes step-17-om-guided-k:{n} when K is overridden from default 5', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omGuidedRetrieval: true,
        omGuidedRetrievalK: 7,
      } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-17-om-guided-k:7');
  });

  it('fingerprint omits step-17 tags when omGuidedRetrieval is off', () => {
    const { runKeyParts } = computeCaseRunKeyParts(
      {
        reader: 'gpt-4o',
        memoryMode: 'full-cognitive',
        replayMode: 'ingest',
        observationalMemory: true,
        omGuidedRetrieval: false,
      } as RunConfig,
      'case-1',
    );
    expect(
      runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-17-om-guided')),
    ).toBe(false);
  });
});
