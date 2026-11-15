/**
 * @file longmemevalAbstentionIds.spec.ts
 * @description LongMemEval marks an abstention question by its id: "If `question_id` ends with `_abs`, then the question
 * is an `abstention` question" (the dataset's README,
 * https://github.com/xiaowu0162/LongMemEval/blob/d6dc8b50a2d9ac0c99485ea28fa5755c62414c34/README.md?plain=1#L71), and its
 * evaluator picks the abstention prompt by `'_abs' in question_id`
 * (https://github.com/xiaowu0162/LongMemEval/blob/d6dc8b50a2d9ac0c99485ea28fa5755c62414c34/src/evaluation/evaluate_qa.py#L101).
 * Such a question keeps its base `question_type` and its answer is an explanation, so neither the type nor the answer
 * says it is one. These tests pin that an `_abs` case loads as an abstention case from every file shape the loader
 * reads, that the judge grades it with the abstention rubric on the bench's own path and under `--driver gmi`, and that
 * a grading cached before the rule was read is not reused for it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCaseRunKeyParts, resolveRunConfig } from '../src/core/BenchmarkRunner.js';
import { Cache } from '../src/core/Cache.js';
import type { RunConfig } from '../src/core/IBenchmark.js';
import { resetGmiDriver } from '../src/drivers/gmiDriver.js';
import {
  BenchmarkRunner,
  LongMemEvalJudge,
  LongMemEvalS,
  MockReader,
  RUBRIC_VERSION,
  loadLongMemEvalDataset,
} from '../src/index.js';
import { startOpenAiStub, type OpenAiStub } from './helpers/openaiStub.js';

/** The abstention rubric's closing question, as the judge prompt carries it. */
const ABSTENTION_QUESTION = 'Does the model correctly identify the question as unanswerable?';
/** Words only the temporal-reasoning rubric carries. */
const TEMPORAL_CLAUSE = 'do not penalize off-by-one errors';

const ABS_ID = '80ec1f4f_abs';
const BASE_ID = '80ec1f4f';
const ABS_QUESTION = 'How many days passed between my trip to Lisbon and my trip to Porto?';
const BASE_QUESTION = 'How many days passed between my trip to Lisbon and my trip to Madrid?';
/** What the reader answers every question with. */
const READER_ANSWER = "I don't know: the conversations never mention that trip.";

const TURNS = [
  { role: 'user', content: 'I flew to Lisbon on March 3 and on to Madrid on March 15.' },
  { role: 'assistant', content: 'Two good cities for a spring trip.' },
];

/** One raw case. `A` is the nested `haystack_sessions` shape, `B` the flat `sessions` array of objects. */
function rawCase(id: string, question: string, answer: string, shape: 'A' | 'B'): Record<string, unknown> {
  const base = { question_id: id, question_type: 'temporal-reasoning', question, answer, question_date: '2026-04-18' };
  return shape === 'A'
    ? { ...base, haystack_sessions: [TURNS], haystack_dates: ['2026-03-20'], haystack_session_ids: ['s0'] }
    : { ...base, sessions: [{ session_id: 's0', sessions_date: '2026-03-20', session: TURNS }] };
}

/** An `_abs` case and its answerable twin of the same type. Neither answer holds the word "unanswerable". */
function cases(shape: 'A' | 'B'): Record<string, unknown>[] {
  return [
    rawCase(ABS_ID, ABS_QUESTION, 'You did not mention a trip to Porto.', shape),
    rawCase(BASE_ID, BASE_QUESTION, '12 days', shape),
  ];
}

