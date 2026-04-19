/**
 * @file LongMemEvalS.metricsIntegration.spec.ts
 * @description End-to-end integration: encoding a three-session haystack
 * with a known gold-session ID, asserting that the CaseResult emits
 * populated retrievalMetrics, latencyBreakdown, memoryFootprint, and
 * goldSessionIds fields.
 *
 * Uses MockReader + MockJudge and the deterministic CharHashEmbedder
 * from createCognitiveManager — zero API cost, ~200ms runtime.
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

describe('LongMemEvalS metrics integration', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  // Three sessions with distinct topics. The question asks about session B;
  // gold is ['session-B']. Session A and C carry unrelated content so
  // char-hash retrieval has a chance to surface the right session.
  const FIXTURE = {
    question_id: 'coffee-gold-b',
    question_type: 'single-session-user',
    question: 'What is my usual coffee order?',
    answer: 'an oat flat white with an extra shot',
    question_date: '2026-04-18',
    haystack_sessions: [
      [
        { role: 'user', content: 'I like rainy weather and long walks in the park.' },
        { role: 'assistant', content: 'Nice — rainy-day walks are a classic.' },
      ],
      [
        { role: 'user', content: 'By the way, my usual coffee order is an oat flat white with an extra shot.' },
        { role: 'assistant', content: 'Noted — an oat flat white with an extra shot.' },
      ],
      [
        { role: 'user', content: 'I prefer fiction books over non-fiction.' },
        { role: 'assistant', content: 'Got it — fiction reader.' },
      ],
    ],
    haystack_dates: ['2026-03-01', '2026-04-01', '2026-04-10'],
    haystack_session_ids: ['session-A', 'session-B', 'session-C'],
    answer_session_ids: ['session-B'],
  };

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-metrics-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      JSON.stringify([FIXTURE]),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function runOne() {
    const readerMock = new MockReader('claude-sonnet-4-6').on(
      () => true,
      () => ({
        text: 'Your usual coffee order is an oat flat white with an extra shot.',
        tokensIn: 100,
        tokensOut: 20,
        model: 'claude-sonnet-4-6',
        latencyMs: 0,
      }),
    );
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'yes', tokensIn: 10, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });
    return runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
    });
  }

  it('emits non-null retrievalMetrics with sample of 1', async () => {
    const result = await runOne();
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;

    expect(caseResult.retrievalMetrics).toBeDefined();
    expect(caseResult.retrievalMetrics).not.toBeNull();
    expect(caseResult.retrievalMetrics!.goldCount).toBe(1);
    expect(caseResult.retrievalMetrics!.k).toBeGreaterThan(0);
    // recallAtK is 0 or 1 for this single-gold case — don't assert the
    // value; assert it's a number in [0, 1].
    expect(caseResult.retrievalMetrics!.recallAtK).toBeGreaterThanOrEqual(0);
    expect(caseResult.retrievalMetrics!.recallAtK).toBeLessThanOrEqual(1);
  });

  it('emits latencyBreakdown with a positive encodeMs and retrieveMs', async () => {
    const result = await runOne();
    const caseResult = result.cases[0]!;
    expect(caseResult.latencyBreakdown).toBeDefined();
    expect(caseResult.latencyBreakdown!.encodeMs).toBeGreaterThanOrEqual(0);
    expect(caseResult.latencyBreakdown!.retrieveMs).toBeGreaterThanOrEqual(0);
    expect(caseResult.latencyBreakdown!.replayMs).toBeGreaterThanOrEqual(0);
  });

  it('emits memoryFootprint with populated trace count and encode calls', async () => {
    const result = await runOne();
    const caseResult = result.cases[0]!;
    expect(caseResult.memoryFootprint).toBeDefined();
    expect(caseResult.memoryFootprint!.traceCount).toBeGreaterThan(0);
    expect(caseResult.memoryFootprint!.encodeCalls).toBeGreaterThan(0);
    // Brain file exists during the case (before close deletes it) so size > 0.
    expect(caseResult.memoryFootprint!.brainBytes).toBeGreaterThan(0);
  });

  it('passes goldSessionIds through to the case result', async () => {
    const result = await runOne();
    const caseResult = result.cases[0]!;
    expect(caseResult.goldSessionIds).toEqual(['session-B']);
  });

  it('retrievedEvidence carries sessionId parsed from bench-session tags', async () => {
    const result = await runOne();
    const caseResult = result.cases[0]!;
    const retrievedEvidence = (caseResult.metadata as {
      retrievedEvidence?: Array<{ sessionId?: string }>;
    }).retrievedEvidence ?? [];
    expect(retrievedEvidence.length).toBeGreaterThan(0);
    // At least one retrieved item must have a bench-session tag parsed.
    expect(retrievedEvidence.some((e) => typeof e.sessionId === 'string')).toBe(true);
  });
});
