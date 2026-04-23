# Step 19 — Conditional Retriever Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. All bench commands run from `packages/agentos-bench/`. Commits use `--no-verify`. Commit messages read as human-written.

**Goal:** Test three classifier-conditional retriever variants for multi-session questions, gated on the v10 router's `metadata.omRouterCategory === 'multi-session'`. Fire all three Tier A in parallel (~$45 total), pick winner for Phase A.

**Architecture:** Three optional RunConfig fields (`omRetrieverMsKOverride`, `omRetrieverMsBm25Weight`, `omRetrieverMsOverFetchMultiplier`) gate per-case retriever parameter overrides applied only to MS-classified canonical-route cases. Cache fingerprints `step-19a-ms-k:{n}`, `step-19b-ms-bm25:{w}`, `step-19c-ms-overfetch:{m}` keep variants cache-independent.

**Spec:** [docs/specs/2026-04-23-step-19-conditional-retriever-tuning-design.md](../specs/2026-04-23-step-19-conditional-retriever-tuning-design.md)

---

## Phase 1 — Plumbing (no LLM cost)

### Task 1: Add 3 RunConfig fields + JSDoc

**Files:** `src/core/IBenchmark.ts` (RunConfig interface, around line 200)

- [ ] **Step 1: Locate RunConfig**

Run: `grep -n "interface RunConfig\|omClassifierFewshot" src/core/IBenchmark.ts`

- [ ] **Step 2: Add three optional fields after the existing OM router fields**

Insert immediately after the `omClassifierFewshot?:` field:

```typescript
  /**
   * Step 19A: per-case readerTopK override applied when the v10 router
   * classifies a question as `multi-session`. Default behavior (when
   * undefined) keeps the run-level `readerTopK` for all cases. When set,
   * MS-classified cases use this K instead. Cache fingerprint:
   * `step-19a-ms-k:{n}`.
   */
  omRetrieverMsKOverride?: number;
  /**
   * Step 19B: per-case BM25 weight in RRF applied when the v10 router
   * classifies a question as `multi-session`. Default RRF is dense=0.7 /
   * sparse=0.3. Setting this to e.g. 0.7 flips to dense=0.3 / sparse=0.7
   * for MS-classified cases (BM25-heavy fusion). Cache fingerprint:
   * `step-19b-ms-bm25:{w}`.
   */
  omRetrieverMsBm25Weight?: number;
  /**
   * Step 19C: per-case over-fetch multiplier applied when the v10 router
   * classifies a question as `multi-session`. Default is 3 (over-fetch K
   * = recallTopK * 3). Set to 6 for K=60 over-fetch on MS cases. Cache
   * fingerprint: `step-19c-ms-overfetch:{m}`.
   */
  omRetrieverMsOverFetchMultiplier?: number;
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`. Expect: silent exit 0.

---

### Task 2: Add 3 cache fingerprint tags

**Files:** `src/core/BenchmarkRunner.ts` (`computeCaseRunKeyParts` function)

- [ ] **Step 1: Find the fingerprint function**

Locate the existing `step-17-om-guided` block. Step 19 tags are appended after it but before the `retention-instrumentation:v1` tag.

- [ ] **Step 2: Add the three conditional fingerprint pushes**

Insert before the `retention-instrumentation:v1` push:

