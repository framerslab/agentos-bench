/**
 * @file twoCallReader.spec.ts
 * @description Unit tests for Step 14 Emergence-style two-call reader.
 * Pins happy-path JSON parse, malformed-JSON fallback to single-call,
 * empty-facts answer-call behavior, citation round-trip, and per-call
 * token accounting.
 */

import { describe, it, expect } from 'vitest';
import { twoCallRead } from '../src/readers/twoCallReader.js';
import type { IReader, ReaderRequest, ReaderResponse } from '../src/readers/IReader.js';

function stubReader(responses: ReaderResponse[]): IReader & { calls: ReaderRequest[] } {
  const calls: ReaderRequest[] = [];
  let i = 0;
  return {
    model: 'stub-reader',
    async invoke(req: ReaderRequest): Promise<ReaderResponse> {
      calls.push(req);
      const next = responses[i++];
      if (!next) throw new Error(`stubReader out of responses after ${calls.length} calls`);
      return next;
    },
    calls,
  };
}

const okExtract = (facts: Array<{ content: string; sourcePassages: string[] }>): ReaderResponse => ({
  text: JSON.stringify({ facts }),
  tokensIn: 3000,
  tokensOut: 120,
  model: 'gpt-4o',
  latencyMs: 850,
});

const okAnswer = (answer: string): ReaderResponse => ({
  text: answer,
  tokensIn: 400,
  tokensOut: 40,
  model: 'gpt-4o',
  latencyMs: 420,
});

const passages = [
  { id: 'P0', content: 'User said they live in Berlin.' },
  { id: 'P1', content: 'User mentioned they started working in 2022.' },
  { id: 'P2', content: 'Unrelated chatter about the weather.' },
];

describe('twoCallRead — happy path JSON', () => {
  it('parses extract JSON, passes scratchpad to answer call, returns final answer', async () => {
    const reader = stubReader([
      okExtract([{ content: 'User lives in Berlin', sourcePassages: ['P0'] }]),
      okAnswer('Berlin'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where does the user live?', passages });
    expect(out.answer).toBe('Berlin');
    expect(out.scratchpadFacts).toHaveLength(1);
    expect(out.scratchpadFacts[0].content).toBe('User lives in Berlin');
    expect(out.scratchpadFacts[0].sourcePassages).toEqual(['P0']);
    expect(out.fallbackUsed).toBe(false);
    expect(reader.calls).toHaveLength(2);
    expect(reader.calls[1].user).toContain('User lives in Berlin');
    expect(reader.calls[1].user).not.toContain('Unrelated chatter');
  });
});

describe('twoCallRead — malformed JSON fallback', () => {
  it('falls back to single-call when extract output is not valid JSON', async () => {
    const reader = stubReader([
      { text: 'definitely not json', tokensIn: 3000, tokensOut: 10, model: 'gpt-4o', latencyMs: 500 },
      okAnswer('Berlin'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where does the user live?', passages });
    expect(out.fallbackUsed).toBe(true);
    expect(out.answer).toBe('Berlin');
    expect(out.scratchpadFacts).toEqual([]);
    expect(reader.calls[1].user).toContain('Unrelated chatter');
  });

  it('falls back when JSON is valid but schema is wrong', async () => {
    const reader = stubReader([
      { text: '{"wrong":"shape"}', tokensIn: 3000, tokensOut: 10, model: 'gpt-4o', latencyMs: 500 },
      okAnswer('unknown'),
    ]);
    const out = await twoCallRead({ reader, query: 'Where?', passages });
    expect(out.fallbackUsed).toBe(true);
    expect(out.scratchpadFacts).toEqual([]);
  });
});

describe('twoCallRead — empty facts', () => {
  it('invokes answer call with empty scratchpad when extractor returns no facts', async () => {
    const reader = stubReader([okExtract([]), okAnswer('I cannot find that information.')]);
    const out = await twoCallRead({ reader, query: 'Where?', passages });
    expect(out.fallbackUsed).toBe(false);
    expect(out.scratchpadFacts).toEqual([]);
    expect(out.answer).toBe('I cannot find that information.');
    expect(reader.calls[1].user).not.toContain('Unrelated chatter');
  });
});

describe('twoCallRead — citation parsing', () => {
  it('preserves multi-passage citations from extract', async () => {
    const reader = stubReader([
      okExtract([
        { content: 'Berlin.', sourcePassages: ['P0', 'P1'] },
        { content: 'Started 2022.', sourcePassages: ['P1'] },
      ]),
      okAnswer('Berlin since 2022'),
    ]);
    const out = await twoCallRead({ reader, query: 'Details', passages });
    expect(out.scratchpadFacts[0].sourcePassages).toEqual(['P0', 'P1']);
    expect(out.scratchpadFacts[1].sourcePassages).toEqual(['P1']);
    expect(reader.calls[1].user).toContain('sources: P0, P1');
  });
});

describe('twoCallRead — tolerant JSON parsing (code fences)', () => {
  it('strips ```json fences around the extract output', async () => {
    const reader = stubReader([
      {
        text: '```json\n{"facts":[{"content":"fenced fact","sourcePassages":["P0"]}]}\n```',
        tokensIn: 3000, tokensOut: 30, model: 'gpt-4o', latencyMs: 500,
      },
      okAnswer('answer'),
    ]);
    const out = await twoCallRead({ reader, query: 'q', passages });
    expect(out.fallbackUsed).toBe(false);
    expect(out.scratchpadFacts).toHaveLength(1);
    expect(out.scratchpadFacts[0].content).toBe('fenced fact');
  });

  it('extracts JSON embedded in surrounding prose', async () => {
    const reader = stubReader([
      {
        text: 'Here is the answer: {"facts":[{"content":"embedded","sourcePassages":["P1"]}]} hope that helps!',
        tokensIn: 3000, tokensOut: 40, model: 'gpt-4o', latencyMs: 500,
      },
      okAnswer('answer'),
    ]);
    const out = await twoCallRead({ reader, query: 'q', passages });
    expect(out.fallbackUsed).toBe(false);
    expect(out.scratchpadFacts[0].content).toBe('embedded');
  });
});

describe('twoCallRead — fallbackSystemPrompt', () => {
  it('uses supplied fallback system prompt on malformed JSON', async () => {
    const reader = stubReader([
      { text: 'not json', tokensIn: 100, tokensOut: 10, model: 'gpt-4o', latencyMs: 200 },
      okAnswer('fallback answer'),
    ]);
    const out = await twoCallRead({
      reader,
      query: 'question',
      passages,
      fallbackSystemPrompt: 'BENCH_FULL_SYSTEM_PROMPT',
    });
    expect(out.fallbackUsed).toBe(true);
    expect(reader.calls[1].system).toBe('BENCH_FULL_SYSTEM_PROMPT');
    expect(reader.calls[1].user).toBe('question'); // no passages re-embedded when using bench prompt
  });
});

describe('twoCallRead — token accounting', () => {
  it('returns both extract and answer cost breakdowns', async () => {
    const reader = stubReader([
      okExtract([{ content: 'x', sourcePassages: ['P0'] }]),
      okAnswer('x'),
    ]);
    const out = await twoCallRead({ reader, query: 'q', passages });
    expect(out.extractCost.tokensIn).toBe(3000);
    expect(out.extractCost.tokensOut).toBe(120);
    expect(out.extractCost.model).toBe('gpt-4o');
    expect(out.answerCost.tokensIn).toBe(400);
    expect(out.answerCost.tokensOut).toBe(40);
  });
});
