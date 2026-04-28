/**
 * @file readerRouter.spec.ts
 * @description Unit tests for the per-category reader router primitive.
 *
 * The router picks an OpenAI reader model per question based on the
 * gpt-5-mini classifier's predicted category. The MIN_COST_BEST_CAT_2026_04_28
 * calibration is derived from the LongMemEval-S Phase B N=500 per-category
 * accuracy split between gpt-4o and gpt-5-mini at the Tier 3 min-cost +
 * text-embedding-3-small retrieval stack:
 *
 *   - temporal-reasoning      → gpt-4o    (84.7% vs 72.9% = +11.8 pp)
 *   - single-session-user     → gpt-4o    (94.3% vs 90.0% = +4.3 pp)
 *   - single-session-preference → gpt-5-mini (86.7% vs 63.3% = +23.4 pp)
 *   - single-session-assistant → gpt-5-mini (100% vs 98.2% = +1.8 pp; tied,
 *     prefer cheaper)
 *   - knowledge-update        → gpt-5-mini (87.2% vs 85.7% = +1.5 pp; tied,
 *     prefer cheaper)
 *   - multi-session           → gpt-5-mini (79.7% vs 76.2% = +3.5 pp)
 *
 * Source runs:
 *   - results/runs/2026-04-27T06-27-24-170--longmemeval-s--gpt-4o--full-cognitive--ingest.json
 *   - results/runs/2026-04-28T08-07-48-754--longmemeval-s--gpt-5-mini--full-cognitive--ingest.json
 *
 * Oracle aggregate at this calibration: 435/500 = 87.0% (+3.8 pp over either
 * reader alone). Realized at ~80% classifier accuracy: ~86%.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_COST_BEST_CAT_2026_04_28_TABLE,
  PRESET_TABLES,
  ReaderRouterUnknownCategoryError,
  ReaderRouterUnknownPresetError,
  selectReader,
  type ReaderRouterPreset,
} from '../src/core/readerRouter.js';
import type { QuestionCategory } from '../src/observational-memory/questionRouter.js';

const PRESET: ReaderRouterPreset = 'min-cost-best-cat-2026-04-28';

describe('selectReader: min-cost-best-cat-2026-04-28 calibration', () => {
  it('routes temporal-reasoning to gpt-4o (clear +11.8 pp accuracy lift)', () => {
    expect(selectReader('temporal-reasoning', PRESET)).toBe('gpt-4o');
  });

  it('routes single-session-user to gpt-4o (+4.3 pp accuracy lift)', () => {
    expect(selectReader('single-session-user', PRESET)).toBe('gpt-4o');
  });

  it('routes single-session-preference to gpt-5-mini (+23.4 pp lift, biggest single-category swing)', () => {
    expect(selectReader('single-session-preference', PRESET)).toBe('gpt-5-mini');
  });

  it('routes single-session-assistant to gpt-5-mini (tied accuracy, cheaper reader)', () => {
    expect(selectReader('single-session-assistant', PRESET)).toBe('gpt-5-mini');
  });

  it('routes knowledge-update to gpt-5-mini (tied accuracy, cheaper reader)', () => {
    expect(selectReader('knowledge-update', PRESET)).toBe('gpt-5-mini');
  });

  it('routes multi-session to gpt-5-mini (+3.5 pp accuracy lift, also cheaper)', () => {
    expect(selectReader('multi-session', PRESET)).toBe('gpt-5-mini');
  });
});

describe('selectReader: error paths', () => {
  it('throws ReaderRouterUnknownPresetError on unknown preset', () => {
    expect(() =>
      selectReader('multi-session', 'not-a-preset' as ReaderRouterPreset),
    ).toThrow(ReaderRouterUnknownPresetError);
  });

  it('throws ReaderRouterUnknownCategoryError when a category is missing from the table', () => {
    // We can't call selectReader with a bogus category through the type
    // system, but the runtime guard MUST fire if a future table addition
    // forgets a category. Simulate via a structural cast.
    expect(() =>
      selectReader('not-a-category' as QuestionCategory, PRESET),
    ).toThrow(ReaderRouterUnknownCategoryError);
  });
});

describe('MIN_COST_BEST_CAT_2026_04_28_TABLE: completeness invariant', () => {
  const ALL_CATEGORIES: QuestionCategory[] = [
    'single-session-user',
    'single-session-assistant',
    'single-session-preference',
    'knowledge-update',
    'multi-session',
    'temporal-reasoning',
  ];

  it('covers all six LongMemEval categories', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat]).toBeDefined();
    }
  });

  it('only references valid OpenAI reader tiers (gpt-4o or gpt-5-mini)', () => {
    for (const cat of ALL_CATEGORIES) {
      const reader = MIN_COST_BEST_CAT_2026_04_28_TABLE.mapping[cat];
      expect(['gpt-4o', 'gpt-5-mini']).toContain(reader);
    }
  });

  it('has the expected preset id', () => {
    expect(MIN_COST_BEST_CAT_2026_04_28_TABLE.preset).toBe(
      'min-cost-best-cat-2026-04-28',
    );
  });
});

describe('PRESET_TABLES: registry', () => {
  it('exposes min-cost-best-cat-2026-04-28 as a registered preset', () => {
    expect(PRESET_TABLES['min-cost-best-cat-2026-04-28']).toBe(
      MIN_COST_BEST_CAT_2026_04_28_TABLE,
    );
  });
});
