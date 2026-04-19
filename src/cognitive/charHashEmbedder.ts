/**
 * @file charHashEmbedder.ts
 * @description Deterministic char-hash stub of `IEmbeddingManager`.
 *
 * Used by the full-cognitive benchmark path so tests and CI runs can
 * exercise `CognitiveMemoryManager` without calling a real embedding
 * API (and without requiring `OPENAI_API_KEY`). The embedding function
 * is:
 *
 *   For each token (lowercased whitespace-split word):
 *     - bucket = hash(token) mod DIM
 *     - vec[bucket] += 1
 *   Then L2-normalize.
 *
 * The resulting vectors are deterministic, cheap, and preserve enough
 * lexical signal that the FTS-less retrieval path ranks literal matches
 * above unrelated traces. They are NOT semantically meaningful — real
 * benchmark sweeps should swap this for an API-backed embedder.
 *
 * Only the methods of `IEmbeddingManager` actually invoked by
 * {@link CognitiveMemoryManager} and its downstream paths are
 * implemented with real logic; the others throw to surface accidental
 * reliance quickly.
 *
 * @module agentos-bench/cognitive/charHashEmbedder
 */

import type {
  IEmbeddingManager,
  EmbeddingRequest,
  EmbeddingResponse,
} from '@framers/agentos/core/embeddings/IEmbeddingManager';
import type { EmbeddingModelConfig } from '@framers/agentos/core/config/EmbeddingManagerConfiguration';

/** Vector dimensionality for the stub. 128 is small, sufficient, and fast. */
export const CHAR_HASH_DIM = 128;

/**
 * Char-hash `IEmbeddingManager` with deterministic, lexical-ish output.
 */
export class CharHashEmbedder implements IEmbeddingManager {
  readonly modelId: string;

  constructor(modelId: string = 'char-hash-stub-v1') {
    this.modelId = modelId;
  }

  async initialize(): Promise<void> {
    // No-op — state is immutable.
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const texts = Array.isArray(request.texts) ? request.texts : [request.texts];
    const embeddings = texts.map((text) => embed(text, CHAR_HASH_DIM));
    // Rough token accounting: ~one token per 4 characters in ASCII.
    const tokensUsed = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    return {
      embeddings,
      modelId: this.modelId,
      providerId: 'char-hash',
      usage: {
        inputTokens: tokensUsed,
        totalTokens: tokensUsed,
      },
    };
  }

  async getEmbeddingModelInfo(_modelId?: string): Promise<EmbeddingModelConfig | undefined> {
    return {
      id: this.modelId,
      provider: 'char-hash',
      dimension: CHAR_HASH_DIM,
      maxTokens: 1_000_000,
    } as unknown as EmbeddingModelConfig;
  }

  async getEmbeddingDimension(_modelId?: string): Promise<number> {
    return CHAR_HASH_DIM;
  }

  /** Synchronous convenience — matches the bench's `ScoringContext` needs. */
  getDimension(): number {
    return CHAR_HASH_DIM;
  }

  async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    return { isHealthy: true, details: { provider: 'char-hash', dimension: CHAR_HASH_DIM } };
  }

  async shutdown(): Promise<void> {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Embedding function
// ---------------------------------------------------------------------------

/**
 * Hash `text` into a `dim`-dimensional L2-normalised vector.
 * Exported for direct testing.
 */
export function embed(text: string, dim: number = CHAR_HASH_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    const bucket = fnv1a(token) % dim;
    vec[bucket] += 1;
  }
  // L2 normalise so cosine similarity lands in [-1, 1].
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  for (let i = 0; i < dim; i++) vec[i] = vec[i]! / norm;
  return vec;
}

/** Tiny FNV-1a 32-bit hash. Deterministic, adequate for bucketing. */
function fnv1a(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
