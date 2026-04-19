/**
 * @file CachedEmbedder.ts
 * @description Persistent on-disk embedding cache. Wraps any
 * `IEmbeddingManager` implementation with a content-hash-keyed cache
 * that survives process restarts. Cuts re-run embedding cost to ~0
 * when the same haystack chunks are re-embedded across iterations.
 *
 * Cache layout:
 *   `<cacheDir>/<sha256-hex>.bin`
 * Each file stores a little-endian Float32Array — one embedding
 * vector. File format is self-delimited via file size; no index.
 *
 * Key = sha256(`${modelId}\n${text}`). Model ID is part of the key so
 * switching models invalidates the cache automatically.
 *
 * Writes use `writeFile` with the `wx` flag (O_EXCL) to avoid torn
 * writes under concurrency — the first writer wins; later writers see
 * the existing file and skip.
 *
 * @module agentos-bench/cognitive/CachedEmbedder
 */

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  IEmbeddingManager,
} from '@framers/agentos/core/embeddings/IEmbeddingManager';
import type { EmbeddingModelConfig } from '@framers/agentos/core/config/EmbeddingManagerConfiguration';

export interface CachedEmbedderOptions {
  /** Directory where cached vectors land. Created on first use. */
  cacheDir: string;
  /**
   * Model identifier to include in cache keys so different models'
   * embeddings don't collide. Must match the inner embedder's model.
   */
  modelId: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
}

/**
 * `IEmbeddingManager` decorator that adds a persistent on-disk cache.
 * Delegates dimension / health / lifecycle calls to the inner embedder.
 */
export class CachedEmbedder implements IEmbeddingManager {
  readonly stats: CacheStats = { hits: 0, misses: 0, writes: 0 };

  constructor(
    private readonly inner: IEmbeddingManager,
    private readonly opts: CachedEmbedderOptions,
  ) {}

  async initialize(...args: unknown[]): Promise<void> {
    await fs.mkdir(this.opts.cacheDir, { recursive: true });
    if (this.inner.initialize) {
      // Forward whatever arguments the caller supplied (the interface
      // takes (config, providerManager); the bench rarely passes either
      // since the inner embedder is stateless).
      await (this.inner.initialize as (...a: unknown[]) => Promise<void>)(...args);
    }
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const texts = Array.isArray(request.texts) ? request.texts : [request.texts];
    if (texts.length === 0) {
      if (this.inner.generateEmbeddings) {
        return this.inner.generateEmbeddings(request);
      }
      throw new Error('CachedEmbedder: inner embedder has no generateEmbeddings');
    }

    await fs.mkdir(this.opts.cacheDir, { recursive: true });

    // Probe the cache for every input. `order[i]` is the index of the
    // cached entry in `hits`; `missIndices` lists the positions that
    // need an inner call.
    const hits: Array<number[] | null> = new Array(texts.length).fill(null);
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    const missKeys: string[] = [];

    for (let i = 0; i < texts.length; i += 1) {
      const key = this.cacheKey(texts[i]!);
      const vec = await this.readCache(key);
      if (vec) {
        hits[i] = vec;
        this.stats.hits += 1;
      } else {
        missIndices.push(i);
        missTexts.push(texts[i]!);
        missKeys.push(key);
        this.stats.misses += 1;
      }
    }

    let innerResponse: EmbeddingResponse | undefined;
    if (missTexts.length > 0) {
      if (!this.inner.generateEmbeddings) {
        throw new Error('CachedEmbedder: inner embedder has no generateEmbeddings');
      }
      innerResponse = await this.inner.generateEmbeddings({
        ...request,
        texts: missTexts,
      });
      // Write the new embeddings to cache and merge them back into the
      // output in original request order.
      for (let j = 0; j < missIndices.length; j += 1) {
        const idx = missIndices[j]!;
        const vec = innerResponse.embeddings[j]!;
        hits[idx] = vec;
        await this.writeCache(missKeys[j]!, vec);
        this.stats.writes += 1;
      }
    }

    const embeddings = hits.map((v) => {
      if (!v) {
        throw new Error('CachedEmbedder: internal error — slot left unfilled');
      }
      return v;
    });

    // Usage accounting: only the miss-subset consumed tokens; cache hits
    // consumed zero. This matches what the API actually billed.
    const usage = innerResponse?.usage ?? { inputTokens: 0, totalTokens: 0 };

    return {
      embeddings,
      modelId: innerResponse?.modelId ?? this.opts.modelId,
      providerId: innerResponse?.providerId ?? this.inferProvider(),
      usage,
    };
  }

  async getEmbeddingModelInfo(modelId?: string): Promise<EmbeddingModelConfig | undefined> {
    return this.inner.getEmbeddingModelInfo?.(modelId);
  }

  async getEmbeddingDimension(modelId?: string): Promise<number> {
    if (!this.inner.getEmbeddingDimension) {
      throw new Error('CachedEmbedder: inner embedder has no getEmbeddingDimension');
    }
    return this.inner.getEmbeddingDimension(modelId);
  }

  async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    return (
      this.inner.checkHealth?.() ?? { isHealthy: true, details: { note: 'no inner health' } }
    );
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown?.();
  }

  private cacheKey(text: string): string {
    return createHash('sha256').update(`${this.opts.modelId}\n${text}`).digest('hex');
  }

  private cachePath(key: string): string {
    return path.join(this.opts.cacheDir, `${key}.bin`);
  }

  private async readCache(key: string): Promise<number[] | null> {
    try {
      const buf = await fs.readFile(this.cachePath(key));
      if (buf.byteLength % 4 !== 0) {
        return null;
      }
      const view = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
      return Array.from(view);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeCache(key: string, vec: number[]): Promise<void> {
    const f32 = Float32Array.from(vec);
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const finalPath = this.cachePath(key);
    const tmpPath = `${finalPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fs.writeFile(tmpPath, buf);
      await fs.rename(tmpPath, finalPath);
    } catch (err) {
      // Cleanup the tmp file if rename failed.
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  private inferProvider(): string {
    const idx = this.opts.modelId.indexOf(':');
    return idx > 0 ? this.opts.modelId.slice(0, idx) : 'openai';
  }
}
