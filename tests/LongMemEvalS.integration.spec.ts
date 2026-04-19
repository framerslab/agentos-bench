/**
 * @file LongMemEvalS.integration.spec.ts
 * @description End-to-end integration test for the LongMemEval-S
 * benchmark pipeline using a synthetic 3-case dataset, a MockReader,
 * and the real LongMemEvalJudge backed by a second MockReader.
 *
 * Verifies the full runner → adapter → judge flow:
 *   - Dataset JSON parsing into BenchCases
 *   - Replay-to-context path for `memoryMode=none`
 *   - Reader invocation + cost accounting
 *   - Judge invocation + cache reuse
 *   - Per-type accuracy aggregation in BenchResult.byType
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BenchmarkRunner,
  LongMemEvalJudge,
  LongMemEvalS,
  MockReader,
} from '../src/index.js';

interface SyntheticCase {
  id: string;
  type: string;
  question: string;
  gold: string;
  givenAnswer: string;
  judgeSaysYes: boolean;
}

const CASES: SyntheticCase[] = [
  {
    id: 'ss-1',
    type: 'single-session-user',
    question: 'What is the capital of France?',
    gold: 'Paris',
    givenAnswer: 'The capital is Paris.',
    judgeSaysYes: true,
  },
  {
    id: 'temporal-1',
    type: 'temporal-reasoning',
    question: 'How many days between the two meetings?',
    gold: '18',
    givenAnswer: '19 days',
    judgeSaysYes: true, // off-by-one clause in temporal rubric
  },
  {
    id: 'abstain-1',
    type: 'abstention',
    question: 'What is my credit card number?',
    gold: 'This information was never shared in the conversation.',
    givenAnswer: 'I don\'t know — that information was not shared.',
    judgeSaysYes: true,
  },
];

describe('LongMemEvalS integration (mock reader + real judge pipeline)', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-lme-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    const dataset = CASES.map((c) => ({
      question_id: c.id,
      question_type: c.type,
      question: c.question,
      answer: c.gold,
      question_date: '2026-04-18',
      haystack_sessions: [
        [
          { role: 'user', content: `[haystack for ${c.id}] ${c.question}` },
          { role: 'assistant', content: `Gold reference: ${c.gold}` },
        ],
      ],
      haystack_dates: ['2026-04-01'],
      haystack_session_ids: [`${c.id}-session-0`],
      answer_session_ids: [`${c.id}-session-0`],
    }));
    await fs.writeFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      JSON.stringify(dataset),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs all three cases end-to-end with mocked reader + judge', async () => {
    // Reader mock: match on question text, return the canned answer.
    const readerMock = new MockReader('claude-sonnet-4-6');
    for (const c of CASES) {
      readerMock.onUserContainsRespond(c.question, c.givenAnswer);
    }

    // Judge mock: match on the judge's prompt containing the case gold,
    // return "yes" or "no" per the synthetic fixture.
    const judgeMock = new MockReader('gpt-4o');
    for (const c of CASES) {
      judgeMock.on(
        (req) => req.user.includes(c.gold) && req.user.includes(c.givenAnswer),
        () => ({
          text: c.judgeSaysYes ? 'yes' : 'no',
          tokensIn: 42,
          tokensOut: 1,
          model: 'gpt-4o',
          latencyMs: 0,
        }),
      );
    }

    const judge = new LongMemEvalJudge({ reader: judgeMock });
    const benchmark = new LongMemEvalS({ reader: readerMock, variant: 's' });

    const runner = new BenchmarkRunner({ dataDir, resultsDir, judge });
    const result = await runner.run(benchmark, {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    expect(result.benchmarkId).toBe('longmemeval-s');
    expect(result.totalCases).toBe(3);
    expect(result.passedCases).toBe(3);
    expect(result.accuracy).toBe(1);
    expect(result.byType['single-session-user']?.n).toBe(1);
    expect(result.byType['temporal-reasoning']?.n).toBe(1);
    expect(result.byType['abstention']?.n).toBe(1);
    expect(result.totalUsd).toBeGreaterThanOrEqual(0);
  });

  it('persists a run JSON file under results/runs/ with per-case detail', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6');
    for (const c of CASES) {
      readerMock.onUserContainsRespond(c.question, c.givenAnswer);
    }
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'yes', tokensIn: 10, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });
    await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'none',
      replayMode: 'ingest',
    });

    const runsDir = path.join(resultsDir, 'runs');
    const files = await fs.readdir(runsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('longmemeval-s');

    const run = JSON.parse(await fs.readFile(path.join(runsDir, files[0]!), 'utf8'));
    expect(run.cases).toHaveLength(3);
    expect(run.cases.every((c: { scoreMetadata?: { rubricVersion?: string } }) => !!c.scoreMetadata?.rubricVersion)).toBe(true);
  });

  it('throws a clear case-level error when memoryMode is not none (v2 path)', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6');
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'no', tokensIn: 1, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });

    const result = await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
    });

    // Every case becomes an error; none should pass.
    expect(result.passedCases).toBe(0);
    for (const c of result.cases) {
      expect(c.error).toMatch(/memoryMode 'full-cognitive' not yet implemented/);
      expect(c.passed).toBe(false);
    }
  });
});
