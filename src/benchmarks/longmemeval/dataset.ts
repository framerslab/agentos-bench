/**
 * @file dataset.ts
 * @description LongMemEval dataset loader.
 *
 * Reads the canonical LongMemEval JSONL files from a local cache or,
 * when `@huggingface/hub` is installed and a network is reachable,
 * downloads them from the official HF dataset repo `xiaowu0162/longmemeval`.
 *
 * Schema reference: github.com/xiaowu0162/LongMemEval (README and
 * `src/utils/dataloader.py`). Each line is one JSON object per case.
 *
 * @module agentos-bench/benchmarks/longmemeval/dataset
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { BenchCase, Session, Turn } from '../../core/IBenchmark.js';

/** Which LongMemEval variant to load. */
export type LongMemEvalVariant = 's' | 'm' | 'oracle';

const VARIANT_FILENAMES: Record<LongMemEvalVariant, string> = {
  s: 'longmemeval_s.json',
  m: 'longmemeval_m.json',
  oracle: 'longmemeval_oracle.json',
};

// The upstream JSON files are arrays of records, not JSONL. Documented here
// so nobody goes hunting for a stream parser.
const SOURCE_FORMAT = 'json-array' as const;

/**
 * Zod schema for one LongMemEval haystack session. The `sessions_date` field
 * is the ISO date of the session; `sessions` is the ordered turn list.
 */
const RawTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']).default('user'),
  content: z.string(),
});

const RawSessionEntrySchema = z.object({
  sessions_date: z.string().optional(),
  session_date: z.string().optional(),
  session_id: z.string().optional(),
  id: z.string().optional(),
  session: z.array(RawTurnSchema).optional(),
  turns: z.array(RawTurnSchema).optional(),
  sessions: z.array(RawTurnSchema).optional(),
});

/**
 * Zod schema for one LongMemEval question. Field names vary slightly
 * between the S / M / Oracle variants, so optional overloads are accepted.
 */
const RawCaseSchema = z.object({
  question_id: z.string(),
  question_type: z.string(),
  question: z.string(),
  // Upstream dumps mix strings and numbers (temporal questions often
  // serialise the answer as `18` not `"18"`). Accept either and
  // normalise to a string downstream.
  answer: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  question_date: z.string().optional(),
  answer_session_ids: z.array(z.string()).optional(),
  haystack_session_ids: z.array(z.string()).optional(),
  haystack_dates: z.array(z.string()).optional(),
  haystack_sessions: z.array(z.array(RawTurnSchema)).optional(),
  // Some dumps use a flat `sessions` array of session objects.
  sessions: z.array(RawSessionEntrySchema).optional(),
});

export type RawLongMemEvalCase = z.infer<typeof RawCaseSchema>;

/**
 * Load a LongMemEval dataset variant from `dataDir/longmemeval/<variant>.json`.
 * Returns parsed {@link BenchCase}s. Throws with a useful hint if the file is
 * missing.
 */
export async function loadLongMemEvalDataset(
  dataDir: string,
  variant: LongMemEvalVariant,
): Promise<BenchCase[]> {
  const filename = VARIANT_FILENAMES[variant];
  const filePath = path.join(dataDir, 'longmemeval', filename);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `LongMemEval dataset not found at ${filePath}. ` +
          `Download via 'agentos-bench setup --benchmark longmemeval-${variant}' ` +
          `or place the upstream file there manually ` +
          `(source: huggingface.co/datasets/xiaowu0162/longmemeval).`,
      );
    }
    throw err;
  }

  // Upstream format is a JSON array. Accept JSONL too for forward compat.
  const parsed: unknown = raw.trim().startsWith('[') ? JSON.parse(raw) : parseJsonl(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`LongMemEval dataset at ${filePath} is not an array (${SOURCE_FORMAT} expected).`);
  }

  return parsed.map((entry, idx) => {
    const c = RawCaseSchema.parse(entry);
    return convertCase(c, idx, variant);
  });
}

function parseJsonl(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Convert one raw upstream case to a {@link BenchCase}. Handles both the
 * nested `haystack_sessions` array-of-array shape and the flat `sessions`
 * array-of-objects shape seen in different dataset dumps.
 */
function convertCase(raw: RawLongMemEvalCase, idx: number, variant: LongMemEvalVariant): BenchCase {
  const haystack = extractHaystack(raw);
  const expected = normaliseAnswer(raw.answer);
  return {
    id: raw.question_id || `longmemeval-${variant}-${idx}`,
    type: raw.question_type,
    question: raw.question,
    haystack,
    expected,
    questionDate: raw.question_date,
    metadata: {
      variant,
      answerSessionIds: raw.answer_session_ids,
      abstention:
        raw.question_type.toLowerCase().includes('abstention') ||
        /unanswerable/i.test(expected),
    },
  };
}

/**
 * Coerce the upstream `answer` field — which may be a string, a number,
 * a boolean, or an array of strings/numbers — into a single string the
 * rubric composer expects.
 */
function normaliseAnswer(answer: RawLongMemEvalCase['answer']): string {
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number' || typeof answer === 'boolean') return String(answer);
  return answer.map((a) => String(a)).join(' / ');
}

function extractHaystack(raw: RawLongMemEvalCase): Session[] {
  // Shape A: `haystack_sessions: Turn[][]` paired with `haystack_dates: string[]`.
  if (raw.haystack_sessions && raw.haystack_sessions.length > 0) {
    return raw.haystack_sessions.map((turns, i) => ({
      sessionId: raw.haystack_session_ids?.[i] ?? `session_${i}`,
      date: raw.haystack_dates?.[i] ?? '',
      turns: turns.map(normalizeTurn),
    }));
  }

  // Shape B: flat `sessions: { sessions_date, session: Turn[] }[]`.
  if (raw.sessions && raw.sessions.length > 0) {
    return raw.sessions.map((s, i) => {
      const turns = (s.session ?? s.turns ?? s.sessions ?? []).map(normalizeTurn);
      return {
        sessionId: s.session_id ?? s.id ?? `session_${i}`,
        date: s.sessions_date ?? s.session_date ?? '',
        turns,
      };
    });
  }

  return [];
}

function normalizeTurn(t: { role?: string; content: string }): Turn {
  const role = (t.role ?? 'user') as Turn['role'];
  return { role, content: t.content };
}
