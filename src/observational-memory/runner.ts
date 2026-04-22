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
  CROSS_SESSION_READER_SCAFFOLD,
  CROSS_SESSION_SYNTHESIS_HEADER,
  CROSS_SESSION_SYNTHESIS_PROMPT,
  OBSERVATION_CONTEXT_INSTRUCTIONS,
  OBSERVATION_CONTEXT_PROMPT,
  OBSERVATION_CONTINUATION_HINT,
  OM_DEFAULTS,
  RETRIEVED_PASSAGES_HEADER,
  RETRIEVED_PASSAGES_INSTRUCTIONS,
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
  /**
   * Combined observer batches from all passes. In dual-path mode this is
   * the concatenation of perSessionBatches and batchedBatches; in single-
   * mode it equals whichever of the two pass arrays was populated.
   * Preserved as a legacy alias for consumers that existed before
   * per-session / batched passes were separately exposed.
   */
  observationBatches: OmObservationBatch[];
  /**
   * Step 15 v3: per-session pass output. One entry per session. Empty
   * when {@link IngestSessionsArgs.omMode} is `'batched'`.
   */
  perSessionBatches: OmObservationBatch[];
  /**
   * Step 15 v3: batched pass output. One entry per token-bounded batch.
   * Empty when {@link IngestSessionsArgs.omMode} is `'per-session'`.
   */
  batchedBatches: OmObservationBatch[];
  /**
   * Step 15 v4b: synthesis-call output when ingesting in `hierarchical`
   * mode. Null when not in hierarchical mode or when the synthesis call
   * failed (fallback: per-session log used alone).
   */
  synthesisOutput: string | null;
  /** Step 15 v4b: model identifier that produced the synthesis output. */
  synthesisModel: string | null;
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

/**
 * Step 15 ingest mode.
 * - `per-session` (v1): one Observer call per session.
 * - `batched` (v2): one Observer call per token-bounded batch.
 * - `dual-path` (v3): per-session + batched passes, concatenated.
 * - `hierarchical` (v4b): per-session pass + ONE synthesis call over the
 *   per-session observations (input is compressed text, not raw
 *   conversation). Synthesis uses a stronger model if provided, otherwise
 *   falls back to the observer model. Output is a compact cross-session
 *   patterns block appended to the per-session log.
 */
export type OmIngestMode = 'per-session' | 'batched' | 'dual-path' | 'hierarchical';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate token count via 4-char-per-token heuristic. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Partition a chronological list of sessions into token-bounded batches
 * for cross-session Observer calls (Step 15 v2).
 *
 * Walks sessions in haystack order, accumulating into the current batch
 * until adding another session would exceed `batchTokenTarget`. At that
 * point the current batch is closed and a new one starts. A single
 * session whose own formatted transcript exceeds the target becomes its
 * own batch — we never split a session mid-stream.
 *
 * Token counts use {@link approxTokens} over {@link formatSessionForObserver}
 * output so the estimate matches the Observer's actual input size.
 *
 * Matches Mastra's `messageTokens × bufferActivation` = 30_000 × 0.8 =
 * 24_000 default, letting each Observer call see 5-15 sessions of
 * cross-session context instead of 1.
 */