```typescript
  // Step 19A: K-override for MS-classified cases.
  if (typeof config.omRetrieverMsKOverride === 'number') {
    const tag = `step-19a-ms-k:${config.omRetrieverMsKOverride}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }
  // Step 19B: BM25 weight in RRF for MS-classified cases.
  if (typeof config.omRetrieverMsBm25Weight === 'number') {
    const tag = `step-19b-ms-bm25:${config.omRetrieverMsBm25Weight.toFixed(2)}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }
  // Step 19C: over-fetch multiplier for MS-classified cases.
  if (typeof config.omRetrieverMsOverFetchMultiplier === 'number') {
    const tag = `step-19c-ms-overfetch:${config.omRetrieverMsOverFetchMultiplier.toFixed(1)}`;
    runKeyParts.push(tag);
    resultKeyParts.push(tag);
  }
```

- [ ] **Step 3: Add wiring tests** in `tests/step15ObservationalMemory.wiring.spec.ts`

Append a new describe block:

```typescript
describe('Step 19 conditional retriever tuning fingerprints', () => {
  const baseConfig: RunConfig = {
    reader: 'gpt-4o',
    memoryMode: 'full-cognitive',
    replayMode: 'ingest',
    rerank: { provider: 'cohere' },
    contextSummary: 'gpt-5-mini',
    hybridRetrieval: true,
    readerTopK: 10,
  } as RunConfig;

  it('appends step-19a-ms-k:{n} when omRetrieverMsKOverride is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsKOverride: 30 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19a-ms-k:30');
    expect(resultKeyParts).toContain('step-19a-ms-k:30');
  });

  it('appends step-19b-ms-bm25:{w} when omRetrieverMsBm25Weight is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsBm25Weight: 0.7 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19b-ms-bm25:0.70');
    expect(resultKeyParts).toContain('step-19b-ms-bm25:0.70');
  });

  it('appends step-19c-ms-overfetch:{m} when omRetrieverMsOverFetchMultiplier is set', () => {
    const { runKeyParts, resultKeyParts } = computeCaseRunKeyParts(
      { ...baseConfig, omRetrieverMsOverFetchMultiplier: 6.0 } as RunConfig,
      'case-1',
    );
    expect(runKeyParts).toContain('step-19c-ms-overfetch:6.0');
    expect(resultKeyParts).toContain('step-19c-ms-overfetch:6.0');
  });

  it('omits Step 19 tags when none are set (baseline preserved)', () => {
    const { runKeyParts } = computeCaseRunKeyParts(baseConfig, 'case-1');
    expect(runKeyParts.some((p) => typeof p === 'string' && p.startsWith('step-19'))).toBe(false);
  });
});
```

- [ ] **Step 4: Run new tests**

Run: `pnpm vitest run tests/step15ObservationalMemory.wiring.spec.ts`. Expect: 4 new tests pass + all existing 41+ pass.

---

### Task 3: Add 3 CLI flags

**Files:** `src/cli.ts` (around the existing `--om-classifier-fewshot` flag)

- [ ] **Step 1: Locate the OM CLI flag block**

Run: `grep -n "om-classifier-fewshot\|om-guided-retrieval-k" src/cli.ts`. The Step 19 flags are added near these.

- [ ] **Step 2: Add 3 flags**

```typescript
.option(
  '--om-retriever-ms-k <n>',
  'Step 19A: per-case readerTopK override for MS-classified cases (v10 router only). Default 10. Set to 30 for K=30 MS retrieval.',
  parseInteger,
)
.option(
  '--om-retriever-ms-bm25-weight <w>',
  'Step 19B: per-case BM25 weight in RRF for MS-classified cases (v10 router only). Default RRF dense=0.7/sparse=0.3. Set to 0.7 for BM25-heavy MS retrieval.',
  parseFloatArg,
)
.option(
  '--om-retriever-ms-overfetch <m>',
  'Step 19C: per-case over-fetch multiplier for MS-classified cases (v10 router only). Default 3. Set to 6 for K=60 over-fetch on MS cases.',
  parseFloatArg,
)
```

- [ ] **Step 3: Wire the flag values into RunConfig at command construction**

Find where `omClassifierFewshot: opts.omClassifierFewshot` is set in the run command's RunConfig assembly. Add three lines:

```typescript
omRetrieverMsKOverride: opts.omRetrieverMsK,
omRetrieverMsBm25Weight: opts.omRetrieverMsBm25Weight,
omRetrieverMsOverFetchMultiplier: opts.omRetrieverMsOverfetch,
```

- [ ] **Step 4: Wire into resolveRunConfig** (`src/core/BenchmarkRunner.ts`)

Find `resolveRunConfig` and add the three pass-through lines:

```typescript
omRetrieverMsKOverride: cfg.omRetrieverMsKOverride,
omRetrieverMsBm25Weight: cfg.omRetrieverMsBm25Weight,
omRetrieverMsOverFetchMultiplier: cfg.omRetrieverMsOverFetchMultiplier,
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`. Expect: silent exit 0.

---

### Task 4: Per-case retriever override in `LongMemEvalS.runCase`

**Files:** `src/benchmarks/longmemeval/LongMemEvalS.ts` (canonical-route branch)

- [ ] **Step 1: Read the canonical-route branch**

Run: `grep -n "useOmBranch\|runFullCognitiveCase\|recallTopK" src/benchmarks/longmemeval/LongMemEvalS.ts | head -20`. Find the canonical branch (where `useOmBranch === false`).

- [ ] **Step 2: Inspect runFullCognitiveCase signature**

Run: `grep -n "export async function runFullCognitiveCase\|recallTopK:.*number" src/benchmarks/longmemeval/LongMemEvalS.ts`. Note: existing parameters that `runFullCognitiveCase` accepts. The Step 19 implementation needs to either pass overrides through or shim the override at the call site.

**If `runFullCognitiveCase` accepts a `recallTopK` parameter:** override it conditionally per case.

**If it doesn't:** the implementation needs to either modify the signature (adding `overrideRecallTopK?: number`, `overrideOverFetchMultiplier?: number`, `overrideBm25Weight?: number`) OR construct a fresh HybridRetriever per call when overrides are present (more expensive setup).

- [ ] **Step 3: Add the conditional override logic**

In the canonical-route branch of `runCase`, before the call to `runFullCognitiveCase`, compute per-case overrides:

```typescript
// Step 19: per-case retriever overrides for MS-classified cases.
const isMsClassified = routerCategory === 'multi-session';
const effectiveRecallTopK = isMsClassified && typeof ctx.config.omRetrieverMsKOverride === 'number'
  ? ctx.config.omRetrieverMsKOverride
  : recallTopK;
const effectiveOverFetchMultiplier = isMsClassified && typeof ctx.config.omRetrieverMsOverFetchMultiplier === 'number'
  ? ctx.config.omRetrieverMsOverFetchMultiplier
  : undefined; // undefined → use HybridRetriever default (3x)
const effectiveBm25Weight = isMsClassified && typeof ctx.config.omRetrieverMsBm25Weight === 'number'
  ? ctx.config.omRetrieverMsBm25Weight
  : undefined; // undefined → use RRF default (0.3 sparse / 0.7 dense)

// Record what was applied so the run JSON metadata reflects the override.
if (isMsClassified) {
  if (typeof ctx.config.omRetrieverMsKOverride === 'number') runMetadata.omRetrieverMsKOverride = ctx.config.omRetrieverMsKOverride;
  if (typeof ctx.config.omRetrieverMsBm25Weight === 'number') runMetadata.omRetrieverMsBm25Weight = ctx.config.omRetrieverMsBm25Weight;
  if (typeof ctx.config.omRetrieverMsOverFetchMultiplier === 'number') runMetadata.omRetrieverMsOverFetchMultiplier = ctx.config.omRetrieverMsOverFetchMultiplier;
}
```

Then pass `effectiveRecallTopK`, `effectiveOverFetchMultiplier`, `effectiveBm25Weight` to `runFullCognitiveCase` (depending on Step 2 outcome — either via existing parameters or a new shim).

- [ ] **Step 4: Run typecheck + build**

Run: `pnpm typecheck && pnpm build`. Expect: silent exit 0 for both.

- [ ] **Step 5: Add a unit test** for the per-case override decision logic (if it's pure-function-extractable).

Optional but encouraged: extract the `compute effective overrides` block into a pure function `computeStep19Overrides(routerCategory, config) → { recallTopK, overFetchMultiplier, bm25Weight }` and unit-test it.

---

### Task 5: Phase 1 framework gate

- [ ] **Step 1: Full typecheck + tests**

```bash
cd packages/agentos-bench
pnpm typecheck   # expect silent exit 0
pnpm vitest run  # expect 405+ tests pass (401 existing + 4 new wiring tests)
pnpm build       # expect silent exit 0
```

- [ ] **Step 2: Verify dist files**

```bash
grep -c "omRetrieverMs" dist/core/BenchmarkRunner.js  # expect ≥ 6 (3 fingerprints x 2 keys)
grep -c "omRetrieverMs" dist/benchmarks/longmemeval/LongMemEvalS.js  # expect ≥ 3
```

**STOP HERE for explicit user approval before firing Phase 2 LLM-cost runs.**

---

## Phase 2 — Fire 3 Tier A variants (~$45 LLM, requires explicit user approval)

### Task 6: Variant A — K-override Tier A

- [ ] **Step 1: Confirm explicit user approval to fire ~$10**

- [ ] **Step 2: Fire**

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
set -a && source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env && set +a
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --observational-memory \
  --om-mode dual-path --om-batch-tokens 24000 \
  --om-reader-scaffold --om-observer-model gpt-4o \
  --om-dynamic-router --om-classifier-fewshot \
  --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
  --reader-top-k 10 \
  --om-retriever-ms-k 30 \
  --bootstrap-resamples 10000 --seed 42 \
  --max-usd 30 \
  --sample-per-type 4
```

Expected: ~24 cases, ~$10. Run JSON has `metadata.omRetrieverMsKOverride: 30` on MS cases (verify via probe).

---

### Task 7: Variant B — BM25-heavy RRF Tier A

- [ ] **Step 1: Confirm explicit user approval to fire ~$15**

- [ ] **Step 2: Fire**

Same flags as Task 6 but replace `--om-retriever-ms-k 30` with `--om-retriever-ms-bm25-weight 0.7`.

---

### Task 8: Variant C — Wider over-fetch Tier A

- [ ] **Step 1: Confirm explicit user approval to fire ~$15**

- [ ] **Step 2: Fire**

Same flags as Task 6 but replace `--om-retriever-ms-k 30` with `--om-retriever-ms-overfetch 6.0`.

---

## Phase 3 — Diagnose + pick winner (no LLM)

### Task 9: Compare 3 variants vs baseline

- [ ] **Step 1: Probe per-stage retention deltas**

Use the existing per-correctness analysis script pattern from Step 18 to compare:

- v10 baseline (run JSON `2026-04-23T09-25-56-244`)
- v10 Variant A
- v10 Variant B
- v10 Variant C

Focus questions:
1. Did Variant X lift MS rawToRetrieved by ≥ 10pp vs baseline?
2. Did MS aggregate accuracy improve at Tier A?
3. Did per-correctness gap on MS widen (correct retention up, wrong retention down)?
4. Did any other category regress > 5pp?

- [ ] **Step 2: Pick winner**

Per kill criteria §6.2: Variant with highest MS accuracy lift AND no other category regressed > 5pp ladders to Phase A. If ≥ 2 variants tie, pick the one with the cleanest per-correctness signal.

- [ ] **Step 3: Update Step 19 findings doc** at `docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_{YYYY-MM-DD}.md`

---

## Phase 4 — Phase A on winner (~$30-50, requires explicit user approval)

### Task 10: Phase A on winning variant

- [ ] **Step 1: Confirm explicit user approval**

- [ ] **Step 2: Fire**

Same flags as winning variant + `--sample-per-type 17 --max-usd 100`.

- [ ] **Step 3: Apply Phase A kill criteria**

Per existing kill ladder: < canonical + 5pp at point estimate OR McNemar p ≥ 0.05 → STOP, do not fire Phase B.

---

## Phase 5 — Phase B (conditional, requires explicit user approval)

### Task 11: Phase B v10 + winning Step 19 variant

ONLY EXECUTE if Phase A passes kill gate.

- [ ] **Step 1: Re-confirm user approval** (~$120-150)

- [ ] **Step 2: Fire** with `--max-usd 250` and no `--sample` flag.

- [ ] **Step 3: Update LEADERBOARD + bench blog if shipping tier shifts**

---

## Self-review checklist

1. **Spec coverage:** All §2-§7 of the spec map to tasks here. Phase 1 = Tasks 1-5; Phase 2 = Tasks 6-8; Phase 3 = Task 9; Phase 4 = Task 10; Phase 5 = Task 11.
2. **Placeholder scan:** No "TBD", "TODO", or vague requirements. The HybridRetriever-doesn't-accept-overrides contingency in Task 4 is explicitly called out with a fallback (construct fresh HybridRetriever per call).
3. **Type consistency:** `omRetrieverMsKOverride: number`, `omRetrieverMsBm25Weight: number`, `omRetrieverMsOverFetchMultiplier: number` used consistently across RunConfig, CLI, fingerprint tags, runMetadata.
4. **Commands verified:** `pnpm bench run` is the canonical pattern (verified in Step 18 plan). `--sample-per-type 4` = Tier A N=24 (verified). All env loading via `source apps/wilds-ai/.env`.

---

End of plan.
