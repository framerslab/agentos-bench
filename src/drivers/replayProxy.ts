/**
 * @file replayProxy.ts
 * @description A local OpenAI-compatible endpoint for the GMI driver. Each case holds a script under
 * its own bearer key: while the case files its haystack, a chat request is answered with the scripted
 * assistant text and nothing leaves the process; once the script is set to forward, the request goes
 * to the real provider under the real key.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReplayScript {
  /** The text that answers the next chat request(s) until the next call. */
  reply(text: string): void;
  /** From now on every chat request of this script goes upstream. */
  forward(): void;
  /**
   * `replayed`: requests answered with a scripted text, one per `reply()`; `extra`: further requests made before the
   * next `reply()` (a component of the turn that calls the model again); `forwarded`: chat requests sent upstream;
   * `modelReads`: `GET /models` reads, which go upstream in either mode and carry nothing of a case.
   */
  counts(): { replayed: number; extra: number; forwarded: number; modelReads: number };
  /** Releases the key. */
  done(): void;
}

export interface ReplayProxy {
  /** Base URL, ending in `/v1`. */
  url: string;
  script(key: string): ReplayScript;
  close(): Promise<void>;
}

interface State {
  mode: 'replay' | 'forward';
  text: string;
  sinceReply: number;
  replayed: number;
  extra: number;
  forwarded: number;
  modelReads: number;
}

export async function startReplayProxy(o: { upstreamBaseUrl: string; upstreamApiKey: string }): Promise<ReplayProxy> {
  const scripts = new Map<string, State>();
  const json = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (d: Buffer) => {
      chunks.push(d);
    });
    req.on('end', () => {
      void (async () => {
        const raw = Buffer.concat(chunks);
        const key = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const state = scripts.get(key);
        const route = (req.url ?? '').split('?')[0]!;
        if (!state) return json(res, 401, { error: { message: 'replay proxy: unknown key' } });
        // The provider lists the models when it starts (and may read one model's entry): those reads carry nothing of
        // a case and go upstream in either mode, so the agent sees the provider's own list.
        const models = /\/models(?:\/[^/]+)?$/.exec(route);
        if (req.method === 'GET' && models) {
          state.modelReads += 1;
          const upstream = await fetch(`${o.upstreamBaseUrl}${models[0]}`, {
            method: 'GET',
            redirect: 'error',
            headers: { authorization: `Bearer ${o.upstreamApiKey}` },
          });
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
          res.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        if (req.method !== 'POST' || !route.endsWith('/chat/completions')) {
          return json(res, 404, { error: { message: `replay proxy: no route ${req.method} ${route}` } });
        }
        if (state.mode === 'forward') {
          state.forwarded += 1;
          const upstream = await fetch(`${o.upstreamBaseUrl}/chat/completions`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${o.upstreamApiKey}` },
            body: raw.toString('utf8'),
          });
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
          res.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        state.sinceReply += 1;
        if (state.sinceReply === 1) state.replayed += 1;
        else state.extra += 1;
        const body = JSON.parse(raw.toString('utf8')) as { model?: string; stream?: boolean };
        const base = { id: `replay-${state.replayed}-${state.extra}`, created: 0, model: body.model ?? 'replay' };
        const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        if (!body.stream) {
          return json(res, 200, {
            ...base,
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: state.text }, finish_reason: 'stop' }],
            usage,
          });
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: state.text }, finish_reason: null }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      })().catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
          return;
        }
        json(res, 502, { error: { message: `replay proxy: ${error instanceof Error ? error.message : String(error)}` } });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref(); // a finished run exits without a teardown hook (IBenchmark has none)
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    script(key) {
      if (scripts.has(key)) throw new Error(`replay proxy: key ${key} is already scripted`);
      const state: State = { mode: 'replay', text: 'Noted.', sinceReply: 0, replayed: 0, extra: 0, forwarded: 0, modelReads: 0 };
      scripts.set(key, state);
      return {
        reply: (text) => {
          state.text = text;
          state.sinceReply = 0;
        },
        forward: () => {
          state.mode = 'forward';
        },
        counts: () => ({ replayed: state.replayed, extra: state.extra, forwarded: state.forwarded, modelReads: state.modelReads }),
        done: () => {
          scripts.delete(key);
        },
      };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