export function partitionSessionsIntoBatches(
  sessions: readonly OmSession[],
  batchTokenTarget: number,
): OmSession[][] {
  const batches: OmSession[][] = [];
  let current: OmSession[] = [];
  let currentTokens = 0;
  for (const session of sessions) {
    const sessionTokens = approxTokens(formatSessionForObserver(session));
    if (currentTokens + sessionTokens > batchTokenTarget && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(session);
    currentTokens += sessionTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
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

/**
 * Concatenate a batch's sessions into a single Observer input transcript
 * for Step 15 v2 cross-session batching.
 *
 * Each session is formatted via {@link formatSessionForObserver}, which
 * already emits a `Date: {iso}` header followed by `[role @ time] content`
 * lines. Sessions are joined with blank-line separators so the Observer
 * sees a chronologically ordered multi-session transcript with clear
 * date-anchored section boundaries.
 *
 * No explicit session or thread markup is added — the existing date
 * headers plus the Observer prompt's own date-grouped output format
 * carry session provenance without additional wrapping.
 */
export function combineSessionsForObserver(batch: readonly OmSession[]): string {
  return batch.map(formatSessionForObserver).join('\n\n');
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
  /** Concurrency for observer batches. Default 6 (v3) so both passes fit in the same wall-clock envelope as v2. */
  observerConcurrency?: number;
  /**
   * Step 15 v2: token target per Observer batch. Sessions are grouped in
   * haystack order until the running token count exceeds this target. A
   * single session exceeding the target becomes its own batch (no mid-
   * session split). Default: 24_000 (Mastra `messageTokens ×
   * bufferActivation` = 30_000 × 0.8). Setting a very large value
   * reduces to a single-batch pass over the whole haystack. Only
   * consulted in `batched` and `dual-path` modes.
   */
  batchTokenTarget?: number;
  /**
   * Step 15 v3: observer ingest mode. Default `dual-path` runs the
   * per-session and batched passes in parallel and concatenates both
   * logs. See {@link OmIngestMode}.
   */
  omMode?: OmIngestMode;
  /**
   * Step 15 v4b: reader used for the hierarchical-mode synthesis call.
   * Separate from `observerReader` so callers can use a stronger model
   * (e.g. gpt-4o) for synthesis while keeping a cheaper observer. When
   * undefined, falls back to `observerReader`. Ignored outside
   * `hierarchical` mode.
   */
  synthesisReader?: IReader;
}

/**
 * Invoke the observer LLM on a multi-session batch transcript (Step 15 v2).
 *
 * Returns a single {@link OmObservationBatch}. The `sessionId` is the
 * first session's id suffixed with `+N` where N is the count of
 * additional sessions in the batch, so per-batch metrics remain
 * attributable without claiming ownership of any single session.
 */
export interface RunObserverOnBatchArgs {
  reader: IReader;
  batch: readonly OmSession[];
  systemPrompt?: string;
}

export async function runObserverOnBatch(
  args: RunObserverOnBatchArgs,
): Promise<OmObservationBatch> {
  const { reader, batch, systemPrompt } = args;
  const transcript = combineSessionsForObserver(batch);
  const userPrompt = `Process the following conversation messages and produce observations.\n\n${transcript}`;
  const response = await reader.invoke({
    system: systemPrompt ?? buildObserverSystemPrompt(),
    user: userPrompt,
    maxTokens: OM_DEFAULTS.observation.maxOutputTokens,
    temperature: OM_DEFAULTS.observation.temperature,
  });
  const firstId = batch[0]?.sessionId ?? 'empty';
  return {
    sessionId: `${firstId}+${batch.length - 1}`,
    rawOutput: response.text,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    model: response.model,
  };
}

/** Helper: bounded-parallel Observer pass over individual sessions (v1 semantics). */
async function runPerSessionPass(
  observerReader: IReader,
  sessions: readonly OmSession[],
  observerConcurrency: number,
): Promise<{ batches: OmObservationBatch[]; tokensIn: number; tokensOut: number }> {
  const batches: OmObservationBatch[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const queue = [...sessions];
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, observerConcurrency);
  const slot = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      try {
        const out = await runObserverOnSession({ reader: observerReader, session: next });
        batches.push(out);
        tokensIn += out.tokensIn;
        tokensOut += out.tokensOut;
      } catch {
        // Per-session observer failure is non-fatal; continue with remaining sessions.
      }
    }
  };
  for (let i = 0; i < limit; i++) workers.push(slot());
  await Promise.all(workers);
  return { batches, tokensIn, tokensOut };
}

/** Helper: bounded-parallel Observer pass over token-bounded batches (v2 semantics). */
async function runBatchedPass(
  observerReader: IReader,
  sessions: readonly OmSession[],
  batchTokenTarget: number,
  observerConcurrency: number,
): Promise<{ batches: OmObservationBatch[]; tokensIn: number; tokensOut: number }> {
  const partitions = partitionSessionsIntoBatches(sessions, batchTokenTarget);
  const batches: OmObservationBatch[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const queue = [...partitions];
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, observerConcurrency);
  const slot = async (): Promise<void> => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || next.length === 0) continue;
      try {
        const out = await runObserverOnBatch({ reader: observerReader, batch: next });
        batches.push(out);
        tokensIn += out.tokensIn;
        tokensOut += out.tokensOut;
      } catch {
        // Batched observer failure is non-fatal; continue with remaining batches.
      }
    }
  };
  for (let i = 0; i < limit; i++) workers.push(slot());
  await Promise.all(workers);
  return { batches, tokensIn, tokensOut };
}

/**
 * Step 15 v4b hierarchical-mode helper. Runs ONE synthesis call over the
 * per-session observation log using the provided synthesis reader
 * (typically gpt-4o for reasoning quality). Input is compressed
 * observation text (~20k chars), not raw conversation.
 *
 * Returns the raw synthesis output (which should be an `<observations>`
 * block containing cross-session patterns) plus token accounting.
 */
