/**
 * @file CachedEmbedder.spec.ts
 * @description Unit tests for the persistent on-disk embedding cache.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CachedEmbedder } from '../src/cognitive/CachedEmbedder.js';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  IEmbeddingManager,
} from '@framers/agentos/core/embeddings/IEmbeddingManager';

function mockInner(dimension: number = 4): IEmbeddingManager {
  const calls: number[] = [];
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    generateEmbeddings: vi.fn(async (req: EmbeddingRequest) => {
      const texts = Array.isArray(req.texts) ? req.texts : [req.texts];
      calls.push(texts.length);
      // Deterministic fake embedding: sum codepoints modulo 1 per dim.
      const embeddings = texts.map((t) =>
        Array.from({ length: dimension }, (_, i) => ((t.charCodeAt(0) ?? 0) + i) / 256),
      );
      return {
        embeddings,
        modelId: 'mock-embed',
        providerId: 'mock',
        usage: { inputTokens: texts.length * 10, totalTokens: texts.length * 10 },
      } as EmbeddingResponse;
    }),
    getEmbeddingModelInfo: vi.fn().mockResolvedValue({
      id: 'mock-embed',
      provider: 'mock',
      dimension,
      maxTokens: 8192,
    }),
    getEmbeddingDimension: vi.fn().mockResolvedValue(dimension),
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as IEmbeddingManager & { calls: number[] };
}

describe('CachedEmbedder', () => {
  let tmpRoot: string;
  let cacheDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'embed-cache-'));
    cacheDir = path.join(tmpRoot, 'cache');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('passes through to inner on cold cache', async () => {
    const inner = mockInner();
    const embedder = new CachedEmbedder(inner, { cacheDir, modelId: 'mock-embed' });
    const res = await embedder.generateEmbeddings({ texts: ['hello world'] });
    expect(res.embeddings).toHaveLength(1);
    expect(inner.generateEmbeddings).toHaveBeenCalledTimes(1);
    expect(embedder.stats.misses).toBe(1);
    expect(embedder.stats.hits).toBe(0);
  });

  it('returns identical embeddings on warm cache without calling inner', async () => {
    const inner = mockInner();
    const a = new CachedEmbedder(inner, { cacheDir, modelId: 'mock-embed' });
    const firstResult = await a.generateEmbeddings({ texts: ['repeat me'] });

    // Fresh embedder, same cache directory → second call should be a hit.
    const inner2 = mockInner();
    const b = new CachedEmbedder(inner2, { cacheDir, modelId: 'mock-embed' });
    const secondResult = await b.generateEmbeddings({ texts: ['repeat me'] });

    expect(secondResult.embeddings).toEqual(firstResult.embeddings);
    expect(inner2.generateEmbeddings).not.toHaveBeenCalled();
    expect(b.stats.hits).toBe(1);
    expect(b.stats.misses).toBe(0);
  });

  it('splits a batch into cached hits and missed texts, calling inner only for misses', async () => {
    const inner = mockInner();
    const embedder = new CachedEmbedder(inner, { cacheDir, modelId: 'mock-embed' });
    await embedder.generateEmbeddings({ texts: ['alpha', 'beta'] });

    const inner2 = mockInner();
    const embedder2 = new CachedEmbedder(inner2, { cacheDir, modelId: 'mock-embed' });
    const result = await embedder2.generateEmbeddings({ texts: ['alpha', 'beta', 'gamma'] });

    expect(result.embeddings).toHaveLength(3);
    expect(inner2.generateEmbeddings).toHaveBeenCalledTimes(1);
    // Inner was called with the 1 missed text only.
    const innerCall = (inner2.generateEmbeddings as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as EmbeddingRequest;
    const innerTexts = Array.isArray(innerCall.texts) ? innerCall.texts : [innerCall.texts];
    expect(innerTexts).toEqual(['gamma']);
    expect(embedder2.stats.hits).toBe(2);
    expect(embedder2.stats.misses).toBe(1);
  });

  it('keys include modelId — different models do not collide', async () => {
    const innerSmall = mockInner(4);
    const a = new CachedEmbedder(innerSmall, {
      cacheDir,
      modelId: 'text-embedding-3-small',
    });
    await a.generateEmbeddings({ texts: ['clash key'] });

    // Same text, different model: cache must miss.
    const innerLarge = mockInner(8);
    const b = new CachedEmbedder(innerLarge, {
      cacheDir,
      modelId: 'text-embedding-3-large',
    });
    await b.generateEmbeddings({ texts: ['clash key'] });
    expect(innerLarge.generateEmbeddings).toHaveBeenCalled();
    expect(b.stats.hits).toBe(0);
  });

  it('delegates non-cache calls (dimension, health) to inner', async () => {
    const inner = mockInner();
    const embedder = new CachedEmbedder(inner, { cacheDir, modelId: 'mock-embed' });
    const dim = await embedder.getEmbeddingDimension?.();
    const health = await embedder.checkHealth?.();
    expect(dim).toBe(4);
    expect(health?.isHealthy).toBe(true);
  });

  it('initialize creates the cache directory', async () => {
    const inner = mockInner();
    const embedder = new CachedEmbedder(inner, { cacheDir, modelId: 'mock-embed' });
    await embedder.initialize?.({} as never);
    const stat = await fs.stat(cacheDir);
    expect(stat.isDirectory()).toBe(true);
  });
});
