import { describe, it, expect } from 'vitest';
import { splitForEmbedding } from '../src/benchmarks/longmemeval/LongMemEvalS.js';

const SAFE = 24_000;

describe('splitForEmbedding', () => {
  it('returns input unchanged when under the cap', () => {
    const text = 'hello world';
    expect(splitForEmbedding(text)).toEqual([text]);
  });

  it('returns input unchanged at exactly the cap', () => {
    const text = 'x'.repeat(SAFE);
    expect(splitForEmbedding(text)).toEqual([text]);
  });

  it('splits a chunk just over the cap into two roughly-equal pieces', () => {
    const text = 'x'.repeat(SAFE + 1000);
    const out = splitForEmbedding(text);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(SAFE);
    expect(out.join('')).toBe(text);
  });

  it('splits a 3x-oversized chunk into at least 3 pieces under the cap', () => {
    const text = 'x'.repeat(SAFE * 3);
    const out = splitForEmbedding(text);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(SAFE);
    expect(out.join('')).toBe(text);
  });

  it('prefers splitting at newlines near the midpoint', () => {
    // A newline exists 100 chars before midpoint; splitter should use it.
    const half = Math.floor(SAFE / 2) + 6000;
    const text = 'a'.repeat(half - 100) + '\n' + 'b'.repeat(half);
    const out = splitForEmbedding(text);
    expect(out.length).toBe(2);
    expect(out[0]!.endsWith('\n')).toBe(true);
    expect(out[1]!.startsWith('b')).toBe(true);
  });

  it('falls back to whitespace split when no newline is near the midpoint', () => {
    const half = Math.floor(SAFE / 2) + 6000;
    // Plain text, all letters and spaces; splitter must pick a space.
    const text = 'a'.repeat(half) + ' ' + 'b'.repeat(half);
    const out = splitForEmbedding(text);
    expect(out.length).toBe(2);
    expect(out.join('')).toBe(text);
  });

  it('preserves content when forced to hard-slice (no whitespace in window)', () => {
    // All a's: no newline, no space. Hard slice at the midpoint.
    const text = 'a'.repeat(SAFE + 500);
    const out = splitForEmbedding(text);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.join('')).toBe(text);
    for (const piece of out) expect(piece.length).toBeLessThanOrEqual(SAFE);
  });
});
