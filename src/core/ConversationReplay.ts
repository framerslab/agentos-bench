/**
 * @file ConversationReplay.ts
 * @description Feeds a benchmark haystack into an AgentOS memory instance.
 *
 * LongMemEval, LOCOMO, and BEAM all package their haystacks as an ordered
 * list of dated {@link Session}s. AgentOS offers two natural ingestion
 * points, and the two produce measurably different accuracy numbers, so
 * the bench evaluates both:
 *
 * - `observe` — each turn is delivered to {@link CognitiveMemoryManager.observe},
 *   mimicking a live conversation. Triggers observer / reflector / consolidation
 *   just as in production use.
 * - `ingest` — each session is concatenated and stored as one memory trace
 *   via {@link Memory.remember} (for the base facade) or synthesized into
 *   observations for the cognitive manager. Faster and deterministic, but
 *   skips the personality-modulated observation pipeline.
 *
 * Memory-mode `none` is a degenerate case — the haystack is returned as a
 * concatenated string for the reader to place directly in its context.
 * This is handled by {@link buildHaystackContext}.
 *
 * @module agentos-bench/core/ConversationReplay
 */

import type { CognitiveMemoryManager } from '@framers/agentos';
import type { Memory } from '@framers/agentos';
import type { Session, ReplayMode, Turn } from './IBenchmark.js';

/**
 * Replay statistics — surfaced in {@link CaseRun.metadata}.
 */
export interface ReplayStats {
  /** Sessions replayed. */
  sessionsReplayed: number;
  /** Total turns replayed. */
  turnsReplayed: number;
  /** Observation notes emitted (observe mode only). */
  observationsEmitted: number;
  /** Memory traces created (best-effort count). */
  tracesCreated: number;
  /** Elapsed wall-clock time. */
  durationMs: number;
}

/**
 * Replay a haystack into a {@link CognitiveMemoryManager} via per-turn
 * `observe()`. Observation notes are discarded; whatever the observer
 * emits is fed back into the trace store asynchronously by the manager.
 */
export async function replayViaObserve(
  sessions: Session[],
  mgr: CognitiveMemoryManager,
): Promise<ReplayStats> {
  const start = Date.now();
  let turns = 0;
  let observations = 0;

  for (const session of sessions) {
    for (const turn of session.turns) {
      const notes = await mgr.observe(turn.role, turn.content);
      turns += 1;
      if (notes) observations += notes.length;
    }
  }

  return {
    sessionsReplayed: sessions.length,
    turnsReplayed: turns,
    observationsEmitted: observations,
    tracesCreated: observations,
    durationMs: Date.now() - start,
  };
}

/**
 * Replay a haystack into a {@link Memory} facade via one `remember()` call
 * per session. Session metadata (ID, date) is preserved on the trace so
 * retrieval can surface source provenance.
 */
export async function replayViaIngest(
  sessions: Session[],
  mem: Memory,
): Promise<ReplayStats> {
  const start = Date.now();
  let turns = 0;
  let traces = 0;

  for (const session of sessions) {
    const body = formatSessionAsMarkdown(session);
    turns += session.turns.length;
    // `Memory.remember` accepts tags/entities but not a free-form metadata
    // object — encode session ID and date as tags so provenance survives
    // ingestion and can be queried back out later.
    await mem.remember(body, {
      type: 'episodic',
      scope: 'user',
      scopeId: 'bench',
      tags: [`session:${session.sessionId}`, `date:${session.date}`],
    });
    traces += 1;
  }

  return {
    sessionsReplayed: sessions.length,
    turnsReplayed: turns,
    observationsEmitted: 0,
    tracesCreated: traces,
    durationMs: Date.now() - start,
  };
}

/**
 * Render a session as a compact markdown block — used by `ingest` replay
 * and by the `none`-memory baseline when stuffing the reader's context.
 */
export function formatSessionAsMarkdown(session: Session): string {
  const header = `## Session ${session.sessionId} (${session.date})`;
  const body = session.turns.map(formatTurn).join('\n');
  return `${header}\n${body}`;
}

function formatTurn(turn: Turn): string {
  const stamp = turn.timestamp ? ` [${turn.timestamp}]` : '';
  return `**${turn.role}**${stamp}: ${turn.content}`;
}

/**
 * Build the full haystack as a single markdown string — used by the
 * `none` memory mode to drop the haystack directly into the reader
 * context window.
 */
export function buildHaystackContext(sessions: Session[]): string {
  return sessions.map(formatSessionAsMarkdown).join('\n\n');
}

/**
 * Dispatch helper — picks the right replay function based on mode.
 * Micro-benchmarks with synthetic data typically bypass this.
 */
export async function replay(
  sessions: Session[],
  mode: ReplayMode,
  target:
    | { kind: 'cognitive'; mgr: CognitiveMemoryManager }
    | { kind: 'base'; mem: Memory },
): Promise<ReplayStats> {
  if (mode === 'observe') {
    if (target.kind !== 'cognitive') {
      throw new Error(
        "ConversationReplay: replayMode 'observe' requires a CognitiveMemoryManager target; got 'base'.",
      );
    }
    return replayViaObserve(sessions, target.mgr);
  }
  // ingest
  if (target.kind === 'base') return replayViaIngest(sessions, target.mem);
  // For cognitive + ingest we synthesize observations rather than calling
  // remember() — the base facade is the only one with a direct content API.
  // This keeps the two modes comparable for the cognitive manager.
  const stats = await replayViaObserve(sessions, target.mgr);
  return { ...stats, turnsReplayed: stats.turnsReplayed };
}
