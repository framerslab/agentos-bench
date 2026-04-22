# Step 14 Findings — Two-Call Reader (Emergence AI pattern)

**Date:** 2026-04-21
**Scope:** Split the bench's single reader.invoke into an Emergence-style extract-then-answer pair. Extract call: raw retrieved passages → JSON fact scratchpad with passage-id citations. Answer call: scratchpad only → final answer (no raw passages in final context).
**Spec:** [specs/2026-04-21-step-14-two-call-reader-design.md](specs/2026-04-21-step-14-two-call-reader-design.md)
**Plan:** [plans/2026-04-21-step-14-two-call-reader-plan.md](plans/2026-04-21-step-14-two-call-reader-plan.md)
**Baseline:** Step 3 Hybrid canonical = 73.2% unweighted at N=500 (shipping).
**Kill gate:** unweighted ≥ 78% at Tier A (≥ +5pp vs canonical).

---

## Verdict: RED — pattern now n=10

Three Tier A variants run against the 73.2% canonical, all below both the 78% kill gate AND the 73.2% shipping baseline:

| Variant | N | Extract prompt | Max extract tokens | Fallback rate | Fact count (mean) | Unweighted | CI |
|---|---:|---|---:|---:|---:|---:|---|
| **v1 (selective)** | 24 | "only facts bearing on the query" | 400 | 24/24 (100%) | 0.0 | 37.5% | [16.7%, 58.3%] |
| **v2 (tolerant parse)** | 24 | same as v1 | 400 | 0/24 | 1.3 | **45.8%** | [25.0%, 66.7%] |
| **v3 (inclusive, wider tokens)** | 24 | "extract EVERY fact, err on inclusion" | 1200 | 1/24 | **14.2** | **45.8%** | [25.0%, 66.7%] |

