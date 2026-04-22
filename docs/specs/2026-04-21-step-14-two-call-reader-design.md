# Step 14 — Two-Call Reader (Emergence AI pattern)

**Date:** 2026-04-21
**Author session:** Opus 4.7 (1M context)
**Status:** design approved, plan pending
**Scope:** bench-only (reader-side, zero agentos changes)
**Spec identifier:** `2026-04-21-step-14-two-call-reader-design.md`

---

## 1. TL;DR

Split the single reader call at `runFullCognitiveCase` into two sequential gpt-4o calls: an **extract call** that transforms raw top-K retrieved passages into a structured JSON fact-scratchpad with passage-id citations, and an **answer call** that produces the final answer from the scratchpad only (no raw passages in final context). Closes the context-dilution problem that the n=9 pattern pointed to: retrieval finds the gold session in ~74% of top-K, but the reader's conversion rate is only 83% (and dropped to 67% in Step 13 under reordered context). Two-call isolates fact extraction from answer synthesis so dilution in the retrieved pool doesn't confuse answer composition.

**Hypothesis:** two-call reader lifts Tier A LongMemEval-S N=24 unweighted accuracy by ≥ +5pp over the 73.2% canonical (Phase B N=500 baseline) to ≥ 78% at Tier A N=24. Emergence AI publishes 86.0% at gpt-4o using this exact shape.

**Kill criterion:** unweighted ≥ 77% at Tier A LongMemEval-S N=24. Otherwise RED, close out two-call reader for this workload.

**Budget cap:** $70 across Tier A + Phase A + Phase B.

**Dodges the n=9 pattern by construction:** reader-side experiment, no retrieval-layer additions, no LLM-mediated-content transformation at ingest or query time.

---

## 2. Background

### 2.1 Why this, why now

The n=9 RED/null pattern from Steps 2-13 establishes: adding scoring signals to the hybrid retrieval stack regresses on specific-value LongMemEval-S unless the signal is tightly aligned with the benchmark's query distribution. Every retrieval-layer experiment has been exhausted. The remaining architectural-different lever is READER-side.

Step 13 stage metrics + reader-conversion analysis make the case concrete:

| Step | final.recall | Reader conversion |
|---|---:|---:|
| Step 3 canonical (shipping) | ≈ 0.82 (estimated from Phase B) | ~89% |
| Step 12 baseline (ADDITIVE) | 0.740 | 83% |
| Step 13 (graph activation) | 0.745 | 67% |

The reader has consistent conversion headroom. Even when retrieval puts the gold session in the final top-K, the reader gets it right only 67-89% of the time. That's the gap two-call reader targets.

### 2.2 Emergence AI's published pattern

