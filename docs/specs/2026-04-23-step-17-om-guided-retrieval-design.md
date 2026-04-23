# Step 17 — OM-Guided Retrieval (scoped HybridRetriever)

**Date:** 2026-04-23
**Status:** Design v1; designed during Phase B v10 inflight to test architectural alternative.
**Supersedes:** None. Independent architectural alternative to Step 16 (combined OM + retrieval) and Step 16c (router).

---

## 1. Summary

Step 16 family (OM + HybridRetriever combined into one reader context) failed because retrieval pollutes single-session/temporal categories with non-gold-session passages. Step 16c family (per-question router) works but is bounded by the canonical Pareto frontier.

Step 17 takes a different architectural approach: **use the OM observation log to identify candidate sessions, then run HybridRetriever scoped to those sessions only**. The OM observations act as a query-relevance prior on which sessions matter, narrowing the retrieval scope from the full corpus (~50 sessions) to ~3-5 OM-identified candidates.

**Hypothesis:** narrowing retrieval scope eliminates the pollution that killed Step 16:
- Single-session questions: OM identifies 1-2 candidate sessions, retrieval returns chunks only from those, no cross-session distractors → SSU/SSP/SSA stay at 100%.
- Multi-session questions: OM identifies 2-3 candidate sessions, retrieval surfaces specific cross-session chunks within scope → MS lifts WITHOUT polluting other categories.
- Temporal questions: OM identifies time-anchored sessions, scaffold chronology step works on dated retrieval results → TR holds.

**If correct,** Step 17 escapes the canonical Pareto ceiling and beats both v10 (Phase A 76.5%) and v5 (Phase A 73.5%) by avoiding their respective tradeoffs.

---

## 2. Architecture

### 2.1 The session-scoring step (new)

After OM ingest produces the observation log, score each ingested session by query-relevance using its per-session observation block:

```typescript
async function scoreSessionsByQueryRelevance({
  question,
  perSessionBlocks,  // Map<sessionId, observationBlockText>
  embedder,
}): Promise<SessionScore[]>
```

**Implementation:**
1. Embed the question (1 call).
2. For each session's per-session observation block, compute cosine similarity to question embedding.
3. Return ranked list of `{ sessionId, score, observationText }`.

**Cost per case:** 1 question embedding (~$0.0001) + N session-block embeddings (~$0.005 for ~50 sessions). Negligible.

### 2.2 The candidate selection step

Pick top-K sessions by score:

```typescript
function pickCandidateSessions(
  scores: SessionScore[],
  K: number = 5,
): string[]  // sessionIds
```

K=5 default. Question-type variation: multi-session needs K≥3; single-session needs K=1-2.

### 2.3 The scoped retrieval step

Run HybridRetriever (BM25 + dense + RRF + Cohere rerank) but filter traces to candidate sessions only:

```typescript
const retrievedEvidence = await runFullCognitiveCase(c, ctx, recallTopK, ...,
  retrievalFilter: (trace) => candidateSessionIds.includes(trace.sessionId),
);
```

The filter is applied at the trace-scoring step. BM25 + dense both score only candidate-session traces. Final top-K passages come from a much narrower pool.

### 2.4 Reader context assembly

Same as Step 16 (combined OM log + retrieved passages):

```
<system prompt>
<cross-session scaffold>

## Per-session observations
... full OM dual-path log (as v5) ...

## Cross-session patterns
... full OM dual-path log (as v5) ...

## Relevant retrieved passages (scoped to OM-identified candidate sessions)
1. [session s5, score 0.89] ...verbatim chunk text...
2. [session s12, score 0.82] ...verbatim chunk text...
...
```

The reader sees BOTH the OM synthesis AND the verbatim passages, like Step 16. Difference: the passages are guaranteed to be from sessions the OM identified as relevant.

### 2.5 Cache fingerprint

New tag: `step-17-om-guided:v1`. Only appended when `--om-guided-retrieval` is on. Different cache buckets from Step 16 (which uses `step-16-om-retrieval:v1`).

### 2.6 Why this is different from Step 16

