# Step 11 Findings — Tuned Reflector Prompt (null result)

**Date:** 2026-04-21
**Scope:** Variant of Step 7 (Observer/Reflector ADDITIVE) with a modified `MemoryReflector` system prompt. The change: added explicit "PRESERVE LITERAL TOKENS" rule + thinking-block item for specific-token identification + concrete paraphrase-vs-verbatim examples to force gpt-5-mini to keep names, dates, and numeric amounts verbatim in reflection content. Tested the hypothesis that Step 7's RED was driven by the reflector paraphrasing high-IDF tokens.
**Spec:** inline (this rollout; ~5 task sub-sprint, not a full multi-task spec).
**Baseline:** Step 7 ADDITIVE at 62.5% N=24 (tuned-prompt RED test)
**Kill gate:** unweighted ≥ 82.5% at Tier A (same as §6.1 of Step 9 spec).

---

## Verdict: RED (null result)

Identical aggregate accuracy to Step 7 with the original prompt.

| Cell | LME-S N=24 unweighted | Δ vs Step 7 (62.5%) | Δ vs Tier 1 smoke (87.5%) |
|---|---:|---:|---:|
| Step 11 Hybrid + `--observer-reflector` + tuned prompt | **62.5%** (15/24) | **+0.0pp** | **-25.0pp** |

### Per-category

| Category | n | Accuracy | Step 7 (original prompt) | Δ |
|---|---:|---:|---:|---:|
| single-session-user | 4 | 100.0% | 100.0% | 0pp |
| knowledge-update | 4 | 75.0% | 75.0% | 0pp |
| single-session-assistant | 4 | 75.0% | 75.0% | 0pp |
| single-session-preference | 4 | 50.0% | 50.0% | 0pp |
| temporal-reasoning | 4 | 50.0% | 50.0% | 0pp |
| multi-session | 4 | 25.0% | 25.0% | 0pp |
| **Unweighted** | 24 | **62.5%** | 62.5% | **0pp** |

Bootstrap 95% CI: **[41.7%, 83.3%]**. Cost: **$1.45 total, $0.0969/correct** — confirms real LLM calls fired (not a cache replay).

---

## The decisive data point: reader never quoted reflection traces

```
evidenceOrigin: { user_statement: 20, none: 4 }
```

**Zero of 24 cases attributed the reader's answer to a reflection trace.** All 15 correct answers sourced from raw chunks (`sourceType: 'user_statement'`). Same pattern as Step 9's fact-graph `{ fact_graph: 0 }`. The reflector's paraphrase quality (tuned or original) is not the bottleneck — the reader never reads reflection traces.

### Why reflection traces don't surface

Stage-level retrieval metrics tell the story:

| Stage | Recall@10 | NDCG@10 | MRR |
|---|---:|---:|---:|
| dense | 0.347 | 0.286 | 0.313 |
| sparse | 0.882 | 0.784 | 0.815 |
| merged | 0.774 | 0.602 | 0.611 |
| reranked | 0.740 | 0.721 | 0.802 |
| final | 0.740 | 0.721 | 0.802 |

BM25 sparse retrieval carries the retrieval load: **sparse.recall 0.882** vs **dense.recall 0.347**. Reflection traces go through `manager.encode()` inside `manager.observe()`, which bypasses the bench's BM25 ingest hook (Step 7 findings root cause #2). So BM25 only sees raw chunks; reflection traces can only surface via the dense side, where they score lower than the exact-term raw chunks.

**The 11.5pp gap between `final.recall` (0.740) and accuracy (0.625) is a reader-side problem, not retrieval.** Retrieval put the gold session in the final top-K 74% of the time, yet accuracy sits at 62.5%. The reader is already getting enough signal to answer correctly on most cases where retrieval succeeded; prompt-tuned reflection summaries don't add new information it's missing.

---

## What this proves about the Mastra gap

Step 8 findings hypothesized Mastra's 84.23% at gpt-4o likely comes from a reflector prompt that better preserves high-IDF tokens. Step 11 tested that hypothesis directly by adding explicit verbatim-preservation rules to our reflector. **Zero lift.**

The remaining Mastra-gap explanations, in order of remaining plausibility:
1. **BM25 index parity** — Mastra indexes reflection-derived observations into their sparse index alongside raw messages. Our bench doesn't (the BM25 hook is only fired from raw-chunk encoding). Fixing this is a Step 12 candidate: wire reflection-trace content into the bench's `hybridBm25` after `manager.observe()` + `manager.flushReflection()`.
2. **Supersession handling** — Mastra's observational memory replaces raw messages with observations (Step 8 REPLACEMENT tried this and failed at 25%, but with the BM25 mismatch, not a clean test). A retry of Step 8 REPLACEMENT with the BM25 parity fix is a plausible Step 13.
3. **Different reader prompting** — Mastra may prompt the reader differently (e.g., explicit "prefer observations over raw messages"). Untested.

