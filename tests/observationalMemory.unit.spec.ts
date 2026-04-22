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
  OBSERVATION_CONTEXT_PROMPT,
  OBSERVATION_CONTEXT_INSTRUCTIONS,
  OBSERVATION_CONTINUATION_HINT,
  OM_DEFAULTS,
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

describe('ingestSessions — happy path', () => {
  it('runs observer per session and concatenates extracted observation blocks', async () => {
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
      reflectionTokenThreshold: 500, // force a reflection
    });
    expect(result.reflections).toHaveLength(1);
    expect(result.finalLog).toContain('Consolidated fact');
    expect(result.reflectorTokensIn).toBe(8000);
    expect(result.reflectorTokensOut).toBe(100);
  });
});

describe('ingestSessions — observer failure tolerance', () => {
  it('continues past a failed observer call on one session', async () => {
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
