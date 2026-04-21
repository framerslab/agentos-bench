/**
 * @file redactSecretsFromConfig.spec.ts
 * @description Regression test for the Cohere apiKey leak that could
 * write reranker credentials into `results/runs/*.json` and from there
 * into git history. The redaction path is the single choke point —
 * every code path that persists {@link RunConfig} must go through it.
 *
 * This test pins:
 *   - apiKey is stripped when present
 *   - provider, model, candidateMultiplier survive (cache fingerprinting)
 *   - undefined rerank stays undefined (no spurious object creation)
 *   - non-rerank config fields are unchanged
 */

import { describe, it, expect } from 'vitest';
import { redactSecretsFromConfig } from '../src/core/BenchmarkRunner.js';
import type { RunConfig } from '../src/core/IBenchmark.js';

describe('redactSecretsFromConfig', () => {
  const baseCfg: RunConfig = {
    reader: 'gpt-5-mini',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
  };

  it('strips apiKey from rerank config but keeps provider/model/candidateMultiplier', () => {
    const cfg: RunConfig = {
      ...baseCfg,
      rerank: {
        provider: 'cohere',
        model: 'rerank-v3.5',
        apiKey: 'SECRET_KEY_DO_NOT_COMMIT',
        candidateMultiplier: 3,
      },
    };

    const redacted = redactSecretsFromConfig(cfg);

    expect(redacted.rerank).toEqual({
      provider: 'cohere',
      model: 'rerank-v3.5',
      candidateMultiplier: 3,
    });
    expect(redacted.rerank).not.toHaveProperty('apiKey');
    expect(JSON.stringify(redacted)).not.toContain('SECRET_KEY_DO_NOT_COMMIT');
  });

  it('returns the original config unchanged when rerank is not set', () => {
    const redacted = redactSecretsFromConfig(baseCfg);
    expect(redacted).toBe(baseCfg);
  });

  it('does not mutate the input config', () => {
    const cfg: RunConfig = {
      ...baseCfg,
      rerank: {
        provider: 'cohere',
        apiKey: 'STILL_SECRET',
      },
    };

    redactSecretsFromConfig(cfg);

    // Input still has the apiKey — redaction is non-destructive.
    expect(cfg.rerank?.apiKey).toBe('STILL_SECRET');
  });

  it('preserves non-rerank fields verbatim', () => {
    const cfg: RunConfig = {
      ...baseCfg,
      sampleN: 42,
      concurrency: 8,
      tags: ['phase-a'],
      retrievalProfile: 'balanced',
      ablateSignal: 'similarity',
      rerank: {
        provider: 'cohere',
        apiKey: 'SECRET',
      },
    };

    const redacted = redactSecretsFromConfig(cfg);

    expect(redacted.sampleN).toBe(42);
    expect(redacted.concurrency).toBe(8);
    expect(redacted.tags).toEqual(['phase-a']);
    expect(redacted.retrievalProfile).toBe('balanced');
    expect(redacted.ablateSignal).toBe('similarity');
    expect(redacted.rerank).toEqual({ provider: 'cohere' });
  });

  it('handles rerank with only required provider field', () => {
    const cfg: RunConfig = {
      ...baseCfg,
      rerank: {
        provider: 'cohere',
        apiKey: 'SECRET',
      },
    };

    const redacted = redactSecretsFromConfig(cfg);

    expect(redacted.rerank).toEqual({ provider: 'cohere' });
  });
});
