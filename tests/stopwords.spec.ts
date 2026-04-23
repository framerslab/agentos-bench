import { describe, it, expect } from 'vitest';
import { ENGLISH_STOPWORDS, isStopword } from '../src/core/metrics/stopwords.js';

describe('stopwords', () => {
  it('contains canonical English stopwords', () => {
    expect(isStopword('the')).toBe(true);
    expect(isStopword('and')).toBe(true);
    expect(isStopword('of')).toBe(true);
    expect(isStopword('a')).toBe(true);
    expect(isStopword('to')).toBe(true);
  });

  it('rejects non-stopwords (proper nouns, content words)', () => {
    expect(isStopword('berlin')).toBe(false);
    expect(isStopword('acme')).toBe(false);
    expect(isStopword('quantum')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isStopword('The')).toBe(true);
    expect(isStopword('AND')).toBe(true);
  });

  it('exports a frozen array of at least 150 stopwords', () => {
    expect(Array.isArray(ENGLISH_STOPWORDS)).toBe(true);
    expect(ENGLISH_STOPWORDS.length).toBeGreaterThanOrEqual(150);
    expect(Object.isFrozen(ENGLISH_STOPWORDS)).toBe(true);
  });
});
