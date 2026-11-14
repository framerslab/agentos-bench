/**
 * @file gmiDriver.ts
 * @description Answers one case through an AgentOS agent on the GMI runtime: the haystack is filed
 * through the agent's own session (one session per case, its history cleared after each haystack
 * session), the question is asked last, and the turn's recall record goes into the case's metadata.
 * See the README, "The GMI driver".
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { agent } from '@framers/agentos/api/agent';
import type { BenchCase, BenchContext, CaseRun, RunConfig } from '../core/IBenchmark.js';
import { AGENTOS_VERSION, GMI_DRIVER_INSTRUCTIONS, GMI_DRIVER_VERSION } from './constants.js';
import { startReplayProxy, type ReplayProxy } from './replayProxy.js';
import { gmiEmbedderProblem, gmiUpstreamBaseUrl, gmiUpstreamEndpoint, gmiUpstreamProblem } from './upstream.js';

export { gmiEmbedderProblem, gmiUpstreamBaseUrl, gmiUpstreamEndpoint, gmiUpstreamProblem };

type AgentOptions = Parameters<typeof agent>[0];
type MemoryOption = Exclude<NonNullable<AgentOptions['memory']>, boolean>;
type Agent = ReturnType<typeof agent>;

/**
 * One replay proxy per upstream and key. A proxy forwards to the upstream and key it started with, so a case takes the
 * proxy of the upstream and key the environment names when it starts: a later run in the same process with another
 * `OPENAI_BASE_URL` or `OPENAI_API_KEY` never sends through an earlier run's proxy, and a proxy cases may be using is
 * never closed under them.
 */
const proxies = new Map<string, Promise<ReplayProxy>>();

function replayProxy(): { proxy: Promise<ReplayProxy>; upstream: string } {
  const upstreamApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!upstreamApiKey) throw new Error('--driver gmi: OPENAI_API_KEY is not set');
  const upstreamBaseUrl = gmiUpstreamBaseUrl();
  // Checked here too, for a caller that reaches the driver without the CLI's check (a live run's rule: the provider
  // or a stub).
  const problem = gmiUpstreamProblem(upstreamBaseUrl, false);
  if (problem) throw new Error(`--driver gmi: ${problem}`);
  const identity = `${upstreamBaseUrl}\n${upstreamApiKey}`;
  let proxy = proxies.get(identity);
  if (!proxy) {
    proxy = startReplayProxy({ upstreamBaseUrl, upstreamApiKey });
    proxies.set(identity, proxy);
    // A proxy that fails to start is forgotten, so the next case tries again rather than inheriting the failure.
    proxy.catch(() => {
      if (proxies.get(identity) === proxy) proxies.delete(identity);
    });
  }
  return { proxy, upstream: gmiUpstreamEndpoint({ OPENAI_BASE_URL: upstreamBaseUrl }) };
}

/** Closes every replay proxy (tests start a stub each). Call it only when no case is running. */
export async function resetGmiDriver(): Promise<void> {
  const open = [...proxies.values()];
  proxies.clear();
  await Promise.all(open.map(async (proxy) => (await proxy.catch(() => undefined))?.close()));
}

/** The agent's `memory` option for a run's settings. A field the run leaves unset is not passed, so the library's default applies. */
export function gmiMemoryOption(config: Pick<RunConfig, 'gmiRecall' | 'embedderModel'>, storePath?: string): MemoryOption {
  const recall = config.gmiRecall ?? {};
  return {
    embedding: { provider: 'openai', model: embedderModelOf(config) },
    recall: {
      capture: 'metadata',
      ...(recall.budgetTokens !== undefined ? { budget: { totalTokens: recall.budgetTokens } } : {}),
    },
    ...(storePath ? { store: { path: storePath } } : {}),
  };
}

function embedderModelOf(config: Pick<RunConfig, 'embedderModel'>): string {
  // Checked here too, for a caller that reaches the driver without the CLI's check.
  const problem = gmiEmbedderProblem(config.embedderModel);
  if (problem) throw new Error(`--driver gmi: ${problem}`);
  return (config.embedderModel ?? 'text-embedding-3-small').replace(/^openai:/, '');
}

const safe = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * A case's proxy key. Its random part (128 bits) is what no other local process can guess: the key is what lets a
 * request through the proxy to the provider under the real key.
 */
function caseKey(caseId: string): string {
  return `bench-${safe(caseId)}-${randomBytes(16).toString('hex')}`;
}

