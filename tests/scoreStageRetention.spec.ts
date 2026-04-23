import { describe, it, expect } from 'vitest';
import { scoreStageRetention } from '../src/core/metrics/scoreStageRetention.js';

describe('scoreStageRetention', () => {
  it('returns 1.0 when all tokens appear in the stage text', () => {
    const tokens = ['berlin', 'acme', '2024'];
    const stage = 'User moved to Berlin to work at Acme in 2024.';
    expect(scoreStageRetention(tokens, stage)).toBe(1);
  });

  it('returns 0.0 when no tokens appear', () => {
    const tokens = ['berlin', 'acme', '2024'];
    const stage = 'Completely unrelated text about pasta and recipes.';
    expect(scoreStageRetention(tokens, stage)).toBe(0);
  });

  it('returns the correct fraction for partial matches', () => {
    const tokens = ['berlin', 'acme', '2024', 'engineer'];
    const stage = 'User worked at Acme as an engineer.';
    expect(scoreStageRetention(tokens, stage)).toBe(0.5);
  });

  it('is case-insensitive and NFKD-normalized', () => {
    const tokens = ['cafe'];
    const stage = 'Met at the CAFÉ.';
    expect(scoreStageRetention(tokens, stage)).toBe(1);
  });

  it('returns 0 when tokens array is empty (vacuous)', () => {
    expect(scoreStageRetention([], 'anything')).toBe(0);
  });

  it('returns 0 when stage text is empty', () => {
    expect(scoreStageRetention(['berlin'], '')).toBe(0);
  });

  it('counts multi-occurrence as a single match', () => {
    const tokens = ['berlin'];
    const stage = 'Berlin Berlin Berlin BERLIN.';
    expect(scoreStageRetention(tokens, stage)).toBe(1);
  });
});
