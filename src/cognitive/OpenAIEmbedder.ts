/**
 * @file OpenAIEmbedder.ts
 * @description `IEmbeddingManager` adapter that delegates to AgentOS's
 * first-class {@link embedText} helper.
 *
 * AgentOS already ships provider-agnostic embedding support in
 * `api/embedText` (OpenAI, Ollama, OpenRouter, Azure-compatible
 * endpoints). This file is a thin adapter that presents that helper
 * as the `IEmbeddingManager` interface `CognitiveMemoryManager` expects,
 * so the bench inherits AgentOS's multi-provider dispatch, env-var
 * handling, dimension overrides, and usage-ledger hooks automatically.
 *
 * The class name stays OpenAI-centric because that's the default path
 * bench runs actually take, but the constructor accepts any
 * `provider:model` string that `embedText` can resolve —
 * `ollama:nomic-embed-text`, `openrouter:…`, or just `text-embedding-3-small`.
 *
 * @module agentos-bench/cognitive/OpenAIEmbedder
 */

import { embedText } from '@framers/agentos/api/embedText';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  IEmbeddingManager,
} from '@framers/agentos/core/embeddings/IEmbeddingManager';
import type { EmbeddingModelConfig } from '@framers/agentos/core/config/EmbeddingManagerConfiguration';

/**
 * Default embedding model. Includes the explicit `openai:` prefix so
 * AgentOS's provider resolver skips the env-var heuristic — handy when
 * both OPENAI_API_KEY and OLLAMA_HOST happen to be set.
 */
export const DEFAULT_OPENAI_EMBED_MODEL = 'openai:text-embedding-3-small';

/** Reported dimensions for commonly-used models (no API round-trip). */
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'openai:text-embedding-3-small': 1536,
  'openai:text-embedding-3-large': 3072,
  'nomic-embed-text': 768,
  'ollama:nomic-embed-text': 768,
};

/**
 * Options for constructing an {@link OpenAIEmbedder}.
 */
export interface OpenAIEmbedderOptions {
  /**
   * Optional API key override. When omitted, AgentOS resolves the key
   * from the appropriate environment variable during provider
   * resolution (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, etc.).
   */
  apiKey?: string;
  /**
   * Model identifier. Accepts `provider:id`
   * (`openai:text-embedding-3-small`, `ollama:nomic-embed-text`) or a
   * plain model id that AgentOS's default-provider logic can resolve.
   */
  modelId?: string;
  /**
   * Optional dimension override for models that support it
   * (`text-embedding-3-*`). Ignored by fixed-dimension models.
   */
  dimensions?: number;
  /** Optional base URL override — useful for Azure or a local proxy. */
  baseUrl?: string;
}

/**
 * AgentOS-backed `IEmbeddingManager`. Every call funnels through
 * {@link embedText}, so the bench uses AgentOS's first-class embedding
 * path instead of duplicating HTTP client logic.
 */
export class OpenAIEmbedder implements IEmbeddingManager {
  readonly modelId: string;
  private readonly apiKey?: string;
  private readonly baseUrl?: string;
  private readonly dimensions?: number;

  constructor(opts: OpenAIEmbedderOptions = {}) {
    this.modelId = opts.modelId ?? DEFAULT_OPENAI_EMBED_MODEL;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.dimensions = opts.dimensions;
  }

  async initialize(): Promise<void> {
    /* no-op — stateless */
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const texts = Array.isArray(request.texts) ? request.texts : [request.texts];
    if (texts.length === 0) {
      return {
        embeddings: [],
        modelId: this.modelId,
        providerId: providerIdFor(this.modelId),
        usage: { inputTokens: 0, totalTokens: 0 },
      };
    }

    const result = await embedText({
      model: this.modelId,
      input: texts,
      ...(this.dimensions ? { dimensions: this.dimensions } : {}),
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}),
    });

    return {
      embeddings: result.embeddings,
      modelId: result.model,
      providerId: result.provider,
      usage: {
        inputTokens: result.usage.promptTokens,
        totalTokens: result.usage.totalTokens,
      },
    };
  }

  async getEmbeddingModelInfo(_modelId?: string): Promise<EmbeddingModelConfig | undefined> {
    const dim = this.dimensions ?? MODEL_DIMENSIONS[this.modelId] ?? 1536;
    return {
      id: this.modelId,
      provider: providerIdFor(this.modelId),
      dimension: dim,
      maxTokens: 8192,
    } as unknown as EmbeddingModelConfig;
  }

  async getEmbeddingDimension(_modelId?: string): Promise<number> {
    return this.dimensions ?? MODEL_DIMENSIONS[this.modelId] ?? 1536;
  }

  async checkHealth(): Promise<{ isHealthy: boolean; details?: unknown }> {
    return {
      isHealthy: true,
      details: {
        provider: providerIdFor(this.modelId),
        model: this.modelId,
        dimensions: this.dimensions ?? MODEL_DIMENSIONS[this.modelId],
      },
    };
  }

  async shutdown(): Promise<void> {
    /* no-op — stateless */
  }
}

/**
 * Construct an embedder using AgentOS's standard env-var resolution.
 * Throws early for OpenAI models when `OPENAI_API_KEY` is unset so
 * callers fail fast instead of hitting a cryptic 401 mid-run; for other
 * providers the check is skipped (Ollama, OpenRouter, etc. use their
 * own env vars resolved inside `embedText`).
 */
export function createOpenAIEmbedderFromEnv(
  modelId: string = DEFAULT_OPENAI_EMBED_MODEL,
): OpenAIEmbedder {
  if (providerIdFor(modelId) === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error(
      `createOpenAIEmbedderFromEnv: OPENAI_API_KEY is not set. Source your wilds-ai/.env.local or export it manually.`,
    );
  }
  return new OpenAIEmbedder({ modelId });
}

function providerIdFor(modelId: string): string {
  const idx = modelId.indexOf(':');
  return idx > 0 ? modelId.slice(0, idx) : 'openai';
}