describe("a LongMemEval case whose id ends in '_abs'", () => {
  let tmp: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-abs-'));
    dataDir = path.join(tmp, 'data');
    resultsDir = path.join(tmp, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const writeDataset = (body: string) => fs.writeFile(path.join(dataDir, 'longmemeval', 'longmemeval_s.json'), body);

  describe('loads as an abstention case', () => {
    it('from a JSON array of nested haystack_sessions cases (shape A)', async () => {
      await writeDataset(JSON.stringify(cases('A')));
      const loaded = await loadLongMemEvalDataset(dataDir, 's');
      expect(loaded.map((c) => [c.id, c.type, c.metadata?.abstention])).toEqual([
        [ABS_ID, 'temporal-reasoning', true],
        [BASE_ID, 'temporal-reasoning', false],
      ]);
    });

    it('from JSON lines of flat sessions cases (shape B)', async () => {
      await writeDataset(cases('B').map((c) => JSON.stringify(c)).join('\n'));
      const loaded = await loadLongMemEvalDataset(dataDir, 's');
      expect(loaded.map((c) => [c.id, c.type, c.metadata?.abstention])).toEqual([
        [ABS_ID, 'temporal-reasoning', true],
        [BASE_ID, 'temporal-reasoning', false],
      ]);
    });

    it('while the two signals read before still mark a case', async () => {
      await writeDataset(
        JSON.stringify([
          { ...rawCase('q-typed', 'Where is my passport?', 'Not stated.', 'A'), question_type: 'abstention' },
          rawCase('q-worded', 'Where is my passport?', 'Unanswerable: never mentioned.', 'A'),
        ]),
      );
      const loaded = await loadLongMemEvalDataset(dataDir, 's');
      expect(loaded.map((c) => c.metadata?.abstention)).toEqual([true, true]);
    });
  });

  /** A judge that answers "yes" and keeps every prompt it is sent. */
  function recordingJudge(): { judge: LongMemEvalJudge; prompts: string[] } {
    const prompts: string[] = [];
    const reader = new MockReader('gpt-4o').on(
      (req) => {
        prompts.push(req.user);
        return true;
      },
      () => ({ text: 'yes', tokensIn: 1, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );
    return { judge: new LongMemEvalJudge({ reader }), prompts };
  }

  /** The one prompt that names `question`. */
  const promptFor = (prompts: string[], question: string): string => {
    const found = prompts.filter((p) => p.includes(question));
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  const BENCH_CONFIG: RunConfig = { reader: 'gpt-4o-mini', memoryMode: 'none', replayMode: 'ingest', concurrency: 1 };

  it("is graded with the abstention rubric on the bench's own path, and its twin with its type's", async () => {
    await writeDataset(JSON.stringify(cases('A')));
    const { judge, prompts } = recordingJudge();
    const reader = new MockReader('gpt-4o-mini').on(
      () => true,
      () => ({ text: READER_ANSWER, tokensIn: 1, tokensOut: 1, model: 'gpt-4o-mini', latencyMs: 0 }),
    );
    const result = await new BenchmarkRunner({ dataDir, resultsDir, judge }).run(
      new LongMemEvalS({ reader, variant: 's' }),
      BENCH_CONFIG,
    );
    expect(result.cases.map((c) => c.error)).toEqual([undefined, undefined]);
    expect(prompts).toHaveLength(2);

    const abs = promptFor(prompts, ABS_QUESTION);
    expect(abs).toContain(ABSTENTION_QUESTION);
    expect(abs).toContain('Explanation: You did not mention a trip to Porto.');
    expect(abs).not.toContain(TEMPORAL_CLAUSE);

    const twin = promptFor(prompts, BASE_QUESTION);
    expect(twin).toContain(TEMPORAL_CLAUSE);
    expect(twin).toContain('Correct Answer: 12 days');
    expect(twin).not.toContain(ABSTENTION_QUESTION);
  });

  describe('under --driver gmi, with the provider stubbed', () => {
    let stub: OpenAiStub;
    const saved: Record<string, string | undefined> = {};

    beforeEach(async () => {
      stub = await startOpenAiStub(() => READER_ANSWER);
      for (const name of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'COHERE_API_KEY']) saved[name] = process.env[name];
      process.env.OPENAI_API_KEY = 'stub-upstream-key';
      process.env.OPENAI_BASE_URL = stub.url;
      delete process.env.COHERE_API_KEY;
    });
    afterEach(async () => {
      await resetGmiDriver();
      await stub.close();
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it(
      "is graded with the abstention rubric, and its twin with its type's",
      async () => {
        await writeDataset(JSON.stringify(cases('A')));
        const { judge, prompts } = recordingJudge();
        const result = await new BenchmarkRunner({ dataDir, resultsDir, judge, scratchRoot: path.join(tmp, 'scratch') }).run(
          new LongMemEvalS({ reader: new MockReader('gpt-4o-mini'), variant: 's' }),
          { reader: 'gpt-4o-mini', memoryMode: 'full-cognitive', replayMode: 'observe', concurrency: 1, driver: 'gmi' } as RunConfig,
        );
        expect(result.cases.map((c) => c.error)).toEqual([undefined, undefined]);
        expect(result.cases.map((c) => c.actualOutput)).toEqual([READER_ANSWER, READER_ANSWER]);
        // The agent asked each question of the provider; the judge read each answer.
        expect(stub.chat).toHaveLength(2);
        expect(prompts).toHaveLength(2);

        const abs = promptFor(prompts, ABS_QUESTION);
        expect(abs).toContain(ABSTENTION_QUESTION);
        expect(abs).not.toContain(TEMPORAL_CLAUSE);
        const twin = promptFor(prompts, BASE_QUESTION);
        expect(twin).toContain(TEMPORAL_CLAUSE);
        expect(twin).not.toContain(ABSTENTION_QUESTION);
      },
      120_000,
    );
  });

  it('is graded again rather than read from a grading cached under the earlier keys; its twin keeps its cache', async () => {
    await writeDataset(JSON.stringify(cases('A')));
    const cache = new Cache(path.join(dataDir, 'cache'));
    const resolved = resolveRunConfig(BENCH_CONFIG);
    for (const caseId of [ABS_ID, BASE_ID]) {
      // The case-result key as it was laid out before this rule: the 14 parts of a default run.
      const { resultKeyParts } = computeCaseRunKeyParts(resolved, {
        benchmarkId: 'longmemeval-s',
        benchmarkVersion: '1.0.0',
        caseId,
        judgeModel: 'gpt-4o',
        judgeRubricVersion: RUBRIC_VERSION,
      });
      await cache.set(
        'case-result',
        {
          caseId,
          actualOutput: READER_ANSWER,
          latencyMs: 0,
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          score: 0,
          passed: false,
          scoreMetadata: { judgeModel: 'gpt-4o', rubricVersion: RUBRIC_VERSION, reasoning: 'stale-result' },
        },
        ...resultKeyParts.slice(0, 14),
      );
      // The judge's key as it was laid out before this rule.
      await cache.set(
        'judge',
        { score: 0, correct: false, reasoning: 'stale-judgment', judgeModel: 'gpt-4o', tokensIn: 0, tokensOut: 0, rubricVersion: RUBRIC_VERSION },
        'longmemeval-s',
        '1.0.0',
        caseId,
        resolved.reader,
        resolved.memoryMode,
        resolved.replayMode,
        'gpt-4o',
        RUBRIC_VERSION,
        READER_ANSWER,
      );
    }

    const { judge, prompts } = recordingJudge();
    const reader = new MockReader('gpt-4o-mini').on(
      () => true,
      () => ({ text: READER_ANSWER, tokensIn: 1, tokensOut: 1, model: 'gpt-4o-mini', latencyMs: 0 }),
    );
    const result = await new BenchmarkRunner({ dataDir, resultsDir, judge }).run(
      new LongMemEvalS({ reader, variant: 's' }),
      BENCH_CONFIG,
    );

    // Only the `_abs` case reached the judge, with the abstention rubric, and its new grading stands.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(ABS_QUESTION);
    expect(prompts[0]).toContain(ABSTENTION_QUESTION);
    const byId = new Map(result.cases.map((c) => [c.caseId, c]));
    expect(byId.get(ABS_ID)?.passed).toBe(true);
    // The twin's grading did not change, so its cached result is still read.
    expect(byId.get(BASE_ID)?.passed).toBe(false);
    expect(byId.get(BASE_ID)?.scoreMetadata).toMatchObject({ reasoning: 'stale-result' });
  });
});
