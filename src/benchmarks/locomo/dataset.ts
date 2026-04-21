/**
 * @file dataset.ts
 * @description LOCOMO dataset loader.
 *
 * LOCOMO packs the entire benchmark (10 conversations × ~300 turns × up to
 * 35 sessions + multiple QA pairs per conversation) into a single
 * `locomo10.json` file under the snap-research/locomo repo. Each
 * top-level sample contains:
 *
 *   - `sample_id`              — conversation ID
 *   - `conversation`           — `session_<i>`, `session_<i>_date_time`
 *   - `qa[]`                   — {question, answer, category, evidence}
 *   - `events_session_<i>`     — event annotations (unused in v1)
 *   - `session_<i>_observation`, `session_<i>_summary` — RAG aids (unused)
 *
 * V1 supports only the QA task. Each QA pair becomes one
 * {@link BenchCase}; the haystack is the full conversation unrolled to
 * dated sessions. Category mapping matches LOCOMO paper's taxonomy.
 *
 * @module agentos-bench/benchmarks/locomo/dataset
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { BenchCase, Session, Turn } from '../../core/IBenchmark.js';

/**
 * LOCOMO question categories (see paper table 2). Integers in the
 * dataset; we surface them as strings in `BenchCase.type` for the
 * per-type accuracy breakdown.
 */
export const LOCOMO_CATEGORY_NAMES: Record<number, string> = {
  1: 'single-hop',
  2: 'multi-hop',
  3: 'temporal',
  4: 'open-domain',
  5: 'adversarial',
};

const TurnSchema = z.object({
  speaker: z.string(),
  dia_id: z.string().optional(),
  text: z.string(),
  img_url: z.string().optional(),
  blip_caption: z.string().optional(),
});

// Upstream LOCOMO has schema drift: some `answer` fields are numbers
// (e.g. `answer: 19` for a "how many days" temporal question). Accept
// number|string|string[] at parse time and coerce to string in the
// loader so downstream BenchCase sees a uniform string expected.
const QaSchema = z.object({
  question: z.string(),
  answer: z
    .union([z.string(), z.array(z.string()), z.number()])
    .optional(),
  category: z.union([z.number(), z.string()]).optional(),
  evidence: z.array(z.string()).optional(),
  adversarial_answer: z.string().optional(),
});

/**
 * Raw LOCOMO sample shape — lenient to handle schema drift across
 * dataset revisions. Session-indexed fields are matched at runtime.
 */
const SampleSchema = z
  .object({
    sample_id: z.string(),
    conversation: z.record(z.string(), z.unknown()),
    qa: z.array(QaSchema),
  })
  .passthrough();

export type RawLocomoSample = z.infer<typeof SampleSchema>;

/**
 * Load and parse `<dataDir>/locomo/locomo10.json` into
 * {@link BenchCase}s — one per QA pair across all 10 conversations.
 */
export async function loadLocomoDataset(dataDir: string): Promise<BenchCase[]> {
  const filePath = path.join(dataDir, 'locomo', 'locomo10.json');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `LOCOMO dataset not found at ${filePath}. Place the upstream locomo10.json there. ` +
          'Source: github.com/snap-research/locomo (data/locomo10.json).',
      );
    }
    throw err;
  }

  const parsed = JSON.parse(raw);
  const samples = Array.isArray(parsed) ? parsed : [parsed];

  const cases: BenchCase[] = [];
  for (const entry of samples) {
    const sample = SampleSchema.parse(entry);
    const haystack = extractSessions(sample);
    for (let qaIdx = 0; qaIdx < sample.qa.length; qaIdx++) {
      const qa = sample.qa[qaIdx]!;
      const answer = typeof qa.answer === 'string'
        ? qa.answer
        : typeof qa.answer === 'number'
          ? String(qa.answer)
          : Array.isArray(qa.answer)
            ? qa.answer.join(' / ')
            : (qa.adversarial_answer ?? '');
      const categoryNum = typeof qa.category === 'number' ? qa.category : Number(qa.category ?? 0);
      const categoryName = LOCOMO_CATEGORY_NAMES[categoryNum] ?? `category-${categoryNum || 'unknown'}`;

      cases.push({
        id: `${sample.sample_id}-qa-${qaIdx}`,
        type: categoryName,
        question: qa.question,
        haystack,
        expected: answer,
        metadata: {
          conversationId: sample.sample_id,
          category: categoryNum,
          evidence: qa.evidence,
          abstention: categoryNum === 5 || Boolean(qa.adversarial_answer),
        },
      });
    }
  }
  return cases;
}

/**
 * Pull the `session_<i>` arrays out of the lenient `conversation`
 * record and pair them with `session_<i>_date_time` strings.
 *
 * Exported for use by tests that construct synthetic samples.
 */
export function extractSessions(sample: RawLocomoSample): Session[] {
  const conv = sample.conversation;
  const sessions: Session[] = [];
  const keys = Object.keys(conv);
  const sessionIndices = new Set<number>();
  for (const k of keys) {
    const m = k.match(/^session_(\d+)$/);
    if (m) sessionIndices.add(Number.parseInt(m[1]!, 10));
  }

  const sortedIndices = Array.from(sessionIndices).sort((a, b) => a - b);
  for (const i of sortedIndices) {
    const rawTurns = conv[`session_${i}`];
    if (!Array.isArray(rawTurns)) continue;

    const turns: Turn[] = [];
    for (const raw of rawTurns) {
      const parsed = TurnSchema.safeParse(raw);
      if (!parsed.success) continue;
      turns.push({
        role: parsed.data.speaker.toLowerCase().includes('assistant') ? 'assistant' : 'user',
        content: `${parsed.data.speaker}: ${parsed.data.text}`,
      });
    }
    const date = (conv[`session_${i}_date_time`] as string | undefined) ?? '';
    sessions.push({
      sessionId: `session_${i}`,
      date,
      turns,
    });
  }
  return sessions;
}
