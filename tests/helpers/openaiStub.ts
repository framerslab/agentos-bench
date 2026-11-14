/**
 * @file openaiStub.ts
 * @description A local stand-in for OpenAI's API, for tests that drive real
 * clients without a network: `/embeddings` answers a word-hash vector and
 * `/chat/completions` answers through `onChat`, as JSON or as a server-sent
 * event stream, whichever the request asks for.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubChat {
  authorization: string;
  body: { model: string; stream?: boolean; messages: Array<{ role: string; content: unknown }> };
}

export interface OpenAiStub {
  /** Base URL, ending in `/v1`. */
  url: string;
  /** Every chat request the stub received, in order. */
  chat: StubChat[];
  embeddingCalls: number;
  close(): Promise<void>;
}

/** text-embedding-3-small's vector size. */
const DIMENSION = 1536;

/** A bag-of-words vector: texts that share words point the same way. */
function embed(text: string): number[] {
  const v = new Array<number>(DIMENSION).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i += 1) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIMENSION] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export async function startOpenAiStub(onChat: (chat: StubChat) => string): Promise<OpenAiStub> {
  const chat: StubChat[] = [];
  const stub = { chat, embeddingCalls: 0 } as unknown as OpenAiStub;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const route = (req.url ?? '').split('?')[0]!;
      if (route.endsWith('/embeddings')) {
        stub.embeddingCalls += 1;
        const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            model: body.model,
            data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: embed(String(t)) })),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
        );
        return;
      }
      if (route.endsWith('/chat/completions')) {
        const seen: StubChat = { authorization: String(req.headers.authorization ?? ''), body };
        chat.push(seen);
        const text = onChat(seen);
        const base = { id: `stub-${chat.length}`, created: 0, model: body.model };
        const usage = { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 };
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(
            `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`,
          );
          res.write(
            `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ...base,
              object: 'chat.completion',
              choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
              usage,
            }),
          );
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `stub: no route ${route}` } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  stub.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return stub;
}