v1 → v2 fixed a code-fence wrapping bug in JSON parsing (stripJsonWrappers tolerates ```json blocks and embedded JSON). v2 → v3 lifted the extract-prompt aggressiveness 10× (mean factCount 1.3 → 14.2). **Accuracy stayed at 45.8%.** Extraction volume is not the bottleneck.

Canonical v3 run: [results/runs/2026-04-22T04-13-02-416--longmemeval-s--gpt-4o--full-cognitive--ingest.json](../results/runs/2026-04-22T04-13-02-416--longmemeval-s--gpt-4o--full-cognitive--ingest.json).

### Per-category (v3, the best variant)

| Category | n | v3 | Step 3 canonical (N=500 reference) | Δ |
|---|---:|---:|---:|---:|
| single-session-user | 4 | 75.0% | 97.1% | −22.1pp |
| knowledge-update | 4 | 75.0% | 86.8% | −11.8pp |
| single-session-assistant | 4 | 75.0% | 89.3% | −14.3pp |
| single-session-preference | 4 | 50.0% | 60.0% | −10.0pp |
| multi-session | 4 | **0.0%** | 54.9% | **−54.9pp** |
| temporal-reasoning | 4 | **0.0%** | 70.2% | **−70.2pp** |
| **Unweighted** | 24 | **45.8%** | 73.2% | **−27.4pp** |

Multi-session and temporal-reasoning collapsing to **0%** is the decisive signal.

Cost: $0.68 / case-run, cost/correct $0.062 (vs single-call canonical $0.021/correct). Roughly 3× more expensive and substantially less accurate.

---

## Root cause analysis

### Why atomization destroyed cross-fact reasoning

The extractor turns a coherent passage block into a flat list of atomic facts. Each fact preserves its own literal tokens, but the cross-fact structure that the single-call reader synthesizes — temporal ordering, causal precedence, multi-session co-reference — is lost in the JSON scratchpad shape.

Single-call reader workflow (at K=10):
- Sees 10 raw passages with their original narrative context.
- Multi-session question "Did user travel to Berlin before or after they started their new job?" → reader reads both passages, identifies dates, reasons temporally, answers.
- Temporal question "When did user last mention their water bill?" → reader scans passages in retrieved order, picks the most recent date, answers.

Two-call reader workflow (at K=10):
- Extract call sees 10 passages, atomizes them: `facts: ["User traveled to Berlin on Apr 2023", "User started new job on Feb 2024", "Water bill mentioned with $150 on May 2025", "Water bill mentioned with $165 on Nov 2025"]`.
- Answer call sees only the fact list. Facts have no passage ordering, no temporal reasoning chain, no session-level context.
- Reader has to reconstruct temporal order from bare dates inside text — possible but much harder than reading the original passages sequentially.

**The extractor is loss-ful, and the lost information is exactly what multi-session and temporal-reasoning questions need.** Specific-value categories (single-session-user / knowledge-update / assistant) still work at ~75% because those questions are directly-answerable from a single fact.

### Why Emergence AI's 86% doesn't carry over

Emergence AI publishes 86.0% at gpt-4o using two-call reader. Our stack hits 45.8% at N=24 with the same architectural shape. Likely differences:

1. **Retrieval top-K.** Emergence may use K=30-50 where context dilution is high and extraction filters effectively. Our Hybrid K=10 is already concentrated; filtering further removes signal rather than noise.
2. **Extract prompt tuning.** Emergence's prompt is not public. Our v3 "inclusive" variant with 14.2 facts/query didn't help, so this is likely not the gap.
3. **Answer prompt scaffolding.** Emergence may have a richer answer-call prompt that reconstructs temporal / cross-fact structure explicitly. Not tested.
4. **Different rerank + context shape.** Our rerank gives a specific order that the single-call reader uses implicitly; atomizing into facts discards that signal.

The most likely explanation: two-call reader GAINS in noisy-context regimes (large K, poor retrieval) but LOSES in concentrated-context regimes (small K, high-quality retrieval). Our stack is the latter.

### What the three-attempt journey proved

| Attempt | Lesson |
|---|---|
| v1 fallback-100% | Tolerant JSON parsing is necessary. gpt-4o output must survive code-fence / prose wrappers. |
| v2 fallback-0%, factCount 1.3 | Default "only directly-relevant facts" prompt under-extracts at our scale. |
| v3 inclusive, factCount 14.2 | Extraction volume does not fix the fundamental atomization loss. Accuracy is identical to v2 despite 10× more facts. |

v2 → v3 with identical 45.8% is the strongest falsification: **it's not how many facts are extracted, it's that atomization itself breaks cross-fact reasoning on this benchmark's query distribution.**

---

## Pattern update: n=10 confirmed

| # | Step | Mechanism | Verdict |
|---:|---|---|---|
| 1 | 2 | SessionRetriever without rerank | RED |
| 2 | 4 | HyDE query rewrite | RED |
| 3 | 5 | FactSupersession (LLM post-retrieval filter) | RED |
| 4 | 6 | Split-on-Ambiguous (rerank-score content trim) | RED |
| 5 | 7 | Observer/Reflector additive overlay | RED |
| 6 | 8 | Observer/Reflector replacement | RED |
| 7 | 9 | Fact-graph tuple extraction | RED |
| 8 | 11 | Tuned reflector prompt | NULL |
| 9 | 12 | BM25 parity for reflection traces | NULL |
| 10 | 13 | Heuristic graph activation | RED |
| 11 | **14** | **Two-call reader (Emergence AI pattern)** | **RED** |

**The n=10 pattern now spans both retrieval-layer AND reader-layer architectural additions.** Every experiment that sits on top of the Step 3 Hybrid canonical (BM25 + dense RRF + Cohere rerank) has regressed or been null at matched gpt-4o reader + gpt-4o judge on specific-value LongMemEval-S.

Step 14 is the strongest form of this pattern because it tests the **reader** side, which the n=9 pattern explicitly pointed to as "not yet tested." Two-call reader was the clearest remaining architectural lever per Emergence AI's published 86% result. Failing here eliminates the last straightforward architectural experiment on this benchmark.

---

## What ships regardless of the RED verdict

Durable value independent of accuracy outcome:

- **`twoCallRead`** helper in [packages/agentos-bench/src/readers/twoCallReader.ts](../src/readers/twoCallReader.ts). Reusable Emergence-pattern implementation with:
  - Tolerant JSON parser (strips ```json code fences, extracts embedded JSON from prose).
  - Configurable extract / answer max-token budgets.
  - Fallback path that accepts a caller-supplied `fallbackSystemPrompt` so malformed-JSON cases run identical to pre-Step-14 baseline.
  - `EXTRACT_PROMPT_HASH` content-addressed cache-key fingerprint (mirrors Step 11 `REFLECTOR_PROMPT_HASH` pattern).
- **9 unit tests** pinning happy path, code-fence stripping, embedded-prose extraction, malformed-JSON fallback, schema-mismatch fallback, empty-facts answer path, multi-passage citation round-trip, token accounting, fallback-system-prompt contract.
- **5 bench wiring tests** pinning RunConfig threading, cache fingerprint content-addressed invalidation, CLI flag propagation.
- **`--two-call-reader`** CLI flag + `RunConfig.twoCallReader` + cache fingerprint.
- **Bench adapter integration** in [LongMemEvalS.ts::runCase](../src/benchmarks/longmemeval/LongMemEvalS.ts) with per-call cost tracking (`<caseId>:extract` + `<caseId>:answer`) and metadata surfacing (`twoCallFallbackUsed`, `twoCallFactCount`).

Downstream consumers with different retrieval shapes (large K, noisy top-K) can enable `--two-call-reader` and the helper may work for them even though it does not help our pipeline.

---

## What does NOT ship

