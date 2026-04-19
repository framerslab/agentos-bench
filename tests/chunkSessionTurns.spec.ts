/**
 * @file chunkSessionTurns.spec.ts
 * @description Pins the chunking shape that drives ingest-mode replay.
 * This is the change that was supposed to fix the pilot's retrieval
 * failures, so assertions here are explicit enough that a future
 * refactor that flattens the grouping shows up as a test break.
 */

import { describe, it, expect } from 'vitest';

import { chunkSessionTurns } from '../src/benchmarks/longmemeval/LongMemEvalS.js';

describe('chunkSessionTurns', () => {
  it('groups each user→assistant exchange into its own chunk', () => {
    const chunks = chunkSessionTurns([
      { role: 'user', content: 'what is 2 + 2' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'and 3 + 3' },
      { role: 'assistant', content: '6' },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('user: what is 2 + 2\nassistant: 4');
    expect(chunks[1]).toBe('user: and 3 + 3\nassistant: 6');
  });

  it('emits a lone user turn at the end as its own chunk', () => {
    const chunks = chunkSessionTurns([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'one more question' },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe('user: one more question');
  });

  it('starts a new chunk when two user turns are adjacent', () => {
    const chunks = chunkSessionTurns([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second without assistant in between' },
      { role: 'assistant', content: 'response' },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('user: first');
    expect(chunks[1]).toBe('user: second without assistant in between\nassistant: response');
  });

  it('attaches system / tool turns to the in-flight exchange', () => {
    const chunks = chunkSessionTurns([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'what is it' },
      { role: 'tool', content: 'lookup: it is a cat' },
      { role: 'assistant', content: 'it is a cat' },
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('system: you are helpful');
    expect(chunks[0]).toContain('user: what is it');
    expect(chunks[0]).toContain('tool: lookup: it is a cat');
    expect(chunks[0]).toContain('assistant: it is a cat');
  });

  it('returns an empty list for an empty session', () => {
    expect(chunkSessionTurns([])).toEqual([]);
  });

  it('produces meaningfully shorter chunks than the old per-session bundle', () => {
    // Synthetic session with 6 turn-pairs, each ~200 chars.
    const turns = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i} content with extra bytes ${'.'.repeat(170)}`,
    }));
    const chunks = chunkSessionTurns(turns);
    expect(chunks).toHaveLength(6);
    const wholeSession = turns.map((t) => `${t.role}: ${t.content}`).join('\n');
    // Each chunk should be clearly smaller than the whole session — if
    // a refactor collapses back to session-sized chunks retrieval
    // quality regresses.
    for (const c of chunks) {
      expect(c.length).toBeLessThan(wholeSession.length / 3);
    }
  });
});
