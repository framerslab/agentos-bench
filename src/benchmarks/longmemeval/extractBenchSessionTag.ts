/**
 * @file extractBenchSessionTag.ts
 * @description Parse the `bench-session:<id>` tag off a MemoryTrace's tag
 * list. Returns `undefined` for traces encoded without a session tag.
 *
 * The prefix is collision-resistant (AgentOS's own tags are unprefixed
 * entity names or shorter category strings).
 *
 * @module agentos-bench/benchmarks/longmemeval/extractBenchSessionTag
 */

/**
 * Reserved tag prefix used by the bench to carry source-session identity
 * through `MemoryTrace.tags`.
 */
export const BENCH_SESSION_TAG_PREFIX = 'bench-session:';

/**
 * Return the sessionId encoded in a `bench-session:<id>` tag, if any.
 * Returns `undefined` when the tag list is missing, empty, or contains
 * no bench-session tag.
 */
export function extractBenchSessionTag(tags?: string[]): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const tag of tags) {
    if (tag.startsWith(BENCH_SESSION_TAG_PREFIX)) {
      return tag.slice(BENCH_SESSION_TAG_PREFIX.length);
    }
  }
  return undefined;
}
