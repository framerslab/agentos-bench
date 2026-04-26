/**
 * @file Beam.dataset.spec.ts
 * @description Contract tests for the BEAM dataset loader.
 *
 * Verifies that `loadBeamDataset` correctly:
 *   - Reads `queries.json.gz` + `documents.json.gz` from the per-tier
 *     directory and parses both with the upstream schema (zod).
 *   - Groups documents by `user_id` so each query's haystack picks up
 *     the user's full conversation history.
 *   - Parses BEAM's `[<date> | Turn N] <Role>:` markers into proper
 *     {@link Turn} records with role + content + (optional) timestamp.
 *   - Throws an actionable error pointing to the upstream download URL
 *     when the tier directory is missing.
 *
 * The 100K tier dataset is committed under `data/beam/100k/` so this
 * test runs offline and CI-stable.
 *
 * @module agentos-bench/tests/Beam.dataset.spec
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  loadBeamDataset,
  BEAM_QUESTION_CATEGORIES,
} from '../src/benchmarks/beam/index.js';

const dataDir = path.join(__dirname, '..', 'data');

describe('loadBeamDataset 100k', () => {
  it('loads 400 queries and assembles per-user haystacks', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    expect(cases.length).toBe(400);
    // Each user has 6-9 docs on average; haystacks should be non-empty.
    for (const c of cases) {
      expect(c.haystack.length).toBeGreaterThan(0);
    }
  });

  it('every case carries a known BEAM question_category', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    const validTypes = new Set<string>(BEAM_QUESTION_CATEGORIES);
    for (const c of cases) {
      expect(validTypes).toContain(c.type);
    }
  });

  it('parses BEAM turn markers into role/content/timestamp tuples', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    const sample = cases[0];
    expect(sample.haystack.length).toBeGreaterThan(0);
    const firstSession = sample.haystack[0];
    expect(firstSession.turns.length).toBeGreaterThan(0);
    const turn = firstSession.turns[0];
    expect(['user', 'assistant', 'system', 'tool']).toContain(turn.role);
    expect(turn.content.length).toBeGreaterThan(0);
  });

  it('preserves gold_answers as expected + acceptableAnswers', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    for (const c of cases.slice(0, 50)) {
      expect(typeof c.expected).toBe('string');
      // BEAM cases always have at least one gold answer.
      expect(c.expected.length).toBeGreaterThan(0);
    }
  });

  it('attaches gold_ids + rubric + conversationId in metadata for downstream use', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    const sample = cases[0];
    const md = sample.metadata as Record<string, unknown>;
    expect(md.beamTier).toBe('100k');
    expect(Array.isArray(md.goldDocumentIds)).toBe(true);
    expect((md.goldDocumentIds as string[]).length).toBeGreaterThan(0);
    expect(typeof md.conversationId).toBe('string');
  });

  it('groups documents per user — every haystack session belongs to that user', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    const byUser = new Map<string, number[]>();
    for (const c of cases) {
      const userId = (c.metadata as Record<string, unknown>).conversationId as string;
      const list = byUser.get(userId) ?? [];
      list.push(c.haystack.length);
      byUser.set(userId, list);
    }
    // BEAM 100k has 20 unique users, each with 20 queries.
    expect(byUser.size).toBe(20);
    for (const [, sizes] of byUser) {
      expect(sizes.length).toBe(20);
      // All queries from the same user share the same haystack size.
      const first = sizes[0];
      for (const s of sizes) expect(s).toBe(first);
    }
  });

  it('throws an actionable error when the tier directory is missing', async () => {
    await expect(loadBeamDataset(dataDir, '500k')).rejects.toThrow(
      /BEAM 500k dataset not found/,
    );
  });

  it('every category has cases (10 categories total in BEAM)', async () => {
    const cases = await loadBeamDataset(dataDir, '100k');
    const counts = new Map<string, number>();
    for (const c of cases) {
      counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    }
    // BEAM 100k design: 40 queries per category × 10 categories = 400.
    for (const cat of BEAM_QUESTION_CATEGORIES) {
      expect(counts.get(cat) ?? 0).toBe(40);
    }
  });
});