export async function runSynthesisOverObservations(args: {
  reader: IReader;
  perSessionLog: string;
}): Promise<{ rawOutput: string; tokensIn: number; tokensOut: number; model: string }> {
  const { reader, perSessionLog } = args;
  const userPrompt = `Per-session observations:\n\n${perSessionLog.trim()}`;
  const response = await reader.invoke({
    system: CROSS_SESSION_SYNTHESIS_PROMPT,
    user: userPrompt,
    maxTokens: OM_DEFAULTS.observation.maxOutputTokens,
    temperature: OM_DEFAULTS.reflection.temperature,
  });
  return {
    rawOutput: response.text,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    model: response.model,
  };
}

/** Helper: extract and concatenate observation blocks from a list of Observer outputs. */
function concatenateObservationBlocks(batches: OmObservationBatch[]): string {
  const blocks: string[] = [];
  for (const batch of batches) {
    const inner = extractObservationsBlock(batch.rawOutput);
    blocks.push(inner ?? stripWrappers(batch.rawOutput));
  }
  return blocks.join('\n\n');
}

/**
 * Ingest a haystack of LongMemEval sessions into a Mastra-style observation
 * log. Three ingest modes (see {@link OmIngestMode}):
 *
 * - `per-session` (v1): one Observer call per session. Preserves per-
 *   session fidelity; cannot encode cross-session patterns.
 * - `batched` (v2): one Observer call per token-bounded batch. Encodes
 *   cross-session patterns; compresses per-session detail at batch sizes.
 * - `dual-path` (v3 DEFAULT): both passes in parallel. Log concatenates
 *   under `## Per-session observations` + `## Cross-session patterns`
 *   section headers. Strict superset of v1 and v2.
 *
 * Returns the final consolidated log + token / cost accounting.
 */
