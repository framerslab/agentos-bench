/**
 * @file MockReader.ts
 * @description Deterministic mock reader for unit tests.
 *
 * Test code registers (request-predicate → response) pairs. Each
 * `invoke` call walks the handler list in order and returns the first
 * match. Unmatched requests fall through to the default response, so
 * tests can either script every reply or just set a sensible default.
 *
 * @module agentos-bench/readers/MockReader
 */

import type { IReader, ReaderRequest, ReaderResponse } from './IReader.js';

/**
 * A handler that converts a matched request into a response. Handlers
 * may observe the request synchronously or return a Promise.
 */
export type MockHandler = (req: ReaderRequest) => ReaderResponse | Promise<ReaderResponse>;

/**
 * A (predicate, handler) pair. The predicate receives the request; if
 * it returns true, the handler is invoked.
 */
export interface MockRoute {
  match: (req: ReaderRequest) => boolean;
  respond: MockHandler;
}

/**
 * Default "echo" response for unmatched requests — enough for tests
 * that don't care about the exact text, while making accidental
 * fall-through visible if someone forgets to register a route.
 */
const defaultResponse: MockHandler = (req) => ({
  text: `[MockReader default] system=${(req.system ?? '').slice(0, 40)} user=${req.user.slice(0, 80)}`,
  tokensIn: Math.ceil((req.system?.length ?? 0) / 4) + Math.ceil(req.user.length / 4),
  tokensOut: 24,
  model: 'mock',
  latencyMs: 0,
});

/**
 * In-memory mock reader.
 */
export class MockReader implements IReader {
  readonly model: string;
  private readonly routes: MockRoute[] = [];
  private readonly fallback: MockHandler;

  constructor(model: string = 'mock', fallback: MockHandler = defaultResponse) {
    this.model = model;
    this.fallback = fallback;
  }

  /** Register a conditional handler. First-match wins. */
  on(match: MockRoute['match'], respond: MockHandler): this {
    this.routes.push({ match, respond });
    return this;
  }

  /** Register a handler that matches if the user message contains `needle`. */
  onUserContains(needle: string, respond: MockHandler): this {
    return this.on((req) => req.user.toLowerCase().includes(needle.toLowerCase()), respond);
  }

  /** Shorthand for a fixed text response. */
  onUserContainsRespond(needle: string, text: string): this {
    return this.onUserContains(needle, () => ({
      text,
      tokensIn: 0,
      tokensOut: Math.ceil(text.length / 4),
      model: this.model,
      latencyMs: 0,
    }));
  }

  async invoke(req: ReaderRequest): Promise<ReaderResponse> {
    const start = Date.now();
    for (const route of this.routes) {
      if (route.match(req)) {
        const resp = await route.respond(req);
        return { ...resp, model: resp.model ?? this.model, latencyMs: Date.now() - start };
      }
    }
    const resp = await this.fallback(req);
    return { ...resp, model: resp.model ?? this.model, latencyMs: Date.now() - start };
  }
}
