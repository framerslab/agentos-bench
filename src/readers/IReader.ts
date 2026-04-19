/**
 * @file IReader.ts
 * @description Minimal LLM invocation contract used by benchmarks and judges.
 *
 * The bench suite abstracts away provider-specific SDKs behind a small
 * interface: give the reader a system + user prompt, get back text and
 * token counts. This lets us:
 *
 * - Swap real Anthropic / OpenAI readers for deterministic mocks in tests
 * - Run benchmarks inside environments where only one provider is configured
 * - Plug in AgentOS's unified LLM router in the future without touching
 *   any benchmark adapter code
 *
 * All readers must populate `tokensIn` / `tokensOut` honestly — the
 * {@link CostTracker} relies on them to enforce the `--max-usd` budget.
 *
 * @module agentos-bench/readers/IReader
 */

import type { ReaderModel } from '../core/IBenchmark.js';

/**
 * A single generation request.
 */
export interface ReaderRequest {
  /** System prompt (memory context goes here for external benchmarks). */
  system?: string;
  /** User-message content — the actual question in most cases. */
  user: string;
  /** Max tokens to generate. Defaults to 512. */
  maxTokens?: number;
  /** Sampling temperature. Defaults to 0.0 for benchmark determinism. */
  temperature?: number;
}

/**
 * A single generation result.
 */
export interface ReaderResponse {
  /** Model's text output (trailing whitespace trimmed). */
  text: string;
  /** Prompt tokens (including system). */
  tokensIn: number;
  /** Completion tokens. */
  tokensOut: number;
  /** Which model actually answered — may differ from requested for routed providers. */
  model: string;
  /** Wall-clock duration in ms. */
  latencyMs: number;
}

/**
 * An LLM that the bench suite can invoke.
 *
 * Implementations:
 * - {@link MockReader} — deterministic canned responses (tests).
 * - {@link OpenAIReader} — real `openai` SDK calls (GPT-4o, GPT-4o-mini).
 * - {@link AnthropicReader} — real `@anthropic-ai/sdk` calls (Claude).
 *
 * Callers pick the implementation based on `RunConfig.reader` via
 * {@link createReader}.
 */
export interface IReader {
  /** Human-readable model identifier for cost + provenance. */
  readonly model: string;

  /** Produce one response. Must throw on API errors (retry is the runner's job). */
  invoke(req: ReaderRequest): Promise<ReaderResponse>;
}
