/**
 * @file createReader.ts
 * @description Factory returning an {@link IReader} for a given
 * {@link ReaderModel}. Uses a lightweight HTTP implementation rather
 * than pulling the vendor SDKs, so `@framers/agentos-bench` stays
 * install-free unless the caller actually runs an external benchmark.
 *
 * Env vars expected at runtime:
 *   - `OPENAI_API_KEY`  — required for `gpt-4o*` models
 *   - `ANTHROPIC_API_KEY` — required for `claude-*` models
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
 * Construct a reader for `model`. Chooses between OpenAI and Anthropic
 * based on the model name prefix.
 */
export function createReader(model: ReaderModel): IReader {
  if (model.startsWith('gpt-')) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(`agentos-bench: OPENAI_API_KEY not set — required for reader '${model}'.`);
    }
    return new OpenAIHttpReader(model, apiKey);
  }
  if (model.startsWith('claude-')) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(`agentos-bench: ANTHROPIC_API_KEY not set — required for reader '${model}'.`);
    }
    return new AnthropicHttpReader(model, apiKey);
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

  constructor(model: string, private readonly apiKey: string) {
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
      requestBody.max_tokens = req.maxTokens ?? 512;
      requestBody.temperature = req.temperature ?? 0;
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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

  constructor(model: string, private readonly apiKey: string) {
    this.model = model;
  }

  async invoke(req: ReaderRequest): Promise<ReaderResponse> {
    const start = Date.now();

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
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