Emergence publishes **86.0% at gpt-4o reader on LongMemEval-S** using a reader split: first call extracts relevant facts into a scratchpad, second call answers from the scratchpad only. Reference: [emergence.ai/blog/sota-on-longmemeval-with-rag](https://emergence.ai/blog/sota-on-longmemeval-with-rag). The architectural insight: reader context windows contain many passages, most irrelevant to any specific question. Asking the reader to both "filter" and "answer" in one call confuses it. Splitting the steps cleanly separates extraction from synthesis.

### 2.3 Competitor positioning

At matched gpt-4o reader:

| System | Reader | LongMemEval-S | Source |
|---|---|---:|---|
| Zep / Graphiti | gpt-4o | 71.2% | zep research |
| **AgentOS (Step 3 Hybrid canonical)** | **gpt-4o** | **73.2%** | this work, N=500 |
| Supermemory | gpt-4o | 81.6% | supermemory.ai/research |
| Mastra Observational Memory | gpt-4o | 84.23% | mastra.ai/research/observational-memory |
| EmergenceMem Internal | gpt-4o | 86.0% | emergence.ai/blog/sota-on-longmemeval-with-rag |

Two-call reader is the architectural mechanism behind the 80%+ band. If Step 14 GREEN's, AgentOS enters the frontier band at 78-83% depending on magnitude.

---

## 3. Hypothesis + mechanism

### 3.1 Hypothesis

> Splitting the reader into an extract call (top-K passages → JSON fact scratchpad with passage-id citations) followed by an answer call (scratchpad → final answer, no raw passages) produces a ≥ +5pp unweighted accuracy lift at Tier A LongMemEval-S N=24 over the 73.2% Step 3 canonical baseline.

### 3.2 Mechanism

**Current single-call pipeline:**
```
query + [P0][P1][P2]...[P9] (raw retrieved passages, avg 300-600 tokens each)
→ gpt-4o reader (sees ~3-6k tokens of possibly-irrelevant context)
→ answer
```

Failure mode: reader splits attention across passages, answers generically, or quotes the wrong passage.

**Two-call pipeline:**
```
Step A — extract:
  query + [P0][P1][P2]...[P9] (same raw passages)
  → gpt-4o with EXTRACT_SYSTEM_PROMPT
  → JSON: { facts: [{content, sourcePassages: ["P3"]}, ...] }

Step B — answer:
  query + scratchpad (facts only, ~200-400 tokens)
  → gpt-4o with ANSWER_SYSTEM_PROMPT
  → answer
```

Reader in Step A has one job: "which sentences in these passages are relevant to the query?" Reader in Step B has one job: "given these facts, answer the query." Both are well-defined, narrower tasks than the original "read everything and answer."

### 3.3 Falsifiable predictions

- **A.** Tier A N=24 unweighted ≥ 78% (≥ +5pp vs 73.2% canonical).
- **B.** Reader conversion (correct answers / gold-in-top-K) ≥ 90% in the run (up from 83% at Step 12).
- **C.** No category regresses > 3pp vs the canonical per-category baseline.

Falsification:
- A FAIL → close two-call reader for this workload, pattern becomes n=10.
- A PASS but C FAIL → partial win (specific categories benefit, others don't). Document and consider category-gated activation.
- A PASS + B PASS + C PASS → proceed to Phase A N=102, then Phase B N=500 for a publishable canonical.

---

## 4. Architecture

### 4.1 New module — `twoCallReader`

**Location:** `packages/agentos-bench/src/readers/twoCallReader.ts`

**Public surface:**

```typescript
/** Retrieved passage with stable bench id (P0, P1, ...). */
export interface RetrievedPassage {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Fact scratchpad produced by the extract call. */
export interface ExtractedFact {
  content: string;
  sourcePassages: string[]; // e.g. ["P3", "P7"]
}

/** Full two-call result. Cost breakdown is per-call for bench accounting. */
export interface TwoCallResult {
  answer: string;
  scratchpadFacts: ExtractedFact[];
  extractCost: { tokensIn: number; tokensOut: number; model: string };
  answerCost: { tokensIn: number; tokensOut: number; model: string };
  /** True when extract JSON parse failed and we fell back to single-call. */
  fallbackUsed: boolean;
}

/**
 * Emergence-style two-call read: extract facts from retrieved passages,
 * then answer from the fact scratchpad only. Falls back to single-call
 * when the extract call returns malformed JSON (safety net; flagged in
 * `fallbackUsed`).
 */
export function twoCallRead(args: {
  reader: IReader;
  query: string;
  passages: RetrievedPassage[];
  extractMaxTokens?: number;   // default 400
  answerMaxTokens?: number;    // default 256
  temperature?: number;        // default 0
}): Promise<TwoCallResult>;
```

### 4.2 Extract prompt

System prompt (pinned, versioned via `EXTRACT_PROMPT_HASH` exported constant):

```
You are a fact-extraction assistant. Given a user query and a set of
passages (tagged [P0], [P1], ...), identify every fact in the passages
that is directly relevant to answering the query. Output a single
valid JSON object with this exact shape:

{
  "facts": [
    { "content": "the verbatim or lightly-paraphrased fact", "sourcePassages": ["P3"] }
  ]
}

Rules:
- Preserve literal tokens (names, dates, numeric amounts, addresses).
  Do not paraphrase those.
- Only include facts that bear on answering the query.
- If no relevant facts are present in any passage, return {"facts": []}.
- Cite every fact with at least one sourcePassages entry.
- Output ONLY valid JSON. No prose before or after.
```

User message:

```
Query: {query}

Passages:
[P0] {passage 0 content}
[P1] {passage 1 content}
...
[P9] {passage 9 content}

Extract the relevant facts as JSON:
```

### 4.3 Answer prompt

System prompt:

```
You are a Q&A assistant. Answer the user's query using ONLY the facts
provided. If the facts do not contain enough information, say so
briefly. Preserve literal tokens (names, dates, numeric amounts).
```

User message:

```
Query: {query}

Facts:
- {fact 0 content} (sources: P3)
- {fact 1 content} (sources: P7, P8)
...

Answer:
```

### 4.4 Fallback path

If `JSON.parse` throws on the extract output OR the parsed object doesn't match the schema (`{facts: [{content, sourcePassages}]}`), `twoCallRead`:

1. Records `fallbackUsed: true`.
2. Invokes the answer call directly with the original raw passages (single-call semantics, matching pre-Step-14 behavior).

This guarantees Step 14 never degrades vs the Step 3 canonical on malformed-extract cases.

### 4.5 Bench wiring

**File:** `packages/agentos-bench/src/benchmarks/longmemeval/LongMemEvalS.ts::runFullCognitiveCase`.

Immediately before the existing reader.invoke call (around line 1100-1150 depending on layout), gate on `twoCallReaderEnabled`:

```typescript
let readerOutput: { text: string; tokensIn: number; tokensOut: number; model: string };
if (ctx.config.twoCallReader) {
  const passages: RetrievedPassage[] = retrievedTraces.slice(0, effectiveRecallTopK)
    .map((t, idx) => ({ id: `P${idx}`, content: t.content, metadata: { traceId: t.id } }));
  const twoCall = await twoCallRead({ reader, query: caseQuery, passages });
  readerOutput = {
    text: twoCall.answer,
    tokensIn: twoCall.extractCost.tokensIn + twoCall.answerCost.tokensIn,
    tokensOut: twoCall.extractCost.tokensOut + twoCall.answerCost.tokensOut,
    model: twoCall.answerCost.model,
  };
  // Cost tracked separately for extract + answer so the per-call
  // breakdown is visible in run JSON.
  ctx.costTracker.record({ category: 'reader', tag: `twoCallExtract:${c.id}`, ...twoCall.extractCost });
  ctx.costTracker.record({ category: 'reader', tag: `twoCallAnswer:${c.id}`, ...twoCall.answerCost });
  // Record fallback + fact count in case metadata for the run JSON.
  runMetadata.twoCallFallbackUsed = twoCall.fallbackUsed;
  runMetadata.twoCallFactCount = twoCall.scratchpadFacts.length;
} else {
  // existing single-call path, unchanged
}
```

### 4.6 CLI flag

```typescript
.option(
  '--two-call-reader',
  'Enable Step-14 two-call reader (Emergence AI pattern). Split the single reader call into an extract call (top-K passages → JSON fact scratchpad with passage-id citations) and an answer call (scratchpad → final answer, raw passages NOT in final context). Targets reader-conversion headroom (~83% at baseline). Default: off.',
  false,
)
```

### 4.7 Cache fingerprint

Inside `computeCaseRunKeyParts`:

```typescript
if (config.twoCallReader) {
  runKeyParts.push(`step-14-two-call-reader:${EXTRACT_PROMPT_HASH.slice(0, 12)}`);
  resultKeyParts.push(`step-14-two-call-reader:${EXTRACT_PROMPT_HASH.slice(0, 12)}`);
}
```

Content-addressed via `EXTRACT_PROMPT_HASH` (sha256 of the extract system prompt) so any future prompt edit auto-invalidates cached answers without manual `:v1 → :v2` bumping. Mirrors the Step 11 `REFLECTOR_PROMPT_HASH` pattern.

### 4.8 RunConfig.twoCallReader

Add to `packages/agentos-bench/src/core/IBenchmark.ts::RunConfig`:

```typescript
  /**
   * Step 14: enable two-call reader (Emergence AI pattern). When true,
   * the benchmark runner splits each case's reader invocation into an
   * extract call (raw passages → JSON fact scratchpad) and an answer
   * call (scratchpad only → final answer). Both use `config.reader`.
   *
   * Default: false. Opt-in behind `--two-call-reader` CLI flag.
   */
  twoCallReader?: boolean;
```

Thread through `resolveRunConfig` + `BenchContext['config']` Omit/Pick lists (parallel to how `graphActivation` was added in Step 13).

---

## 5. Testing

### 5.1 Unit tests — `twoCallReader` helper

**File:** `packages/agentos-bench/src/readers/__tests__/twoCallReader.spec.ts`

1. **Happy path JSON parse.** Mock reader returns valid `{"facts": [...]}` on extract + a string answer on answer call. Verify `twoCallRead` returns the parsed facts + answer.
2. **Malformed JSON fallback.** Mock extract returns `"not json"`. Verify `fallbackUsed: true`, answer call receives raw passages instead of scratchpad, output string is the answer-call result.
3. **Empty facts**. Mock extract returns `{"facts": []}`. Verify answer call still fires with empty-facts scratchpad, final answer is whatever the reader produces.
4. **Passage-id citation parsing.** Mock extract returns facts with `"sourcePassages": ["P3", "P7"]`. Verify `scratchpadFacts[0].sourcePassages` matches.
5. **Token accounting.** Verify `extractCost + answerCost` sums match the mock reader's per-call token responses.

### 5.2 Bench wiring tests

**File:** `packages/agentos-bench/tests/step14TwoCallReader.wiring.spec.ts`

1. **Fingerprint presence.** `computeCaseRunKeyParts({ twoCallReader: true, ... })` includes `step-14-two-call-reader:{hash12}`.
2. **Fingerprint absence.** Flag false → no step-14 entry.
3. **Content-addressed invalidation.** Mock `EXTRACT_PROMPT_HASH` change → fingerprint changes → cache bucket differs.
4. **RunConfig threading.** `resolveRunConfig` preserves `twoCallReader: true` through to `BenchContext['config']`.
5. **CLI flag propagation.** `--two-call-reader` on CLI → `RunConfig.twoCallReader: true`.

### 5.3 Regression gates

All 52 pre-existing tests (Phase 1 + Step 12 + Step 13 wiring) must still pass. Agentos typecheck clean. Bench typecheck clean. If `twoCallReader` is off (Tier 1 config), behavior is byte-identical to pre-Step-14.

---

## 6. Measurement

### 6.1 Tier A

```bash
pnpm bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --hybrid-retrieval --rerank cohere \
  --context-summary gpt-5-mini \
  --two-call-reader \
  --reader-top-k 10 \
  --stratified --sample-per-type 4 \
  --bootstrap-resamples 10000 --seed 42 --concurrency 2
```

N=24 stratified, gpt-4o reader + gpt-4o judge (matched). No observer-reflector, no graph-activation — two-call reader tested in isolation against Tier 1 canonical.

### 6.2 Kill + success criteria

- Unweighted ≥ **78%** at Tier A → GREEN. Fire Phase A N=102 immediately.
- **73-78%** → partial (above canonical but below GREEN gate). Document, present to user for Phase A decision.
- < 73% → RED. Pattern becomes n=10. Close two-call reader for this workload.

### 6.3 Conditional Phase A

If Tier A GREEN, fire Phase A N=102 (+$10). Gate to Phase B N=500 at ≥ +5pp over canonical (so ≥ 78.2%) AND paired McNemar p < 0.05 vs canonical.

### 6.4 Conditional Phase B

If Phase A GREEN, fire Phase B N=500 (+$50). Establishes the new canonical number. Updates `summary.json` via the N-regression guard.

### 6.5 Diagnostic metrics

Beyond accuracy, record per-case:

- `fallbackUsed` rate (proportion of cases that hit malformed-extract fallback). Ideal: < 5%.
- `twoCallFactCount` distribution (how many facts the extractor produces on average). Sanity check: 2-8 typical for specific-value queries.
- Reader conversion rate (correct answers / gold-in-top-K via existing evidenceOrigin + retrieval-stage metrics).

---

## 7. Cost model

| Phase | N | Single-call cost | Two-call cost | Δ |
|---|---:|---:|---:|---:|
| Tier A | 24 | $0.15 | ~$0.45 | +$0.30 |
| Phase A | 102 | $0.65 | ~$2 | +$1.35 |
| Phase B | 500 | $3.20 | ~$10 | +$6.80 |
| Reader total | N | 1× | ~3× | +2× |

Extract call tokens out ~400 (vs answer call ~250), both tokens in grow by ~4k (the passages). Rough net: each case becomes ~3x the reader cost of Step 3 baseline. Full Phase B at ~$50 is within the $70 cap.

Every other bench cost (judge, summarizer, rerank, embeddings) unchanged.

---

## 8. Risk assessment

**R1: Extract call produces malformed JSON.** gpt-4o at temperature 0 is usually reliable with structured-output prompts, but occasional parse failures are expected (3-5%).

**Mitigation:** fallback to single-call path on parse failure. `fallbackUsed` flag tracks rate; published findings will include it. If > 15%, switch to JSON-mode API (`response_format: { type: 'json_object' }`) in a follow-up.

**R2: Extract under-extracts and answer hedges.** If the extractor is too conservative and returns `{"facts": []}`, the answer call gets no context and produces a refusal.

**Mitigation:** the answer prompt allows refusal ("say so briefly"). Judge's LongMemEval rubric scores refusals as incorrect. Diagnostic: `twoCallFactCount` distribution. If > 10% of cases have 0 facts, consider a "be liberal with extraction" prompt change.

**R3: Extract adds latency.** Two sequential calls double latency vs single-call.

**Mitigation:** acceptable for a benchmark (not a user-facing product). Recorded as `avg_latency_ms` in run JSON.

**R4: JSON output consumes tokens unnecessarily.** Structured JSON adds overhead vs freeform.

**Mitigation:** accepted tradeoff for audit-ability and citation fidelity. ~400 max tokens out vs 250 for freeform is a 60% increase, but tokens-in (the passages) dominate cost.

---

## 9. Out of scope

- **Reader-model variants.** Keep reader = gpt-4o for matched discipline. o1/o3/claude variants would be separate experiments.
- **Iterative retrieval.** Agentic re-retrieval ("reader asks what's missing, re-query") is a larger architectural shift.
- **Extract-call caching by passage-set hash.** Could save cost on re-runs but adds complexity. Single run-level cache already handles repeats via `BenchmarkRunner.Cache`.
- **Parallel extract + partial-answer streaming.** Latency-only optimization.
- **Extract-only mode (no answer call, facts returned directly).** Not a LongMemEval-compatible output shape.
- **LOCOMO two-call run.** Add if Tier A GREEN's on LongMemEval-S.

---

## 10. Dependencies

**Verified in place:**
- `ctx.config.reader` is an `IReader` with `.invoke({ system, user, maxTokens, temperature })` returning `{ text, tokensIn, tokensOut, model }`. Pattern used throughout the bench.
- `ctx.costTracker.record({ category, tag, tokensIn, tokensOut, model })` API exists and is called across all current reader paths.
- `BenchmarkRunner.Cache` content-addressed cache exists and is keyed by `computeCaseRunKeyParts` output.

**Not required:**
- No new npm dependencies.
- No agentos changes (purely bench-side).
- No new CLI flags beyond `--two-call-reader`.

---

## 11. References

### Internal

- [COMPREHENSIVE_HANDOFF_2026-04-21.md §7 Option B](../COMPREHENSIVE_HANDOFF_2026-04-21.md) — two-call reader identified as next candidate after Step 13.
- [STEP_13_GRAPH_ACTIVATION_FINDINGS_2026-04-21.md](../STEP_13_GRAPH_ACTIVATION_FINDINGS_2026-04-21.md) — n=9 pattern; reader-conversion drop from 83% to 67%.
- [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md §3.1](../RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md) — Step 3 canonical at 73.2%.

### External

- Emergence AI. 2025. *SOTA on LongMemEval with RAG.* emergence.ai/blog/sota-on-longmemeval-with-rag. 86.0% at gpt-4o using extract-then-answer pattern.
- Wu et al. 2024. *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory.* The benchmark this spec targets.

---

## 12. Self-review checklist

- [x] No "TBD" / "TODO" / placeholder sections.
- [x] Extract + answer prompts are concrete (not `[...]`).
- [x] Scope is single-plan: bench wiring + one new helper + one CLI flag + tests.
- [x] Kill / success criteria explicit (≥78% Tier A).
- [x] Falsification paths clear (A/B/C predictions).
- [x] Fallback path defined (malformed JSON → single-call).
- [x] Cache-fingerprint strategy is content-addressed via prompt hash.
- [x] Out-of-scope explicitly listed.
- [x] Risks + mitigations per risk.
- [x] Dependencies verified.
- [x] No em dashes in prose.
- [x] Honors user no-subagent + no-worktree-with-submodules rules (bench-only change, no agentos submodule, no worktrees).

---

End of Step 14 design spec.
