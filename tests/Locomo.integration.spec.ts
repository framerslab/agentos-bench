/**
 * @file Locomo.integration.spec.ts
 * @description End-to-end test for the LOCOMO adapter. Synthesizes a
 * minimal locomo10.json fixture and verifies:
 *
 *   - Dataset parsing (nested session_<i> / session_<i>_date_time shape).
 *   - QA → BenchCase conversion with LOCOMO category → type mapping.
 *   - Runner drives the base-memory path end-to-end.
 *   - Judge routing for adversarial (category 5) and temporal (category 3).
 *   - Per-type accuracy breakdown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BenchmarkRunner,
  Locomo,
  LongMemEvalJudge,
  MockReader,
  extractSessions,
  loadLocomoDataset,
  LOCOMO_CATEGORY_NAMES,
} from '../src/index.js';

const FIXTURE_SAMPLE = {
  sample_id: 'loc_unit',
  conversation: {
    session_0_date_time: '2026-04-01T10:00:00',
    session_0: [
      { speaker: 'speaker_a', dia_id: 'D1:1', text: 'I just moved to Seattle for a new job.' },
      { speaker: 'speaker_b', dia_id: 'D1:2', text: 'Oh nice, what kind of job?' },
      { speaker: 'speaker_a', dia_id: 'D1:3', text: 'I joined a climate-tech startup as a backend engineer.' },
    ],
    session_1_date_time: '2026-04-15T11:30:00',
    session_1: [
      { speaker: 'speaker_a', dia_id: 'D2:1', text: 'My first month has been great. The team lead, Priya, is fantastic.' },
      { speaker: 'speaker_b', dia_id: 'D2:2', text: 'Glad to hear it!' },
    ],
  },
  qa: [
    {
      question: 'What city did speaker_a move to?',
      answer: 'Seattle',
      category: 1,
      evidence: ['D1:1'],
    },
    {
      question: 'How many days between speaker_a moving and mentioning Priya?',
      answer: '14',
      category: 3,
      evidence: ['D1:1', 'D2:1'],
    },
    {
      question: 'What was speaker_a\'s previous job salary?',
      answer: 'Not mentioned',
      category: 5,
      adversarial_answer: 'Not mentioned in the conversation.',
    },
  ],
};

describe('LOCOMO integration (synthetic fixture)', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-locomo-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'locomo'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    await fs.writeFile(
      path.join(dataDir, 'locomo', 'locomo10.json'),
      JSON.stringify([FIXTURE_SAMPLE]),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('parses sessions from the session_<i> / session_<i>_date_time shape', () => {
    const sessions = extractSessions(FIXTURE_SAMPLE as never);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.sessionId).toBe('session_0');
    expect(sessions[0]!.date).toBe('2026-04-01T10:00:00');
    expect(sessions[0]!.turns).toHaveLength(3);
    expect(sessions[0]!.turns[0]!.content).toContain('Seattle');
  });

  it('loads QA pairs as BenchCases with category-mapped types', async () => {
    const cases = await loadLocomoDataset(dataDir);
    expect(cases).toHaveLength(3);
    expect(cases.map((c) => c.type)).toEqual([
      LOCOMO_CATEGORY_NAMES[1],
      LOCOMO_CATEGORY_NAMES[3],
      LOCOMO_CATEGORY_NAMES[5],
    ]);
    expect(cases[2]!.metadata?.abstention).toBe(true);
  });

  it('runs all three QA cases end-to-end against the base-memory path', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6');
    readerMock.onUserContainsRespond(
      'What city did speaker_a',
      'Speaker_a moved to Seattle.',
    );
    readerMock.onUserContainsRespond(
      'How many days between speaker_a moving',
      'About 14 days between the two sessions.',
    );
    readerMock.onUserContainsRespond(
      'previous job salary',
      'The previous job salary was not mentioned in the conversation.',
    );

    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'yes', tokensIn: 20, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });

    const result = await runner.run(new Locomo({ reader: readerMock }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'base-memory',
      replayMode: 'ingest',
    });

    expect(result.benchmarkId).toBe('locomo');
    expect(result.totalCases).toBe(3);
    expect(result.passedCases).toBe(3);
    // Each LOCOMO category that appeared should have its own row in byType.
    expect(Object.keys(result.byType).sort()).toEqual(
      ['adversarial', 'single-hop', 'temporal'].sort(),
    );
  });
});
