/**
 * @file LongMemEvalS.fullCognitive.spec.ts
 * @description Integration test for the `full-cognitive` memory mode on
 * LongMemEval-S.
 *
 * Exercises:
 *   - Constructing a fresh CognitiveMemoryManager per case (via the
 *     bench's createCognitiveManager helper) with a deterministic
 *     char-hash stub embedder — no API keys required.
 *   - Replaying the haystack via CognitiveMemoryManager.observe
 *     (observe mode) so the per-turn observer / reflector / working-memory
 *     pipeline runs exactly as it would in a production AgentOS deployment.
 *   - Retrieving relevant memory for the question via the manager.
 *   - Returning a system prompt that contains retrieved content.
 *   - Surfacing cognitive-specific stats (observations, working-memory
 *     slot count, retrieved trace count) in CaseRun.metadata.
 *   - Cleaning up the scratch SQLite brain file.
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

const FIXTURE_CASES = [
  {
    id: 'coffee-1',
    type: 'single-session-user',
    question: 'What is my favorite coffee order?',
    gold: 'an oat flat white with an extra shot',
    turns: [
      { role: 'user', content: 'By the way, my usual coffee order is an oat flat white with an extra shot.' },
      { role: 'assistant', content: 'Noted — an oat flat white with an extra shot.' },
    ],
  },
];

describe('LongMemEvalS full-cognitive path', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-fullcog-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    const dataset = FIXTURE_CASES.map((c) => ({
      question_id: c.id,
      question_type: c.type,
      question: c.question,
      answer: c.gold,
      question_date: '2026-04-18',
      haystack_sessions: [c.turns],
      haystack_dates: ['2026-04-01'],
      haystack_session_ids: [`${c.id}-session-0`],
    }));
    await fs.writeFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      JSON.stringify(dataset),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('replays the haystack through the cognitive manager and feeds retrieved memory into the reader prompt', async () => {
    const seenSystemPrompts: string[] = [];
    const readerMock = new MockReader('claude-sonnet-4-6');
    readerMock.on(
      (req) => {
        seenSystemPrompts.push(req.system ?? '');
        return true;
      },
      () => ({
        text: 'Your favorite coffee order is an oat flat white with an extra shot.',
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
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
    });

    expect(result.totalCases).toBe(1);
    expect(result.cases[0]!.error).toBeUndefined();
    expect(result.accuracy).toBe(1);

    // Reader was called with a prompt that referenced retrieved memory.
    expect(seenSystemPrompts).toHaveLength(1);
    const prompt = seenSystemPrompts[0]!;
    expect(prompt).toContain('Retrieved Memory');
    expect(prompt.toLowerCase()).toMatch(/oat flat white|coffee order/);

    // Cognitive-specific stats recorded on the case run.
    const caseMeta = result.cases[0]!.metadata as {
      memoryMode?: string;
      replayStats?: { turnsReplayed: number; sessionsReplayed: number };
      recalledTraces?: number;
      workingMemorySlots?: number;
      observationsEmitted?: number;
    };
    expect(caseMeta.memoryMode).toBe('full-cognitive');
    expect(caseMeta.replayStats?.sessionsReplayed).toBe(1);
    expect(caseMeta.replayStats?.turnsReplayed).toBe(2);
    expect(typeof caseMeta.recalledTraces).toBe('number');
    expect(typeof caseMeta.workingMemorySlots).toBe('number');

    // The cognitive path must actually *encode* traces — not just run
    // through without doing work. Every turn produces one encode call
    // in observe mode, so observationsEmitted should match turnsReplayed.
    expect(caseMeta.observationsEmitted).toBe(caseMeta.replayStats?.turnsReplayed);
    expect(caseMeta.recalledTraces).toBeGreaterThan(0);
  });

  it('full-cognitive surfaces metadata that base-memory does not, proving the paths diverge', async () => {
    const readerMock = new MockReader('claude-sonnet-4-6').on(
      () => true,
      () => ({ text: 'ok', tokensIn: 10, tokensOut: 5, model: 'claude-sonnet-4-6', latencyMs: 0 }),
    );
    const judgeMock = new MockReader('gpt-4o').on(
      () => true,
      () => ({ text: 'yes', tokensIn: 1, tokensOut: 1, model: 'gpt-4o', latencyMs: 0 }),
    );

    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
    });

    const cognitive = await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
    });
    const base = await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'base-memory',
      replayMode: 'ingest',
    });

    const cogMeta = cognitive.cases[0]!.metadata as Record<string, unknown>;
    const baseMeta = base.cases[0]!.metadata as Record<string, unknown>;

    // Contract: full-cognitive publishes both workingMemorySlots and
    // observationsEmitted. base-memory publishes neither. If a future
    // refactor blurs that boundary, the paths have collapsed and the
    // benchmark can no longer distinguish cognitive contributions.
    expect(cogMeta.memoryMode).toBe('full-cognitive');
    expect(cogMeta.workingMemorySlots).toBeDefined();
    expect(cogMeta.observationsEmitted).toBeDefined();

    expect(baseMeta.memoryMode).toBe('base-memory');
    expect(baseMeta.workingMemorySlots).toBeUndefined();
    expect(baseMeta.observationsEmitted).toBeUndefined();
  });

  it('cleans up scratch cognitive brain files after the run', async () => {
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

    // Isolated scratchRoot prevents concurrent suites from dropping
    // files into the directory this assertion scans.
    const scratchRoot = path.join(tmpRoot, 'scratch');
    const runner = new BenchmarkRunner({
      dataDir,
      resultsDir,
      judge: new LongMemEvalJudge({ reader: judgeMock }),
      scratchRoot,
    });

    await runner.run(new LongMemEvalS({ reader: readerMock, variant: 's' }), {
      reader: 'claude-sonnet-4-6',
      memoryMode: 'full-cognitive',
      replayMode: 'observe',
    });

    const stillThere: string[] = [];
    try {
      const roots = await fs.readdir(path.join(scratchRoot, 'agentos-bench'));
      for (const r of roots) {
        const inside = await fs.readdir(path.join(scratchRoot, 'agentos-bench', r)).catch(() => []);
        stillThere.push(...inside);
      }
    } catch {
      /* scratch cleaned up entirely */
    }
    expect(stillThere.filter((f) => f.endsWith('.sqlite'))).toHaveLength(0);
  });
});
