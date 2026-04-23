/**
 * @file buildOmReaderSystemPrompt.spec.ts
 * @description Tests the Step 18 v2 conditional verbatim-citation
 * behavior: appended only for KU/SSU router categories where the
 * Phase 4 v2 Step 1 per-correctness analysis showed retention
 * predicts accuracy.
 */

import { describe, it, expect } from 'vitest';
import { buildOmReaderSystemPrompt } from '../src/observational-memory/runner.js';
import { CONDITIONAL_VERBATIM_CITATION } from '../src/observational-memory/prompts.js';

const SAMPLE_OBSERVATION_LOG = `Date: 2026-01-15
* 🔴 (10:00) User stated they paid $1199 for the new iPhone.`;

describe('buildOmReaderSystemPrompt — Step 18 v2 conditional verbatim citation', () => {
  it('omits the verbatim-citation block when routerCategory is undefined (baseline)', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG);
    expect(prompt).not.toContain(CONDITIONAL_VERBATIM_CITATION);
    expect(prompt).not.toContain('VERBATIM CITATION FOR SPECIFIC-VALUE');
  });

  it('appends the verbatim-citation block when routerCategory is knowledge-update', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'knowledge-update',
    });
    expect(prompt).toContain(CONDITIONAL_VERBATIM_CITATION);
    expect(prompt).toContain('VERBATIM CITATION FOR SPECIFIC-VALUE');
  });

  it('appends the verbatim-citation block when routerCategory is single-session-user', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'single-session-user',
    });
    expect(prompt).toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('omits the verbatim-citation block for temporal-reasoning (synthesis-required)', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'temporal-reasoning',
    });
    expect(prompt).not.toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('omits the verbatim-citation block for multi-session', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'multi-session',
    });
    expect(prompt).not.toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('omits the verbatim-citation block for single-session-preference', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'single-session-preference',
    });
    expect(prompt).not.toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('appends the verbatim-citation block for single-session-assistant (Step 18 v3)', () => {
    // SSA was added to the eligible list in v3 after Phase A v2 showed
    // SSA dipped to 82.4% (vs canonical's 89.3% baseline). SSA's
    // per-correctness gap (+0.50) is borderline-positive; this variant
    // tests whether including it recovers SSA accuracy.
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'single-session-assistant',
    });
    expect(prompt).toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('omits the verbatim-citation block for unknown router category', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'unknown',
    });
    expect(prompt).not.toContain(CONDITIONAL_VERBATIM_CITATION);
  });

  it('still includes the cross-session scaffold + verbatim block when both are requested', () => {
    const prompt = buildOmReaderSystemPrompt(SAMPLE_OBSERVATION_LOG, {
      routerCategory: 'knowledge-update',
      includeScaffold: true,
    });
    expect(prompt).toContain(CONDITIONAL_VERBATIM_CITATION);
    expect(prompt).toContain('CROSS-SESSION REASONING');
  });
});