export async function ingestSessions(args: IngestSessionsArgs): Promise<OmIngestResult> {
  const {
    observerReader,
    sessions,
    reflectionTokenThreshold = OM_DEFAULTS.reflection.observationTokens,
    observerConcurrency = 6,
    batchTokenTarget = 24_000,
    omMode = 'dual-path',
    synthesisReader,
  } = args;

  let perSessionBatches: OmObservationBatch[] = [];
  let batchedBatches: OmObservationBatch[] = [];
  let observerTokensIn = 0;
  let observerTokensOut = 0;
  let synthesisOutput: string | null = null;
  let synthesisModel: string | null = null;

  if (omMode === 'per-session') {
    const r = await runPerSessionPass(observerReader, sessions, observerConcurrency);
    perSessionBatches = r.batches;
    observerTokensIn += r.tokensIn;
    observerTokensOut += r.tokensOut;
  } else if (omMode === 'batched') {
    const r = await runBatchedPass(
      observerReader,
      sessions,
      batchTokenTarget,
      observerConcurrency,
    );
    batchedBatches = r.batches;
    observerTokensIn += r.tokensIn;
    observerTokensOut += r.tokensOut;
  } else if (omMode === 'dual-path') {
    // run both passes through independent worker pools at the full
    // concurrency each. Peak inflight calls = 2 × observerConcurrency.
    const [perSession, batched] = await Promise.all([
      runPerSessionPass(observerReader, sessions, observerConcurrency),
      runBatchedPass(observerReader, sessions, batchTokenTarget, observerConcurrency),
    ]);
    perSessionBatches = perSession.batches;
    batchedBatches = batched.batches;
    observerTokensIn = perSession.tokensIn + batched.tokensIn;
    observerTokensOut = perSession.tokensOut + batched.tokensOut;
  } else {
    // hierarchical: per-session Observer pass, then ONE synthesis call
    // over the already-compressed per-session observations. Synthesis
    // uses `synthesisReader` if provided (typically gpt-4o) otherwise
    // falls back to `observerReader`.
    const perSession = await runPerSessionPass(
      observerReader,
      sessions,
      observerConcurrency,
    );
    perSessionBatches = perSession.batches;
    observerTokensIn += perSession.tokensIn;
    observerTokensOut += perSession.tokensOut;

    const perSessionLogForSynthesis = concatenateObservationBlocks(perSession.batches);
    if (perSessionLogForSynthesis.trim().length > 0) {
      try {
        const synthesis = await runSynthesisOverObservations({
          reader: synthesisReader ?? observerReader,
          perSessionLog: perSessionLogForSynthesis,
        });
        synthesisOutput = synthesis.rawOutput;
        synthesisModel = synthesis.model;
        // Synthesis token cost rolls into observer totals; split via
        // per-case metadata downstream.
        observerTokensIn += synthesis.tokensIn;
        observerTokensOut += synthesis.tokensOut;
      } catch {
        // Synthesis failure: proceed with per-session log only.
      }
    }
  }

  const perSessionLog =
    perSessionBatches.length > 0 ? concatenateObservationBlocks(perSessionBatches) : '';
  const batchedLog =
    batchedBatches.length > 0 ? concatenateObservationBlocks(batchedBatches) : '';

  let consolidatedLog: string;
  if (omMode === 'dual-path') {
    consolidatedLog =
      `## Per-session observations\n\n${perSessionLog}\n\n## Cross-session patterns\n\n${batchedLog}`;
  } else if (omMode === 'per-session') {
    consolidatedLog = perSessionLog;
  } else if (omMode === 'hierarchical') {
    if (synthesisOutput) {
      const synthesisInner = extractObservationsBlock(synthesisOutput) ?? stripWrappers(synthesisOutput);
      consolidatedLog = `${perSessionLog}\n\n${CROSS_SESSION_SYNTHESIS_HEADER}\n\n${synthesisInner}`;
    } else {
      // Synthesis missing: fall back to per-session log alone.
      consolidatedLog = perSessionLog;
    }
  } else {
    consolidatedLog = batchedLog;
  }

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

  // Legacy alias: downstream consumers (metrics, metadata) that read
  // `observationBatches` get the combined set across both passes.
  const observationBatches: OmObservationBatch[] = [
    ...perSessionBatches,
    ...batchedBatches,
  ];

  return {
    observationBatches,
    perSessionBatches,
    batchedBatches,
    synthesisOutput,
    synthesisModel,
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
 * A passage retrieved from HybridRetriever (BM25 + dense + RRF + rerank)
 * and formatted for Step 16's OM+retrieval combined reader context.
 */
export interface OmReaderRetrievedPassage {
  /** Unique id for referring to the passage in the reader's answer. */
  id: string;
  /** Raw conversation-chunk content (verbatim, not observer-compressed). */
  content: string;
}

/**
 * Build the reader's system prompt for the answer call. Wraps the consolidated
 * observation log with Mastra's context preamble + instructions. The reader
 * sees this entire block PLUS the user's question (passed as the `user`
 * message).
 *
 * Step 15 v4a: when `includeScaffold: true`, appends
 * {@link CROSS_SESSION_READER_SCAFFOLD} before the continuation hint. The
 * scaffold adds explicit multi-step reasoning guidance for cross-session,
 * temporal, and knowledge-update questions where the reader otherwise
 * tends to fixate on the most recent observation block.
 *
 * Step 16: when `retrievedPassages` is a non-empty array, appends a
 * `## Relevant retrieved passages` section BEFORE the context instructions
 * + scaffold. The passages come from HybridRetriever's top-K output
 * (BM25 + dense + RRF + Cohere rerank) and carry verbatim raw-chunk
 * specifics that complement the observation log's dense cross-session
 * synthesis. Reader sees: observation log (patterns + dates) +
 * retrieved passages (quotes + specifics) + instructions + scaffold +
 * continuation hint.
 */
export function buildOmReaderSystemPrompt(
  observationLog: string,
  opts: {
    includeScaffold?: boolean;
    retrievedPassages?: readonly OmReaderRetrievedPassage[];
  } = {},
): string {
  const { includeScaffold = false, retrievedPassages } = opts;
  const scaffoldBlock = includeScaffold ? `\n\n${CROSS_SESSION_READER_SCAFFOLD}` : '';
  const hasPassages = Array.isArray(retrievedPassages) && retrievedPassages.length > 0;
  const passagesBlock = hasPassages
    ? `\n\n${RETRIEVED_PASSAGES_HEADER}\n\n${retrievedPassages
        .map((p) => `[${p.id}] ${p.content}`)
        .join('\n\n---\n\n')}\n\n${RETRIEVED_PASSAGES_INSTRUCTIONS}`
    : '';
  return `${OBSERVATION_CONTEXT_PROMPT}

<observations>
${observationLog.trim()}
</observations>${passagesBlock}

${OBSERVATION_CONTEXT_INSTRUCTIONS}${scaffoldBlock}

${OBSERVATION_CONTINUATION_HINT}`;
}
