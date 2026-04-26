/**
 * @file dataset.ts
 * @description BEAM dataset loader.
 *
 * Reads BEAM tier files from a local cache. The upstream dataset lives
 * at github.com/vectorize-io/agent-memory-benchmark under
 * `data/beam/<tier>/{queries,documents,categories,stats}.json.gz`.
 * The HuggingFace mirror is at huggingface.co/datasets/Mohammadta/BEAM.
 *
 * Schema (per upstream 2026-04-26):
 *   - queries.json.gz: list of `{ id, query, gold_answers[], gold_ids[],
 *     user_id, meta: { question_category, conversation_id, rubric[],
 *     why_unanswerable? } }`
 *   - documents.json.gz: list of `{ id, content, user_id, timestamp }`
 *     where `content` is a multi-turn dialogue with markers
 *     `[<date> | Turn <n>] <Role>: <text>` (date is omitted past Turn 0).
 *
 * **Haystack assembly:** every query carries a `user_id`. The haystack
 * for that query is ALL documents with the same `user_id` (each document
 * → one Session with parsed turns). At the 100K tier there are 20 users
 * × 6-9 documents each (170 docs total) and 20 queries per user (400
 * queries × 10 categories).
 *
 * @module agentos-bench/benchmarks/beam/dataset
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { BenchCase, Session, Turn } from '../../core/IBenchmark.js';

/** Target tier in the BEAM 100K → 10M token ladder. */
export type BeamTier = '100k' | '500k' | '1m' | '10m';

/**
 * BEAM question categories. Ten total per the upstream dataset; richer
 * than LongMemEval's six. Some overlap (knowledge_update,
 * temporal_reasoning) for cross-benchmark per-category comparison.
 */
export const BEAM_QUESTION_CATEGORIES = [
  'abstention',
  'contradiction_resolution',
  'event_ordering',
  'information_extraction',
  'instruction_following',
  'knowledge_update',
  'multi_session_reasoning',
  'preference_following',
  'summarization',
  'temporal_reasoning',
] as const;

export type BeamQuestionCategory = (typeof BEAM_QUESTION_CATEGORIES)[number];

const RawQueryMetaSchema = z.object({
  question_category: z.string(),
  conversation_id: z.string().optional(),
  rubric: z.array(z.string()).optional(),
  why_unanswerable: z.string().optional(),
});

const RawQuerySchema = z.object({
  id: z.string(),
  query: z.string(),
  gold_answers: z.array(z.string()),
  gold_ids: z.array(z.string()),
  user_id: z.string(),
  meta: RawQueryMetaSchema,
});

const RawDocumentSchema = z.object({
  id: z.string(),
  content: z.string(),
  user_id: z.string(),
  timestamp: z.union([z.string(), z.null()]).optional(),
});

type RawBeamQuery = z.infer<typeof RawQuerySchema>;
type RawBeamDocument = z.infer<typeof RawDocumentSchema>;

/**
 * Parse a BEAM document's `content` into ordered {@link Turn}s. The
 * upstream format wraps each turn with a marker line:
 *
 *   `[March-15-2024 | Turn 0] User: <text>` (date present on Turn 0)
 *   `[Turn 1] Assistant: <text>` (date omitted on subsequent turns)
 *
 * The marker may include a date (`<Month-Day-Year> | Turn N`) or
 * just `Turn N`. Body text continues until the next marker or end-of-
 * input. Roles are normalized to the {@link Turn.role} union.
 */
function parseDocumentTurns(content: string): { turns: Turn[]; firstDate: string | undefined } {
  // Match each marker; capture optional date, turn number, and role.
  const markerRegex = /\[(?:([^|\]]+?)\s*\|\s*)?Turn\s+(\d+)\]\s*(\w+):/g;
  const markers: Array<{ index: number; date: string | undefined; role: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(content)) !== null) {
    markers.push({
      index: m.index,
      date: m[1]?.trim() || undefined,
      role: m[3].trim(),
    });
  }
  if (markers.length === 0) {
    // No markers found — treat the whole thing as one user turn.
    return {
      turns: [{ role: 'user', content: content.trim() }],
      firstDate: undefined,
    };
  }

  const turns: Turn[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const next = markers[i + 1];
    const start = marker.index + content.slice(marker.index).indexOf(':') + 1;
    const end = next ? next.index : content.length;
    const body = content.slice(start, end).trim();
    if (!body) continue;
    turns.push({
      role: normalizeRole(marker.role),
      content: body,
      timestamp: marker.date,
    });
  }
  return { turns, firstDate: markers[0]?.date };
}

