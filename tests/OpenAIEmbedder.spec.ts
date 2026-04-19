/**
 * @file OpenAIEmbedder.spec.ts
 * @description Unit tests for OpenAIEmbedder — the thin adapter that
 * presents AgentOS's first-class {@link embedText} as an
 * `IEmbeddingManager`. Mocks `embedText` so no real API call goes out
 * in CI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mocks must be registered before the module under test is imported.
vi.mock('@framers/agentos/api/embedText', () => ({
  embedText: vi.fn(),
}));

import { embedText } from '@framers/agentos/api/embedText';
import {
  DEFAULT_OPENAI_EMBED_MODEL,
  OpenAIEmbedder,
  createOpenAIEmbedderFromEnv,
} from '../src/cognitive/OpenAIEmbedder.js';

const mockEmbedText = embedText as unknown as ReturnType<typeof vi.fn>;

describe('OpenAIEmbedder', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.OPENAI_API_KEY;
    mockEmbedText.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('defaults to openai:text-embedding-3-small (1536 dimensions)', async () => {
    const e = new OpenAIEmbedder();
    expect(e.modelId).toBe(DEFAULT_OPENAI_EMBED_MODEL);
    expect(await e.getEmbeddingDimension()).toBe(1536);
  });

  it('returns empty embeddings for empty input without calling embedText', async () => {
    const e = new OpenAIEmbedder();
    const resp = await e.generateEmbeddings({ texts: [] });
    expect(resp.embeddings).toEqual([]);
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('delegates to embedText with the configured model and forwards the response', async () => {
    mockEmbedText.mockResolvedValueOnce({
      embeddings: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      model: 'text-embedding-3-small',
      provider: 'openai',
      usage: { promptTokens: 10, totalTokens: 10 },
    });

    const e = new OpenAIEmbedder();
    const resp = await e.generateEmbeddings({ texts: ['hello', 'world'] });

    expect(resp.embeddings).toHaveLength(2);
    expect(resp.providerId).toBe('openai');
    expect(resp.usage.totalTokens).toBe(10);

    expect(mockEmbedText).toHaveBeenCalledTimes(1);
    const call = mockEmbedText.mock.calls[0]![0];
    expect(call.model).toBe(DEFAULT_OPENAI_EMBED_MODEL);
    expect(call.input).toEqual(['hello', 'world']);
  });

  it('passes apiKey / baseUrl / dimensions through to embedText when provided', async () => {
    mockEmbedText.mockResolvedValueOnce({
      embeddings: [[0]],
      model: 'text-embedding-3-small',
      provider: 'openai',
      usage: { promptTokens: 1, totalTokens: 1 },
    });
    const e = new OpenAIEmbedder({
      apiKey: 'sk-override',
      baseUrl: 'https://example-proxy.local',
      dimensions: 256,
      modelId: 'openai:text-embedding-3-small',
    });
    await e.generateEmbeddings({ texts: ['x'] });
    const call = mockEmbedText.mock.calls[0]![0];
    expect(call.apiKey).toBe('sk-override');
    expect(call.baseUrl).toBe('https://example-proxy.local');
    expect(call.dimensions).toBe(256);
  });

  it('accepts ollama / openrouter model strings without requiring OPENAI_API_KEY', () => {
    const ollama = new OpenAIEmbedder({ modelId: 'ollama:nomic-embed-text' });
    expect(ollama).toBeInstanceOf(OpenAIEmbedder);
    const router = new OpenAIEmbedder({ modelId: 'openrouter:custom' });
    expect(router).toBeInstanceOf(OpenAIEmbedder);
  });

  it('surfaces embedText errors to the caller', async () => {
    mockEmbedText.mockRejectedValueOnce(new Error('401 Unauthorized'));
    const e = new OpenAIEmbedder();
    await expect(() => e.generateEmbeddings({ texts: ['x'] })).rejects.toThrow(
      /401 Unauthorized/,
    );
  });

  it('createOpenAIEmbedderFromEnv throws when OPENAI_API_KEY is missing for openai models', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => createOpenAIEmbedderFromEnv()).toThrow(/OPENAI_API_KEY is not set/);
  });

  it('createOpenAIEmbedderFromEnv skips the env check for non-openai providers', () => {
    delete process.env.OPENAI_API_KEY;
    // Ollama doesn't need OPENAI_API_KEY — factory must not throw.
    const e = createOpenAIEmbedderFromEnv('ollama:nomic-embed-text');
    expect(e).toBeInstanceOf(OpenAIEmbedder);
  });

  it('createOpenAIEmbedderFromEnv honours OPENAI_API_KEY and returns an embedder', () => {
    process.env.OPENAI_API_KEY = 'sk-from-env';
    const e = createOpenAIEmbedderFromEnv();
    expect(e).toBeInstanceOf(OpenAIEmbedder);
    expect(e.modelId).toBe(DEFAULT_OPENAI_EMBED_MODEL);
  });
});
