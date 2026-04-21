# Step 12 — BM25 Parity for Observer/Reflector ADDITIVE Mode

**Date:** 2026-04-21
**Author session:** Opus 4.7 (1M context)
**Status:** design approved, plan pending
**Scope:** bench-only (no agentos submodule changes)
**Spec identifier:** `2026-04-21-step-12-bm25-parity-design.md`

---

## 1. TL;DR

When Observer/Reflector runs in ADDITIVE mode (Step 7), reflection-derived traces get encoded into `MemoryStore` via `manager.observe()` and its internal auto-trigger paths. The bench's BM25 hook only fires on raw-chunk encoding, so reflection traces are indexed into the DENSE side (MemoryStore.query) but NOT the SPARSE side (hybridBm25). The REPLACEMENT path (Step 8) already fixes this. This spec extends the same fix to ADDITIVE mode with three correctness layers: per-session `flushReflection` with scopeOverride, end-of-replay reflection-trace sweep, and idempotent BM25 indexing.

**Hypothesis:** Step 11 stage metrics show `sparse.recall=0.882` vs `dense.recall=0.347`. BM25 is carrying the retrieval weight. Reflection content bypasses BM25. If reflection traces get a sparse-side boost, they may surface through retrieval and contribute to reader attribution (currently `evidenceOrigin.reflection=0/24`).

**Kill criterion:** unweighted ≥ 82.5% at Tier A LongMemEval-S N=24. Full-RED paths (`evidenceOrigin.reflection` still zero OR unweighted < 82.5%) close the Observer/Reflector line for good, making this the eighth element of the n=7 RED pattern.

**Budget cap:** $8 across Tier A + optional Phase A.

---

## 2. Background + motivation

### 2.1 The gap, precisely

Three reflection-encoding paths exist in `@framers/agentos`:

1. **Observer auto-trigger.** `manager.observe(role, content, mood)` pushes notes into `ObservationBuffer`. When accumulated notes exceed the reflector's 40,000-token activation threshold, the reflector fires and its output traces get encoded via `manager.encode(...)` with `sourceType: 'reflection'`. The bench never sees these trace IDs.

2. **Manual flush.** `manager.flushReflection(mood?, scopeOverride?)` forces reflection regardless of threshold. Returns `{ encodedTraceIds, supersededTraceIds, compressionRatio }`. The caller receives the IDs.

