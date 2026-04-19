/**
 * @file LongMemEvalS.baseMemory.spec.ts
 * @description Integration test for the `base-memory` path on
 * LongMemEval-S. Exercises the Memory.create → replayViaIngest →
 * Memory.recall → reader pipeline end-to-end against a synthetic
 * 2-case dataset.
 *
 * Intentionally bypasses the judge — we assert the pipeline feeds
 * retrieved memory into the reader system prompt and that replay
 * stats propagate into the case-run metadata. Judge correctness is
 * covered by the main LongMemEvalS integration test.
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

describe('LongMemEvalS base-memory path', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-base-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    const dataset = [
      {
        question_id: 'base-1',
        question_type: 'single-session-user',
        question: 'What did I say about my favorite coffee order?',
        answer: 'oat flat white with an extra shot',
        question_date: '2026-04-18',
        haystack_sessions: [
          [
            { role: 'user', content: 'By the way, my usual coffee order is an oat flat white with an extra shot.' },
            { role: 'assistant', content: 'Good to know, I will remember that.' },
          ],
          [
            { role: 'user', content: 'I really enjoyed the pasta last night.' },
            { role: 'assistant', content: 'Glad you liked it.' },
          ],
        ],
        haystack_dates: ['2026-04-01', '2026-04-05'],
        haystack_session_ids: ['session-coffee', 'session-pasta'],
      },
    ];
    await fs.writeFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      JSON.stringify(dataset),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('opens a scratch Memory, replays the haystack, recalls, and includes recalled content in the reader prompt', async () => {
    // Capture the system prompt the reader received so we can assert
    // retrieved content made it in.
    const seenSystemPrompts: string[] = [];
    const readerMock = new MockReader('claude-sonnet-4-6');
    readerMock.on(
      (req) => {
        seenSystemPrompts.push(req.system ?? '');
        return true;
      },
      () => ({
        text: 'You prefer an oat flat white with an extra shot.',
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

    const result = await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'base-memory',
      replayMode: 'ingest',
    });

    expect(result.totalCases).toBe(1);
    expect(result.accuracy).toBe(1);
    expect(seenSystemPrompts).toHaveLength(1);

    // The base-memory prompt wraps recalled content in a "Retrieved Memory"
    // section. When FTS surfaces the coffee session, its content should
    // appear verbatim in the prompt.
    const prompt = seenSystemPrompts[0]!;
    expect(prompt).toContain('--- Retrieved Memory ---');
    expect(prompt).toMatch(/oat flat white|coffee order/);

    // Replay stats and recall count should be recorded in case metadata.
    const caseRun = result.cases[0]!;
    const stats = (caseRun.metadata as { replayStats?: { turnsReplayed: number; sessionsReplayed: number } }).replayStats;
    expect(stats?.sessionsReplayed).toBe(2);
    expect(stats?.turnsReplayed).toBe(4);
    expect((caseRun.metadata as { recalledTraces?: number }).recalledTraces).toBeGreaterThan(0);
  });

  it('tears down the per-case SQLite brain file after the case completes', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6').on(
      () => true,
      () => ({
        text: 'answer',
        tokensIn: 10,
        tokensOut: 5,
        model: 'claude-sonnet-4-6',
        latencyMs: 0,
      }),
    );
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'no', tokensIn: 1, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });

    const scratchRootBefore = path.join(os.tmpdir(), 'agentos-bench');
    await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'base-memory',
      replayMode: 'ingest',
    });

    // After the run the runner deletes the scratch directory; no stale
    // brain-*.sqlite files should survive under the shared bench root.
    let stillThere: string[] = [];
    try {
      const roots = await fs.readdir(scratchRootBefore);
      for (const r of roots) {
        if (r.startsWith('longmemeval-s-')) {
          const inside = await fs.readdir(path.join(scratchRootBefore, r)).catch(() => []);
          stillThere.push(...inside);
        }
      }
    } catch {
      // root may not exist if all scratch dirs were cleaned up.
    }
    expect(stillThere.filter((f) => f.endsWith('.sqlite'))).toHaveLength(0);
  });
});
