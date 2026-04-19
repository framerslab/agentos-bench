/**
 * @file MinimalWorkingMemoryBacking.ts
 * @description Small in-process `IWorkingMemory` implementation used by
 * micro-benchmarks. The {@link CognitiveWorkingMemory} wraps an
 * `IWorkingMemory` for key/value storage that it delegates away from
 * the slot management logic. Benchmarks need a fast, dependency-free
 * backing that does not touch the filesystem.
 *
 * @module agentos-bench/micro/support/MinimalWorkingMemoryBacking
 */

import type { IWorkingMemory } from '@framers/agentos/cognitive_substrate/memory/IWorkingMemory';

/**
 * Map-backed IWorkingMemory implementation.
 *
 * Holds no state beyond an in-memory `Map<string, unknown>`. Safe for
 * concurrent micro-benchmark instances because each benchmark creates a
 * fresh backing.
 */
export class MinimalWorkingMemoryBacking implements IWorkingMemory {
  readonly id: string;
  private store = new Map<string, unknown>();

  constructor(id: string = `bench-wm-${Math.random().toString(36).slice(2, 10)}`) {
    this.id = id;
  }

  async initialize(_gmiInstanceId: string, _config?: Record<string, unknown>): Promise<void> {
    // No-op — state lives in the Map.
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async getAll(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.store.entries());
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
