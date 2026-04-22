/**
 * @file runner.ts
 * @description Step 15 Observational Memory runner — Mastra-style three-tier
 * memory pipeline ported as a bench-side adapter.
 *
 * Architecture (matches Mastra's published 84.23% gpt-4o configuration):
 *
 *   1. For each LongMemEval-S session in the haystack, format messages as
 *      `[role @ HH:MM] content` and ask the Observer LLM to extract dated,
 *      priority-tagged observations into a single XML block.
 *   2. Accumulate per-session observation blocks. When the running token
 *      count exceeds {@link OM_DEFAULTS.reflection.observationTokens} (40k),
 *      invoke the Reflector to consolidate.
 *   3. At query time, assemble the reader's prompt as:
 *        OBSERVATION_CONTEXT_PROMPT
 *        <observations>{full log}</observations>
 *        OBSERVATION_CONTEXT_INSTRUCTIONS
 *      and answer in a single reader call. NO retrieval, NO top-K, NO rerank.
 *
 * Observer + Reflector model: substituted gpt-5-mini for Mastra's
 * gemini-2.5-flash because the bench infrastructure ships with OpenAI keys
 * only. Documented in findings.
 *
 * @module agentos-bench/observational-memory/runner
 */

import type { IReader } from '../readers/IReader.js';
import {
  OBSERVATION_CONTEXT_INSTRUCTIONS,
  OBSERVATION_CONTEXT_PROMPT,
  OBSERVATION_CONTINUATION_HINT,
  OM_DEFAULTS,
  buildObserverSystemPrompt,
  buildReflectorSystemPrompt,
} from './prompts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OmTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Optional ISO timestamp for the turn. When omitted, falls back to session date. */
  timestamp?: string;
}

export interface OmSession {
  sessionId: string;
  /** ISO date / timestamp marking when this session occurred. */
  date?: string;
  turns: readonly OmTurn[];
}

export interface OmObservationBatch {
  sessionId: string;
  /** Raw observer output, including <observations>, <current-task>, etc. */
  rawOutput: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface OmReflectionResult {
  /** Reflected observation log replacing prior observations. */
  rawOutput: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface OmIngestResult {
  observationBatches: OmObservationBatch[];
  reflections: OmReflectionResult[];
  /** Final consolidated observation log as a single string (with XML tags). */
  finalLog: string;
  /** Total tokens spent on observer calls. */
  observerTokensIn: number;
  observerTokensOut: number;
  /** Total tokens spent on reflector calls. */
  reflectorTokensIn: number;
  reflectorTokensOut: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate token count via 4-char-per-token heuristic. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a single session's turns as a chat transcript block. */
function formatSessionForObserver(session: OmSession): string {
  const dateLine = session.date ? `Date: ${session.date}` : `Session ${session.sessionId}`;
  const lines = session.turns
    .filter((t) => t.content.trim().length > 0)
    .map((t) => {
      const time = t.timestamp ? `[${t.role} @ ${t.timestamp}]` : `[${t.role}]`;
      return `${time} ${t.content}`;
    });
  return `${dateLine}\n${lines.join('\n')}`;
}

/** Strip common LLM wrappers around XML output to handle code-fence pollution. */
function stripWrappers(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:xml|markdown)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text;
}

/** Extract the `<observations>...</observations>` block content (without tags). */
export function extractObservationsBlock(raw: string): string | null {
  const cleaned = stripWrappers(raw);
  const match = cleaned.match(/<observations>([\s\S]*?)<\/observations>/i);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Observer runner
// ---------------------------------------------------------------------------

export interface RunObserverArgs {
  /** Reader instance used for the observer LLM call. Typically gpt-5-mini. */
  reader: IReader;
  session: OmSession;
  systemPrompt?: string;
}

/**
 * Invoke the observer LLM on a single session's transcript.
 *
 * @returns Raw observer output (XML with <observations>, <current-task>,
 *   <suggested-response> blocks) plus token accounting.
 */
export async function runObserverOnSession(args: RunObserverArgs): Promise<OmObservationBatch> {
  const { reader, session, systemPrompt } = args;
  const transcript = formatSessionForObserver(session);
  const userPrompt = `Process the following conversation messages and produce observations.\n\n${transcript}`;
  const response = await reader.invoke({
    system: systemPrompt ?? buildObserverSystemPrompt(),
    user: userPrompt,
    maxTokens: OM_DEFAULTS.observation.maxOutputTokens,
    temperature: OM_DEFAULTS.observation.temperature,
  });
  return {
    sessionId: session.sessionId,
    rawOutput: response.text,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    model: response.model,
  };
}

// ---------------------------------------------------------------------------
// Reflector runner
// ---------------------------------------------------------------------------

export interface RunReflectorArgs {
  /** Reader instance used for the reflector LLM call. */
  reader: IReader;
  /** Raw observation log accumulated so far (concatenated observer outputs). */
  observationLog: string;
  systemPrompt?: string;
}

export async function runReflectorOnLog(args: RunReflectorArgs): Promise<OmReflectionResult> {
  const { reader, observationLog, systemPrompt } = args;
  const userPrompt = `The following are accumulated observations from past conversations. Reflect on them and produce a consolidated, restructured version.\n\n${observationLog}`;
  const response = await reader.invoke({
    system: systemPrompt ?? buildReflectorSystemPrompt(),
    user: userPrompt,
    maxTokens: OM_DEFAULTS.reflection.maxOutputTokens,
    temperature: OM_DEFAULTS.reflection.temperature,
  });
  return {
    rawOutput: response.text,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    model: response.model,
  };
}

// ---------------------------------------------------------------------------
// Full ingest pipeline
// ---------------------------------------------------------------------------

export interface IngestSessionsArgs {
  /** LLM used for both observer and reflector calls. */
  observerReader: IReader;
  /** Sessions to ingest, in chronological order. */
  sessions: readonly OmSession[];
  /** Optional reflection trigger override. Default {@link OM_DEFAULTS.reflection.observationTokens}. */
  reflectionTokenThreshold?: number;
  /** Concurrency for observer batches across sessions. Default 4. */
  observerConcurrency?: number;
}

/**
 * Ingest a haystack of LongMemEval sessions into a Mastra-style observation
 * log. Runs the observer per-session in parallel batches, then runs the
 * reflector once at the end if accumulated observations exceed the token
 * threshold.
 *
 * Returns the final consolidated log + token / cost accounting.
 */
export async function ingestSessions(args: IngestSessionsArgs): Promise<OmIngestResult> {
  const {
    observerReader,
    sessions,
    reflectionTokenThreshold = OM_DEFAULTS.reflection.observationTokens,
    observerConcurrency = 4,
  } = args;

  const batches: OmObservationBatch[] = [];
  let observerTokensIn = 0;
  let observerTokensOut = 0;

  // Bounded-parallel observer pass over sessions.
  const queue = [...sessions];
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, observerConcurrency);
  const slot = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      try {
        const batch = await runObserverOnSession({ reader: observerReader, session: next });
        batches.push(batch);
        observerTokensIn += batch.tokensIn;
        observerTokensOut += batch.tokensOut;
      } catch {
        // Observer failures are non-critical for that one session;
        // remaining sessions still produce observations.
      }
    }
  };
  for (let i = 0; i < limit; i++) workers.push(slot());
  await Promise.all(workers);

