/**
 * @file Cache.ts
 * @description Content-hash-keyed persistent cache for bench runs.
 *
 * The benchmark suite makes three kinds of expensive calls — embedding
 * computation, reader LLM inference, and judge LLM grading. A single full
 * sweep without caching costs ~$1.5k–$3k. With warm caches, incremental
 * re-runs drop to ~$50.
 *
 * The cache is intentionally simple: SHA-256 of a canonicalized key → JSON
 * value, stored as one file per entry under `dataDir/cache/<namespace>/`.
 * Stable across runs, cross-platform, no external dependency.
 *
 * Each caller namespaces its entries:
 *   - `embedding` → vector by `(model, content)`
 *   - `reader`    → answer by `(benchId, caseId, reader, memoryMode, replayMode, promptHash)`
 *   - `judge`     → score by `(benchId, caseId, reader, actualOutput, rubricVersion)`
 *
 * @module agentos-bench/core/Cache
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Stable SHA-256 of a canonical JSON serialization of `parts`.
 * Keys are sorted so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically.
 */
export function hashKey(...parts: unknown[]): string {
  const canonical = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p, Object.keys(p as object).sort())))
    .join('\x1f'); // unit-separator — not valid in JSON strings
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Content-hash-keyed JSON cache backed by the local filesystem.
 *
 * @example
 * const cache = new Cache('/path/to/data/cache');
 * const hit = await cache.get<number[]>('embedding', 'text-embedding-3-small', 'hello');
 * if (!hit) {
 *   const vec = await computeEmbedding('hello');
 *   await cache.set('embedding', vec, 'text-embedding-3-small', 'hello');
 * }
 */
export class Cache {
  constructor(private readonly rootDir: string) {}

  /**
   * Look up a cached value. Returns `undefined` on miss.
   * @typeParam T - the JSON-serialisable value type.
   */
  async get<T>(namespace: string, ...keyParts: unknown[]): Promise<T | undefined> {
    const file = this.pathFor(namespace, keyParts);
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  /**
   * Persist a value. Creates the namespace directory lazily.
   */
  async set<T>(namespace: string, value: T, ...keyParts: unknown[]): Promise<void> {
    const file = this.pathFor(namespace, keyParts);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  }

  /**
   * Memoize a potentially-expensive async computation. Returns the cached
   * value if present, otherwise computes, stores, and returns.
   */
  async memoize<T>(
    namespace: string,
    compute: () => Promise<T>,
    ...keyParts: unknown[]
  ): Promise<T> {
    const hit = await this.get<T>(namespace, ...keyParts);
    if (hit !== undefined) return hit;
    const value = await compute();
    await this.set(namespace, value, ...keyParts);
    return value;
  }

  /**
   * Clear an entire namespace. Useful when a rubric version changes and
   * all judge cache entries become stale.
   */
  async clearNamespace(namespace: string): Promise<void> {
    const dir = path.join(this.rootDir, namespace);
    await fs.rm(dir, { recursive: true, force: true });
  }

  private pathFor(namespace: string, keyParts: unknown[]): string {
    const hash = hashKey(...keyParts);
    // 2-char fan-out to keep any single directory small.
    return path.join(this.rootDir, namespace, hash.slice(0, 2), `${hash}.json`);
  }
}
