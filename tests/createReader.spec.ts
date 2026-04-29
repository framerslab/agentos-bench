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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
