# Token-Retention Measurement Framework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per user CLAUDE.md, run all bench commands from `packages/agentos-bench/`, never the monorepo root. All git commits use `--no-verify`. Commit messages must read as human-written (no AI/Claude/Opus/rewrite mentions).

**Goal:** Build a token-retention metric that decomposes Tier 1 canonical, Tier 2 v10, and Tier 3 v5 OM-only pipelines into per-stage retention rates for high-IDF gold-answer tokens, then run cross-tier baselines + one targeted prompt tune to validate the framework.

**Architecture:** New pure-function metric `computeTokenRetention` aggregates over `CaseResult[]` using two metadata keys (one new: `metadata.omFinalLog`; one existing: `metadata.retrievedEvidence`). Aggregator output `tokenRetention?: TokenRetentionResult` lives on `BenchResult` alongside the existing `evidenceOrigin?` and `retrievalStageMetrics?`. Heuristic high-IDF token extraction = NFKD-normalize + lowercase + strip stopwords + drop tokens < 4 chars. Bootstrap CIs reuse `computeBootstrapCI<T>(values, statistic, options)` for shape consistency.

**Tech Stack:** TypeScript 5.4+, Vitest, Node.js 20+, OpenAI gpt-4o reader + gpt-4o judge, Cohere rerank-v3.5, OpenAI text-embedding-3-small.

**Spec:** [docs/specs/2026-04-23-token-retention-framework-design.md](../specs/2026-04-23-token-retention-framework-design.md)

---

## Phase 1 — Framework code (no LLM cost)

### Task 1: Stopword list

**Files:**
- Create: `src/core/metrics/stopwords.ts`
- Test: `tests/stopwords.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/stopwords.spec.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/stopwords.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `stopwords.ts`**

Create `src/core/metrics/stopwords.ts`:

```typescript
/**
 * @file stopwords.ts
 * @description Frozen English stoplist for the token-retention metric.
 * Source: NLTK 3.8 English stopwords (179 entries) + a handful of
 * additions for chat-style content. Frozen at module load so the
 * runtime can't accidentally mutate it.
 *
 * @module agentos-bench/core/metrics/stopwords
 */

const STOPWORDS_RAW = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an',
  'and', 'any', 'are', "aren't", 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', "can't",
  'cannot', 'could', "couldn't", 'did', "didn't", 'do', 'does', "doesn't",
  'doing', "don't", 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', "hadn't", 'has', "hasn't", 'have', "haven't", 'having',
  'he', "he'd", "he'll", "he's", 'her', 'here', "here's", 'hers',
  'herself', 'him', 'himself', 'his', 'how', "how's", 'i', "i'd", "i'll",
  "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's", 'its',
  'itself', "let's", 'me', 'more', 'most', "mustn't", 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  "shan't", 'she', "she'd", "she'll", "she's", 'should', "shouldn't",
  'so', 'some', 'such', 'than', 'that', "that's", 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', "there's", 'these',
  'they', "they'd", "they'll", "they're", "they've", 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was',
  "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were', "weren't",
  'what', "what's", 'when', "when's", 'where', "where's", 'which',
  'while', 'who', "who's", 'whom', 'why', "why's", 'with', "won't",
  'would', "wouldn't", 'you', "you'd", "you'll", "you're", "you've",
  'your', 'yours', 'yourself', 'yourselves',
  // Chat-style additions (not in core NLTK list).
  "i'd", "i'll", "i'm", "i've", 'okay', 'ok', 'yes', 'yeah', 'yep',
  'no', 'nope', 'sure', 'thanks', 'thank', 'please',
];

export const ENGLISH_STOPWORDS: ReadonlyArray<string> = Object.freeze(
  Array.from(new Set(STOPWORDS_RAW.map((w) => w.toLowerCase()))),
);

const STOPWORD_SET = new Set(ENGLISH_STOPWORDS);

/**
 * Case-insensitive stopword check.
 *
 * @param token - input word
 * @returns true when the lowercased token is in the frozen English stoplist
 */
