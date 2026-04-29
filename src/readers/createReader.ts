/**
 * @file createReader.ts
 * @description Factory returning an {@link IReader} for a given
 * {@link ReaderModel}. Uses a lightweight HTTP implementation rather
 * than pulling the vendor SDKs, so `@framers/agentos-bench` stays
 * install-free unless the caller actually runs an external benchmark.
 *
 * Provider routing is by model-id prefix:
 *
 *   - `gpt-*`     → OpenAI (chat completions)
 *   - `claude-*`  → Anthropic (messages API)
 *   - `gemini-*`  → Google AI Studio (generateContent)
 *
 * Env vars expected at runtime:
 *   - `OPENAI_API_KEY`     for `gpt-*` models
 *   - `ANTHROPIC_API_KEY`  for `claude-*` models
 *   - `GEMINI_API_KEY`     for `gemini-*` models
 *
 * The bench is provider-agnostic at every LLM role (reader, classifier,
 * observer, reflector, judge). Single-provider OpenAI remains the
 * recommended baseline for reproducibility; cross-provider configurations
 * (e.g. `gemini-2.5-flash` observer to reproduce Mastra's published
 * stack) are supported by the same factory contract.
 *
 * If a key is missing, the factory throws with a clear message. Unit
 * tests should inject a {@link MockReader} directly instead of calling
 * this factory.
 *
 * @module agentos-bench/readers/createReader
 */

import type { ReaderModel } from '../core/IBenchmark.js';
import type { IReader, ReaderRequest, ReaderResponse } from './IReader.js';

/**
 * Per-request HTTP timeout in milliseconds for the bench's bare-fetch
 * reader adapters. A hung TCP socket / unresponsive provider would
 * otherwise deadlock long-running ingest pipelines indefinitely —
 * Stage E was repeatedly observed hanging at 0% CPU for hours with
 * established-but-idle sockets to OpenAI before this default landed.
 *
 * Override per-call via {@link ReaderRequest.timeoutMs} (not yet wired)
 * or globally by setting `AGENTOS_BENCH_READER_TIMEOUT_MS` in the env.
 * Defaults to 120 s so single slow gpt-4o calls (long contexts +
 * reasoning) still complete; misbehaving connections fail fast.
 */
const DEFAULT_READER_TIMEOUT_MS = (() => {
  const fromEnv = Number(process.env.AGENTOS_BENCH_READER_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 120_000;
})();

/**
 * Wrap a fetch with an AbortController-backed timeout. On timeout,
 * throws a clear error pointing at the URL + elapsed budget so the
 * bench can attribute the failure to the right provider in case
 * logs.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_READER_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`agentos-bench reader: request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Construct a reader for `model`. Chooses between OpenAI, Anthropic,
 * and Google AI Studio based on the model-id prefix. Throws with a
 * specific error message when the matching API key is not set.
 */
export function createReader(model: ReaderModel): IReader {
  if (model.startsWith('gpt-')) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(`agentos-bench: OPENAI_API_KEY not set, required for reader '${model}'.`);
    }
    return new OpenAIHttpReader(model, apiKey);
  }
  if (model.startsWith('claude-')) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(`agentos-bench: ANTHROPIC_API_KEY not set, required for reader '${model}'.`);
    }
    return new AnthropicHttpReader(model, apiKey);
  }
  if (model.startsWith('gemini-')) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(`agentos-bench: GEMINI_API_KEY not set, required for reader '${model}'.`);
    }
    return new GeminiHttpReader(model, apiKey);
  }
  throw new Error(`agentos-bench: no reader configured for model '${model}'.`);
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions API)
// ---------------------------------------------------------------------------

/**
 * Minimal OpenAI chat-completions client. Uses global `fetch`
 * (Node 18+). Non-streaming; benchmarks don't need token streaming.
 */
export class OpenAIHttpReader implements IReader {
  readonly model: string;

  constructor(
    model: string,
    private readonly apiKey: string
  ) {
    this.model = model;
  }

