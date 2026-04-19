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

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: req.maxTokens ?? 512,
        temperature: req.temperature ?? 0,
      }),
    });

    if (!resp.ok) {
      throw new Error(`OpenAI API error ${resp.status}: ${await resp.text()}`);
    }

    const body = (await resp.json()) as {
      choices: Array<{ message: { content: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    return {
      text: (body.choices[0]?.message.content ?? '').trimEnd(),
      tokensIn: body.usage?.prompt_tokens ?? 0,
      tokensOut: body.usage?.completion_tokens ?? 0,
      model: body.model ?? this.model,
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