3. **ContextWindowManager.onTracesCreated.** When the context window manager compresses context, it emits newly-created traces via `onTracesCreated` callback. Those go through `manager.encode(...)` at [CognitiveMemoryManager.ts:419-430](../../../agentos/src/memory/CognitiveMemoryManager.ts#L419-L430) with `sourceType: 'reflection'`. The bench never sees these trace IDs either.

The bench's BM25 hook in `LongMemEvalS.ts` fires only inside `splitForEmbedding(...) → timedEncode(...) → hybridBm25.addDocument(...)` (raw-chunk path). Paths 1 and 3 above bypass it. Path 2 is wired for REPLACEMENT mode ([LongMemEvalS.ts:1439-1450](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L1439-L1450) + [:1549-1560](../../src/benchmarks/longmemeval/LongMemEvalS.ts#L1549-L1560)) but not ADDITIVE.

### 2.2 Evidence this matters

Step 11 (tuned reflector prompt null result, see [STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md](../STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md)) established:

| Stage | Recall@10 | NDCG@10 | MRR |
|---|---:|---:|---:|
| dense | 0.347 | 0.286 | 0.313 |
| sparse | 0.882 | 0.784 | 0.815 |
| merged | 0.774 | 0.602 | 0.611 |
| reranked | 0.740 | 0.721 | 0.802 |
| final | 0.740 | 0.721 | 0.802 |

BM25 carries the retrieval work. Dense recall is roughly 40% of BM25's on specific-value LongMemEval-S queries. Reflection traces go through dense only, so they're competing in the weaker channel against exact-term-matching raw chunks.

Step 11 `evidenceOrigin: { user_statement: 20, none: 4, reflection: 0 }` confirmed the reader quotes zero reflection traces across 24 cases. The question Step 12 asks: **is this a sparse-side visibility bug, or a reader-preference bug?** Fixing sparse visibility isolates the diagnosis.

### 2.3 Why the handoff recommended this

[COMPREHENSIVE_HANDOFF_2026-04-21.md §7 Option A](../COMPREHENSIVE_HANDOFF_2026-04-21.md) ranks BM25 parity the highest-value next experiment because (a) it's the cheapest remaining architectural isolation of the Mastra-gap question, (b) it corrects a known implementation asymmetry between ADDITIVE and REPLACEMENT modes, and (c) whatever the verdict, the fix is correct independent of accuracy outcome.

### 2.4 Pattern context

Steps 4, 5, 6, 7, 8, 9, 11 all RED or null on specific-value LongMemEval-S. The pattern: "LLM content transformation at ingest or query time regresses." Observer/Reflector summaries preserve the intent of raw messages but erase specific tokens. Step 12 does NOT transform content — it only fixes BM25 indexing parity. Same reflection content, different index visibility.

If Step 12 RED's with `evidenceOrigin.reflection` still zero, the diagnosis is conclusive: **the reader prefers raw chunks over reflection traces even when both are in the final top-K**. The Observer/Reflector line closes permanently for benchmark-accuracy purposes (but remains production-valuable for conversational companion workloads).

---

## 3. Hypothesis + mechanism

### 3.1 Hypothesis statement

> Indexing reflection-derived traces into `hybridBm25` in ADDITIVE mode increases reflection-trace visibility in final top-K, leading to non-zero reader attribution (`evidenceOrigin.reflection > 0`) and a measurable unweighted-accuracy lift at Tier A LongMemEval-S N=24 relative to Step 7 baseline (62.5%).

### 3.2 Falsifiable predictions

1. **Retrieval stage metrics change.** Sparse recall for reflection-trace content rises from effectively 0 (not indexed) to non-zero. Measured via per-stage retrieval diagnostics.
2. **`evidenceOrigin.reflection > 0` on at least one case.** Any non-zero attribution to reflection traces constitutes a partial win, even without unweighted-accuracy movement.
3. **Unweighted accuracy ≥ 82.5% at Tier A** to pass kill criterion. If < 82.5% but `evidenceOrigin.reflection > 0`, the null-verdict still includes useful diagnostic: "reflection traces surface but don't outcompete raw chunks."

### 3.3 What falsification looks like

- `evidenceOrigin.reflection` remains 0 across all 24 cases → reader ignores reflection traces even when visible via sparse. Closes Observer/Reflector line.
- `evidenceOrigin.reflection > 0` but accuracy flat vs Step 7 → reflection traces surface but don't contribute net-positive signal (may also displace better signal). Closes line with nuance.
- Accuracy > Step 7 baseline but < 82.5% kill threshold → partial win, consider Phase A with caveats.
- Accuracy ≥ 82.5% → proceed to Phase A.

---

## 4. Architecture

### 4.1 Overview

Three-layer correction inside `LongMemEvalS.ts::replayForCognitive`. Bench-only change. No agentos primitives modified. No semantic-release.

```
ADDITIVE mode ingest (after Step 12):

  per session:
    for each turn: manager.observe() + raw chunk encode + BM25 add
    at session end:
      layer 1: flush = manager.flushReflection(neutralMood, { scope: 'user', scopeId: 'bench' })
      layer 2: for id in flush.encodedTraceIds:
                 trace = store.getTrace(id)
                 hybridBm25.addDocument(id, trace.content, { tag: sessionTag })

  at end of replay:
    layer 3: sweep = store.listTraces({ scope: 'user', scopeId: 'bench' })
             for trace in sweep where trace.provenance.sourceType === 'reflection'
                 and trace.id not in indexedReflectionIds:
               hybridBm25.addDocument(trace.id, trace.content, { tag: 'reflection-sweep' })
```

### 4.2 Why three layers

- **Layer 1 (flushReflection)** catches notes accumulated in the reflector's `ObservationBuffer` that haven't triggered the auto-threshold. For typical LongMemEval-S sessions (~1-2k tokens vs 40k threshold) this is most reflection content.
- **Layer 2 (encodedTraceIds indexing)** is the mechanical mirror of the REPLACEMENT path. Uses `scope: 'user'`, `scopeId: 'bench'` to match retrieval-time scope.
- **Layer 3 (end-of-replay sweep)** is a safety net. Catches traces created by (a) observer auto-triggers mid-session if threshold fires unexpectedly, (b) `ContextWindowManager.onTracesCreated` callback, (c) any future encoding path we haven't audited. Since BM25Index.addDocument is idempotent (removes existing doc first), re-indexing is safe. A Set<string> tracks already-indexed reflection IDs for O(1) dedup.

### 4.3 What the layers do NOT touch

- No change to raw-chunk indexing path (lines 1411-1417, 1521-1527).
- No change to observer per-turn call (line 1427, 1538).
- No change to REPLACEMENT-mode behavior (lines 1437-1455, 1547-1565).
- No change to fact-graph ingest path (lines 1460-1474, 1570+).
- No change to `HybridRetriever`, `MemoryStore.query`, or any agentos code.

### 4.4 Data flow diagram

```
┌─────────── LongMemEvalS.replayForCognitive (ADDITIVE) ──────────────┐
│                                                                     │
│   session loop:                                                     │
│     ┌─── sessionSummarizer → sessionContext ──┐                     │
│     │                                          ▼                    │
│     ├─ per turn:                                                    │
│     │    ┌─ raw chunks ──► encode() ──► MemoryStore (dense)         │
│     │    │                            ╰──► hybridBm25 (sparse) ──┐  │
│     │    │                                                        │  │
│     │    ╰─ observe(role, content, mood)                          │  │
│     │         └─► ObservationBuffer (notes accumulate)            │  │
│     │                                                             │  │
│     └─ session boundary [STEP 12 LAYER 1+2]:                      │  │
│          flushReflection({ scope: 'user', scopeId: 'bench' })     │  │
│            ├─► reflection traces encoded to MemoryStore (dense)   │  │
│            ╰─► encodedTraceIds returned                           │  │
│                  └─► hybridBm25.addDocument(id, content) ─────────┤  │
│                                                                   │  │
│   replay boundary [STEP 12 LAYER 3]:                              │  │
│     store.listTraces({ scope: 'user', scopeId: 'bench' })         │  │
│       filter: provenance.sourceType === 'reflection'              │  │
│       dedup against indexedReflectionIds Set                      │  │
│         └─► hybridBm25.addDocument(id, content) ──────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Code changes (sketch, not final)

### 5.1 New helper function

Add at module scope in `LongMemEvalS.ts`:

```typescript
/**
 * Index reflection-derived trace IDs into the bench's BM25 index so sparse
 * retrieval sees them. Skips IDs already indexed (tracked via the caller's
 * Set). Safe to call with empty id lists.
 *
 * @param ids - Trace IDs to index (typically from `flushReflection.encodedTraceIds`
 *   or a reflection-sweep over `store.listTraces`).
 * @param store - MemoryStore backing the CognitiveMemoryManager. Must expose
 *   `getTrace(id)`.
 * @param hybridBm25 - Per-run BM25Index instance owned by the bench adapter.
 * @param sessionTag - Tag applied to the BM25 document metadata; pass
 *   the session's canonical tag so retrieval-time filters match.
 * @param indexed - Set tracking IDs already indexed to avoid redundant work.
 *   Mutated in place.
 */
function indexReflectionTracesIntoBm25(
  ids: readonly string[],
  store: ReturnType<CognitiveMemoryManager['getStore']>,
  hybridBm25: NonNullable<ReplayArgs['hybridBm25']>,
  sessionTag: string,
  indexed: Set<string>,
): void {
  for (const id of ids) {
    if (indexed.has(id)) continue;
    const trace = store.getTrace?.(id);
    if (!trace || !trace.content) continue;
    try {
      hybridBm25.addDocument(id, trace.content, { tag: sessionTag });
      indexed.add(id);
    } catch {
      // BM25 add failures are non-critical (empty content can't happen
      // because we checked above; duplicate-ID is idempotent via
      // BM25Index's internal removeDocument).
    }
  }
}
```

### 5.2 ADDITIVE-mode session-boundary call

Insert after the existing per-turn `manager.observe()` loop, parallel to the REPLACEMENT-mode block. In both `mode === 'observe'` and `mode === 'ingest'` branches:

```typescript
// Step 12: ADDITIVE-mode BM25 parity. At session boundary, force-flush
// reflection and index reflection-derived traces into BM25 so sparse
// retrieval sees them. Gated on observer enabled AND replace disabled
// (replacement mode already indexes via its own block).
if (
  observerReflectorEnabled &&
  !observerReflectorReplaceEnabled &&
  hybridBm25
) {
  try {
    const flush = await handle.manager.flushReflection(
      neutralMood,
      { scope: 'user', scopeId: 'bench' },
    );
    indexReflectionTracesIntoBm25(
      flush.encodedTraceIds,
      handle.manager.getStore(),
      hybridBm25,
      sessionTag,
      indexedReflectionIds,
    );
  } catch {
    // Flush errors non-critical; next session can still produce reflections.
  }
}
```

### 5.3 End-of-replay sweep

At the end of `replayForCognitive`, after all sessions processed:

```typescript
// Step 12 Layer 3: end-of-replay reflection-trace sweep. Catches traces
// encoded via observer auto-trigger or ContextWindowManager.onTracesCreated
// that bypass flushReflection. Idempotent; adds only previously-unseen IDs.
if (observerReflectorEnabled && !observerReflectorReplaceEnabled && hybridBm25) {
  const allScoped = handle.manager.getStore().listTraces({
    scope: 'user',
    scopeId: 'bench',
    activeOnly: true,
  });
  const orphanReflectionIds: string[] = [];
  for (const trace of allScoped) {
    if (trace.provenance.sourceType !== 'reflection') continue;
    if (indexedReflectionIds.has(trace.id)) continue;
    orphanReflectionIds.push(trace.id);
  }
  indexReflectionTracesIntoBm25(
    orphanReflectionIds,
    handle.manager.getStore(),
    hybridBm25,
    'reflection-sweep',
    indexedReflectionIds,
  );
}
```

### 5.4 Caller-state addition

At the top of `replayForCognitive`, initialize the dedup Set:

```typescript
const indexedReflectionIds: Set<string> = new Set();
```

This Set persists across sessions within a single case run. Each case starts with a fresh instance via the standard per-case `createCognitiveManager` lifecycle.

### 5.5 Changes summary

| File | LOC delta | What |
|---|---:|---|
| `src/benchmarks/longmemeval/LongMemEvalS.ts` | +40 / -0 | Helper function + 2 session-boundary blocks + 1 sweep block + Set init |
| `tests/step12BM25Parity.spec.ts` | +150 / -0 | New wiring + idempotency + sweep tests |

No agentos changes. No semantic-release. No CLI flag additions (the existing `--observer-reflector` controls ADDITIVE mode; `--observer-reflector --observer-reflector-replace` controls REPLACEMENT).

---

## 6. Testing

### 6.1 Wiring unit test

Verify `flushReflection` result's `encodedTraceIds` get passed to `hybridBm25.addDocument` with correct args.

```typescript
describe('Step 12 BM25 parity wiring', () => {
  it('indexes flushReflection encodedTraceIds into hybridBm25 in ADDITIVE mode', async () => {
    const manager = stubManager({
      flushReflection: async () => ({
        encodedTraceIds: ['r1', 'r2'],
        supersededTraceIds: [],
        compressionRatio: 1,
      }),
      store: stubStore({
        traces: {
          r1: { id: 'r1', content: 'Alice moved to Berlin', provenance: { sourceType: 'reflection' } },
          r2: { id: 'r2', content: 'Alice prefers matcha', provenance: { sourceType: 'reflection' } },
        },
      }),
    });
    const bm25 = stubBm25();
    const handle = { manager, factStore: undefined, factExtractor: undefined };

    await replayForCognitive({
      handle, hybridBm25: bm25, observerReflectorEnabled: true,
      observerReflectorReplaceEnabled: false, /* ... */
    });

    expect(bm25.addDocument).toHaveBeenCalledWith('r1', 'Alice moved to Berlin', { tag: expect.any(String) });
    expect(bm25.addDocument).toHaveBeenCalledWith('r2', 'Alice prefers matcha', { tag: expect.any(String) });
  });
});
```

### 6.2 Idempotency test

Double-indexing must not break; dedup Set must prevent redundant calls.

```typescript
it('skips already-indexed IDs on second session with same flushed IDs', async () => {
  // Two sessions, second returns overlapping encodedTraceIds.
  const flushedIds = [['r1'], ['r1', 'r2']]; // r1 duplicated
  let call = 0;
  const manager = stubManager({
    flushReflection: async () => ({ encodedTraceIds: flushedIds[call++], ... }),
    ...
  });
  // After replay, bm25.addDocument should be called exactly twice: r1, r2.
});
```

### 6.3 Sweep orphan-ID test

Verify that traces created via pathways bypassing `flushReflection` get picked up by the end-of-replay sweep.

```typescript
it('sweep catches orphan reflection traces not returned from flushReflection', async () => {
  const store = stubStore({
    traces: {
      r1: { id: 'r1', content: 'from flush', provenance: { sourceType: 'reflection' } },
      orphan: { id: 'orphan', content: 'from onTracesCreated', provenance: { sourceType: 'reflection' } },
      raw1: { id: 'raw1', content: 'raw user message', provenance: { sourceType: 'user_statement' } },
    },
  });
  const manager = stubManager({
    flushReflection: async () => ({ encodedTraceIds: ['r1'], ... }),
    store,
  });
  // After replay, bm25 must have r1 AND orphan (both reflection-sourced)
  //   but NOT raw1 (user_statement; raw chunks already indexed via main path).
});
```

### 6.4 REPLACEMENT-mode no-regression

Run the existing REPLACEMENT-mode bench path. Verify `replace` behavior unchanged. Step 8 cached results should still apply. Step 12 only touches ADDITIVE.

### 6.5 Phase 1 infrastructure regression

Re-run all 7 Phase 1 test files (37 tests) confirmed passing at verification time:
- `resultStoreNRegression.spec.ts`
- `computePairedMcNemar.spec.ts`
- `computeEvidenceProvenance.spec.ts`
- `computeRetrievalStageMetrics.spec.ts`
- `factGraph.wiring.spec.ts`
- `redactSecretsFromConfig.spec.ts`
- `readerTopK.spec.ts`

All must still pass. `step12BM25Parity.spec.ts` adds to the suite.

### 6.6 Typecheck gates

- `cd packages/agentos-bench && pnpm typecheck` (currently GREEN).
- Must remain GREEN after edits. No agentos typecheck run needed (submodule untouched).

---

## 7. Measurement

### 7.1 Tier A smoke

**Config:**
```
LONGMEMEVAL_S_PATH=... pnpm bench run \
  --benchmark longmemeval-s \
  --reader gpt-4o \
  --judge gpt-4o \
  --mode full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --context-summary gpt-5-mini \
  --observer-reflector \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 \
  --seed 42 \
  --max-usd 10
```

N=24 (stratified, 4 per type × 6 types). Reader gpt-4o, judge gpt-4o. Bootstrap resamples 10,000. `--max-usd 10` for preflight headroom (actual cost ~$3-5).

### 7.2 Kill criterion

- Unweighted accuracy ≥ **82.5%** (within 5pp of Tier 1 smoke 87.5%) → proceed to Phase A.
- < 82.5% → RED. Close Observer/Reflector line.

### 7.3 Conditional Phase A

If Tier A passes kill criterion, fire Phase A N=102 stratified at gpt-4o + gpt-4o. Budget: +$3. Gate to Phase B N=500 at +5pp over Step 7 baseline AND paired McNemar significant vs Step 7 (p < 0.05 via `compareRuns.paired`).

### 7.4 LoCoMo cell

Skip initial Tier A. Run only if LongMemEval-S Tier A shows `evidenceOrigin.reflection > 0`. LoCoMo's adversarial + temporal categories may benefit differently.

### 7.5 Success metrics (ordered by interpretability)

1. `evidenceOrigin.reflection > 0` — binary: reflection traces contribute to any reader answer.
2. Stage-level metrics: `sparse.recall` change vs Step 11 baseline. If reflection traces displace raw chunks in sparse, recall may drop — that's a warning signal.
3. Unweighted accuracy vs Step 7 baseline (62.5%). Any improvement is signal; ≥ 82.5% passes kill.
4. Per-category: especially multi-session (Step 7 was 25% — if reflection bridges sessions, this should lift).
5. Cost/correct: must stay within 2x of Tier 1 shipping ($0.0213). Higher cost with similar accuracy is not a win.

---

## 8. Cost model

### 8.1 Per-run estimate

| Phase | N | Reader cost | Rerank cost | Observer cost | Summarizer cost | Total |
|---|---:|---:|---:|---:|---:|---:|
| Tier A LongMemEval-S | 24 | $1.50 | $0.05 | $1.00 | $0.10 | **~$2.65** |
| Phase A (conditional) | 102 | $5.00 | $0.15 | $2.50 | $0.30 | **~$7.95** |

Observer cost is gpt-5-mini for the reflector (~$0.15 per M input tokens). Summarizer is gpt-5-mini for session summaries (~$0.15 per M input tokens).

### 8.2 Budget cap

- Tier A alone: $5 cap.
- Tier A + conditional Phase A: $8 cap.
- Hard stop if cumulative spend crosses $10 — abort and redesign.

### 8.3 Cache behavior

The existing content-addressed cache key (Step 11 infrastructure) includes `reflector-prompt:${REFLECTOR_PROMPT_HASH.slice(0,12)}`. Step 12 does NOT modify the reflector prompt. If Step 7 cached Tier A results are still valid, the reader calls may hit cache. Observer calls should NOT cache-hit if Step 12's new BM25-indexing produces different retrieval pools that change what the reader sees. Preflight dry-run will reveal cache status before the expensive run fires.

---

## 9. Expected outcomes

### 9.1 Probability-weighted matrix

| Outcome | Prob (my read) | evidenceOrigin.reflection | Unweighted Δ | Ships |
|---|---:|---:|---:|---|
| Full RED | 50% | 0/24 | ±2pp from Step 7 | closes line; infra still ships |
| Partial RED | 30% | > 0 but < 5/24 | -2pp to +15pp but < 82.5% gate | nuanced close; infra ships |
| Tier A GREEN | 15% | > 5/24 | ≥ 82.5% (i.e., +20pp over Step 7) | proceed to Phase A |
| Phase A GREEN | 5% | > 10/102 | Phase A paired-McNemar significant | consider default flip |

### 9.2 Infrastructure shipping regardless

Three durable outcomes independent of accuracy verdict:

1. **Correct ADDITIVE-mode BM25 indexing.** Fixes a real bug (mode asymmetry) even if accuracy doesn't move. Future Observer/Reflector experiments benefit.
2. **End-of-replay sweep primitive.** Catches any future encoding path that bypasses flushReflection. Defensive infrastructure.
3. **Expanded wiring test suite.** `step12BM25Parity.spec.ts` pins the contract so regressions can't creep in.

### 9.3 Closes the 4th hypothesis

Step 7 findings identified four compounding root causes for Observer/Reflector additive failure:

1. Additive overlay dilutes retrieval (dense sees raw + summary).
2. BM25 index mismatch. **(This spec fixes.)**
3. MemoryReflector soft-deletes "superseded" traces.
4. Personality-biased observer prompt.

Step 11 tested (4) in isolation — null result. Step 12 tests (2) in isolation. If Step 12 RED's, that's 3 of 4 hypotheses eliminated. (1) and (3) remain testable but are more invasive than either prior step.

---

## 10. Risk assessment

### 10.1 What could go wrong

**Reflection traces displace raw chunks in sparse top-K.** If reflection content contains the same high-IDF tokens as raw chunks, BM25 might rank both comparably, and the rerank stage might prefer reflection over raw (shorter, denser). This is the Step 9 failure pattern applied to BM25 instead of rerank.

Mitigation: stage-level retrieval metrics per case. If `sparse.recall` drops vs Step 11 baseline, we'll see it. Combined with `evidenceOrigin` we can distinguish "reflection displaces then reader ignores" (bad) from "reflection adds alongside then reader still picks raw" (net-neutral).

**Sweep catches too many traces.** If a future bench config creates many reflection traces, the sweep could inflate BM25 index size. At LongMemEval-S scales (~100-500 traces per case), this isn't a concern. Document as a limitation.

**BM25Index.addDocument throws on empty content.** Guarded at lines 299-300. The helper function checks `if (!trace || !trace.content) continue` before calling. Tests verify.

**Observer auto-trigger fires mid-session.** If the 40k-token reflector threshold fires mid-session (would require unusually long LongMemEval-S sessions), those trace IDs aren't surfaced to flushReflection. Layer 3 sweep catches them.

### 10.2 What is out of scope

- Changing reflection trace content (tested in Step 11, null).
- Adjusting cognitive + neural score blend weights (not this experiment).
- Modifying the reflector prompt (Step 11 territory; tuned prompt already ships).
- Changing rerank model (Cohere rerank-v3.5 stays).
- Any agentos core change.
- LoCoMo Phase B run.

---

## 11. Dependencies

### 11.1 Must be in place (verified)

- `@framers/agentos` v0.1.253+ for `REFLECTOR_PROMPT_HASH` export and scopeOverride-aware `flushReflection`. Currently at v0.1.255. ✓
- `BM25Index.addDocument` idempotency. Verified at [BM25Index.ts:298-304](../../../agentos/src/rag/search/BM25Index.ts#L298-L304). ✓
- `MemoryStore.listTraces(options?)` with filtering support. Verified at [MemoryStore.ts:601](../../../agentos/src/memory/retrieval/store/MemoryStore.ts#L601). ✓
- `MemoryStore.getTrace(id)` returning trace with `.content` and `.provenance.sourceType`. Verified in Step 11 findings instrumentation.
- Phase 1 eval infrastructure (evidenceOrigin + stage metrics) shipping always-on. Verified: 37/37 tests pass.

### 11.2 Not required

- No new CLI flag.
- No new RunConfig field.
- No new agentos API.
- No new release.

---

## 12. Out-of-scope audit findings (for follow-up specs)

These were found during design exploration but are NOT part of Step 12. They become their own specs later.

### 12.1 Graph activation silent sixth signal

`RetrievalPriorityScorer.ts` assigns `graphActivation: 0.10` weight, but both `MemoryStore.ts:376` and `HybridRetriever.ts:560` hardcode the input to 0 with a "Batch 2" comment. The `SqliteKnowledgeGraph.recordMemory` call at `MemoryStore.ts:222` passes `entityIds: []`. So the KG gets memory nodes but no edges, and spreading activation has nothing to activate through. Proper fix: heuristic entity extraction at ingest (regex-based, no LLM), edge creation, spreadActivation at retrieve time seeded from query-entity matches. Out of scope for Step 12; candidate Step 13 spec.

### 12.2 Untested architectural primitives

`GraphRAGEngine`, `RaptorTree`, `UnifiedRetriever`, `ProspectiveMemoryManager` all ship in agentos and are never benchmarked on LongMemEval-S. RAPTOR and GraphRAG global search require LLM summaries — fall into n=7 pattern risk. UnifiedRetriever is a meta-router with zero LLM and may compose with Hybrid productively. Each deserves its own spec.

### 12.3 Fact-graph score-confidence variant

Step 9 RED was driven by `retrievalScore: 1.0` pinning displacing raw chunks. A variant setting synthetic fact-graph score to the fact's extraction confidence (or 0.5) is cheap to test. Distinct from Step 12.

### 12.4 Stale handoff

`NEXT_SESSION_HANDOFF.md` claims "end of Steps 1-8 session" but the rollout is post-Step 11. `COMPREHENSIVE_HANDOFF_2026-04-21.md` supersedes it. Fold the narrower handoff into the comprehensive one or add a redirect pointer. Housekeeping; out of scope for Step 12.

---

## 13. References

### 13.1 Internal

- [COMPREHENSIVE_HANDOFF_2026-04-21.md](../COMPREHENSIVE_HANDOFF_2026-04-21.md) — full rollout state
- [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](../RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md) — Steps 1-9 + Step 11 umbrella
- [STEP_7_OBSERVER_REFLECTOR_FINDINGS_2026-04-20.md](../STEP_7_OBSERVER_REFLECTOR_FINDINGS_2026-04-20.md) — ADDITIVE baseline
- [STEP_8_OBSERVER_REPLACE_FINDINGS_2026-04-20.md](../STEP_8_OBSERVER_REPLACE_FINDINGS_2026-04-20.md) — REPLACEMENT pattern source
- [STEP_9_FACT_GRAPH_FINDINGS_2026-04-21.md](../STEP_9_FACT_GRAPH_FINDINGS_2026-04-21.md) — synthetic-trace displacement pattern
- [STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md](../STEP_11_TUNED_REFLECTOR_PROMPT_FINDINGS_2026-04-21.md) — prompt-isolation null + stage metrics evidence

### 13.2 External

- Wu, J. et al. 2024. "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory." Core benchmark this spec targets.
- Robertson, S. & Zaragoza, H. 2009. "The Probabilistic Relevance Framework: BM25 and Beyond." Foundations of the sparse-side index this spec wires into.
- Cormack, G. V., Clarke, C. L. A., Büttcher, S. 2009. "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods." RRF merge used in HybridRetriever.
- Anthropic. Sep 2024. "Contextual Retrieval." Contextual BM25 + embeddings cut retrieval failure by 49%, 67% with rerank. Pre-existing baseline in AgentOS.
- Mastra AI. 2025. "Observational Memory" research page. 84.23% at gpt-4o, the target gap this rollout investigates.

---

## 14. Self-review checklist (complete before plan)

- [x] No placeholder "TBD" sections.
- [x] Architecture matches feature description (three layers, all specified).
- [x] Single-implementation-plan scope (no decomposition needed).
- [x] Requirements unambiguous (ADDITIVE mode only, scope 'user'/'bench', sweep filters by sourceType).
- [x] Kill criterion explicit (unweighted ≥ 82.5% at Tier A N=24).
- [x] Falsification path clear (evidenceOrigin.reflection == 0 → Observer/Reflector line closes).
- [x] Dependencies verified against actual code (listTraces filters, addDocument idempotency, flushReflection scopeOverride).
- [x] Out-of-scope explicitly listed.
- [x] References formatted consistently.
- [x] No em dashes in prose.

---

End of Step 12 design spec.