  async invoke(req: ReaderRequest): Promise<ReaderResponse> {
    const start = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    // GPT-5 family rejects `max_tokens` — they require `max_completion_tokens`
    // and refuse non-default temperatures. The older chat-completions path
    // keeps using `max_tokens` for GPT-4o / GPT-4 / GPT-3.5 compatibility.
    const isGpt5 = /^gpt-5/.test(this.model);
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (isGpt5) {
      // GPT-5 models use `max_completion_tokens` AND consume some of that
      // budget on internal reasoning tokens before producing visible
      // output. A 256-token budget often gets fully spent on reasoning,
      // leaving empty `message.content`. Scale up so there's room for
      // both, and ask for minimal reasoning where the API supports it.
      requestBody.max_completion_tokens = Math.max(req.maxTokens ?? 512, 2048);
      requestBody.reasoning_effort = 'minimal';
      // GPT-5 only accepts temperature=1 (the default). Omit to avoid 400.
    } else {
      // GPT-4-class models (gpt-4o, gpt-4o-mini, etc.) cap completion
      // tokens at 16384 — the API rejects requests with max_tokens
      // exceeding that ceiling. Clamp defensively at 16000 so callers
      // who pass the OM_DEFAULTS observer/reflector budget (100_000,
      // sized for Gemini) don't hit silent API failures.
      const GPT4O_MAX_COMPLETION_TOKENS = 16000;
      requestBody.max_tokens = Math.min(req.maxTokens ?? 512, GPT4O_MAX_COMPLETION_TOKENS);
      requestBody.temperature = req.temperature ?? 0;
    }

    const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI API error ${resp.status}: ${await resp.text()}`);
    }

    const responseBody = (await resp.json()) as {
      choices: Array<{ message: { content: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    return {
      text: (responseBody.choices[0]?.message.content ?? '').trimEnd(),
      tokensIn: responseBody.usage?.prompt_tokens ?? 0,
      tokensOut: responseBody.usage?.completion_tokens ?? 0,
      model: responseBody.model ?? this.model,
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API)
// ---------------------------------------------------------------------------

/**
 * Minimal Anthropic messages client. Uses the public REST surface so we
 * don't pull in the full SDK; benchmarks only need a single endpoint.
 */
export class AnthropicHttpReader implements IReader {
  readonly model: string;

  constructor(
    model: string,
    private readonly apiKey: string
  ) {
    this.model = model;
  }

  async invoke(req: ReaderRequest): Promise<ReaderResponse> {
    const start = Date.now();

    const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    }

    const body = (await resp.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };

    const text = body.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('')
      .trimEnd();

    return {
      text,
      tokensIn: body.usage?.input_tokens ?? 0,
      tokensOut: body.usage?.output_tokens ?? 0,
      model: body.model ?? this.model,
      latencyMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Google AI Studio (generateContent API)
// ---------------------------------------------------------------------------

/**
 * Minimal Google AI Studio client for the Gemini family. Targets the
 * `v1beta/models/{model}:generateContent` REST endpoint so we don't pull
 * in `@google/generative-ai`. The Gemini request body diverges from the
 * OpenAI / Anthropic shape:
 *
 *   - User content goes in `contents[].parts[].text` with `role: "user"`
 *   - System prompt goes in `systemInstruction.parts[].text`
 *   - Generation params live under `generationConfig`
 *
 * Token accounting is reported via `usageMetadata.{promptTokenCount,
 * candidatesTokenCount}` which map cleanly onto our existing
 * `tokensIn`/`tokensOut` accounting.
 */
export class GeminiHttpReader implements IReader {
  readonly model: string;

  constructor(
    model: string,
    private readonly apiKey: string
  ) {
    this.model = model;
  }

  async invoke(req: ReaderRequest): Promise<ReaderResponse> {
    const start = Date.now();

    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: req.user }],
        },
      ],
      generationConfig: {
        temperature: req.temperature ?? 0,
        maxOutputTokens: req.maxTokens ?? 512,
      },
    };

    if (req.system) {
      body.systemInstruction = {
        parts: [{ text: req.system }],
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
    }

    const responseBody = (await resp.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
      modelVersion?: string;
    };

    const text = (responseBody.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trimEnd();

    return {
      text,
      tokensIn: responseBody.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: responseBody.usageMetadata?.candidatesTokenCount ?? 0,
      model: responseBody.modelVersion ?? this.model,
      latencyMs: Date.now() - start,
    };
  }
}
