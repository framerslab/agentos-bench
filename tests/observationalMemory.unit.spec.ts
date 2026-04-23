/**
 * @file observationalMemory.unit.spec.ts
 * @description Unit tests for Step 15 OM runner primitives: observation-block
 * extraction (tolerant of code fences + surrounding prose), reader context
 * assembly, and the end-to-end ingest pipeline with a stubbed reader.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IReader, ReaderRequest, ReaderResponse } from '../src/readers/IReader.js';
import {
  buildObserverSystemPrompt,
  buildReflectorSystemPrompt,
  buildOmReaderSystemPrompt,
  extractObservationsBlock,
  ingestSessions,
  runObserverOnSession,
  partitionSessionsIntoBatches,
  combineSessionsForObserver,
  OBSERVATION_CONTEXT_PROMPT,
  OBSERVATION_CONTEXT_INSTRUCTIONS,
  OBSERVATION_CONTINUATION_HINT,
  OM_DEFAULTS,
  classifyQuestion,
  routeQuestion,
  DEFAULT_ROUTE,
  CLASSIFIER_SYSTEM_PROMPT,
  type QuestionCategory,
  type RouterConfig,
} from '../src/observational-memory/index.js';

function stubReader(responses: ReaderResponse[]): IReader & { calls: ReaderRequest[] } {
  const calls: ReaderRequest[] = [];
  let i = 0;
  return {
    model: 'stub',
    async invoke(req) {
      calls.push(req);
      const next = responses[i++];
      if (!next) throw new Error(`stub out of responses after ${calls.length}`);
      return next;
    },
    calls,
  };
}

const mkResponse = (text: string): ReaderResponse => ({
  text,
  tokensIn: 1000,
  tokensOut: 200,
  model: 'gpt-5-mini',
  latencyMs: 500,
});

describe('extractObservationsBlock', () => {
  it('extracts content between <observations> tags', () => {
    const raw = `<observations>
Date: Dec 4, 2025
* 🔴 (14:30) User lives in Berlin
</observations>

<current-task>Nothing pending</current-task>`;
    const out = extractObservationsBlock(raw);
    expect(out).toContain('User lives in Berlin');
    expect(out).not.toContain('<current-task>');
  });

  it('strips ```xml code fences before extracting', () => {
    const raw = '```xml\n<observations>\n* 🔴 test\n</observations>\n```';
    const out = extractObservationsBlock(raw);
    expect(out).toBe('* 🔴 test');
  });

  it('returns null when no observations block is present', () => {
    expect(extractObservationsBlock('no tags here')).toBeNull();
  });

  it('is case-insensitive on the tag', () => {
    expect(extractObservationsBlock('<OBSERVATIONS>x</OBSERVATIONS>')).toBe('x');
  });
});

describe('buildObserverSystemPrompt', () => {
  it('contains the three core blocks: instructions, output format, guidelines', () => {
    const prompt = buildObserverSystemPrompt();
    expect(prompt).toContain('DISTINGUISH USER ASSERTIONS FROM QUESTIONS');
    expect(prompt).toContain('OUTPUT FORMAT');
    expect(prompt).toContain('GUIDELINES');
    expect(prompt).toContain('🔴');
    expect(prompt).toContain('TEMPORAL ANCHORING');
  });

  it('appends custom instructions when provided', () => {
    const prompt = buildObserverSystemPrompt('extra rule about dates');
    expect(prompt).toContain('CUSTOM INSTRUCTIONS');
    expect(prompt).toContain('extra rule about dates');
  });
});

describe('buildReflectorSystemPrompt', () => {
  it('contains reflector-specific framing and embeds observer instructions', () => {
    const prompt = buildReflectorSystemPrompt();
    expect(prompt).toContain('memory consciousness');
    expect(prompt).toContain('observational-memory-instruction');
    expect(prompt).toContain('USER ASSERTIONS TAKE PRECEDENCE');
  });
});

describe('buildOmReaderSystemPrompt', () => {
  it('wraps the log with context prompt + instructions + continuation hint', () => {
    const log = 'Date: Dec 4\n* 🔴 User lives in Berlin';
    const prompt = buildOmReaderSystemPrompt(log);
    expect(prompt).toContain(OBSERVATION_CONTEXT_PROMPT);
    expect(prompt).toContain('<observations>');
    expect(prompt).toContain('User lives in Berlin');
    expect(prompt).toContain(OBSERVATION_CONTEXT_INSTRUCTIONS);
    expect(prompt).toContain(OBSERVATION_CONTINUATION_HINT);
  });

  it('omits the cross-session scaffold by default', () => {
    const prompt = buildOmReaderSystemPrompt('log');
    expect(prompt).not.toContain('CROSS-SESSION REASONING');
  });

  it('appends the cross-session scaffold when includeScaffold is true (Step 15 v4a)', () => {
    const prompt = buildOmReaderSystemPrompt('log', { includeScaffold: true });
    expect(prompt).toContain('CROSS-SESSION REASONING');
    expect(prompt).toContain('SCAN ALL date-grouped sections');
    // Scaffold lands between OBSERVATION_CONTEXT_INSTRUCTIONS and the
    // continuation hint (so the reader sees the instructions, then the
    // scaffold, then the continuation reminder).
    const scaffoldIdx = prompt.indexOf('CROSS-SESSION REASONING');
    const continuationIdx = prompt.indexOf('Please continue naturally');
    expect(scaffoldIdx).toBeGreaterThan(0);
    expect(continuationIdx).toBeGreaterThan(scaffoldIdx);
  });

  it('omits the retrieved-passages block by default (Step 16 OFF)', () => {
    const prompt = buildOmReaderSystemPrompt('log');
    expect(prompt).not.toContain('## Relevant retrieved passages');
    expect(prompt).not.toContain('[P0]');
  });

  it('appends retrieved passages + instructions when retrievedPassages is provided (Step 16)', () => {
    const prompt = buildOmReaderSystemPrompt('my-observations', {
      retrievedPassages: [
        { id: 'P0', content: 'User said they love hiking on March 10' },
        { id: 'P1', content: 'User mentioned a dog named Buddy on April 2' },
      ],
    });
    // Section header present.
    expect(prompt).toContain('## Relevant retrieved passages');
    // Each passage wrapped with its id prefix.
    expect(prompt).toContain('[P0] User said they love hiking on March 10');
    expect(prompt).toContain('[P1] User mentioned a dog named Buddy on April 2');
    // Passages instructions present.
    expect(prompt).toContain('use them directly in your answer');
    // Retrieval section lands AFTER the observation log but BEFORE the
    // context instructions + continuation hint so the reader sees
    // observations first, specifics second, then guidance.
    const obsIdx = prompt.indexOf('<observations>');
    const retrievalIdx = prompt.indexOf('## Relevant retrieved passages');
    const instructionsIdx = prompt.indexOf('IMPORTANT: When responding');
    expect(obsIdx).toBeLessThan(retrievalIdx);
    expect(retrievalIdx).toBeLessThan(instructionsIdx);
  });

  it('omits the retrieved-passages block when retrievedPassages is empty array', () => {
    const prompt = buildOmReaderSystemPrompt('log', { retrievedPassages: [] });
    expect(prompt).not.toContain('## Relevant retrieved passages');
  });
});

describe('runObserverOnSession', () => {
  it('sends a session transcript and returns raw output plus cost', async () => {
    const reader = stubReader([
      mkResponse('<observations>\n* 🔴 (14:30) User tests\n</observations>'),
    ]);
    const out = await runObserverOnSession({
      reader,
      session: {
        sessionId: 's0',
        date: '2024-05-01',
        turns: [{ role: 'user', content: 'hello', timestamp: '14:30' }],
      },
    });
    expect(out.sessionId).toBe('s0');
    expect(out.rawOutput).toContain('User tests');
    expect(out.tokensIn).toBe(1000);
    expect(out.tokensOut).toBe(200);
    expect(reader.calls[0].system).toContain('DISTINGUISH USER ASSERTIONS');
    expect(reader.calls[0].user).toContain('[user @ 14:30] hello');
  });
});

describe('ingestSessions — happy path (per-session batches)', () => {
  it('runs observer per session when batchTokenTarget forces one session per batch', async () => {
    const reader = stubReader([
      mkResponse('<observations>\n* 🔴 (14:30) Session A fact\n</observations>'),
      mkResponse('<observations>\n* 🔴 (15:00) Session B fact\n</observations>'),
    ]);
    const result = await ingestSessions({
      observerReader: reader,
      sessions: [
        { sessionId: 'a', turns: [{ role: 'user', content: 'x' }] },
        { sessionId: 'b', turns: [{ role: 'user', content: 'y' }] },
      ],
      observerConcurrency: 1, // deterministic order for assertions
      batchTokenTarget: 1, // force per-session batches (each session > 1 token)
    });
    expect(result.observationBatches).toHaveLength(2);
    expect(result.finalLog).toContain('Session A fact');
    expect(result.finalLog).toContain('Session B fact');
    expect(result.reflections).toHaveLength(0); // below 40k threshold
    expect(result.observerTokensIn).toBe(2000);
    expect(result.observerTokensOut).toBe(400);
  });
});

describe('ingestSessions — reflection trigger', () => {
  it('fires reflector when accumulated log exceeds the threshold', async () => {
    // Craft large observer outputs so the concatenated log exceeds the
    // lowered threshold we pass in.
    const bigBlock = (i: number): string =>
      `<observations>\n${Array.from({ length: 50 }, (_, j) => `* 🔴 (14:${String(j).padStart(2, '0')}) Session ${i} fact ${j} x`.repeat(10)).join('\n')}\n</observations>`;
    const responses: ReaderResponse[] = [
      {
        text: bigBlock(1),
        tokensIn: 1000, tokensOut: 500, model: 'gpt-5-mini', latencyMs: 500,
      },
      {
        text: bigBlock(2),
        tokensIn: 1000, tokensOut: 500, model: 'gpt-5-mini', latencyMs: 500,
      },
      // reflector response
      {
        text: '<observations>\nDate: Dec 4\n* 🔴 (14:30) Consolidated fact\n</observations>',
        tokensIn: 8000, tokensOut: 100, model: 'gpt-5-mini', latencyMs: 800,
      },
    ];
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions: [
        { sessionId: 'a', turns: [{ role: 'user', content: 'x' }] },
        { sessionId: 'b', turns: [{ role: 'user', content: 'y' }] },
      ],
      observerConcurrency: 1,
      omMode: 'batched', // v2 semantics — one Observer call per batch
      batchTokenTarget: 1, // force per-session batches so both big blocks fire
      reflectionTokenThreshold: 500, // force a reflection
    });
    expect(result.reflections).toHaveLength(1);
    expect(result.finalLog).toContain('Consolidated fact');
    expect(result.reflectorTokensIn).toBe(8000);
    expect(result.reflectorTokensOut).toBe(100);
  });
});

describe('ingestSessions — observer failure tolerance', () => {
  it('continues past a failed observer call on one batch', async () => {
    let i = 0;
    const reader: IReader = {
      model: 'stub',
      async invoke() {
        i++;
        if (i === 1) throw new Error('api blip');
        return mkResponse('<observations>\n* 🔴 ok\n</observations>');
      },
    };
    const result = await ingestSessions({
      observerReader: reader,
      sessions: [
        { sessionId: 'a', turns: [{ role: 'user', content: 'x' }] },
        { sessionId: 'b', turns: [{ role: 'user', content: 'y' }] },
      ],
      observerConcurrency: 1,
      omMode: 'batched', // v2 semantics
      batchTokenTarget: 1, // force two separate batches so the first throws and the second succeeds
    });
    expect(result.observationBatches).toHaveLength(1);
    expect(result.finalLog).toContain('ok');
  });
});

describe('OM_DEFAULTS', () => {
  it('matches the Mastra thresholds (30k observer, 40k reflector)', () => {
    expect(OM_DEFAULTS.observation.messageTokens).toBe(30_000);
    expect(OM_DEFAULTS.reflection.observationTokens).toBe(40_000);
    expect(OM_DEFAULTS.observation.temperature).toBe(0.3);
    expect(OM_DEFAULTS.reflection.temperature).toBe(0);
  });
});

describe('partitionSessionsIntoBatches', () => {
  it('groups small sessions into one batch when all fit under the target', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'small payload' }],
    }));
    const batches = partitionSessionsIntoBatches(sessions, 24_000);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });

  it('places a single oversized session in its own batch (no split)', () => {
    const oversized = {
      sessionId: 'big',
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(200_000) }],
    };
    const batches = partitionSessionsIntoBatches([oversized], 24_000);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([oversized]);
  });

  it('respects batchTokenTarget: no batch spans more sessions than the target allows', () => {
    // 20 sessions, each ~5k tokens (20_000 chars). Target 24k -> ~4-5 per batch.
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const batches = partitionSessionsIntoBatches(sessions, 24_000);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      // Each session is ~5k tokens. A batch of 5 would be 25k > 24k, so at
      // most 5 sessions per batch (last one may push over by one session).
      expect(batch.length).toBeLessThanOrEqual(5);
      expect(batch.length).toBeGreaterThan(0);
    }
  });

  it('preserves session order within and across batches', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const batches = partitionSessionsIntoBatches(sessions, 24_000);
    const flatSessionIds = batches.flat().map((s) => s.sessionId);
    expect(flatSessionIds).toEqual(sessions.map((s) => s.sessionId));
  });
});

describe('combineSessionsForObserver', () => {
  it('concatenates session transcripts with blank-line separators and preserves date headers', () => {
    const a = {
      sessionId: 'a',
      date: '2024-05-01',
      turns: [{ role: 'user' as const, content: 'hello from session a', timestamp: '09:00' }],
    };
    const b = {
      sessionId: 'b',
      date: '2024-05-02',
      turns: [{ role: 'user' as const, content: 'hello from session b', timestamp: '10:00' }],
    };
    const combined = combineSessionsForObserver([a, b]);
    expect(combined).toContain('Date: 2024-05-01');
    expect(combined).toContain('Date: 2024-05-02');
    expect(combined).toContain('[user @ 09:00] hello from session a');
    expect(combined).toContain('[user @ 10:00] hello from session b');
    // Blank-line separator between the two session blocks.
    expect(combined).toMatch(/hello from session a[\s\S]*\n\n[\s\S]*Date: 2024-05-02/);
  });
});

describe('ingestSessions — mode: per-session (v1 restoration)', () => {
  it('invokes observer once per session and emits no cross-session header', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: `fact ${i}` }],
    }));
    const responses = Array.from({ length: 10 }, () =>
      mkResponse('<observations>\n* 🔴 per-session fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'per-session',
      observerConcurrency: 1,
    });
    expect(reader.calls).toHaveLength(5);
    expect(result.finalLog).not.toContain('## Cross-session patterns');
    expect(result.finalLog).not.toContain('## Per-session observations');
  });
});

describe('ingestSessions — mode: batched (v2 preservation)', () => {
  it('invokes observer once per batch and emits no section headers', async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const responses = Array.from({ length: 25 }, () =>
      mkResponse('<observations>\n* 🔴 batched fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'batched',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    expect(reader.calls.length).toBeGreaterThan(1);
    expect(reader.calls.length).toBeLessThan(sessions.length);
    expect(result.finalLog).not.toContain('## Per-session observations');
    expect(result.finalLog).not.toContain('## Cross-session patterns');
  });
});

describe('ingestSessions — mode: dual-path (v3 default)', () => {
  it('invokes observer per-session AND per-batch, emits both section headers', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const responses = Array.from({ length: 20 }, () =>
      mkResponse('<observations>\n* 🔴 fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'dual-path',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    expect(reader.calls.length).toBeGreaterThanOrEqual(sessions.length);
    expect(result.finalLog).toContain('## Per-session observations');
    expect(result.finalLog).toContain('## Cross-session patterns');
    expect(result.perSessionBatches).toHaveLength(5);
    expect(result.batchedBatches.length).toBeGreaterThan(0);
  });

  it('sums observer tokens across both passes', async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    const responses = Array.from({ length: 10 }, () =>
      mkResponse('<observations>\n* 🔴 fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'dual-path',
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    expect(result.observerTokensIn).toBe(reader.calls.length * 1000);
    expect(result.observerTokensOut).toBe(reader.calls.length * 200);
  });
});

describe('ingestSessions — mode: hierarchical (v4b)', () => {
  it('runs per-session observer pass + one synthesis call, appends synthesis block', async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: `fact ${i}` }],
    }));
    // 3 per-session Observer responses, then 1 synthesis response.
    const observerReader = stubReader([
      mkResponse('<observations>\n* 🔴 Session 0 fact\n</observations>'),
      mkResponse('<observations>\n* 🔴 Session 1 fact\n</observations>'),
      mkResponse('<observations>\n* 🔴 Session 2 fact\n</observations>'),
    ]);
    const synthesisReader = stubReader([
      mkResponse('<observations>\n* 🔗 Cross-session: facts 0, 1, 2 reference similar patterns\n</observations>'),
    ]);
    const result = await ingestSessions({
      observerReader,
      sessions,
      omMode: 'hierarchical',
      observerConcurrency: 1,
      synthesisReader,
    });
    // 3 Observer calls on observerReader, 1 synthesis call on synthesisReader.
    expect(observerReader.calls).toHaveLength(3);
    expect(synthesisReader.calls).toHaveLength(1);
    // Synthesis system prompt should contain the synthesis instructions.
    expect(synthesisReader.calls[0].system).toContain('cross-session synthesis');
    // Synthesis user prompt should contain the per-session observations.
    expect(synthesisReader.calls[0].user).toContain('Session 0 fact');
    // Final log contains per-session observations AND the synthesis section header.
    expect(result.finalLog).toContain('Session 0 fact');
    expect(result.finalLog).toContain('## Cross-session synthesis');
    expect(result.finalLog).toContain('Cross-session: facts 0, 1, 2 reference');
    // Per-session batches populated; batched empty; synthesis fields populated.
    expect(result.perSessionBatches).toHaveLength(3);
    expect(result.batchedBatches).toHaveLength(0);
    expect(result.synthesisOutput).toContain('Cross-session');
    expect(result.synthesisModel).toBe('gpt-5-mini');
    // Token totals sum observer + synthesis.
    expect(result.observerTokensIn).toBe(4 * 1000); // 3 observer + 1 synthesis, each 1000 in
    expect(result.observerTokensOut).toBe(4 * 200);
  });

  it('falls back to per-session log alone when synthesis call fails', async () => {
    const sessions = [
      {
        sessionId: 's0',
        date: '2024-01-01',
        turns: [{ role: 'user' as const, content: 'fact 0' }],
      },
    ];
    const observerReader = stubReader([
      mkResponse('<observations>\n* 🔴 Session 0 fact\n</observations>'),
    ]);
    const synthesisReader: IReader = {
      model: 'gpt-4o',
      async invoke() {
        throw new Error('synthesis api error');
      },
    };
    const result = await ingestSessions({
      observerReader,
      sessions,
      omMode: 'hierarchical',
      observerConcurrency: 1,
      synthesisReader,
    });
    expect(result.finalLog).toContain('Session 0 fact');
    expect(result.finalLog).not.toContain('## Cross-session synthesis');
    expect(result.synthesisOutput).toBeNull();
    expect(result.synthesisModel).toBeNull();
  });

  it('defaults synthesisReader to observerReader when undefined', async () => {
    const sessions = [
      {
        sessionId: 's0',
        date: '2024-01-01',
        turns: [{ role: 'user' as const, content: 'fact 0' }],
      },
    ];
    const reader = stubReader([
      mkResponse('<observations>\n* 🔴 Session 0 fact\n</observations>'),
      mkResponse('<observations>\n* 🔗 synthesis observation\n</observations>'),
    ]);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'hierarchical',
      observerConcurrency: 1,
    });
    // Both calls flow through the single reader.
    expect(reader.calls).toHaveLength(2);
    expect(result.synthesisModel).toBe('gpt-5-mini');
    expect(result.finalLog).toContain('## Cross-session synthesis');
  });
});

describe('ingestSessions — batched observer calls', () => {
  it('runs observer once per batch (fewer calls than sessions)', async () => {
    // 20 sessions of ~5k tokens each = ~100k total. At 24k target -> ~4-5 batches.
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'x'.repeat(20_000) }],
    }));
    // Provide more stub responses than the worst-case batch count.
    const responses: ReaderResponse[] = Array.from({ length: 25 }, () =>
      mkResponse('<observations>\n* 🔴 batched fact\n</observations>'),
    );
    const reader = stubReader(responses);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'batched', // v2 semantics — batched-only observer pass
      batchTokenTarget: 24_000,
      observerConcurrency: 1,
    });
    expect(reader.calls.length).toBeGreaterThan(1);
    expect(reader.calls.length).toBeLessThan(sessions.length);
    expect(result.observationBatches).toHaveLength(reader.calls.length);
    // Each batch's transcript should contain a Date header and span multiple sessions.
    const firstCall = reader.calls[0];
    expect(firstCall.user).toContain('Date: 2024-01-01');
  });

  it('falls back to a single batch when batchTokenTarget exceeds total haystack size', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      date: '2024-01-01',
      turns: [{ role: 'user' as const, content: 'short' }],
    }));
    const reader = stubReader([mkResponse('<observations>\n* 🔴 tiny\n</observations>')]);
    const result = await ingestSessions({
      observerReader: reader,
      sessions,
      omMode: 'batched', // v2 semantics
      batchTokenTarget: 100_000,
      observerConcurrency: 1,
    });
    expect(reader.calls).toHaveLength(1);
    expect(result.observationBatches).toHaveLength(1);
    // The single batch call should contain content from all 5 sessions.
    expect(reader.calls[0].user).toMatch(/Date: 2024-01-01[\s\S]*\n\nDate: 2024-01-01/);
  });
});

describe('classifyQuestion (Step 16c)', () => {
  it('calls the reader once with the classifier system prompt and returns the category', async () => {
    const reader = stubReader([
      { text: 'multi-session', tokensIn: 120, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'Which languages have I said I am learning?',
    });
    expect(reader.calls).toHaveLength(1);
    expect(reader.calls[0].system).toBe(CLASSIFIER_SYSTEM_PROMPT);
    expect(reader.calls[0].user).toContain('Which languages have I said I am learning?');
    expect(result.category).toBe('multi-session');
  });

  it('parses category from uppercase output with trailing whitespace', async () => {
    const reader = stubReader([
      { text: 'TEMPORAL-REASONING  \n', tokensIn: 100, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'In what order did I visit the three countries?',
    });
    expect(result.category).toBe('temporal-reasoning');
  });

  it('parses category when model appends trailing punctuation like a period', async () => {
    const reader = stubReader([
      { text: 'knowledge-update.', tokensIn: 100, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'What is my current job title?',
    });
    expect(result.category).toBe('knowledge-update');
  });

  it('parses category when model prefixes the response with "Category:"', async () => {
    const reader = stubReader([
      { text: 'Category: single-session-user', tokensIn: 100, tokensOut: 5, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'Where did I say I moved last month?',
    });
    expect(result.category).toBe('single-session-user');
  });

  it('returns real token usage from the reader response (for cost tracking)', async () => {
    const reader = stubReader([
      { text: 'multi-session', tokensIn: 187, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'q',
    });
    expect(result.tokensIn).toBe(187);
    expect(result.tokensOut).toBe(3);
    expect(result.model).toBe('gpt-5-mini');
  });

  it('defaults to multi-session on unparseable model output', async () => {
    const reader = stubReader([
      { text: 'banana', tokensIn: 100, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    const result = await classifyQuestion({
      reader,
      question: 'Who knows',
    });
    expect(result.category).toBe('multi-session');
  });
});

describe('routeQuestion (Step 16c v2 — Phase A grounded)', () => {
  it('routes SSU/SSA/SSP/TR to canonical (no OM, retrieval on, no scaffold)', () => {
    const expected: RouterConfig = { runOM: false, runRetrieval: true, useScaffold: false };
    for (const cat of [
      'single-session-user',
      'single-session-assistant',
      'single-session-preference',
      'temporal-reasoning',
    ] as const satisfies readonly QuestionCategory[]) {
      expect(routeQuestion(cat)).toEqual(expected);
    }
  });

  it('routes KU + MS to v5 OM (OM on, retrieval off, scaffold on)', () => {
    const expected: RouterConfig = { runOM: true, runRetrieval: false, useScaffold: true };
    for (const cat of ['knowledge-update', 'multi-session'] as const satisfies readonly QuestionCategory[]) {
      expect(routeQuestion(cat)).toEqual(expected);
    }
  });

  it('exports DEFAULT_ROUTE matching the v5 OM (KU/MS) route shape', () => {
    expect(DEFAULT_ROUTE).toEqual({ runOM: true, runRetrieval: false, useScaffold: true });
  });
});

describe('CLASSIFIER_SYSTEM_PROMPT_FEWSHOT (Step 16c v10)', () => {
  it('exports a distinct fewshot prompt with explicit Question/Category pairs', async () => {
    const { CLASSIFIER_SYSTEM_PROMPT_FEWSHOT } = await import(
      '../src/observational-memory/index.js'
    );
    expect(typeof CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toBe('string');
    expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).not.toBe(CLASSIFIER_SYSTEM_PROMPT);
    expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toMatch(/Question:/);
    expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toMatch(/Category:\s+single-session-/);
  });

  it('fewshot prompt covers all 6 categories at least once', async () => {
    const { CLASSIFIER_SYSTEM_PROMPT_FEWSHOT } = await import(
      '../src/observational-memory/index.js'
    );
    for (const cat of [
      'single-session-user',
      'single-session-assistant',
      'single-session-preference',
      'knowledge-update',
      'multi-session',
      'temporal-reasoning',
    ]) {
      expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toContain(cat);
    }
  });

  it('fewshot prompt distinguishes single-session-user from single-session-assistant', async () => {
    const { CLASSIFIER_SYSTEM_PROMPT_FEWSHOT } = await import(
      '../src/observational-memory/index.js'
    );
    // Should contain at least one Q/A pair labelled SSU and one labelled SSA
    // so the classifier learns the USER-said vs ASSISTANT-said distinction.
    expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toMatch(/Category:\s+single-session-user/);
    expect(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT).toMatch(/Category:\s+single-session-assistant/);
  });
});

describe('classifyQuestion prompt variant', () => {
  it('uses the fewshot prompt when args.useFewshotPrompt is true', async () => {
    const { CLASSIFIER_SYSTEM_PROMPT_FEWSHOT } = await import(
      '../src/observational-memory/index.js'
    );
    const reader = stubReader([
      { text: 'multi-session', tokensIn: 250, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    await classifyQuestion({
      reader,
      question: 'Test',
      useFewshotPrompt: true,
    });
    expect(reader.calls[0].system).toBe(CLASSIFIER_SYSTEM_PROMPT_FEWSHOT);
  });

  it('uses the basic prompt by default', async () => {
    const reader = stubReader([
      { text: 'multi-session', tokensIn: 120, tokensOut: 3, model: 'gpt-5-mini', latencyMs: 50 },
    ]);
    await classifyQuestion({
      reader,
      question: 'Test',
    });
    expect(reader.calls[0].system).toBe(CLASSIFIER_SYSTEM_PROMPT);
  });
});

describe('Step 17: extractPerSessionBlocks (uses perSessionBatches directly)', () => {
  it('builds sessionId → observation map from per-session batches', async () => {
    const { extractPerSessionBlocks } = await import(
      '../src/observational-memory/index.js'
    );
    const batches = [
      {
        sessionId: 's1',
        rawOutput: '<observations>\n* 🔴 User mentioned moving to Berlin\n</observations>\n<current-task>n/a</current-task>',
        tokensIn: 0, tokensOut: 0, model: 'test',
      },
      {
        sessionId: 's2',
        rawOutput: '<observations>\n* 🔴 User started new job at Acme\n</observations>',
        tokensIn: 0, tokensOut: 0, model: 'test',
      },
    ];
    const blocks = extractPerSessionBlocks(batches);
    expect(blocks.size).toBe(2);
    expect(blocks.get('s1')).toContain('moving to Berlin');
    expect(blocks.get('s1')).not.toContain('current-task'); // observations only
    expect(blocks.get('s2')).toContain('Acme');
  });

  it('falls back to raw output when <observations> tags are absent', async () => {
    const { extractPerSessionBlocks } = await import(
      '../src/observational-memory/index.js'
    );
    const batches = [
      {
        sessionId: 's1',
        rawOutput: 'plain text observation, no XML tags',
        tokensIn: 0, tokensOut: 0, model: 'test',
      },
    ];
    const blocks = extractPerSessionBlocks(batches);
    expect(blocks.get('s1')).toContain('plain text observation');
  });

  it('returns empty map for empty input array', async () => {
    const { extractPerSessionBlocks } = await import(
      '../src/observational-memory/index.js'
    );
    const blocks = extractPerSessionBlocks([]);
    expect(blocks.size).toBe(0);
  });

  it('skips batches with empty sessionId or observations', async () => {
    const { extractPerSessionBlocks } = await import(
      '../src/observational-memory/index.js'
    );
    const batches = [
      { sessionId: '', rawOutput: '<observations>x</observations>', tokensIn: 0, tokensOut: 0, model: 'test' },
      { sessionId: 's1', rawOutput: '', tokensIn: 0, tokensOut: 0, model: 'test' },
      { sessionId: 's2', rawOutput: '<observations>real</observations>', tokensIn: 0, tokensOut: 0, model: 'test' },
    ];
    const blocks = extractPerSessionBlocks(batches);
    expect(blocks.size).toBe(1);
    expect(blocks.get('s2')).toContain('real');
  });
});

describe('Step 17: pickCandidateSessions', () => {
  it('picks top-K sessions by descending score', async () => {
    const { pickCandidateSessions } = await import(
      '../src/observational-memory/index.js'
    );
    const scores = [
      { sessionId: 's1', score: 0.9, observationText: '' },
      { sessionId: 's2', score: 0.5, observationText: '' },
      { sessionId: 's3', score: 0.7, observationText: '' },
      { sessionId: 's4', score: 0.3, observationText: '' },
    ];
    const picked = pickCandidateSessions(scores, 2);
    expect(picked).toEqual(new Set(['s1', 's3']));
  });

  it('returns all sessions when K >= length', async () => {
    const { pickCandidateSessions } = await import(
      '../src/observational-memory/index.js'
    );
    const scores = [
      { sessionId: 's1', score: 0.9, observationText: '' },
      { sessionId: 's2', score: 0.5, observationText: '' },
    ];
    const picked = pickCandidateSessions(scores, 10);
    expect(picked).toEqual(new Set(['s1', 's2']));
  });

  it('returns empty set when scores are empty', async () => {
    const { pickCandidateSessions } = await import(
      '../src/observational-memory/index.js'
    );
    expect(pickCandidateSessions([], 5)).toEqual(new Set());
  });
});

describe('Step 17: scoreSessionsByQueryRelevance (cosine over OM blocks)', () => {
  it('scores sessions by question-vs-block embedding cosine similarity', async () => {
    const { scoreSessionsByQueryRelevance } = await import(
      '../src/observational-memory/index.js'
    );

    // Stub embedder: returns a unit vector pointing toward the input's first letter
    const stubEmbedder = {
      async generateEmbeddings(req: { texts: string | string[] }) {
        const texts = Array.isArray(req.texts) ? req.texts : [req.texts];
        return {
          embeddings: texts.map((t) => {
            const c = t.charCodeAt(0);
            return [Math.cos(c / 100), Math.sin(c / 100), 0];
          }),
          modelUsed: 'stub',
        };
      },
    };

    const perSessionBlocks = new Map([
      ['s1', 'Berlin'],   // starts with B (66) — close to Berlin question
      ['s2', 'Tokyo'],    // starts with T (84) — different
      ['s3', 'Beijing'],  // starts with B (66) — close to Berlin
    ]);

    const scores = await scoreSessionsByQueryRelevance({
      question: 'Berlin', // starts with B (66)
      perSessionBlocks,
      embedder: stubEmbedder as never,
    });

    expect(scores).toHaveLength(3);
    // s1 and s3 both start with B — should rank above s2
    const s1Score = scores.find((s) => s.sessionId === 's1')?.score ?? 0;
    const s3Score = scores.find((s) => s.sessionId === 's3')?.score ?? 0;
    const s2Score = scores.find((s) => s.sessionId === 's2')?.score ?? 0;
    expect(s1Score).toBeGreaterThan(s2Score);
    expect(s3Score).toBeGreaterThan(s2Score);
  });

  it('returns empty array when perSessionBlocks is empty', async () => {
    const { scoreSessionsByQueryRelevance } = await import(
      '../src/observational-memory/index.js'
    );
    const stubEmbedder = {
      async generateEmbeddings(_req: unknown) {
        return { embeddings: [[1, 0]], modelUsed: 'stub' };
      },
    };
    const scores = await scoreSessionsByQueryRelevance({
      question: 'q',
      perSessionBlocks: new Map(),
      embedder: stubEmbedder as never,
    });
    expect(scores).toEqual([]);
  });
});
