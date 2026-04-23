import { describe, it, expect } from 'vitest';
import { extractHighIdfTokens } from '../src/core/metrics/extractHighIdfTokens.js';

describe('extractHighIdfTokens', () => {
  it('drops stopwords and short tokens', () => {
    const result = extractHighIdfTokens('The user moved to Berlin in 2024.');
    expect(result).toContain('user');
    expect(result).toContain('moved');
    expect(result).toContain('berlin');
    expect(result).toContain('2024');
    expect(result).not.toContain('the');
    expect(result).not.toContain('to');
    expect(result).not.toContain('in');
  });

  it('lowercases and NFKD-normalizes', () => {
    const result = extractHighIdfTokens('Café Visited Café');
    expect(result).toContain('cafe');
    expect(result).toContain('visited');
    expect(result.filter((t) => t === 'cafe').length).toBe(1);
  });

  it('strips punctuation and splits on hyphens', () => {
    const result = extractHighIdfTokens('Berlin-based startup, called Acme.');
    expect(result).toContain('berlin');
    expect(result).toContain('based');
    expect(result).toContain('startup');
    expect(result).toContain('called');
    expect(result).toContain('acme');
  });

  it('keeps digit and short tokens of length >= 2 (LongMemEval-style answers)', () => {
    const result = extractHighIdfTokens('I paid $50 in 2024.');
    expect(result).toContain('2024');
    expect(result).toContain('paid');
    // "50" passes the 2-char minimum and is not a stopword.
    // LongMemEval-S gold answers often contain short numerics like
    // "$50", "25 minutes", "3" that must survive extraction.
    expect(result).toContain('50');
  });

  it('still drops 1-character noise tokens', () => {
    const result = extractHighIdfTokens('I paid $5 for X.');
    // "5" is 1 char, dropped. "x" is 1 char, dropped. "paid" stays.
    expect(result).toContain('paid');
    expect(result).not.toContain('5');
    expect(result).not.toContain('x');
  });

  it('returns empty array for whitespace / punctuation only', () => {
    expect(extractHighIdfTokens('   .,;!?   ')).toEqual([]);
  });
});