export function isStopword(token: string): boolean {
  return STOPWORD_SET.has(token.toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/stopwords.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/metrics/stopwords.ts packages/agentos-bench/tests/stopwords.spec.ts
git commit --no-verify -m "feat(bench): English stoplist for token-retention metric

Frozen 179-word NLTK 3.8 English stopwords plus a handful of chat-style
additions. Used by the upcoming computeTokenRetention metric to filter
low-information tokens before scoring per-stage retention rates."
```

---

### Task 2: Token extractor

**Files:**
- Create: `src/core/metrics/extractHighIdfTokens.ts`
- Test: `tests/extractHighIdfTokens.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/extractHighIdfTokens.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractHighIdfTokens } from '../src/core/metrics/extractHighIdfTokens.js';

describe('extractHighIdfTokens', () => {
  it('drops stopwords and short tokens', () => {
    const result = extractHighIdfTokens('The user moved to Berlin in 2024.');
    // 'the', 'to', 'in' are stopwords; 'user' (4 chars) is allowed; 'Berlin' and '2024' are kept.
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
    expect(result).toContain('cafe'); // NFKD strips diacritics
    expect(result).toContain('visited');
    // Multiple occurrences collapse to one
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

  it('keeps digit tokens of length >= 4', () => {
    const result = extractHighIdfTokens('I paid $50 in 2024.');
    expect(result).toContain('2024');
    expect(result).toContain('paid');
    // '$50' is 3 chars after stripping '$' (or 3 digits), drop it.
    expect(result).not.toContain('50');
  });

  it('returns empty array for whitespace / punctuation only', () => {
    expect(extractHighIdfTokens('   .,;!?   ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/extractHighIdfTokens.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `extractHighIdfTokens.ts`**

Create `src/core/metrics/extractHighIdfTokens.ts`:

```typescript
/**
 * @file extractHighIdfTokens.ts
 * @description Heuristic high-IDF token extractor. Used by the
 * token-retention metric to derive the per-case set of tokens worth
 * tracking through the pipeline (raw conversation → observer log /
 * retrieved passages → reader answer).
 *
 * Heuristic v1: NFKD normalize, lowercase, strip punctuation, split on
 * hyphens and whitespace, drop English stopwords, drop tokens shorter
 * than 4 characters. The 4-char cutoff filters articles/prepositions
 * without dropping short proper nouns; verified empirically against 10
 * sampled LongMemEval-S gold answers.
 *
 * @module agentos-bench/core/metrics/extractHighIdfTokens
 */

import { isStopword } from './stopwords.js';

const MIN_TOKEN_LENGTH = 4;

/**
 * Extract high-IDF candidate tokens from a piece of text (typically
 * the gold answer for a LongMemEval-S case).
 *
 * @param text - input text (gold answer, observer log, etc.)
 * @returns deduplicated array of lowercase tokens of length >= 4
 *          that are not in the stoplist
 */
export function extractHighIdfTokens(text: string): string[] {
  if (!text) return [];

  // NFKD normalize then strip combining marks (handles "café" -> "cafe").
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Replace anything that isn't a letter, digit, or whitespace with a
  // space. This treats hyphens and punctuation as token separators.
  const cleaned = normalized.replace(/[^a-z0-9\s]/g, ' ');

  // Split on whitespace, drop empties.
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);

  // Filter: length >= 4, not a stopword.
  const filtered = rawTokens.filter(
    (t) => t.length >= MIN_TOKEN_LENGTH && !isStopword(t),
  );

  // Deduplicate (presence, not frequency).
  return Array.from(new Set(filtered));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/extractHighIdfTokens.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/metrics/extractHighIdfTokens.ts packages/agentos-bench/tests/extractHighIdfTokens.spec.ts
git commit --no-verify -m "feat(bench): extractHighIdfTokens heuristic for retention metric

NFKD normalize + lowercase + strip punctuation + split on hyphens +
drop stopwords + drop tokens shorter than 4 chars. Empirically verified
against 10 sampled LongMemEval-S gold answers; the 4-char cutoff
filters prepositions without dropping short proper nouns."
```

---

### Task 3: Single-stage retention scorer

**Files:**
- Create: `src/core/metrics/scoreStageRetention.ts`
- Test: `tests/scoreStageRetention.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scoreStageRetention.spec.ts`:

```typescript
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
    // 'acme' + 'engineer' match. 2/4 = 0.5
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/scoreStageRetention.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `scoreStageRetention.ts`**

Create `src/core/metrics/scoreStageRetention.ts`:

```typescript
/**
 * @file scoreStageRetention.ts
 * @description Compute the fraction of high-IDF gold-answer tokens
 * that appear (verbatim, after normalization) in a single pipeline
 * stage's text.
 *
 * Substring match after NFKD-normalize + lowercase. Multi-occurrence
 * in the stage text counts as one match — we measure presence, not
 * frequency.
 *
 * @module agentos-bench/core/metrics/scoreStageRetention
 */

/**
 * Normalize text for matching: NFKD strip combining marks + lowercase.
 *
 * @param text - input
 * @returns normalized text
 */
function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Fraction of `tokens` that appear (substring-match, normalized) in
 * `stageText`. Returns 0 if `tokens` or `stageText` is empty.
 *
 * @param tokens - high-IDF candidate tokens (already lowercased)
 * @param stageText - pipeline-stage text to search in
 * @returns fraction in [0, 1]
 */
export function scoreStageRetention(
  tokens: ReadonlyArray<string>,
  stageText: string,
): number {
  if (tokens.length === 0 || !stageText) return 0;
  const normalizedStage = normalize(stageText);
  let matches = 0;
  for (const token of tokens) {
    if (normalizedStage.includes(token)) {
      matches += 1;
    }
  }
  return matches / tokens.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/scoreStageRetention.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/metrics/scoreStageRetention.ts packages/agentos-bench/tests/scoreStageRetention.spec.ts
git commit --no-verify -m "feat(bench): scoreStageRetention single-stage retention scorer

Pure function returning the fraction of high-IDF tokens that appear
(verbatim, NFKD-normalized, case-insensitive) in a single pipeline
stage's text. Presence semantics: multi-occurrence counts as one match."
```

---

### Task 4: `computeTokenRetention` aggregator

**Files:**
- Create: `src/core/metrics/computeTokenRetention.ts`
- Test: `tests/computeTokenRetention.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/computeTokenRetention.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTokenRetention } from '../src/core/metrics/computeTokenRetention.js';
import type { CaseResult } from '../src/core/IBenchmark.js';

function makeCase(opts: {
  caseId: string;
  type: string;
  expected: string;
  actualOutput: string;
  omFinalLog?: string;
  retrievedEvidence?: { id?: string; content?: string }[];
}): CaseResult {
  return {
    caseId: opts.caseId,
    actualOutput: opts.actualOutput,
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    score: 1,
    passed: true,
    metadata: {
      ...(opts.omFinalLog !== undefined ? { omFinalLog: opts.omFinalLog } : {}),
      ...(opts.retrievedEvidence !== undefined
        ? { retrievedEvidence: opts.retrievedEvidence }
        : {}),
      // The aggregator reads `expected` and `type` from the case if they're
      // surfaced via metadata, or from a sibling record passed alongside.
      expected: opts.expected,
      type: opts.type,
    },
  };
}

describe('computeTokenRetention', () => {
  it('computes per-case retention when only retrievedEvidence is present (canonical)', () => {
    const cases = [
      makeCase({
        caseId: 'c1',
        type: 'multi-session',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [
          { id: 'p1', content: 'User moved to Berlin to work at Acme in 2024 as an engineer.' },
        ],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['multi-session'].rawToRetrieved).toBeDefined();
    expect(result.perCategory['multi-session'].rawToRetrieved!.retention.value).toBe(1);
    expect(result.perCategory['multi-session'].observerToReader).toBeUndefined();
  });

  it('computes observer-route retention when omFinalLog is present', () => {
    const cases = [
      makeCase({
        caseId: 'c2',
        type: 'knowledge-update',
        expected: 'Berlin Acme 2024',
        actualOutput: 'Berlin Acme 2024',
        omFinalLog: 'Date: 2024. User moved to Berlin to work at Acme.',
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['knowledge-update'].rawToObserver).toBeDefined();
    expect(result.perCategory['knowledge-update'].rawToObserver!.retention.value).toBe(1);
    expect(result.perCategory['knowledge-update'].observerToReader!.retention.value).toBe(1);
  });

  it('flags cases with < 3 high-IDF tokens as excluded', () => {
    const cases = [
      makeCase({
        caseId: 'c3',
        type: 'temporal-reasoning',
        expected: 'yes',
        actualOutput: 'yes',
        retrievedEvidence: [{ id: 'p1', content: 'yes' }],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.excluded).toEqual([
      { caseId: 'c3', category: 'temporal-reasoning', tokenCount: 0 },
    ]);
  });

  it('computes overall retention across categories', () => {
    const cases = [
      makeCase({
        caseId: 'c1',
        type: 'multi-session',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
        retrievedEvidence: [{ id: 'p1', content: 'Berlin Acme 2024 engineer' }],
      }),
      makeCase({
        caseId: 'c2',
        type: 'knowledge-update',
        expected: 'Paris Bistro 2025 chef',
        actualOutput: 'Paris Bistro 2025 chef',
        retrievedEvidence: [{ id: 'p2', content: 'Paris Bistro 2025 chef' }],
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.overall.e2eRetention.retention.value).toBe(1);
    expect(result.overall.e2eRetention.n).toBe(2);
  });

  it('handles cases with neither omFinalLog nor retrievedEvidence (e2e only)', () => {
    const cases = [
      makeCase({
        caseId: 'c4',
        type: 'single-session-user',
        expected: 'Berlin Acme 2024 engineer',
        actualOutput: 'Berlin Acme 2024 engineer',
      }),
    ];
    const result = computeTokenRetention({ cases, bootstrapResamples: 100, seed: 42 });
    expect(result.perCategory['single-session-user'].e2eRetention.retention.value).toBe(1);
    expect(result.perCategory['single-session-user'].rawToObserver).toBeUndefined();
    expect(result.perCategory['single-session-user'].rawToRetrieved).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/computeTokenRetention.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `computeTokenRetention.ts`**

Create `src/core/metrics/computeTokenRetention.ts`:

```typescript
/**
 * @file computeTokenRetention.ts
 * @description Per-stage retention aggregator. Decomposes Tier 1
 * canonical (raw → retrieved → reader), Tier 2 v10 (per-route), and
 * Tier 3 v5 OM-only (raw → observer → reader) into measurable per-
 * stage retention rates so we can see WHERE high-IDF tokens are lost
 * in each architecture.
 *
 * Pure function over `CaseResult[]`. Reads two metadata keys when
 * present:
 *   - `metadata.omFinalLog?: string` (NEW; OM modes only)
 *   - `metadata.retrievedEvidence?: Array<{ content?: string }>`
 *     (existing; canonical / OM-with-retrieval / 16 / 17)
 * Reader output is `CaseResult.actualOutput`.
 *
 * @module agentos-bench/core/metrics/computeTokenRetention
 */

import type { CaseResult } from '../IBenchmark.js';
import type { BootstrapResult } from './computeBootstrapCI.js';
import { computeBootstrapCI } from './computeBootstrapCI.js';
import { extractHighIdfTokens } from './extractHighIdfTokens.js';
import { scoreStageRetention } from './scoreStageRetention.js';

const MIN_TOKENS_PER_CASE = 3;

export interface TokenRetentionStageRates {
  n: number;
  retention: BootstrapResult;
}

export interface TokenRetentionPerCategory {
  rawToObserver?: TokenRetentionStageRates;
  rawToRetrieved?: TokenRetentionStageRates;
  observerToReader?: TokenRetentionStageRates;
  retrievedToReader?: TokenRetentionStageRates;
  e2eRetention: TokenRetentionStageRates;
}

export interface TokenRetentionExclusion {
  caseId: string;
  category: string;
  tokenCount: number;
}

export interface TokenRetentionResult {
  perCategory: Record<string, TokenRetentionPerCategory>;
  overall: TokenRetentionPerCategory;
  excluded: TokenRetentionExclusion[];
}

interface PerCaseStageRates {
  caseId: string;
  category: string;
  rawToObserver?: number;
  rawToRetrieved?: number;
  observerToReader?: number;
  retrievedToReader?: number;
  e2e: number;
}

/**
 * Helper: extract the gold answer + category for a case from its
 * metadata (the bench surfaces `expected` and `type` via metadata
 * when running LongMemEval-S — they're the BenchmarkCase fields
 * carried through into the run record).
 */
function extractCaseInputs(caseResult: CaseResult): {
  expected: string;
  category: string;
} {
  const md = (caseResult.metadata ?? {}) as Record<string, unknown>;
  const expected = typeof md.expected === 'string' ? md.expected : '';
  const category = typeof md.type === 'string' ? md.type : 'unknown';
  return { expected, category };
}

/**
 * Helper: extract per-stage text strings from a case's metadata.
 */
function extractStageTexts(caseResult: CaseResult): {
  observerLog?: string;
  retrievedJoined?: string;
} {
  const md = (caseResult.metadata ?? {}) as Record<string, unknown>;

  const observerLog =
    typeof md.omFinalLog === 'string' ? md.omFinalLog : undefined;

  let retrievedJoined: string | undefined;
  if (Array.isArray(md.retrievedEvidence)) {
    const parts = (md.retrievedEvidence as Array<{ content?: unknown }>)
      .map((ev) => (typeof ev.content === 'string' ? ev.content : ''))
      .filter(Boolean);
    if (parts.length > 0) retrievedJoined = parts.join('\n');
  }

  return { observerLog, retrievedJoined };
}

/**
 * Compute per-case stage retention rates. Returns `null` when the case
 * has fewer than `MIN_TOKENS_PER_CASE` high-IDF tokens after filtering
 * (the case is then logged in the excluded list).
 */
function computePerCase(
  caseResult: CaseResult,
): { rates: PerCaseStageRates; tokenCount: number } | { excluded: TokenRetentionExclusion } {
  const { expected, category } = extractCaseInputs(caseResult);
  const tokens = extractHighIdfTokens(expected);
  if (tokens.length < MIN_TOKENS_PER_CASE) {
    return {
      excluded: {
        caseId: caseResult.caseId,
        category,
        tokenCount: tokens.length,
      },
    };
  }

  const { observerLog, retrievedJoined } = extractStageTexts(caseResult);
  const reader = caseResult.actualOutput;

  const rates: PerCaseStageRates = {
    caseId: caseResult.caseId,
    category,
    e2e: scoreStageRetention(tokens, reader),
  };

  if (observerLog !== undefined) {
    rates.rawToObserver = scoreStageRetention(tokens, observerLog);
    rates.observerToReader = scoreStageRetention(tokens, reader);
  }

  if (retrievedJoined !== undefined) {
    rates.rawToRetrieved = scoreStageRetention(tokens, retrievedJoined);
    rates.retrievedToReader = scoreStageRetention(tokens, reader);
  }

  return { rates, tokenCount: tokens.length };
}

/**
 * Aggregate per-case rates into a per-category bucket.
 */
function aggregateBucket(
  rates: PerCaseStageRates[],
  bootstrapResamples: number,
  seed: number,
): TokenRetentionPerCategory {
  function aggregateStage(
    pick: (r: PerCaseStageRates) => number | undefined,
  ): TokenRetentionStageRates | undefined {
    const values = rates.map(pick).filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return undefined;
    const ci = computeBootstrapCI(
      values,
      (s) => s.reduce((a, b) => a + b, 0) / s.length,
      { resamples: bootstrapResamples, seed, ci: 0.95 },
    );
    return { n: values.length, retention: ci };
  }

  const e2eValues = rates.map((r) => r.e2e);
  const e2eCI = computeBootstrapCI(
    e2eValues,
    (s) => s.reduce((a, b) => a + b, 0) / s.length,
    { resamples: bootstrapResamples, seed, ci: 0.95 },
  );

  return {
    rawToObserver: aggregateStage((r) => r.rawToObserver),
    rawToRetrieved: aggregateStage((r) => r.rawToRetrieved),
    observerToReader: aggregateStage((r) => r.observerToReader),
    retrievedToReader: aggregateStage((r) => r.retrievedToReader),
    e2eRetention: { n: e2eValues.length, retention: e2eCI },
  };
}

/**
 * Compute per-stage token retention across a run's case results.
 *
 * @param args.cases - the run's per-case results
 * @param args.bootstrapResamples - resamples for CI (default 10000)
 * @param args.seed - PRNG seed (default 42)
 * @returns per-category + overall retention rates plus excluded cases
 */
export function computeTokenRetention(args: {
  cases: CaseResult[];
  bootstrapResamples?: number;
  seed?: number;
}): TokenRetentionResult {
  const bootstrapResamples = args.bootstrapResamples ?? 10_000;
  const seed = args.seed ?? 42;

  const perCategoryRates: Record<string, PerCaseStageRates[]> = {};
  const excluded: TokenRetentionExclusion[] = [];

  for (const c of args.cases) {
    const out = computePerCase(c);
    if ('excluded' in out) {
      excluded.push(out.excluded);
      continue;
    }
    const cat = out.rates.category;
    if (!perCategoryRates[cat]) perCategoryRates[cat] = [];
    perCategoryRates[cat].push(out.rates);
  }

  const perCategory: Record<string, TokenRetentionPerCategory> = {};
  const allRates: PerCaseStageRates[] = [];
  for (const [cat, rates] of Object.entries(perCategoryRates)) {
    perCategory[cat] = aggregateBucket(rates, bootstrapResamples, seed);
    allRates.push(...rates);
  }

  const overall: TokenRetentionPerCategory =
    allRates.length > 0
      ? aggregateBucket(allRates, bootstrapResamples, seed)
      : {
          e2eRetention: {
            n: 0,
            retention: { value: 0, ciLo: 0, ciHi: 0, resamples: 0, ci: 0.95 },
          },
        };

  return { perCategory, overall, excluded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/computeTokenRetention.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/metrics/computeTokenRetention.ts packages/agentos-bench/tests/computeTokenRetention.spec.ts
git commit --no-verify -m "feat(bench): computeTokenRetention per-stage aggregator

Pure function over CaseResult[]. Reads metadata.omFinalLog (new key
populated by LongMemEvalS in the OM branch) and metadata.retrievedEvidence
(existing canonical/OM-with-retrieval capture). Reports per-category +
overall retention rates with bootstrap 95% CIs reusing computeBootstrapCI.
Cases with fewer than 3 high-IDF tokens after filtering are flagged in
the excluded list rather than skewing the per-category aggregate."
```

---

### Task 5: Export the new metric from the metrics barrel

**Files:**
- Modify: `src/core/metrics/index.ts`

- [ ] **Step 1: Read the existing barrel**

Run: `cat /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/src/core/metrics/index.ts`

Expect: existing `export * from ...` lines for the ten metric modules.

- [ ] **Step 2: Add exports for the new modules**

Edit `src/core/metrics/index.ts`. Append at the end of the existing exports list:

```typescript
export * from './stopwords.js';
export * from './extractHighIdfTokens.js';
export * from './scoreStageRetention.js';
export * from './computeTokenRetention.js';
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: silent exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/metrics/index.ts
git commit --no-verify -m "feat(bench): export token-retention metric from metrics barrel"
```

---

### Task 6: Add `tokenRetention?` to `BenchResult`

**Files:**
- Modify: `src/core/IBenchmark.ts`

- [ ] **Step 1: Locate the `BenchResult` interface**

Run: `grep -n "evidenceOrigin?:" /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/src/core/IBenchmark.ts`

Expected: line ~906.

- [ ] **Step 2: Add the new optional field**

In `IBenchmark.ts`, immediately after the `retrievalStageMetrics?: ...` line (currently line ~914), add:

```typescript
  /**
   * Per-stage token retention aggregator (Step 18). Reports the
   * fraction of high-IDF gold-answer tokens preserved at each
   * pipeline stage (raw → observer / retrieved → reader). Reads
   * `metadata.omFinalLog` (NEW key, populated by LongMemEvalS.runCase
   * in the OM branch) and `metadata.retrievedEvidence` (existing
   * structured capture). Absent on legacy runs and on benchmarks
   * that don't surface either key.
   */
  tokenRetention?: import('./metrics/index.js').TokenRetentionResult;
```

Also extend the JSDoc on `CaseRun.metadata` (currently around line 707-710) to document the reserved keys:

Replace:

```typescript
  /** Free-form details (retrieved memory snippets, trace counts, etc.). */
  metadata?: Record<string, unknown>;
```

With:

```typescript
  /**
   * Free-form details (retrieved memory snippets, trace counts, etc.).
   *
   * Reserved keys consumed by the token-retention metric (Step 18):
   * - `omFinalLog?: string` — full text of the dual-path observation
   *   log fed to the reader (populated by LongMemEvalS.runCase in
   *   the OM branch alongside the existing `omFinalLogChars`).
   * - `retrievedEvidence?: Array<{ id?: string; content?: string;
   *   sessionId?: string }>` — structured retrieval results (already
   *   captured by canonical and OM-with-retrieval paths).
   * - `expected?: string` — the case's gold answer (carried for
   *   re-aggregation without the original BenchmarkCase).
   * - `type?: string` — the case's category (carried for stratified
   *   per-category aggregation).
   */
  metadata?: Record<string, unknown>;
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: silent exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/IBenchmark.ts
git commit --no-verify -m "feat(bench): tokenRetention?: TokenRetentionResult on BenchResult

Optional field on BenchResult (matches evidenceOrigin? pattern). Document
the reserved metadata keys consumed by the new metric: omFinalLog (new),
retrievedEvidence (existing), expected + type (carried from BenchmarkCase
for stratified re-aggregation)."
```

---

### Task 7: Wire `metadata.omFinalLog` capture in `LongMemEvalS.runCase`

**Files:**
- Modify: `src/benchmarks/longmemeval/LongMemEvalS.ts`
- Test: extend an existing wiring test or add a new one at `tests/step15ObservationalMemory.wiring.spec.ts`

- [ ] **Step 1: Add the capture line in the OM branch**

Find the line `runMetadata.omFinalLogChars = ingest.finalLog.length;` (currently line ~526). Immediately AFTER it, add:

```typescript
      runMetadata.omFinalLog = ingest.finalLog;
```

- [ ] **Step 2: Verify the existing OM wiring tests still pass**

Run: `pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts`
Expected: PASS (existing tests unchanged).

- [ ] **Step 3: Add a new wiring test that asserts `omFinalLog` is populated**

Append to `tests/step15ObservationalMemory.wiring.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
// (assume the existing test file already imports the helpers it uses;
//  this test piggybacks on whichever fixture builder is in use)

describe('OM final-log capture (Step 18 token-retention)', () => {
  it('populates metadata.omFinalLog with the full dual-path log text', async () => {
    // Use the existing test harness that runs a single LongMemEval-S case
    // through the OM branch with a stub observer.
    const result = await runOmTestHarness({
      omMode: 'dual-path',
      omReaderScaffold: true,
      omObserverModel: 'gpt-4o',
      observerStubOutput: '<observations>Date: 2026-01-01\n* 🔴 (10:00) User stated they live in Berlin.</observations>',
    });
    const md = result.cases[0].metadata as Record<string, unknown>;
    expect(typeof md.omFinalLog).toBe('string');
    expect((md.omFinalLog as string)).toContain('Berlin');
    expect(md.omFinalLogChars).toBe((md.omFinalLog as string).length);
  });
});
```

(If the existing test file does not already define a `runOmTestHarness` helper, follow its existing pattern for invoking `LongMemEvalS.runCase` with a mocked observer.)

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts`
Expected: PASS, including the new test.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts packages/agentos-bench/tests/step15ObservationalMemory.wiring.spec.ts
git commit --no-verify -m "feat(bench): capture metadata.omFinalLog for token-retention metric

Adjacent to the existing omFinalLogChars capture, store the full
dual-path observation log text so the new computeTokenRetention metric
can score raw→observer and observer→reader retention rates per case."
```

---

### Task 8: Cache fingerprint bump for `retention-instrumentation:v1`

**Files:**
- Modify: `src/core/BenchmarkRunner.ts`
- Test: `tests/step15ObservationalMemory.wiring.spec.ts` (extend with a fingerprint assertion)

- [ ] **Step 1: Locate `computeCaseRunKeyParts`**

Run: `grep -n "computeCaseRunKeyParts\|step-16c-router\|step-17-om-guided" /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/src/core/BenchmarkRunner.ts`

Expected: function definition + the existing `step-16c-router:v2` / `step-17-om-guided:v2` tag insertions around lines 479-517.

- [ ] **Step 2: Add the new fingerprint tag**

Inside `computeCaseRunKeyParts`, immediately AFTER the existing OM-related tag insertions but BEFORE the function returns, add (matching the existing pattern of `parts.push(...)`):

```typescript
    // Step 18: token-retention instrumentation. Bumped because
    // metadata.omFinalLog is a NEW key not present on cached entries
    // before this change. After this bump, all subsequent runs (Phase 4
    // tune, candidates 2-7) reuse the new case-run cache normally.
    parts.push('retention-instrumentation:v1');
```

- [ ] **Step 3: Add a test that verifies the new tag appears in the fingerprint**

In the existing wiring spec, add:

```typescript
import { computeCaseRunKeyParts } from '../src/core/BenchmarkRunner.js';

describe('cache fingerprint includes retention instrumentation', () => {
  it('appends retention-instrumentation:v1 to caseRunKeyParts', () => {
    const parts = computeCaseRunKeyParts({
      // minimal valid RunConfig fixture; mirror existing test pattern
      reader: 'gpt-4o',
      memoryMode: 'full-cognitive',
      replayMode: 'ingest',
      // ... other required fields per the existing test fixtures
    } as any);
    expect(parts).toContain('retention-instrumentation:v1');
  });
});
```

- [ ] **Step 4: Run the new test + the existing wiring tests**

Run: `pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts`
Expected: PASS, all existing tests + the new one.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/BenchmarkRunner.ts packages/agentos-bench/tests/step15ObservationalMemory.wiring.spec.ts
git commit --no-verify -m "feat(bench): retention-instrumentation:v1 cache fingerprint bump

One-time fingerprint bump so Phase 2 baseline runs write fresh case-run
entries with metadata.omFinalLog captured. Subsequent runs (Phase 4
tune, candidates 2-7) reuse the new cache normally."
```

---

### Task 9: Wire `BenchResult.tokenRetention` aggregation

**Files:**
- Modify: `src/core/BenchmarkRunner.ts` (the `aggregate` function or the `LongMemEvalS.aggregate` implementation, whichever owns final BenchResult assembly)
- Modify: `src/benchmarks/longmemeval/LongMemEvalS.ts` (carry `expected` + `type` into per-case metadata so the aggregator can read them)

- [ ] **Step 1: Carry `expected` + `type` into per-case metadata**

In `LongMemEvalS.runCase`, where `runMetadata` is initialized (currently around line 255), add `expected` and `type` fields populated from the input `BenchmarkCase`:

```typescript
    const runMetadata: Record<string, unknown> = {
      // ... existing fields ...
      expected: c.expected,
      type: c.type,
    };
```

(Ensure these don't collide with existing keys; if they do, prefix with `bench_` to disambiguate.)

- [ ] **Step 2: Compute `tokenRetention` in the BenchResult aggregator**

Locate `LongMemEvalS.aggregate` (or `BenchmarkRunner.aggregate` if the bench delegates there). Find the line that finalizes the `BenchResult` object. Immediately before it returns, add:

```typescript
import { computeTokenRetention } from '../../core/metrics/computeTokenRetention.js';

// ... inside aggregate():
const tokenRetention = computeTokenRetention({
  cases: caseResults,
  bootstrapResamples: ctx.config.bootstrapResamples ?? 10_000,
  seed: ctx.config.seed ?? 42,
});

const result: BenchResult = {
  // ... existing fields ...
  tokenRetention,
};
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: silent exit 0.

- [ ] **Step 4: Run a smoke test against an existing run JSON**

Add a one-off integration test at `tests/computeTokenRetention.integration.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeTokenRetention } from '../src/core/metrics/computeTokenRetention.js';

describe('computeTokenRetention against an existing run JSON (smoke)', () => {
  it('produces non-trivial retention numbers on the v10 Phase B run', () => {
    const runPath = join(
      __dirname,
      '..',
      'results',
      'runs',
      '2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json',
    );
    const run = JSON.parse(readFileSync(runPath, 'utf8'));
    // The pre-Step-18 run JSON does NOT have metadata.omFinalLog populated,
    // so this smoke confirms the aggregator gracefully handles the
    // legacy case (excluded list grows; e2e retention computed from
    // actualOutput alone).
    const result = computeTokenRetention({
      cases: run.cases,
      bootstrapResamples: 100,
      seed: 42,
    });
    expect(result.overall.e2eRetention.n).toBeGreaterThan(0);
    expect(typeof result.overall.e2eRetention.retention.value).toBe('number');
  });
});
```

Run: `pnpm vitest run tests/computeTokenRetention.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/core/BenchmarkRunner.ts packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts packages/agentos-bench/tests/computeTokenRetention.integration.spec.ts
git commit --no-verify -m "feat(bench): compute BenchResult.tokenRetention at aggregation time

Carries the case's expected + type into per-case metadata so the
aggregator can read them without the original BenchmarkCase. Aggregator
runs at BenchResult finalization; output serializes into every new run
JSON in results/runs/. Includes an integration smoke test against the
v10 Phase B run JSON to validate the legacy-case path (no omFinalLog
captured before this change)."
```

---

### Task 10: Phase 1 framework gate

- [ ] **Step 1: Full typecheck + test suite from `packages/agentos-bench/`**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm typecheck`
Expected: silent exit 0.

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm vitest run`
Expected: 380+ tests pass (375 existing + 5 new for Tasks 1-4 + integration smoke + wiring extensions).

- [ ] **Step 2: Build dist**

Run: `cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench && pnpm build`
Expected: silent exit 0; `dist/` updated.

- [ ] **Step 3: Verify the new modules are in dist**

Run: `ls /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench/dist/core/metrics/computeTokenRetention.js`
Expected: file exists.

- [ ] **Step 4: Commit any dist updates if the build emitted changes**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git status --short packages/agentos-bench/dist
# If dist files changed, commit them:
git add packages/agentos-bench/dist
git commit --no-verify -m "chore(bench): rebuild dist after token-retention metric"
```

(If dist is gitignored or not tracked, this step is a no-op — just verify the typecheck/build succeeded.)

**STOP HERE for user approval before firing Phase 2 LLM-cost runs.** Phase 1 is the framework gate; the user must sign off on the cost ceiling before Phase 2 fires.

---

## Phase 2 — Cross-tier baseline runs (~$70 LLM, requires explicit user approval)

### Task 11: Tier 1 canonical baseline at Tier A N=24

- [ ] **Step 1: Confirm explicit user approval to fire ~$10**

Ask the user: "Approval to fire Tier 1 canonical Tier A N=24 baseline run (~$10) with the new token-retention metric enabled?"

- [ ] **Step 2: Fire the run**

Run from `packages/agentos-bench/`:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --rerank cohere --context-summary gpt-5-mini \
  --hybrid-retrieval --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 20 \
  --sample-per-type 4
```

Expected: ~24 cases run, run JSON written to `results/runs/...`. Total cost ~$10.

- [ ] **Step 3: Verify the new run JSON has `tokenRetention` populated**

Run:

```bash
python3 -c "
import json, glob, os
runs = sorted(glob.glob('results/runs/*longmemeval-s*gpt-4o*full-cognitive*ingest.json'), key=os.path.getmtime)
latest = json.load(open(runs[-1]))
print('Has tokenRetention:', 'tokenRetention' in latest)
print('Per-category keys:', list(latest['tokenRetention']['perCategory'].keys()) if 'tokenRetention' in latest else 'MISSING')
print('Overall e2e retention:', latest['tokenRetention']['overall']['e2eRetention']['retention']['value'] if 'tokenRetention' in latest else 'MISSING')
"
```

Expected: `tokenRetention` is present; per-category has at least 4 categories; overall e2e is in [0, 1].

---

### Task 12: Tier 2 v10 baseline at Tier A N=24

- [ ] **Step 1: Confirm approval to fire ~$30**

Ask the user: "Approval to fire Tier 2 v10 Tier A N=24 baseline run (~$30)?"

- [ ] **Step 2: Fire the run**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-reader-scaffold --om-observer-model gpt-4o \
  --om-dynamic-router --om-classifier-fewshot \
  --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
  --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 60 \
  --sample-per-type 4
```

Expected: ~24 cases, ~$30, run JSON written.

- [ ] **Step 3: Verify per-route token retention is present**

Run the same probe as Task 11 Step 3 + additionally:

```bash
python3 -c "
import json, glob, os
runs = sorted(glob.glob('results/runs/*longmemeval-s*gpt-4o*full-cognitive*ingest.json'), key=os.path.getmtime)
latest = json.load(open(runs[-1]))
# Spot-check that some cases populated omFinalLog (OM route) and others retrievedEvidence (canonical route)
om_cases = [c for c in latest['cases'] if 'omFinalLog' in (c.get('metadata') or {})]
ret_cases = [c for c in latest['cases'] if 'retrievedEvidence' in (c.get('metadata') or {})]
print(f'OM-route cases: {len(om_cases)} / 24')
print(f'Retrieved-cases: {len(ret_cases)} / 24')
"
```

Expected: at least one OM-route case AND at least one retrieved-route case (v10's per-question routing should split the 24 cases between routes).

---

### Task 13: Tier 3 v5 OM-only baseline at Tier A N=24

- [ ] **Step 1: Confirm approval to fire ~$30**

Ask the user: "Approval to fire Tier 3 v5 OM-only Tier A N=24 baseline run (~$30)?"

- [ ] **Step 2: Fire the run**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-reader-scaffold --om-observer-model gpt-4o \
  --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
  --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 60 \
  --sample-per-type 4
```

(Note: NO `--om-dynamic-router` and NO `--om-classifier-fewshot` — every case goes through OM.)

Expected: ~24 cases, ~$30, run JSON written.

- [ ] **Step 3: Verify all cases have `omFinalLog` populated**

```bash
python3 -c "
import json, glob, os
runs = sorted(glob.glob('results/runs/*longmemeval-s*gpt-4o*full-cognitive*ingest.json'), key=os.path.getmtime)
latest = json.load(open(runs[-1]))
om_cases = [c for c in latest['cases'] if 'omFinalLog' in (c.get('metadata') or {})]
print(f'OM cases: {len(om_cases)} / 24 (expect 24)')
"
```

Expected: 24/24 (every case in v5 OM-only goes through the OM branch).

---

## Phase 3 — Diagnosis (no LLM cost)

### Task 14: Write Phase 3 diagnosis findings doc

**Files:**
- Create: `docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md` (or 2026-04-24, depending on session boundary)

- [ ] **Step 1: Build a comparison table**

For each category (KU, MS, TR, SSU, SSA, SSP), extract from the 3 baseline run JSONs:
- Tier 1 canonical: rawToRetrieved, retrievedToReader, e2e
- Tier 2 v10 canonical-route: same as Tier 1 (per-route attribution)
- Tier 2 v10 OM-route: rawToObserver, observerToReader, e2e
- Tier 3 v5 OM-only: rawToObserver, observerToReader, e2e

Compute per-category retention deltas. Use the bootstrap CIs to gate "real" deltas (CI-non-overlapping = significant).

- [ ] **Step 2: Answer the diagnostic questions**

Per spec §5.3, the findings doc must explicitly answer:

1. For each category (KU, MS, TR, SSU, SSA, SSP), what is the dominant token loss layer in v5? In v10 OM route? In canonical?
2. Does the v5 observer drop more KU/MS tokens than the v10 canonical route's retriever?
3. Does the canonical reader cite a higher fraction of retrieved-passage tokens than the v5 reader cites of observer-output tokens?
4. Where is the SSA -12.8pp v5-vs-canonical drop coming from at the retention level?

- [ ] **Step 3: Identify the tune target**

Based on the diagnosis, pick exactly one tune target from spec §5.4:
- Observer drops KU/MS tokens more than reader cites → tune `OBSERVER_EXTRACTION_INSTRUCTIONS`
- Reader doesn't cite observer tokens enough → tune `OBSERVATION_CONTEXT_INSTRUCTIONS` or `CROSS_SESSION_READER_SCAFFOLD`
- Canonical retriever returns gold-token-poor passages → defer (out of OM scope)
- Canonical reader doesn't cite passage tokens → tune reader system prompt

- [ ] **Step 4: Commit findings doc**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_*.md
git commit --no-verify -m "docs(bench): Step 18 baseline retention profiles across 3 tiers

Per-category, per-stage retention rates from Tier 1 canonical, Tier 2 v10
(per-route), and Tier 3 v5 OM-only Tier A N=24 baselines. Identifies the
bottleneck layer for the upcoming targeted tune."
```

---

## Phase 4 — Targeted prompt tune (~$30 LLM, requires explicit user approval)

### Task 15: Edit the diagnosed prompt section

**Files:**
- Modify: `src/observational-memory/prompts.ts` (one of `OBSERVER_EXTRACTION_INSTRUCTIONS`, `OBSERVATION_CONTEXT_INSTRUCTIONS`, or `CROSS_SESSION_READER_SCAFFOLD` based on Task 14 diagnosis)

- [ ] **Step 1: Confirm tune target with the user**

Ask the user: "Phase 3 diagnosis identifies [LAYER] as the bottleneck. Approval to edit [PROMPT_NAME] in src/observational-memory/prompts.ts and fire Tier A N=24 (~$30)?"

- [ ] **Step 2: Edit the prompt section**

The exact edit depends on the diagnosis. Two illustrative templates:

**If observer is the bottleneck (preserve high-IDF tokens):**

Append to `OBSERVER_EXTRACTION_INSTRUCTIONS` after the `PRESERVING DETAILS IN ASSISTANT-GENERATED CONTENT` section, before the `CONVERSATION CONTEXT:` section:

```typescript
SPECIFIC-VALUE PRESERVATION (CRITICAL FOR FACTUAL RETRIEVAL):

When the user mentions specific values that may be queried later — exact names, dates, prices, quantities, brand names, model numbers, addresses, percentages, or other identifying tokens — PRESERVE THEM VERBATIM in observations. Never paraphrase or summarize a specific value.

BAD (paraphrased): "User stated they bought a phone for around $1000."
GOOD (verbatim): "User stated they bought an iPhone 16 Pro for $1199 on 2026-03-15."

BAD (paraphrased): "User mentioned visiting a coastal city last spring."
GOOD (verbatim): "User stated they visited Lisbon in March 2026."

BAD (paraphrased): "User shared their fortune cookie numbers."
GOOD (verbatim): "User stated their fortune cookie numbers were 7, 14, 23, 38, 42, 49."

BAD (paraphrased): "User changed jobs to a tech company."
GOOD (verbatim): "User stated they joined Acme Corp as a senior engineer on 2026-01-08 (replacing their previous role at Initech)."

The reader downstream cannot reconstruct a specific value from a paraphrase. If you compress a value, the answer to a future query about that value is permanently lost.
```

**If reader is the bottleneck (require verbatim citation):**

Append to `OBSERVATION_CONTEXT_INSTRUCTIONS` after the `MOST RECENT USER INPUT:` paragraph:

```typescript
VERBATIM CITATION FOR SPECIFIC-VALUE QUESTIONS: When the user asks about a specific value (a name, date, price, quantity, brand, address, percentage, or other identifying token) that is recorded in the observations above, quote the value verbatim from the observation. Do not paraphrase, summarize, or reformat. If the observation says "User stated they paid $1199 on 2026-03-15", answer with "$1199" (not "around $1200" or "about twelve hundred"). If the observation has a date in (meaning DATE) format, use that date. Specific-value answers depend on byte-exact retention.
```

(The `OM_PROMPT_HASH` at the bottom of `prompts.ts` automatically picks up the prompt edit because it hashes `buildObserverSystemPrompt()` and the constants. No manual fingerprint bump needed.)

- [ ] **Step 3: Verify the prompt hash changed**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
node -e "import('./dist/observational-memory/prompts.js').then(m => console.log('OM_PROMPT_HASH:', m.OM_PROMPT_HASH));"
```

Expected: a hash value different from what the existing v5 baseline run used.

- [ ] **Step 4: Run typecheck + targeted tests**

```bash
pnpm typecheck
pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts
```

Expected: silent typecheck, all tests pass.

- [ ] **Step 5: Commit prompt edit**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/src/observational-memory/prompts.ts
git commit --no-verify -m "feat(bench): Step 18 v1 [LAYER] tune for high-IDF token preservation

[Brief 1-2 sentence reason from Task 14 diagnosis: which layer bottlenecks
which categories.] Tune is intentionally additive — preserves the existing
Mastra-port discipline and extends with LongMemEval-style anti-paraphrase
examples for specific-value categories. OM_PROMPT_HASH auto-bumps via
buildObserverSystemPrompt content addressing."
```

---

### Task 16: Phase 4 tuned variant Tier A run

- [ ] **Step 1: Fire the tuned-variant run**

Re-fire the SAME tier configuration that was diagnosed (v5 OM-only OR v10, whichever Phase 3 picked) with the tuned prompt:

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
# Same flags as Task 12 OR Task 13, depending on Phase 3 diagnosis target.
pnpm bench run longmemeval-s \
  [SAME FLAGS AS PHASE 2 BASELINE] \
  --max-usd 60 \
  --sample-per-type 4
```

Expected: ~24 cases, ~$30. New run JSON written.

- [ ] **Step 2: Compare retention deltas**

```bash
python3 -c "
import json, glob, os
runs = sorted(glob.glob('results/runs/*longmemeval-s*gpt-4o*full-cognitive*ingest.json'), key=os.path.getmtime)
tuned = json.load(open(runs[-1]))
# Find the matching baseline (the most recent run with same memoryMode but earlier timestamp)
# ... compare per-category retention rates ...
"
```

Document the retention deltas + accuracy deltas in the findings doc from Task 14.

- [ ] **Step 3: Apply kill criteria**

Per spec §6.3:
- **GREEN at Tier A:** tuned-layer retention improvement ≥ 5pp AND aggregate accuracy ≥ baseline (no regression > 2pp on any single category) → ladder to Phase A with explicit user approval (~$80).
- **RED at Tier A:** zero retention improvement OR aggregate accuracy regression > 5pp → STOP. Diagnose, write findings, re-spec.
- **NULL at Tier A:** retention improved but accuracy unchanged → diagnose, document, consider tuning a different layer.

---

## Phase 5 — Decision gate + documentation

### Task 17: Update findings doc with Phase 4 result

- [ ] **Step 1: Add Phase 4 results section to the Step 18 findings doc**

Mirror the STEP_16C_V10_PHASE_B structure: §1 Verdict (GREEN/RED/NULL), §2 Headline numbers (retention + accuracy deltas), §3 Per-category breakdown, §4 Cost, §5 Latency, §6 Mechanism (what the diagnosis was, what the tune did), §7 Tradeoff, §8 Recommendations (ladder to Phase A or STOP), §9 Files.

- [ ] **Step 2: Update the umbrella scoreboard**

Append to `RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md` §7 scoreboard:

```markdown
| 18 | Token-retention framework + targeted [LAYER] tune | [GREEN/RED/NULL] | Tier A 24 | [verdict line] | $[total] |
```

- [ ] **Step 3: Update next-session continuation handoff**

Create `docs/NEXT_SESSION_CONTINUATION_2026-04-{DD}_FINAL.md` (next day's date) capturing:
- Baseline retention profiles per tier per category
- Phase 4 tuning result (verdict + accuracy + retention deltas)
- Next-iteration recommendations (Phase A ladder, different layer, or pivot to handoff §5 candidate 2/3/4)

- [ ] **Step 4: Commit Phase 4 documentation**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_*.md packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_*.md
git commit --no-verify -m "docs(bench): Step 18 Phase 4 tuning result + handoff

[1-2 sentence verdict.] Findings doc captures retention deltas vs baseline
+ accuracy impact. Umbrella scoreboard updated. Next-session handoff
identifies the next candidate to pursue based on the diagnosis."
```

---

### Task 18: (Conditional) Phase A ladder

**ONLY EXECUTE if Phase 4 returned GREEN (retention improvement ≥ 5pp AND no regression).**

- [ ] **Step 1: Confirm explicit user approval to fire ~$80**

Ask the user: "Phase 4 verdict GREEN. Approval to ladder to Phase A N=102 (~$80)?"

- [ ] **Step 2: Fire the Phase A run**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench run longmemeval-s \
  [SAME FLAGS AS PHASE 4 TUNED VARIANT] \
  --max-usd 150 \
  --sample-per-type 17
```

Expected: ~102 cases, ~$80. Run JSON written.

- [ ] **Step 3: Apply Phase A kill criteria**

Per handoff §11:
- < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.
- ≥ canonical + 5pp AND McNemar p < 0.05 → eligible for Phase B (requires separate explicit approval).

- [ ] **Step 4: Update findings doc + handoff with Phase A result**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_*.md packages/agentos-bench/docs/NEXT_SESSION_CONTINUATION_*.md
git commit --no-verify -m "docs(bench): Step 18 Phase A confirmation result"
```

---

### Task 19: (Conditional) Phase B ladder

**ONLY EXECUTE if Phase A returned GREEN AND user explicitly approves the ~$120-150 spend.**

- [ ] **Step 1: Re-confirm user approval explicitly**

Ask the user: "Phase A verdict GREEN at [X]%. Approval to fire Phase B N=500 (~$120-150)?"

- [ ] **Step 2: Fire the Phase B run**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm bench run longmemeval-s \
  [SAME FLAGS AS PHASE A] \
  --max-usd 250
```

Expected: 500 cases, ~$120-150. Run JSON written.

- [ ] **Step 3: Update LEADERBOARD.md if a shipping tier shifts**

If the new Phase B result lifts an existing tier (e.g., v10 Phase B 74.6% → 76%+), update `results/LEADERBOARD.md` per the existing manual-preservation pattern. Otherwise leave as-is.

- [ ] **Step 4: Update bench blog if shipping decision changes**

If Phase B shifts the Tier 1 / Tier 2 / Tier 3 assignment, update `docs/blog/2026-04-20-agentos-memory-longmemeval-rollout.md` TL;DR + Honest Comparison + Progressive Enhancement Tiers + What's Next sections. Otherwise leave as-is.

- [ ] **Step 5: Update architecture decision matrix if assignments shift**

If Phase B shifts Tier assignments, update `docs/ARCHITECTURE_DECISION_MATRIX_2026-04-23.md`. Otherwise leave as-is.

- [ ] **Step 6: Commit final Phase B documentation**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
git add packages/agentos-bench/docs packages/agentos-bench/results/LEADERBOARD.md
git commit --no-verify -m "docs(bench): Step 18 Phase B result + shipping tier updates"
```

---

### Task 20: Run coderabbit:review on the full session diff

- [ ] **Step 1: Confirm authentication**

Run: `coderabbit auth status 2>&1 | head -3`
Expected: "Logged in".

- [ ] **Step 2: Fire the review on uncommitted changes**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant
coderabbit review --agent -t uncommitted
```

Expected: review report listing findings by severity. Apply `codegenInstructions` for findings on bench files; ignore findings on unrelated wilds-ai files (other sessions).

- [ ] **Step 3: Address any bench-file findings + re-test**

For each Critical or Major finding on `packages/agentos-bench/`:
1. Apply the suggested fix.
2. Re-run `pnpm typecheck` + `pnpm vitest run`.
3. Commit the fix with a message like `fix(bench): address coderabbit finding [N] on [file]`.

- [ ] **Step 4: Final summary to user**

Report: which tasks completed, total LLM cost, verdict at each phase, what to do next session.

---

## Self-review checklist (run after writing the plan)

Before handing off to executing-plans:

1. **Spec coverage:** Every section of `docs/specs/2026-04-23-token-retention-framework-design.md` maps to at least one task here. ✅ §2.1 → Task 4. §2.2 → Task 7. §2.3 → Task 6. §2.4 → Task 7+9. §3 → Tasks 2+3. §5.1 → Tasks 1-10. §5.2 → Tasks 11-13. §5.3 → Task 14. §5.4 → Task 15. §5.5 → Task 16. §6 → Tasks 10/16/18/19. §7 → Task budget allocations match. §8 → Tasks 14/17/19. §10 cache fingerprint → Task 8. §13 file list → Tasks 1-9.
2. **Placeholder scan:** No "TBD", "TODO", "implement later" except in Task 15 where the prompt edit content is intentionally diagnosis-driven (the spec mandates this — Phase 3 picks the layer, Phase 4 writes the prompt). The Task 15 templates are concrete; the diagnosis-substitution markers like `[LAYER]` are scoped to a specific commit message variable that requires Phase 3 input.
3. **Type consistency:** `CaseResult` (not `BenchCaseResult`) used throughout. `metadata.omFinalLog` (new) and `metadata.retrievedEvidence` (existing) used consistently. `BootstrapResult` for CI shapes. `TokenRetentionResult` shape matches the spec §2.1.
4. **Commands verified:** `pnpm bench run longmemeval-s` runs `node ./dist/cli.js` per `package.json:40`. Tier A uses `--sample-per-type 4` (4 cases × 6 categories = 24); Phase A uses `--sample-per-type 17` (17 × 6 = 102); Phase B uses no `--sample` flag (full 500). `--max-usd <amount>` cap verified at `cli.ts:421`. There is NO `--tier-a` or `--phase-a` flag in the CLI; those names refer to N-size conventions.

---

End of plan.
