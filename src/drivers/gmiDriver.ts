/**
 * @file gmiDriver.ts
 * @description Answers one case through an AgentOS agent on the GMI runtime: the haystack is filed
 * through the agent's own session (one session per case, its history cleared after each haystack
 * session), the question is asked last, and the turn's recall record goes into the case's metadata.
 * See the README, "The GMI driver".
 */
import path from 'node:path';
import { agent } from '@framers/agentos/api/agent';
import type { BenchCase, BenchContext, CaseRun, RunConfig } from '../core/IBenchmark.js';
import { GMI_DRIVER_INSTRUCTIONS, GMI_DRIVER_VERSION } from './constants.js';
import { startReplayProxy, type ReplayProxy } from './replayProxy.js';
import { gmiUpstreamBaseUrl, gmiUpstreamProblem } from './upstream.js';

export { gmiUpstreamBaseUrl, gmiUpstreamProblem };

type AgentOptions = Parameters<typeof agent>[0];
type MemoryOption = Exclude<NonNullable<AgentOptions['memory']>, boolean>;
type Agent = ReturnType<typeof agent>;

let shared: Promise<ReplayProxy> | undefined;

function replayProxy(): Promise<ReplayProxy> {
  const upstreamApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!upstreamApiKey) throw new Error('--driver gmi: OPENAI_API_KEY is not set');
  // Checked here too, for a caller that reaches the driver without the CLI's check (a live run's rule: the provider
  // or a stub).
  const problem = gmiUpstreamProblem(gmiUpstreamBaseUrl(), false);
  if (problem) throw new Error(`--driver gmi: ${problem}`);
  shared ??= startReplayProxy({ upstreamBaseUrl: gmiUpstreamBaseUrl(), upstreamApiKey });
  return shared;
}

/** Closes the replay proxy, so the next case opens one on the then-current upstream and key (tests start a stub each). */
export async function resetGmiDriver(): Promise<void> {
  const open = shared;
  shared = undefined;
  if (open) await (await open).close();
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
  return (config.embedderModel ?? 'text-embedding-3-small').replace(/^openai:/, '');
}

const safe = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');

export async function runGmiCase(c: BenchCase, ctx: BenchContext): Promise<CaseRun> {
  const start = Date.now();
  const proxy = await replayProxy();
  const key = `bench-${safe(c.id)}-${start.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const script = proxy.script(key);
  const storePath =
    ctx.config.gmiRecall?.store === 'sqlite' ? path.join(ctx.scratchDir, `gmi-${safe(key)}.sqlite`) : undefined;
  const embedderModel = embedderModelOf(ctx.config);
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
        upstreamHost: new URL(gmiUpstreamBaseUrl()).hostname,
      },
    };
  } finally {
    try {
      await a?.close();
    } finally {
      script.done();
    }
  }
}
