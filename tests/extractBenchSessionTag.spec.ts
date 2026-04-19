import { describe, it, expect } from 'vitest';
import {
  extractBenchSessionTag,
  BENCH_SESSION_TAG_PREFIX,
} from '../src/benchmarks/longmemeval/extractBenchSessionTag.js';

describe('BENCH_SESSION_TAG_PREFIX', () => {
  it('is the reserved bench-session prefix', () => {
    expect(BENCH_SESSION_TAG_PREFIX).toBe('bench-session:');
  });
});

describe('extractBenchSessionTag', () => {
  it('returns the sessionId after the bench-session: prefix', () => {
    expect(extractBenchSessionTag(['bench-session:session_42'])).toBe('session_42');
  });

  it('ignores tags without the prefix', () => {
    expect(extractBenchSessionTag(['foo', 'bar:baz'])).toBeUndefined();
  });

  it('returns undefined for empty or missing tag array', () => {
    expect(extractBenchSessionTag([])).toBeUndefined();
    expect(extractBenchSessionTag(undefined)).toBeUndefined();
  });

  it('returns the first bench-session match when multiple exist', () => {
    expect(extractBenchSessionTag(['bench-session:a', 'bench-session:b'])).toBe('a');
  });

  it('handles sessionIds containing colons', () => {
    expect(extractBenchSessionTag(['bench-session:project:123'])).toBe('project:123');
  });

  it('does not match tags that merely contain the prefix later in the string', () => {
    expect(extractBenchSessionTag(['prefixed-bench-session:x'])).toBeUndefined();
  });
});