| Aspect | Step 16 | Step 17 |
|---|---|---|
| Retrieval scope | Full corpus (~50 sessions) | Top-K OM-identified sessions (~5) |
| K (passages returned) | 10 (default) | 3-10 (configurable) |
| Single-session pollution | High (passages from non-gold sessions) | Low (only candidate sessions in scope) |
| Multi-session boost | High (all sessions' chunks available) | High (right candidates in scope) |
| Cost per case | OM + retrieval | OM + scoring (~$0.005) + scoped retrieval |

Step 17 should beat Step 16 on single-session AND multi-session simultaneously.

---

## 3. Implementation

### 3.1 New file: `omGuidedRetrieval.ts`

Path: `src/observational-memory/omGuidedRetrieval.ts`.

Exports:
- `extractPerSessionBlocks(omLog: string): Map<string, string>` — parse OM dual-path log for per-session observation blocks
- `scoreSessionsByQueryRelevance({ question, perSessionBlocks, embedder }): Promise<SessionScore[]>` — compute query-vs-session similarity
- `pickCandidateSessions(scores: SessionScore[], K: number): string[]`
- Type `SessionScore = { sessionId: string; score: number; observationText: string }`

### 3.2 Extend `IBenchmark.ts`

Add `omGuidedRetrieval?: boolean` and `omGuidedRetrievalK?: number` (default 5) to RunConfig. Add to both Pick lists.

### 3.3 Extend `BenchmarkRunner.ts`

`resolveRunConfig` propagation. Fingerprint `step-17-om-guided:v1` + optional `step-17-om-guided-k:{n}` when K is overridden.

### 3.4 Extend `cli.ts`

`--om-guided-retrieval` (boolean) and `--om-guided-retrieval-k <n>` (integer, default 5).

### 3.5 Wire into `LongMemEvalS.runCase`

When `omGuidedRetrieval` is on (and `observationalMemory` is on):
1. Run OM ingest as in v5.
2. Extract per-session observation blocks from `ingest.finalLog`.
3. Score sessions vs question.
4. Pick top-K candidate sessions.
5. Run scoped HybridRetriever via `runFullCognitiveCase` with a session filter.
6. Build reader prompt with OM log + scoped passages (use `buildOmReaderSystemPrompt` with retrievedPassages).

### 3.6 Tests

Unit (in `tests/observationalMemory.unit.spec.ts`):
1. `extractPerSessionBlocks` parses dual-path OM log into per-session map.
2. `extractPerSessionBlocks` handles missing per-session section gracefully (returns empty map).
3. `scoreSessionsByQueryRelevance` returns sessions sorted by descending score.
4. `pickCandidateSessions` returns top-K session IDs.
5. `pickCandidateSessions` returns all sessions if K >= total.

Wiring (in `tests/step15ObservationalMemory.wiring.spec.ts`):
6. `resolveRunConfig` preserves `omGuidedRetrieval` and `omGuidedRetrievalK`.
7. Fingerprint includes `step-17-om-guided:v1` when on.
8. Fingerprint includes `step-17-om-guided-k:{n}` when K is overridden.
9. Fingerprint omits Step 17 tags when off.

Total: 9 new tests.

---

## 4. Kill criteria

Same as Step 16c:
- Unweighted ≥ 82%
- Multi-session ≥ 50%
- All single-session ≥ 90%

Step 17 must beat v10 Phase A (76.5%) at Tier A AND avoid the Step 16 K=10 single-session pollution.

---

## 5. Expected outcomes

### 5.1 Best case

- Aggregate Tier A: 80-85%
- Single-session: all 95-100% (no cross-session pollution from scoped retrieval)
- Multi-session: 60-75% (scoped retrieval surfaces right chunks)
- KU: 80-90% (OM + retrieval combined helps supersession)
- TR: 70-85% (scaffold chronology works on dated passages)

If Tier A clears the 82% gate, Phase A.

### 5.2 Null case (no improvement over v10)

Aggregate ~73-76%, similar to v10. Step 17 doesn't add meaningful lift over routing.

### 5.3 Failure case (worse than v10)

Aggregate < 70%. Scoped retrieval misses the right sessions because OM-relevance doesn't predict gold-session correctly.

---

## 6. Cost

| Line | Cost per case |
|---|---:|
| OM ingest (gpt-4o observer, dual-path) | ~$1.00 |
| Question embedding | $0.0001 |
| Per-session block embeddings (~50 × $0.0001) | $0.005 |
| Scoped HybridRetriever (BM25 free, dense via existing embeddings, Cohere rerank) | $0.05 |
| Reader (gpt-4o) | $0.02 |
| Judge (gpt-4o) | $0.01 |
| **Per case total** | **~$1.09** |

Tier A N=24: ~$26.
Phase A N=102: ~$110 marginal (Tier A cached).
Phase B N=500: ~$540.

More expensive than v10 (which routes most cases away from OM ingest), but cheaper than v5 + always-on retrieval.

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| OM-relevance scoring picks wrong candidate sessions | Medium | K=5 buffers against single-session miss; per-question K tuning available |
| Scoped retrieval still misses on multi-session | Medium | Tier A reveals it. If MS regresses vs v10's 70%, Step 17 family is RED. |
| Scoring step's embedding cost adds up | Low | $0.005/case is negligible vs OM ingest |
| Reader context too long when both OM log + retrieved passages present | Low | Step 16 ran this exact shape successfully (just polluted); Step 17 is the fix |
| Per-session block parsing fails on different OM modes | Medium | Parser must handle dual-path layout specifically (the only mode v10 routing uses for OM) |

---

## 8. Tier A command

```bash
cd /Users/johnn/Documents/git/voice-chat-assistant && \
  set -a && source apps/wilds-ai/.env && set +a && \
  OPENAI_API_KEY="$OPENAI_API_KEY" COHERE_API_KEY="$COHERE_API_KEY" \
  pnpm --filter @framers/agentos-bench bench run longmemeval-s \
    --reader gpt-4o --judge-model gpt-4o \
    --memory full-cognitive --replay ingest \
    --observational-memory \
    --om-mode dual-path --om-batch-tokens 24000 \
    --om-observer-model gpt-4o \
    --om-reader-scaffold \
    --om-guided-retrieval \
    --om-guided-retrieval-k 5 \
    --rerank cohere --context-summary gpt-5-mini --hybrid-retrieval \
    --reader-top-k 5 \
    --stratified --sample-per-type 4 \
    --bootstrap-resamples 10000 --seed 42 \
    --max-usd 40
```

---

## 9. Acceptance

Design v1 finalized 2026-04-23 during Phase B v10 inflight. Implementation + Tier A in same session.

---

End of spec.
