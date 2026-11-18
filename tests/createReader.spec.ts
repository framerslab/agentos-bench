/**
 * @file createReader.spec.ts
 * @description Factory routing contract for the bench's HTTP readers.
 *
 * Covers the three provider branches:
 *   - `gpt-*`     → OpenAIHttpReader (requires OPENAI_API_KEY)
 *   - `claude-*`  → AnthropicHttpReader (requires ANTHROPIC_API_KEY)
 *   - `gemini-*`  → GeminiHttpReader (requires GEMINI_API_KEY)
 *
 * Pure routing contract, no real API calls. End-to-end network behavior
 * is exercised by the bench runner under live API keys; this spec only
 * pins the prefix→class mapping and the missing-key error messages so a
 * future refactor that breaks routing fails CI immediately rather than
 * silently dispatching every reader to the OpenAI client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnthropicHttpReader,
  GeminiHttpReader,
  OpenAIHttpReader,
  createReader,
} from '../src/readers/createReader.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] as const;

describe('createReader factory routing', () => {
  const original: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
  };

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('routes gpt-* models to OpenAIHttpReader', () => {
    process.env.OPENAI_API_KEY = 'test-openai';
    const reader = createReader('gpt-4o');
    expect(reader).toBeInstanceOf(OpenAIHttpReader);
    expect(reader.model).toBe('gpt-4o');
  });

  it('routes claude-* models to AnthropicHttpReader', () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic';
    const reader = createReader('claude-sonnet-4-6');
    expect(reader).toBeInstanceOf(AnthropicHttpReader);
    expect(reader.model).toBe('claude-sonnet-4-6');
  });

  it('routes gemini-* models to GeminiHttpReader', () => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    const reader = createReader('gemini-2.5-flash');
    expect(reader).toBeInstanceOf(GeminiHttpReader);
    expect(reader.model).toBe('gemini-2.5-flash');
  });

  it('throws with a clear message when OPENAI_API_KEY is missing for gpt-*', () => {
    expect(() => createReader('gpt-5-mini')).toThrowError(/OPENAI_API_KEY/);
  });

  it('throws with a clear message when ANTHROPIC_API_KEY is missing for claude-*', () => {
    expect(() => createReader('claude-opus-4-7')).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('throws with a clear message when GEMINI_API_KEY is missing for gemini-*', () => {
    expect(() => createReader('gemini-2.5-pro')).toThrowError(/GEMINI_API_KEY/);
  });

  it('routes all four supported gemini variants to GeminiHttpReader', () => {
    process.env.GEMINI_API_KEY = 'test-gemini';
    const variants = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
    ] as const;
    for (const m of variants) {
      const reader = createReader(m);
      expect(reader).toBeInstanceOf(GeminiHttpReader);
      expect(reader.model).toBe(m);
    }
  });
});

describe('OpenAIHttpReader request fields', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sentBody(model: string): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await new OpenAIHttpReader(model, 'test-key').invoke({
      user: 'question',
      maxTokens: 16,
      temperature: 0,
    });
    return JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as Record<string, unknown>;
  }

  it('calls gpt-6-luna at effort none with max_completion_tokens and no temperature', async () => {
    const body = await sentBody('gpt-6-luna');
    expect(body.reasoning_effort).toBe('none');
    expect(body.max_completion_tokens).toBe(2048);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('calls gpt-6.2-sol at effort low, the lowest it accepts', async () => {
    const body = await sentBody('gpt-6.2-sol');
    expect(body.reasoning_effort).toBe('low');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('keeps max_tokens and temperature for gpt-4o', async () => {
    const body = await sentBody('gpt-4o');
    expect(body.max_tokens).toBe(16);
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});
