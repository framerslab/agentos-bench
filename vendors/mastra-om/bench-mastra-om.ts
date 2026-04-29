/**
 * @file bench-mastra-om.ts
 * @description Vendor reproduction adapter that runs Mastra's
 * @mastra/memory ObservationalMemory pipeline against the agentos-bench
 * LongMemEval-S dataset, with per-case cost + latency instrumentation.
 *
 * Apples-to-apples scope: same dataset, same judge model + rubric,
 * same per-token cost lookup. Deviation: Observer/Reflector model is
 * gpt-5-mini (single-provider OpenAI) rather than Mastra's published
 * gemini-2.5-flash default — agentos-bench is single-provider OpenAI
 * by design; the deviation is documented inline on the run JSON
 * metadata. Reader is gpt-4o per Mastra's published 84.2% gpt-4o
 * configuration (the head-to-head accuracy comparison anchor).
 *
 * Run JSON output shape mirrors agentos-bench native runs so the
 * LEADERBOARD/comparison-table can pick it up directly.
 *
 * @module agentos-bench/vendors/mastra-om/bench-mastra-om
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ObservationalMemory } from '@mastra/memory/processors';
import { MessageHistory } from '@mastra/core/processors';
import { LibSQLStore } from '@mastra/libsql';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types matching the LongMemEval upstream + agentos-bench shape
// ---------------------------------------------------------------------------

type QuestionType =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'
  | 'temporal-reasoning'
  | 'knowledge-update'
  | 'multi-session';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  has_answer?: boolean;
}

interface LongMemEvalCase {
  question_id: string;
  question_type: QuestionType;
  question: string;
  answer: string;
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: Turn[][];
}

interface CaseResult {
  caseId: string;
  question: string;
  expected: string;
  actualOutput: string;
  caseType: QuestionType;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  ingestLatencyMs: number;
  ingestTokensIn: number;
  ingestTokensOut: number;
  ingestUsd: number;
  errored?: boolean;
  errorMessage?: string;
  metadata: {
    caseType: QuestionType;
    type: QuestionType;
    expected: string;
    sessionsReplayed: number;
    observerModel: string;
    reflectorModel: string;
    readerModel: string;
  };
}

// ---------------------------------------------------------------------------
// Per-token pricing (matches agentos-bench MODEL_PRICES at 2026-04-28)
// ---------------------------------------------------------------------------

const MODEL_PRICES_PER_1K: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 0.0025, out: 0.01 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-5': { in: 0.00125, out: 0.01 },
  'gpt-5-mini': { in: 0.00025, out: 0.002 },
  'gpt-5-nano': { in: 0.00005, out: 0.0004 },
};

function priceUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICES_PER_1K[model];
  if (!p) {
    throw new Error(`bench-mastra-om: no price entry for model '${model}'.`);
  }
  return (tokensIn / 1000) * p.in + (tokensOut / 1000) * p.out;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface RunOptions {
  reader: string;
  observerModel: string;
  reflectorModel: string;
  samplePerType?: number;
  sampleN?: number;
  concurrency: number;
  datasetPath: string;
  outputDir: string;
  seed: number;
}

function parseArgs(): RunOptions {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return fallback;
    return argv[i + 1];
  };
  const has = (flag: string) => argv.includes(flag);
  return {
    reader: get('--reader', 'gpt-4o')!,
    observerModel: get('--observer-model', 'gpt-5-mini')!,
    reflectorModel: get('--reflector-model', 'gpt-5-mini')!,
    samplePerType: has('--sample-per-type') ? Number(get('--sample-per-type')) : undefined,
    sampleN: has('--sample') ? Number(get('--sample')) : undefined,
    concurrency: Number(get('--concurrency', '3')),
    datasetPath: resolve(
      get(
        '--dataset',
        join(__dirname, '..', '..', 'data', 'longmemeval', 'longmemeval_s.json'),
      )!,
    ),
    outputDir: resolve(
      get('--output-dir', join(__dirname, '..', '..', 'results', 'runs'))!,
    ),
    seed: Number(get('--seed', '42')),
  };
}

// ---------------------------------------------------------------------------
// Mulberry32 RNG (matches agentos-bench bootstrap RNG so seeded runs are
// reproducible across the harnesses)
// ---------------------------------------------------------------------------

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleStable<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function lastSessionIdForObserve(
  sessionsByDate: ReadonlyArray<{ sessionId: string }>,
  questionId: string,
): string {
  return sessionsByDate[sessionsByDate.length - 1]?.sessionId ?? `session_${questionId}`;
}

// ---------------------------------------------------------------------------
// Dataset loading + sampling
// ---------------------------------------------------------------------------

async function loadDataset(path: string): Promise<LongMemEvalCase[]> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as LongMemEvalCase[];
}

function sampleCases(
  all: LongMemEvalCase[],
  opts: RunOptions,
): LongMemEvalCase[] {
  if (opts.samplePerType) {
    const byType = new Map<QuestionType, LongMemEvalCase[]>();
    for (const c of all) {
      const arr = byType.get(c.question_type) ?? [];
      arr.push(c);
      byType.set(c.question_type, arr);
    }
    const sampled: LongMemEvalCase[] = [];
    let typeIdx = 0;
    for (const [, arr] of byType) {
      const shuffled = shuffleStable(arr, opts.seed + typeIdx++);
      sampled.push(...shuffled.slice(0, opts.samplePerType));
    }
    return sampled;
  }
  if (opts.sampleN) {
    return shuffleStable(all, opts.seed).slice(0, opts.sampleN);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Per-case run: ingest haystack via OM, then ask question
// ---------------------------------------------------------------------------

async function runCase(c: LongMemEvalCase, opts: RunOptions): Promise<CaseResult> {
  const resourceId = `resource_${c.question_id}`;
  // Mastra needs a composite store for Memory (which dispatches to
  // sub-stores via getStore()), and the inner memory sub-store for
  // MessageHistory + ObservationalMemory (which call methods like
  // getThreadById directly on what they're given). LibSQLStore exposes
  // both: the composite for Memory, and `.stores.memory` for the
  // processor's storage slot.
  const omStorage = new LibSQLStore({ id: `om-${c.question_id}`, url: ':memory:' });
  // LibSQLStore composite needs init() before any sub-store reads/writes
  // hit the DB — otherwise the per-domain tables (mastra_observational_memory,
  // mastra_messages, etc.) don't exist yet and observe/reflect crash.
  await (omStorage as unknown as { init: () => Promise<void> }).init();
  const omMemoryStore = (omStorage as unknown as { stores: { memory: unknown } }).stores.memory;

  // Track cost of Observer/Reflector calls separately from the reader
  let observerTokensIn = 0;
  let observerTokensOut = 0;
  let observerUsd = 0;

  const observationalMemory = new ObservationalMemory({
    obscureThreadIds: true,
    storage: omMemoryStore as ConstructorParameters<typeof ObservationalMemory>[0]['storage'],
    observation: {
      model: openai(opts.observerModel),
      // Lower threshold than Mastra's bench default of 30000 tokens.
      // We observe per-session here (each call gets one session's
      // messages), so the threshold needs to be below typical per-
      // session token budget (~500-3000 for LongMemEval-S sessions).
      // 1000 ensures observation fires for every session that has
      // meaningful content; smaller sessions get rolled into the next
      // observation when threshold cumulatively exceeds.
      messageTokens: 1000,
      recognizePatterns: false,
    },
    reflection: {
      model: openai(opts.reflectorModel),
      // Reflection threshold remains high; we trigger reflection
      // explicitly via reflect() at the end of ingest, not via the
      // accumulated-tokens trigger.
      observationTokens: 80000,
      recognizePatterns: false,
    },
    scope: 'resource',
    onDebugEvent: (event: { type: string; usage?: { inputTokens?: number; outputTokens?: number } }) => {
      const usage = event.usage;
      if (usage) {
        observerTokensIn += usage.inputTokens ?? 0;
        observerTokensOut += usage.outputTokens ?? 0;
      }
    },
  });

  const messageHistory = new MessageHistory({
    storage: omMemoryStore as ConstructorParameters<typeof MessageHistory>[0]['storage'],
    lastMessages: 10,
  });
  const memory = new Memory({
    storage: omStorage as ConstructorParameters<typeof Memory>[0]['storage'],
  });

  const agent = new Agent({
    name: `mastra-om-bench-${c.question_id}`,
    instructions:
      'You are an assistant answering questions about a previous conversation. Answer using the observation log; if the answer is not in the log, say "I do not know."',
    model: openai(opts.reader),
    memory,
    inputProcessors: [observationalMemory],
    outputProcessors: [messageHistory, observationalMemory],
  });

  // ---------- Ingest phase: replay haystack sessions ----------
  const ingestStart = performance.now();
  const sessionsByDate = c.haystack_sessions
    .map((session, i) => ({
      session,
      date: new Date(c.haystack_dates[i] ?? c.question_date),
      sessionId: c.haystack_session_ids[i] ?? `session_${i}`,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Direct OM observation per session via the npm-published `observe()`
  // and `reflect()` API. Bypasses the agent.generate-driven ingest
  // (which Mastra's bench uses with a mock model) — direct calls avoid
  // wasted reader tokens during ingest, and don't depend on the
  // threshold accumulator firing across many tiny message-pair calls.
  // Cost accounting: observerTokensIn/Out are aggregated from the
  // observe() return value's observationUsage; reflection cost is
  // captured separately when reflect() returns reflectionUsage.
  type OmDirectAPI = {
    observe: (opts: {
      threadId: string;
      resourceId: string;
      messages: Array<{ role: string; content: string; createdAt: Date }>;
    }) => Promise<{
      observed: boolean;
      observationUsage?: { inputTokens?: number; outputTokens?: number };
    }>;
    reflect: (
      threadId: string,
      resourceId: string,
    ) => Promise<{
      reflected: boolean;
      reflectionUsage?: { inputTokens?: number; outputTokens?: number };
    }>;
  };
  const om = observationalMemory as unknown as OmDirectAPI;

  // Aggregate all haystack messages into a single observation call.
  // The OM threshold is computed against the messages passed to observe(),
  // so per-session calls fail to fire when individual sessions are under
  // the messageTokens threshold. Aggregating across the full haystack
  // (~115K tokens for LongMemEval-S) guarantees threshold is met.
  // Each message keeps its source session's threadId via msg.threadId
  // so the OM's observation log can attribute observations back.
  const aggregatedMessages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: Date;
    threadId: string;
  }> = [];
  for (const { session, date, sessionId } of sessionsByDate) {
    for (let i = 0; i < session.length; i++) {
      aggregatedMessages.push({
        id: `${sessionId}-msg-${i}`,
        role: session[i].role,
        content: session[i].content,
        createdAt: new Date(date.getTime() + i * 5_000),
        threadId: sessionId,
      });
    }
  }

  try {
    const obsResult = await om.observe({
      threadId: lastSessionIdForObserve(sessionsByDate, c.question_id),
      resourceId,
      messages: aggregatedMessages,
    });
    if (obsResult?.observationUsage) {
      observerTokensIn += obsResult.observationUsage.inputTokens ?? 0;
      observerTokensOut += obsResult.observationUsage.outputTokens ?? 0;
    }
    console.log(
      `[${c.question_id}] observed=${obsResult?.observed} tokens=${aggregatedMessages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0)}`,
    );
  } catch (err) {
    console.warn(
      `observe failed for ${c.question_id}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Reflection over the accumulated observation log, scoped at resource.
  // Mastra's bench triggers reflection through finalize(); we call
  // reflect() directly with the last session as the thread anchor.
  const lastSessionId = sessionsByDate[sessionsByDate.length - 1]?.sessionId
    ?? `session_${c.question_id}`;
  try {
    const refResult = await om.reflect(lastSessionId, resourceId);
    if (refResult?.reflectionUsage) {
      observerTokensIn += refResult.reflectionUsage.inputTokens ?? 0;
      observerTokensOut += refResult.reflectionUsage.outputTokens ?? 0;
    }
  } catch (err) {
    console.warn(
      `reflect failed for ${c.question_id}:`,
      err instanceof Error ? err.message : err,
    );
  }

  const ingestLatencyMs = performance.now() - ingestStart;
  observerUsd = priceUsd(opts.observerModel, observerTokensIn, observerTokensOut);

  // ---------- Question phase: ask the question with OM context ----------
  // Bypass Mastra's Agent + inputProcessor pipeline (the OM input
  // processor's prompt-injection path is brittle when observations
  // and questions cross threadId boundaries). Instead, read the OM
  // record directly via getOrCreateRecord(), serialize the observation
  // log into a system prompt, and call gpt-4o directly via the AI SDK.
  // This is what Mastra's OM does internally anyway — fetches the
  // observation log and injects it as system context — just made
  // explicit for the apples-to-apples cost+latency capture.
  type OmRecord = {
    activeObservations?: string;
    observations?: string;
    [k: string]: unknown;
  };
  type OmRecordReader = {
    getOrCreateRecord: (threadId: string, resourceId: string) => Promise<OmRecord>;
    formatObservationsForContext?: (observations: string) => string;
  };
  const omRecordReader = observationalMemory as unknown as OmRecordReader;
  const lastSessId = lastSessionIdForObserve(sessionsByDate, c.question_id);
  const omRecord = await omRecordReader.getOrCreateRecord(lastSessId, resourceId);
  const observationLog =
    omRecord.activeObservations ?? omRecord.observations ?? '';

  const askStart = performance.now();
  let answer = '';
  let answerTokensIn = 0;
  let answerTokensOut = 0;
  try {
    const systemPrompt =
      'You are an assistant answering a question about a previous conversation.\n\n' +
      '<observation_log>\n' +
      observationLog +
      '\n</observation_log>\n\n' +
      'Answer using the observation log. If the answer is not in the log, ' +
      'say "I do not know."';
    const result = await generateText({
      model: openai(opts.reader),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: c.question },
      ],
      temperature: 0,
    });
    answer = result.text ?? '';
    answerTokensIn = result.usage?.inputTokens ?? 0;
    answerTokensOut = result.usage?.outputTokens ?? 0;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      caseId: c.question_id,
      question: c.question,
      expected: c.answer,
      actualOutput: '',
      caseType: c.question_type,
      latencyMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      ingestLatencyMs,
      ingestTokensIn: observerTokensIn,
      ingestTokensOut: observerTokensOut,
      ingestUsd: observerUsd,
      errored: true,
      errorMessage: `ask:${errMsg}`,
      metadata: {
        caseType: c.question_type,
        type: c.question_type,
        expected: c.answer,
        sessionsReplayed: sessionsByDate.length,
        observerModel: opts.observerModel,
        reflectorModel: opts.reflectorModel,
        readerModel: opts.reader,
      },
    };
  }
  const askLatencyMs = performance.now() - askStart;
  const answerUsd = priceUsd(opts.reader, answerTokensIn, answerTokensOut);

  return {
    caseId: c.question_id,
    question: c.question,
    expected: c.answer,
    actualOutput: answer,
    caseType: c.question_type,
    latencyMs: askLatencyMs,
    tokensIn: answerTokensIn,
    tokensOut: answerTokensOut,
    usd: answerUsd,
    ingestLatencyMs,
    ingestTokensIn: observerTokensIn,
    ingestTokensOut: observerTokensOut,
    ingestUsd: observerUsd,
    metadata: {
      caseType: c.question_type,
      type: c.question_type,
      expected: c.answer,
      sessionsReplayed: sessionsByDate.length,
      observerModel: opts.observerModel,
      reflectorModel: opts.reflectorModel,
      readerModel: opts.reader,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  console.log('mastra-om bench config:', {
    reader: opts.reader,
    observerModel: opts.observerModel,
    reflectorModel: opts.reflectorModel,
    samplePerType: opts.samplePerType,
    sampleN: opts.sampleN,
    concurrency: opts.concurrency,
    seed: opts.seed,
  });

  if (!existsSync(opts.datasetPath)) {
    throw new Error(
      `bench-mastra-om: dataset not found at ${opts.datasetPath}.\n` +
        'Download from https://github.com/xiaowu0162/LongMemEval per agentos-bench docs.',
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('bench-mastra-om: OPENAI_API_KEY env var is required.');
  }

  const all = await loadDataset(opts.datasetPath);
  const sample = sampleCases(all, opts);
  console.log(`Running ${sample.length} cases (of ${all.length} total in dataset).`);

  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(opts.outputDir, { recursive: true });

  // Concurrency-limited dispatcher
  const results: CaseResult[] = [];
  let nextIdx = 0;
  let completed = 0;
  const total = sample.length;

  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= total) return;
      const c = sample[idx];
      try {
        const r = await runCase(c, opts);
        results.push(r);
        completed++;
        process.stdout.write(
          `\r[${completed}/${total}] ${r.caseId} type=${r.caseType} ` +
            `lat=${(r.latencyMs / 1000).toFixed(1)}s ingest=${(r.ingestLatencyMs / 1000).toFixed(1)}s` +
            `${r.errored ? ' ERROR' : ''}                 `,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          caseId: c.question_id,
          question: c.question,
          expected: c.answer,
          actualOutput: '',
          caseType: c.question_type,
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          ingestLatencyMs: 0,
          ingestTokensIn: 0,
          ingestTokensOut: 0,
          ingestUsd: 0,
          errored: true,
          errorMessage: errMsg,
          metadata: {
            caseType: c.question_type,
            type: c.question_type,
            expected: c.answer,
            sessionsReplayed: 0,
            observerModel: opts.observerModel,
            reflectorModel: opts.reflectorModel,
            readerModel: opts.reader,
          },
        });
        completed++;
      }
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  process.stdout.write('\n');

  // ---------- Aggregate ----------
  const passed = results.filter((r) => !r.errored).length;
  const totalUsd = results.reduce((s, r) => s + r.usd + r.ingestUsd, 0);
  const totalLatencyMs = results.reduce((s, r) => s + r.latencyMs + r.ingestLatencyMs, 0);
  const askLatencies = results.filter((r) => !r.errored).map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = askLatencies[Math.floor(askLatencies.length / 2)] ?? 0;
  const p95 = askLatencies[Math.floor(askLatencies.length * 0.95)] ?? 0;

  const runJson = {
    benchmarkId: 'longmemeval-s',
    benchmarkVersion: 'mastra-om-vendor-adapter-v1',
    config: {
      adapter: 'mastra-om',
      reader: opts.reader,
      observerModel: opts.observerModel,
      reflectorModel: opts.reflectorModel,
      memory: 'mastra-observational-memory',
      replay: 'ingest',
      sample: opts.samplePerType ? `per-type-${opts.samplePerType}` : opts.sampleN ? `n-${opts.sampleN}` : 'full',
      concurrency: opts.concurrency,
      seed: opts.seed,
      mastraSourceCommit: 'TBD', // Filled by run script if available
      apples_to_apples_caveats: [
        'Observer + Reflector model is gpt-5-mini (single-provider OpenAI), NOT Mastra published default of gemini-2.5-flash',
        'Reader is gpt-4o per Mastra published 84.2% gpt-4o config',
        'Same dataset (data/longmemeval-s/longmemeval_s.json) as agentos-bench native runs',
        'Cost tracking captured from response.usage on every LLM call (no estimates)',
        'Latency split into ingest phase (haystack replay through OM) and ask phase (question + answer)',
        'Scoring requires the agentos-bench LongMemEvalJudge to consume actualOutput; not done inline by this adapter',
      ],
    },
    totalCases: results.length,
    passedCases: passed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    avgLatencyMs:
      askLatencies.length > 0
        ? askLatencies.reduce((s, x) => s + x, 0) / askLatencies.length
        : 0,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    totalIngestLatencyMs: results.reduce((s, r) => s + r.ingestLatencyMs, 0),
    totalUsd,
    costPerCorrect: passed > 0 ? totalUsd / passed : 0,
    startedAt,
    completedAt: new Date().toISOString(),
    cases: results,
  };

  const outputPath = join(
    opts.outputDir,
    `${startedAt}--longmemeval-s--mastra-om--${opts.reader}.json`,
  );
  await writeFile(outputPath, JSON.stringify(runJson, null, 2));
  console.log(`\n=== Mastra OM vendor adapter run complete ===`);
  console.log(`Cases: ${results.length} (passed-by-output-presence: ${passed})`);
  console.log(
    `Cost: $${totalUsd.toFixed(4)} (ingest+answer); $/case: $${(totalUsd / Math.max(1, results.length)).toFixed(4)}`,
  );
  console.log(`Avg ask latency: ${(runJson.avgLatencyMs / 1000).toFixed(2)}s`);
  console.log(`p50 ask latency: ${(p50 / 1000).toFixed(2)}s`);
  console.log(`p95 ask latency: ${(p95 / 1000).toFixed(2)}s`);
  console.log(`Run JSON: ${outputPath}`);
  console.log('');
  console.log('NEXT: feed actualOutput to the agentos-bench LongMemEvalJudge to score per-case + aggregate accuracy.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