/**
 * Removes a case's SQLite file and the journal files SQLite keeps beside it. Nothing reads the file once the case's
 * agent has closed, and a long run would otherwise hold one per case until it ends. A file that will not go is left
 * for the runner, which removes the scratch directory with the run.
 */
async function removeStore(storePath: string): Promise<void> {
  await Promise.all(
    ['', '-wal', '-shm', '-journal'].map((suffix) => fs.rm(`${storePath}${suffix}`, { force: true }).catch(() => undefined)),
  );
}

export async function runGmiCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun> {
  const start = Date.now();
  // Before the case takes a key, so a refused embedder leaves nothing scripted behind.
  const embedderModel = embedderModelOf(ctx.config);
  const { proxy: proxyStarting, upstream } = replayProxy();
  const proxy = await proxyStarting;
  const key = caseKey(c.id);
  const script = proxy.script(key);
  const storePath =
    ctx.config.gmiRecall?.store === 'sqlite' ? path.join(ctx.scratchDir, `gmi-${safe(key)}.sqlite`) : undefined;
  const ingest = { sessions: 0, userTurns: 0, replayedAssistantTurns: 0, skippedTurns: 0, filedChars: 0, extraModelRequests: 0, ms: 0 };
  let a: Agent | undefined;
  try {
    a = agent({
      runtime: 'gmi',
      name: 'bench-reader',
      provider: 'openai',
      model: ctx.config.reader,
      apiKey: key,
      baseUrl: proxy.url,
      instructions: GMI_DRIVER_INSTRUCTIONS,
      fallbackProviders: [],
      memory: gmiMemoryOption(ctx.config, storePath),
      ...(storePath ? { learning: { agentKey: `bench-${safe(c.id)}`, mode: 'off' as const } } : {}),
    });
    // One session per case, under one user: every line it files stays in scope for the question.
    const session = a.session(key, { userId: key });
    for (const haystackSession of c.haystack) {
      let first = true;
      const turns = haystackSession.turns;
      for (let i = 0; i < turns.length; i += 1) {
        const turn = turns[i]!;
        if (turn.role !== 'user' || !turn.content.trim()) {
          ingest.skippedTurns += 1;
          continue;
        }
        const next = turns[i + 1];
        const answered = next?.role === 'assistant' && next.content.trim().length > 0;
        const replyText = answered ? next!.content : 'Noted.';
        const text = first && haystackSession.date ? `(Conversation of ${haystackSession.date})\n${turn.content}` : turn.content;
        first = false;
        script.reply(replyText);
        await session.send(text);
        ingest.userTurns += 1;
        if (answered) {
          ingest.replayedAssistantTurns += 1;
          i += 1;
        }
        ingest.filedChars += text.length + replyText.length;
      }
      // The reader's context at the question holds no haystack turn: what it knows of the haystack is what recall finds.
      session.clear();
      ingest.sessions += 1;
    }
    ingest.extraModelRequests = script.counts().extra;
    ingest.ms = Date.now() - start;

    script.forward();
    const asked = Date.now();
    const question = c.questionDate ? `(Today is ${c.questionDate}.)\n${c.question}` : c.question;
    const result = await session.send(question);
    const tokensIn = result.usage.promptTokens;
    const tokensOut = result.usage.completionTokens;
    const usd = ctx.costTracker.record({ category: 'reader', model: ctx.config.reader, tokensIn, tokensOut, tag: c.id });
    // Every filed line is embedded once and every send embeds its query once: about four characters a token.
    ctx.costTracker.record({
      category: 'embedding',
      model: embedderModel,
      tokensIn: Math.ceil((ingest.filedChars * 1.5 + question.length) / 4),
      tokensOut: 0,
      tag: `${c.id}:gmi-embedding-estimate`,
    });
    return {
      caseId: c.id,
      actualOutput: result.text,
      latencyMs: Date.now() - start,
      tokensIn,
      tokensOut,
      usd,
      metadata: {
        driver: 'gmi',
        driverVersion: GMI_DRIVER_VERSION,
        agentosVersion: AGENTOS_VERSION,
        memoryMode: ctx.config.memoryMode,
        replayMode: ctx.config.replayMode,
        caseType: c.type,
        expected: c.expected,
        type: c.type,
        gmiRecall: ctx.config.gmiRecall ?? {},
        memoryRecall: result.memoryRecall ?? null,
        ingest,
        questionMs: Date.now() - asked,
        forwardedRequests: script.counts().forwarded,
        modelListReads: script.counts().modelReads,
        upstream,
      },
    };
  } finally {
    try {
      await a?.close();
    } finally {
      script.done();
      if (storePath) await removeStore(storePath);
    }
  }
}