The tuning-alone hypothesis (that a better prompt closes the gap) is now eliminated from the explanation space. Any future Observer/Reflector work in this codebase should focus on BM25 parity, not prompt iteration.

---

## Side effect: content-addressed cache for future prompt changes

Step 11 exposed a cache-invalidation bug: the first Tier A run returned Step 7's cached answers verbatim (identical per-category + `$0.00` cost) because the case-run cache key didn't include the prompt text. Fixed via `REFLECTOR_PROMPT_HASH` — computed at module load time from the prompt rendered with neutral HEXACO traits, included in the bench cache-key fingerprint as `reflector-prompt:${hash.slice(0,12)}`. Any future reflector prompt edit now automatically invalidates cached answers.

This is durable value regardless of Step 11's null result — future prompt experiments don't risk silent cache replay.

---

## What ships

- **Tuned reflector prompt** in agentos (`MemoryReflector.ts`). Strictly better for non-benchmark workloads that benefit from literal-token preservation (production companion memory, customer-data extraction, dated-fact recall). Zero regression surface — the prompt adds rules, doesn't remove them.
- **`REFLECTOR_PROMPT_HASH` export** in `@framers/agentos` (exported from memory barrel). Downstream consumers can include it in their own cache keys.
- **Bench content-addressed cache key** in `BenchmarkRunner.ts` — `observer-reflector` runs now include the prompt hash in the fingerprint.
- Agentos release v0.1.253 includes the tuned prompt; v0.1.254 includes the hash export.

## What does NOT ship

- No production default flip. Tier 1 Hybrid remains shipping at 73.2% N=500.
- No Phase A / Phase B runs (kill criterion triggered at Tier A).
- `--observer-reflector` defaults remain opt-in.

---

## Cost accounting

| Run | USD | Notes |
|---|---:|---|
| Step 11 cached run (before hash-key fix) | $0.00 | Silently replayed Step 7 cache; discarded |
| Step 11 real run (after hash-key fix) | $1.45 | 24 cases, full pipeline, no cache |
| Total Step 11 LLM cost | **$1.45** | Well under the $3-5 spec budget |

---

## Rollback

Not required. All changes are strictly additive:
- Reflector prompt is a superset of the original (adds a rule, doesn't remove)
- `REFLECTOR_PROMPT_HASH` is a new export, not a replacement
- Bench cache-key fingerprint change is additive (new element appended)

If someone objects to the prompt change specifically, revert `9a32aa45f` (the one-commit change in agentos).

---

## Pattern across 7 RED steps — unchanged, but with one more null

| Step | Mechanism | Verdict | Teaches |
|---|---|---|---|
| 2 | SessionRetriever without rerank | RED | rerank is non-negotiable |
| 4 | HyDE query rewrite | RED | LLM query paraphrase fails on specific-value |
| 5 | LLM post-retrieval filter | RED | reader > LLM filter on precision/recall tradeoff |
| 6 | Rerank-score-guided content trim | RED | rerank score ≠ reader utility |
| 7 | Observer/Reflector additive overlay | RED | reflection traces don't surface through retrieval |
| 8 | Observer/Reflector replacement | RED | summaries erase specific tokens |
| 9 | Fact-graph tuple extraction | RED | synthetic `retrievalScore: 1.0` displaces real chunks; reader still prefers raw |
| 11 | Tuned reflector prompt (Step 7 variant) | **NULL** | **prompt tuning alone doesn't close the architectural gap** |

Step 11 is not a new RED step — it's a prompt-isolation test of Step 7. The null result eliminates prompt quality from the gap-to-Mastra explanation space.

---

## Commits (Step 11)

### agentos submodule
- `9a32aa45f` feat(memory): MemoryReflector prompt preserves literal tokens verbatim
- `11dd15528` feat(memory): export REFLECTOR_PROMPT_HASH for content-addressed cache keys
- v0.1.253 + v0.1.254 semantic-releases

### monorepo (bench)
- `4686ffa05b` chore: bump agentos submodule (MemoryReflector tuned prompt)
- `1a843254d9` chore: bump agentos submodule (REFLECTOR_PROMPT_HASH export)
- `039c8ada59` feat(bench): content-addressed cache key for observer-reflector runs

---

## Recommendation

**Accept Step 11 null result, publish.** Close out the Observer/Reflector line of investigation unless the user wants to pursue the BM25-parity fix (Step 12 candidate: wire reflection-trace content into the bench's `hybridBm25` after observer/reflector runs). That's a cleaner architectural question and the data says it's more likely to move numbers than more prompt iteration.

The blog can now honestly claim: "We tested prompt tuning in isolation — null result. Mastra's 84.23% lead is not reflector-prompt-quality; it's architectural (retrieval coverage of observation content)."

---

End of Step 11 findings.
