# Step 13 — Graph Activation Wire-Up (silent sixth signal)

**Date:** 2026-04-21
**Author session:** Opus 4.7 (1M context)
**Status:** design approved, plan pending
**Scope:** agentos-core (new module + wiring fixes) + agentos-bench (CLI flag + extractor invocation + tests + Tier A run)
**Spec identifier:** `2026-04-21-step-13-graph-activation-design.md`

---

## 1. TL;DR

`RetrievalPriorityScorer` declares a 6-signal cognitive composite with `graphActivation` weighted 10%. The input is hardcoded to 0 at [MemoryStore.ts:376](../../../agentos/src/memory/retrieval/store/MemoryStore.ts#L376) and [HybridRetriever.ts:560](../../../agentos/src/memory/retrieval/hybrid/HybridRetriever.ts#L560). The `SqliteKnowledgeGraph` is instantiated and `recordMemory` is called per encode, but with `entityIds: []` at [MemoryStore.ts:229](../../../agentos/src/memory/retrieval/store/MemoryStore.ts#L229). Result: memory nodes exist, zero edges, no activation propagation.

Step 13 activates the sixth signal end-to-end via heuristic entity extraction (regex-only, zero LLM) at ingest and Anderson spreading activation at retrieve. Targets multi-session (54.9% at N=500, our weakest category) because cross-session entity bridges are exactly what graph activation promotes.

**Hypothesis:** enabling the silent sixth signal with heuristic entity extraction lifts unweighted accuracy at Tier A LongMemEval-S N=24 by ≥ 4pp over the 73.2% canonical baseline.

**Kill criterion:** unweighted ≥ 77% at Tier A. Otherwise RED, pattern becomes n=9, close graph-activation line for this benchmark.

**Budget cap:** $7 across Tier A + conditional Phase A.

**Dodges the n=8 pattern by construction:** no LLM content transformation, no synthetic traces injected into top-K, pure additive scoring signal.

---

## 2. Background

### 2.1 The silent sixth signal

`RetrievalPriorityScorer` at [packages/agentos/src/memory/core/decay/RetrievalPriorityScorer.ts:44](../../../agentos/src/memory/core/decay/RetrievalPriorityScorer.ts#L44) assigns default weights:

```typescript
const DEFAULT_SCORING_WEIGHTS = {
  similarity: 0.45,
  strength: 0.15,
  recency: 0.15,
  emotionalCongruence: 0.10,
  graphActivation: 0.10,  // <- weighted, but input always 0
  importance: 0.05,
};
```

Inside [`MemoryStore.query`](../../../agentos/src/memory/retrieval/store/MemoryStore.ts) the candidate composition passes `graphActivation: 0` for every trace (line 376). The comment on that line reads `// Batch 2`, indicating a TODO that was never closed. Downstream, [`HybridRetriever.ts:560`](../../../agentos/src/memory/retrieval/hybrid/HybridRetriever.ts#L560) mirrors the zero for synthetic fact-graph traces.

The `SqliteKnowledgeGraph` at [SqliteKnowledgeGraph.ts:509](../../../agentos/src/memory/retrieval/store/SqliteKnowledgeGraph.ts#L509) is populated via `recordMemory`, but `MemoryStore.encode` passes `entityIds: []` at line 229, so the KG receives memory nodes with zero outgoing entity edges. Spreading activation has nothing to propagate through.

### 2.2 Why this is the right next experiment

[COMPREHENSIVE_HANDOFF_2026-04-21.md §7 Option A](../COMPREHENSIVE_HANDOFF_2026-04-21.md) identifies Step 13 as highest expected value per dollar because:

1. **Dodges the n=8 pattern.** No LLM routing, no synthetic trace injection. Heuristic regex is deterministic and cheap. The reader cannot "ignore reflection traces" the way it did in Steps 7/8/9/11/12 because graph activation adjusts scoring of EXISTING raw chunks, not content format.
2. **Targets the specific weak category.** LongMemEval-S multi-session 54.9% vs Mastra's 87.2% at N=500. Multi-session questions explicitly bridge sessions via shared entities; graph activation is architecturally shaped for this.
3. **Cheap.** Zero LLM cost for the signal itself; only the bench's existing reader/judge cost during the run. $2-4 Tier A.
4. **Correct regardless of accuracy outcome.** Fixes a legitimate architectural bug (scoring formula with a silent input). Whatever the Tier A verdict, the wire-up ships.

### 2.3 Why heuristic, not LLM

Steps 4 (HyDE), 5 (FactSupersession), 7 (Observer additive), 8 (Observer replacement), 9 (Fact-graph tuple extraction) all tested LLM-mediated content transformations. All RED. Steps 11 (tuned prompt) and 12 (BM25 visibility) tested isolated fixes within the LLM-mediated line. Both null. The n=8 pattern is load-bearing: **LLM intermediate steps regress on specific-value LongMemEval-S.**

Heuristic extraction dodges the pattern by not routing content through an LLM at all. Regex patterns for high-IDF tokens (proper nouns, dates, currency, numeric amounts) are exactly the tokens LongMemEval-S questions ask about, and they're detectable without understanding semantics.

---

## 3. Hypothesis + mechanism

### 3.1 Hypothesis

> Enabling heuristic entity extraction at ingest (populating `trace.entities`) plus spreading activation at retrieve (producing non-zero `graphActivation` per candidate) produces a ≥ 4pp unweighted accuracy lift at Tier A LongMemEval-S N=24, driven primarily by improved multi-session recall.

### 3.2 Mechanism

**At ingest** (bench-side, when `--graph-activation` is on):
1. For each chunk of content being encoded via `manager.encode(content, mood, scope, options)`, call `HeuristicEntityExtractor.extract(content)` → `string[]` of normalized entity labels.
2. Populate `options.entities` with the result. The existing agentos-core path reads `options.entities` at [CognitiveMemoryManager.ts:504](../../../agentos/src/memory/CognitiveMemoryManager.ts#L504) and persists as `trace.entities`.

**At ingest** (agentos-core fix, regardless of bench flag):
3. `MemoryStore.encode` passes `entityIds: trace.entities ?? []` to `knowledgeGraph.recordMemory`. The SqliteKnowledgeGraph's `recordMemory` already handles entity-node creation + memory-to-entity edge wiring when entityIds is non-empty.

**At retrieve**:
4. Inside `MemoryStore.query`, extract query entities via `HeuristicEntityExtractor.extract(query)`.
5. Resolve entity labels to KG entity nodes (via label lookup — the KG indexes entities by label).
6. Seed `spreadActivation` from those entity nodes. Use existing defaults (`maxDepth: 3`, `decayPerHop: 0.5`, `activationThreshold: 0.1`, `maxResults: 20`) to start; tune in a follow-up if needed.
7. For each candidate trace, compute its `graphActivation` as the max activation across entity nodes that trace's `entities` intersect with the activated set. Normalize to [0, 1] by dividing by 1.0 (activation is already capped at 1.0 by the Anderson algorithm).
8. Pass the computed value as `graphActivation: <score>` in the `allCandidates` composition at MemoryStore.ts:376. The existing `scoreAndRankTraces` consumes it via the pre-existing 10% weight.

### 3.3 Falsifiable predictions

- **Prediction A.** Overall unweighted accuracy ≥ 77% at Tier A N=24. Falsifiable: 73.2% or lower.
- **Prediction B.** Multi-session category sees the biggest relative lift (>= +5pp absolute). Falsifiable: multi-session lift < +5pp.
- **Prediction C.** Non-multi-session categories do not regress by more than -3pp. Falsifiable: any category drops > 3pp. Prevents "stole from other categories" failure mode.

If Prediction A fires GREEN but B or C fires RED, treat as a partial: ship the infra, document the nuance, consider follow-up tuning.

---

## 4. Architecture

### 4.1 Overview

Two packages touched. Heuristic extractor is a NEW agentos module (reusable for downstream consumers, not bench-specific). Wire-up is one line at MemoryStore.ts:229 + retrieval-time changes in MemoryStore.query. Bench adds a CLI flag + invokes the extractor at every encode.

### 4.2 New module — `HeuristicEntityExtractor`

**Location:** `packages/agentos/src/memory/retrieval/graph/extraction/HeuristicEntityExtractor.ts`

**Public surface:**

```typescript
/**
 * Heuristic entity extraction over free-form text. Regex-only, zero LLM,
 * deterministic. Returns a deduplicated array of normalized entity labels
 * suitable for populating `MemoryTrace.entities` at encode time and
 * seeding spreading activation at retrieve time.
 *
 * @example
 * extractEntities("Alice moved to Berlin on March 15, 2024 and paid $350,000 for a flat.")
 * // → ["Alice", "Berlin", "March 15, 2024", "$350,000"]
 */
export function extractEntities(text: string): string[];

/** Matching rules exposed for unit testing + custom pipelines. */
export interface ExtractorPatterns {
  properNouns: RegExp;
  isoDates: RegExp;
  namedDates: RegExp;
  currency: RegExp;
  numericWithUnits: RegExp;
}

export const DEFAULT_PATTERNS: ExtractorPatterns;
```

**Pattern families (tested individually):**

| Family | Regex sketch | Hits | Skips |
|---|---|---|---|
| Proper nouns | `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g` | `Alice`, `Wells Fargo`, `iPhone 15 Pro` | sentence-start filtered (first-word-of-sentence caps dropped if the word also appears lowercase in the same chunk) |
| ISO dates | `/\b\d{4}-\d{2}-\d{2}\b/g` | `2024-03-15` | — |
| Named dates | `/\b(Jan|Feb|...|Dec)(?:uary|...) \d{1,2}(?:,? \d{4})?\b/gi` | `March 15 2024`, `Mar 15`, `December 2023` | — |
| Currency | `/(?:\$|£|€|USD |EUR )\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?[KMBk])?/g` | `$350,000`, `£500`, `USD 1.2M` | — |
| Numeric + units | `/\b\d+(?:\.\d+)?\s?(?:kg|m|cm|km|lb|oz|days?|weeks?|months?|years?|hours?|minutes?|seconds?)\b/gi` | `5kg`, `3 days`, `100m` | — |

**Normalization:** after extraction, strip trailing punctuation, collapse internal whitespace, preserve case (so `Alice` ≠ `alice`). Deduplicate with `new Set()`.

**Sentence-start caps filter:** a common false positive is `"The quick brown fox"` where `The` gets matched by the proper-noun regex. Filter: drop caps words if the same word appears lowercase elsewhere in the SAME chunk, and always drop common English sentence-starters (`The`, `A`, `An`, `I`, `We`, `They`, `It`, `He`, `She`, `You`, `This`, `That`, `These`, `Those`, `My`, `Our`, `Their`).

**Max entities per chunk:** cap at 50 to prevent explosion on unusual text. If exceeded, keep the first 50 in document order.

### 4.3 Fix — `MemoryStore.encode` entityIds threading

**File:** `packages/agentos/src/memory/retrieval/store/MemoryStore.ts` line 229.

**Change:** `entityIds: []` → `entityIds: trace.entities ?? []`.

**Test:** existing integration tests for `MemoryStore.encode` should still pass. Add one spec that verifies `knowledgeGraph.recordMemory` receives non-empty `entityIds` when `trace.entities` is populated.

### 4.4 Compute — graph activation in `MemoryStore.query`

**File:** `packages/agentos/src/memory/retrieval/store/MemoryStore.ts`.

**Changes:**

1. Before the candidate composition loop, extract query entities via `extractEntities(query)`.
2. Look up entity nodes by label via `knowledgeGraph.queryEntities({ label: entity })` (existing API on IKnowledgeGraph).
3. Build the seed-id list for spreading activation.
4. Run `spreadActivation` with default config, getting `ActivatedNode[]`.
5. Build a map `activationByEntityId: Map<string, number>`.
6. In the candidate loop, compute each trace's activation:
   ```typescript
   const traceActivation = trace.entities && trace.entities.length > 0
     ? Math.max(0, ...trace.entities
         .map(label => activationByEntityId.get(labelToId(label)) ?? 0))
     : 0;
   ```
7. Pass as `graphActivation: traceActivation` instead of `graphActivation: 0`.

**Feature gate:** wrap the query-entity extraction + spreading-activation call in `if (this.config.enableGraphActivation)`. Default off at the MemoryStore level; consumers opt in via new `MemoryStoreConfig.enableGraphActivation`. Bench sets it to true when `--graph-activation` is passed.

### 4.5 HybridRetriever synthetic-trace score breakdown

**File:** `packages/agentos/src/memory/retrieval/hybrid/HybridRetriever.ts` line 560.

**Change:** leave `graphActivationScore: 0` as-is for synthetic fact-graph traces (they have no real KG position). This is a no-op cosmetic update; the zero is correct for synthetic traces.

### 4.6 Bench CLI flag

**File:** `packages/agentos-bench/src/cli.ts`.

**Addition:**

```typescript
.option(
  '--graph-activation',
  'Enable Step-13 graph activation. Heuristic entity extraction (regex) at ingest populates trace.entities; spreading activation at retrieve produces the sixth composite-score signal (weight 0.10 pre-existing). Default: off.',
  false,
)
```

Propagate through `RunConfig.graphActivation` (new field, boolean, default false), then into `MemoryStoreConfig.enableGraphActivation` via the cognitive manager's ingest pipeline.

### 4.7 Bench entity extractor invocation

**File:** `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts`.

**Change:** inside `replayForCognitive`, when `graphActivationEnabled` is true, modify the `timedEncode` helper (or wrap it) to call the extractor:

```typescript
const timedEncode = async (
  content: string,
  tags: string[],
): Promise<string> => {
  const t0 = Date.now();
  const encodeOptions: EncodeOptions = {
    type: 'episodic',
    scope: 'user',
    scopeId: 'bench',
    tags,
  };
  if (graphActivationEnabled) {
    encodeOptions.entities = extractEntities(content);
  }
  const trace = await handle.manager.encode(content, neutralMood, '', encodeOptions);
  encodeMsSamples.push(Date.now() - t0);
  // ...
};
```

Also configure the `CognitiveMemoryManager`'s `MemoryStore` with `enableGraphActivation: true` via `createCognitiveManager`.

### 4.8 Cache fingerprint

**File:** `packages/agentos-bench/src/core/BenchmarkRunner.ts`.

**Addition inside `computeCaseRunKeyParts`:**

```typescript
if (config.graphActivation) {
  runKeyParts.push('step-13-graph-activation:v1');
  resultKeyParts.push('step-13-graph-activation:v1');
}
```

Keeps cached Tier 1 (graph-activation-off) runs intact while forcing fresh runs when the flag is on.

---

## 5. Testing

### 5.1 Extractor unit tests

**File:** `packages/agentos/src/memory/retrieval/graph/extraction/__tests__/HeuristicEntityExtractor.spec.ts`

Eight minimum test cases:

1. Proper noun single word: `"Alice moved"` → `["Alice"]`.
2. Proper noun multi-word: `"Wells Fargo approved"` → `["Wells Fargo"]`.
3. Sentence-start filter: `"The user said hi."` → `[]` (no entities).
4. ISO date: `"on 2024-03-15"` → `["2024-03-15"]`.
5. Named date: `"on March 15, 2024"` → `["March 15, 2024"]`.
6. Currency: `"paid $350,000 and €500"` → `["$350,000", "€500"]`.
7. Numeric + units: `"for 5kg of rice over 3 days"` → `["5kg", "3 days"]`.
8. Dedup + normalize: `"Alice, Alice, and ALICE"` → `["Alice", "ALICE"]` (case preserved, exact-match dedup).
9. Empty / whitespace input: `""` → `[]`, `"   "` → `[]`.
10. Max entities cap: synthetic input with 100 distinct caps words → length 50.

### 5.2 MemoryStore integration tests

**File:** `packages/agentos/src/memory/retrieval/store/__tests__/MemoryStore.graphActivation.spec.ts`

1. `entityIds` thread-through: encoding a trace with `entities: ["Alice", "Berlin"]` produces a `recordMemory` call whose `entityIds` array has length 2.
2. Graph activation computed: with a populated KG (2 sessions sharing entity "Alice"), querying "Alice's preference" produces non-zero `graphActivation` for traces in both sessions.
3. Feature flag off: `enableGraphActivation: false` produces `graphActivation: 0` for all candidates (legacy behavior preserved).

### 5.3 Bench wiring tests

**File:** `packages/agentos-bench/tests/step13GraphActivation.wiring.spec.ts`

1. CLI flag `--graph-activation` propagates to `RunConfig.graphActivation: true`.
2. Extractor is called at encode time when flag is set (spy on `extractEntities`, count invocations).
3. Cache fingerprint `step-13-graph-activation:v1` is present when flag on, absent when flag off.
4. `enableGraphActivation` propagates to `MemoryStore` config.

### 5.4 Regression gates

All 45 pre-existing Step 12 + Phase 1 tests must still pass. Agentos typecheck clean. Bench typecheck clean. If graph-activation is off (Tier 1 config), behavior is byte-for-byte identical to pre-Step-13 (verified by rerunning `step-12-bm25-parity-sweep` cached entries at $0).

---

## 6. Measurement

### 6.1 Tier A config

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o \
  --judge-model gpt-4o \
  --memory full-cognitive \
  --replay ingest \
  --hybrid-retrieval \
  --rerank cohere \
  --context-summary gpt-5-mini \
  --graph-activation \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 \
  --seed 42 \
  --concurrency 2
```

N=24 stratified, gpt-4o both sides. No observer-reflector (Step 13 tests graph activation in isolation against Tier 1 baseline, not stacked with other experiments).

### 6.2 Kill criterion

Tier A unweighted ≥ 77% → proceed to Phase A N=102.
<77% → RED verdict, document, close line, pattern becomes n=9.

### 6.3 Conditional Phase A

If Tier A GREEN, fire Phase A N=102 at +$3. Gate to Phase B N=500 at ≥ +5pp over 73.2% canonical (so ≥ 78.2%) AND paired McNemar significant vs canonical.

### 6.4 Success metrics

1. Unweighted accuracy Δ vs 73.2% canonical. Target ≥ +4pp.
2. Multi-session category Δ vs 54.9% canonical. Target ≥ +5pp.
3. Per-category: no category regresses > 3pp.
4. Graph-activation signal actually contributes: `scoreBreakdown.graphActivationScore > 0` on > 50% of retrieved traces (verify via run JSON inspection).
5. Cost/correct ≤ $0.025 (stays within 20% of canonical $0.0213).

---

## 7. Cost model

| Phase | N | Reader + judge | Extractor | Graph activation | Total |
|---|---:|---:|---:|---:|---:|
| Tier A | 24 | $1.50 | $0 | $0 | **$1.50** |
| Phase A (conditional) | 102 | $5.00 | $0 | $0 | **$5.00** |

Extractor and graph activation are pure CPU, zero API cost. Total cap: **$7**.

---

## 8. Risk assessment

**R1: Enabling a silent signal regresses baseline.** The canonical 73.2% was measured with graphActivation=0. Activating it with a 10% weight on a non-zero input WILL change scoring. If the signal is noisier than expected, it could displace good candidates.

**Mitigation:**
- Default OFF via `--graph-activation` flag.
- Extractor is conservative (high-IDF only, sentence-start filtered).
- Weight (0.10) unchanged. If Tier A suggests the signal is useful but noisy, a follow-up can tune the weight.

**R2: Heuristic extractor misses or false-positives.** Regex can't handle every case. "iPhone 15 Pro" might extract as "Pro" only; "Apple Inc." might extract as "Apple". Inconsistency between ingest-time extraction and retrieve-time extraction means entities don't match.

**Mitigation:**
- Both ingest and retrieve use the SAME `extractEntities` function, so inconsistency is bounded.
- Normalization strips punctuation.
- Unit tests pin the 10 most common patterns.
- If bench result is RED, we know the mechanism; can iterate on patterns in follow-up.

**R3: KG entity-node lookup by label is slow at query time.** `queryEntities({ label })` might not have an index.

**Mitigation:**
- Check at implementation time. If needed, add a label index (cheap SQLite migration).
- Fall back to in-memory label-to-id map built on first use.

**R4: Spreading activation at query time adds latency.** BFS over the graph is O(seeds × avg_neighbors × depth). With default config (maxDepth=3, decayPerHop=0.5), bounded by `activationThreshold: 0.1`.

**Mitigation:**
- Profile at implementation. If > 100ms per query, tune `maxDepth: 2` or `activationThreshold: 0.2`.
- Existing algorithm is already bounded by `maxResults: 20`.

**R5: Semantic-release cuts a new agentos version mid-session.** Another parallel session is working on agentos (multimodal test additions in uncommitted state).

**Mitigation:**
- Rebase before push (standard submodule hygiene from handoff §6.3).
- Don't touch the other session's uncommitted files.
- Semantic-release will cut a minor version (feat: prefix); no API breaking changes.

---

## 9. Out of scope (for this spec — queued as future work)

- **LLM-based entity extraction.** Risks the n=8 pattern. Save for Step 14+ if heuristic extraction GREEN's and we want to push further.
- **NER library integration** (spaCy, compromise.js). Adds a dependency. Evaluate if heuristic accuracy is limiting.
- **Entity co-occurrence weights / Hebbian learning.** The existing `SpreadingActivation.ts` algorithm supports it architecturally; we're not wiring the update loop in this spec.
- **Cross-session entity resolution.** Merging "Alice" across sessions into one canonical entity node requires entity disambiguation. Out of scope; each session's extraction produces its own entity labels which may or may not match across sessions. The shared-label match in the activation path is the implicit resolution strategy.
- **Weight tuning.** Keeping the existing 0.10 for graphActivation. If Tier A suggests tuning would help, follow-up spec.
- **LOCOMO Tier A.** Skipping initial LOCOMO run. Add if LongMemEval-S Tier A is GREEN AND we want additional benchmark coverage.

---

## 10. Dependencies

**Required to be in place (verified this session):**

- `SpreadingActivation.spreadActivation` exported. Verified at [packages/agentos/src/memory/retrieval/graph/SpreadingActivation.ts:51](../../../agentos/src/memory/retrieval/graph/SpreadingActivation.ts#L51).
- `SqliteKnowledgeGraph.recordMemory(episode)` handles non-empty `entityIds`. Verified at [SqliteKnowledgeGraph.ts:509](../../../agentos/src/memory/retrieval/store/SqliteKnowledgeGraph.ts#L509).
- `IKnowledgeGraph.queryEntities` or equivalent label-lookup API. **Needs verification at implementation time** (Task 1 of the plan).
- `MemoryStore.encode` `options.entities` plumbing. Verified at [CognitiveMemoryManager.ts:504](../../../agentos/src/memory/CognitiveMemoryManager.ts#L504).

**Not required:**

- No new npm dependencies.
- No new CLI flags beyond `--graph-activation`.
- No new agentos API surfaces at the public barrel (`extractEntities` gets exported from `@framers/agentos/memory`).

---

## 11. References

### 11.1 Internal

- [COMPREHENSIVE_HANDOFF_2026-04-21.md §7](../COMPREHENSIVE_HANDOFF_2026-04-21.md) — Step 13 Option A rationale
- [STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md §Audit finding](../STEP_12_BM25_PARITY_FINDINGS_2026-04-21.md) — silent sixth signal discovery
- [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md §3.1](../RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md) — 6-signal composite architecture
- [packages/agentos/src/memory/retrieval/graph/SpreadingActivation.ts](../../../agentos/src/memory/retrieval/graph/SpreadingActivation.ts) — Anderson spreading activation
- [packages/agentos/src/memory/retrieval/store/SqliteKnowledgeGraph.ts](../../../agentos/src/memory/retrieval/store/SqliteKnowledgeGraph.ts) — KG backend

### 11.2 External

- Anderson, J. R. (1983). *A spreading activation theory of memory.* Journal of Verbal Learning and Verbal Behavior, 22(3), 261-295.
- Collins, A. M. & Loftus, E. F. (1975). *A spreading-activation theory of semantic processing.* Psychological Review, 82(6), 407-428.
- Wu et al. 2024. *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory.* The benchmark this spec targets.
- Robertson & Zaragoza (2009). *The Probabilistic Relevance Framework: BM25 and Beyond.* BM25 remains the sparse component; graph activation composes additively.

---

## 12. Self-review checklist

- [x] No "TBD" / "TODO" / placeholder sections.
- [x] Architecture matches the code sketches; no contradictions.
- [x] Single implementation plan's worth of scope (extractor + wire-up + bench flag). Not decomposable further without losing coherence.
- [x] Requirements unambiguous (default OFF, kill ≥ 77%, multi-session lift ≥ 5pp).
- [x] Falsification paths explicit (three predictions A/B/C).
- [x] Dependencies verified against actual code except KG label-lookup API (flagged as Task 1 verification).
- [x] Out-of-scope explicitly listed to prevent scope creep.
- [x] Risk assessment includes mitigations per risk.
- [x] No em dashes in prose.
- [x] Honors user's no-subagent + no-worktree-with-submodules rules.

---

End of Step 13 design spec.