  // Concatenate observation blocks (extract <observations> body from each
  // batch; fall back to the raw output when the tag is missing so we don't
  // silently drop content).
  const blocks: string[] = [];
  for (const batch of batches) {
    const inner = extractObservationsBlock(batch.rawOutput);
    blocks.push(inner ?? stripWrappers(batch.rawOutput));
  }
  let consolidatedLog = blocks.join('\n\n');
  const reflections: OmReflectionResult[] = [];
  let reflectorTokensIn = 0;
  let reflectorTokensOut = 0;

  // Single reflection pass at the end if log exceeds threshold.
  if (approxTokens(consolidatedLog) > reflectionTokenThreshold) {
    try {
      const reflection = await runReflectorOnLog({
        reader: observerReader,
        observationLog: consolidatedLog,
      });
      reflections.push(reflection);
      reflectorTokensIn += reflection.tokensIn;
      reflectorTokensOut += reflection.tokensOut;
      const reflectedInner = extractObservationsBlock(reflection.rawOutput);
      consolidatedLog = reflectedInner ?? stripWrappers(reflection.rawOutput);
    } catch {
      // Reflection failure: keep the raw concatenated log.
    }
  }

  return {
    observationBatches: batches,
    reflections,
    finalLog: consolidatedLog,
    observerTokensIn,
    observerTokensOut,
    reflectorTokensIn,
    reflectorTokensOut,
  };
}

// ---------------------------------------------------------------------------
// Reader context assembly (NO retrieval)
// ---------------------------------------------------------------------------

/**
 * Build the reader's system prompt for the answer call. Wraps the consolidated
 * observation log with Mastra's context preamble + instructions. The reader
 * sees this entire block PLUS the user's question (passed as the `user`
 * message). No raw passages, no retrieval pool.
 */
export function buildOmReaderSystemPrompt(observationLog: string): string {
  return `${OBSERVATION_CONTEXT_PROMPT}

<observations>
${observationLog.trim()}
</observations>

${OBSERVATION_CONTEXT_INSTRUCTIONS}

${OBSERVATION_CONTINUATION_HINT}`;
}