- No production default flip. Tier 1 Hybrid remains shipping at 73.2% N=500.
- No Phase A N=102 run. Three consecutive Tier A variants all below baseline; kill criterion decisive.
- No weight-tuning / prompt-iteration follow-up. v2 vs v3 at identical 45.8% despite 10× extraction volume proves the issue is architectural.

---

## Cost accounting

| Attempt | Description | Duration | Cost |
|---|---|---:|---:|
| v1 | Selective prompt, 400-token extract, 100% fallback | ~60s (cache-hot) | $0.91 |
| v2 | Tolerant parsing, 400 tokens, 0% fallback | ~70s | $0.48 |
| v3 | Inclusive prompt, 1200 tokens, 1/24 fallback | ~3 min | $0.68 |
| **Total Step 14** | | | **$2.08** |

Well under the $70 spec cap. Cache-hot ingest reused prior-run artifacts so each iteration cost only reader + judge. Phase A N=102 skipped (would have been ~$10 more, no reason to fire given Tier A < canonical).

---

## Reader-side experiments are exhausted for this workload

Pre-Step-14, the n=9 pattern established that every retrieval-layer addition regressed. Step 14 tested the clearest remaining lever — the **reader-side** Emergence split — and it regressed too. What remains:

### Closed

- Retrieval-layer experiments (Steps 2, 4, 5, 6, 7, 8, 9, 13 all RED; Steps 11, 12 null).
- Reader-architecture experiments via extract-then-answer split (Step 14 RED across 3 variants).

### Not tested but low expected value

- **Reader model upgrade (gpt-4o → o1 / o3 / claude-opus-4.7).** Would break matched-reader discipline for any competitor comparison. o1 is ~10× the cost; expected to lift by a few pp but changes the narrative from "AgentOS memory architecture" to "bigger reader, same memory."
- **Prompt engineering on the single-call reader.** CoT scratch, evidence-citation formatting, refusal scaffolding. Likely a few pp but brittle.
- **Iterative / agentic retrieval.** Reader asks "what's missing" and re-queries. Multi-round loop. High complexity; unclear EV.

### Published cleanly as-is

- The n=10 RED/null methodology is itself publishable. Every step has bootstrap CIs, matched-ablation discipline, evidence-provenance instrumentation, content-addressed caching, and documented root-cause analysis. Few memory-system rollouts publish with this discipline.
- 73.2% at matched gpt-4o is defensible against Zep (71.2%), sits below the 81.6-86.0% frontier band where Supermemory, Mastra, and Emergence sit with different architectural bets. The gap is real; the methodology is the contribution.

---

## Recommendations

### Close the retrieval + reader architectural-variant rollout

10 consecutive RED/null experiments with bootstrap-gated matched-ablation discipline is strong evidence that the LongMemEval-S benchmark specifically rewards a narrow band of architectural choices (our Step 3 Hybrid + single-call reader sits near the local maximum for our infrastructure). Additional variants at the retrieval or reader layer are unlikely to move the number significantly without changing the reader model (gpt-4o → larger) or the benchmark itself.

### Publish

The rollout is complete. The blog post + umbrella findings + leaderboard + per-step findings docs cover the full story. Three honest claims:

1. **73.2% unweighted at matched gpt-4o, Phase B N=500, CI [69.2%, 77.0%].** Above Zep (71.2%), below Supermemory / Mastra / Emergence.
2. **+13.7pp over Step 1 dense-only baseline at matched reader.** Real architectural win for Step 3 Hybrid.
3. **n=10 RED/null pattern across retrieval-layer and reader-layer architectural additions**, each with bootstrap CIs and matched-ablation methodology. Publication-grade empirical discipline.

### If pushing past 80% is hard requirement

Two paths:

1. **Reader upgrade (off-methodology).** Run the shipping Tier 1 Hybrid stack with gpt-5 / o1 / claude-opus-4.7 reader. Expected: ~80%+ because the reader conversion rate bottleneck dissolves. Cost: $40-100 at Phase B. Breaks matched-reader comparison with published competitors.
2. **Abandon LongMemEval-S for LongMemEval-M or LongMemEval-L.** Different haystack sizes, different query distribution. Our K=10 + single-call might hit differently at M/L. Fresh benchmarking territory. Cost: large (M at 500 sessions/case, L at 5000).

My honest read: **accept + publish at 73.2%**. The story is the methodology, not the number.

---

## Commits

Bench-only; no agentos changes.

Pending sign-off:
- Code + tests (helper, wiring, flag, test files)
- Findings + docs integration (this file, umbrella, blog, handoff, leaderboard)
- Run artifacts (3 Tier A variants + logs)

---

## Rollback

Not required. All changes strictly additive + feature-gated. `--two-call-reader` default off. Tier 1 shipping unchanged.

---

End of Step 14 findings.