function normalizeRole(role: string): Turn['role'] {
  const lower = role.toLowerCase();
  if (lower === 'user' || lower === 'assistant' || lower === 'system' || lower === 'tool') {
    return lower;
  }
  return 'user';
}

/** Convert a raw BEAM document to a {@link Session}. */
function documentToSession(doc: RawBeamDocument): Session {
  const { turns, firstDate } = parseDocumentTurns(doc.content);
  return {
    sessionId: doc.id,
    date: doc.timestamp ?? firstDate ?? '',
    turns,
  };
}

async function readJsonGz<T>(filePath: string): Promise<T> {
  const buf = await fs.readFile(filePath);
  const json = gunzipSync(buf).toString('utf8');
  return JSON.parse(json) as T;
}

/**
 * Load a BEAM tier dataset from `dataDir/beam/<tier>/{queries,documents}.json.gz`.
 * Returns parsed {@link BenchCase}s with haystacks assembled per-user.
 *
 * @throws Error with a download hint when the tier directory is missing.
 */
export async function loadBeamDataset(
  dataDir: string,
  tier: BeamTier,
): Promise<BenchCase[]> {
  const tierDir = path.join(dataDir, 'beam', tier);
  const queriesPath = path.join(tierDir, 'queries.json.gz');
  const documentsPath = path.join(tierDir, 'documents.json.gz');

  let stat;
  try {
    stat = await fs.stat(queriesPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `BEAM ${tier} dataset not found at ${queriesPath}. ` +
          `Download via 'agentos-bench setup --benchmark beam-${tier}' or place the upstream files there manually ` +
          `(source: github.com/vectorize-io/agent-memory-benchmark/tree/main/data/beam/${tier} or huggingface.co/datasets/Mohammadta/BEAM).`,
      );
    }
    throw err;
  }
  if (stat.size === 0) {
    throw new Error(`BEAM ${tier} dataset at ${queriesPath} is empty.`);
  }

  const [rawQueries, rawDocuments] = await Promise.all([
    readJsonGz<unknown[]>(queriesPath),
    readJsonGz<unknown[]>(documentsPath),
  ]);

  if (!Array.isArray(rawQueries)) {
    throw new Error(`BEAM ${tier} queries file is not an array.`);
  }
  if (!Array.isArray(rawDocuments)) {
    throw new Error(`BEAM ${tier} documents file is not an array.`);
  }

  const queries = rawQueries.map((q) => RawQuerySchema.parse(q));
  const documents = rawDocuments.map((d) => RawDocumentSchema.parse(d));

  // Group documents by user_id so each query's haystack picks up the
  // user's full conversation history.
  const docsByUser = new Map<string, RawBeamDocument[]>();
  for (const doc of documents) {
    const list = docsByUser.get(doc.user_id);
    if (list) list.push(doc);
    else docsByUser.set(doc.user_id, [doc]);
  }

  return queries.map((q) => convertQueryToBenchCase(q, docsByUser, tier));
}

function convertQueryToBenchCase(
  query: RawBeamQuery,
  docsByUser: Map<string, RawBeamDocument[]>,
  tier: BeamTier,
): BenchCase {
  const userDocs = docsByUser.get(query.user_id) ?? [];
  const haystack = userDocs.map(documentToSession);
  const [first, ...rest] = query.gold_answers;
  // Four BEAM categories ship with empty `gold_answers` — the rubric is
  // the gold standard for those (contradiction_resolution,
  // instruction_following, preference_following, summarization). Join
  // the rubric as the `expected` string so the existing LongMemEval
  // judge prompt has scorable text; preserve the structured rubric in
  // metadata for rubric-aware judges.
  const rubric = query.meta.rubric ?? [];
  const expected = first && first.length > 0 ? first : rubric.join('\n• ');
  return {
    id: query.id,
    type: query.meta.question_category,
    question: query.query,
    haystack,
    expected,
    acceptableAnswers: rest.length > 0 ? rest : undefined,
    metadata: {
      beamTier: tier,
      conversationId: query.meta.conversation_id ?? query.user_id,
      goldDocumentIds: query.gold_ids,
      rubric: rubric.length > 0 ? rubric : undefined,
      whyUnanswerable: query.meta.why_unanswerable,
      hasGoldAnswer: Boolean(first && first.length > 0),
    },
  };
}
