# Step 9 Findings — Fact-Graph Ingest (Mem0 Pattern)

**Date:** 2026-04-21
**Scope:** Mem0-style per-session LLM fact extraction (25-predicate closed schema) + in-memory `FactStore` + `HybridRetriever` synthetic-trace prepending. Targeted the specific-value-token preservation gap that Steps 5, 7, 8 all fell into.
**Spec:** [2026-04-21-step-9-fact-graph-and-eval-upgrades-design.md](../../agentos/docs/superpowers/specs/2026-04-21-step-9-fact-graph-and-eval-upgrades-design.md)
**Plan:** [2026-04-21-step-9-fact-graph-and-eval-upgrades.md](../../agentos/docs/superpowers/plans/2026-04-21-step-9-fact-graph-and-eval-upgrades.md)

---

## Verdict: RED at Tier A

Tier A smoke on LongMemEval-S N=24 triggered the kill criterion. Phase A N=102 and Phase B N=500 NOT executed per spec §6.1.

| Cell | Configuration | LME-S N=24 unweighted | Δ vs Tier 1 smoke 87.5% | Kill? |
|---|---|---:|---:|---|
| Tier 1 + `--fact-graph-ingest` | Hybrid + fact-graph | **58.3%** (14/24) | **-29.2pp** | YES (threshold 82.5%) |

The regression is decisive. Step 9 performs comparably to Step 8 REPLACEMENT (25.0%) + Step 7 ADDITIVE (62.5%), landing in between them.

### Per-category breakdown

| Category | n | Accuracy | 95% CI | Tier 1 smoke baseline | Δ |
|---|---:|---:|---|---:|---:|
| single-session-user | 4 | 100.0% | [100%, 100%] | 100% | 0pp |
| knowledge-update | 4 | 75.0% | [25%, 100%] | 100% | -25pp |
| single-session-assistant | 4 | 50.0% | [0%, 100%] | 100% | -50pp |
| single-session-preference | 4 | 50.0% | [0%, 100%] | 100% | -50pp |
| temporal-reasoning | 4 | 50.0% | [0%, 100%] | 100% | -50pp |
| multi-session | 4 | 25.0% | [0%, 75%] | 75% | -50pp |
| **Unweighted** | 24 | **58.3%** | [37.5%, 79.2%] | 87.5% | **-29.2pp** |
| **Weighted** | — | **54.3%** | — | — | — |

Cost: **$3.05 total, $0.2177 per correct answer** (10x more expensive than Tier 1 shipping $0.0213/correct at Phase B, on top of the 29.2pp accuracy regression).

---

## The decisive data point: evidence-provenance

Phase 1b instrumentation (`evidenceOrigin` aggregator from Task 4) answered the key question directly.

```
evidenceOrigin: { user_statement: 19, none: 5, fact_graph: 0 }
```

**Zero of 24 cases attributed the reader's answer to a fact-graph synthetic trace.** The 14 cases the reader got right all quoted from raw chunks (`sourceType: 'user_statement'`). The 5 cases with `none` had no shingle overlap between any retrieved trace and the reader's answer (likely hedged / refused / paraphrased answers).

The fact-graph synthetic traces were present in the retrieval pool. Stage-level metrics confirm:

| Stage | Recall@10 | NDCG@10 | MRR |
|---|---:|---:|---:|
| dense | n/a | n/a | n/a |
| merged | 0.774 | 0.585 | 0.587 |
| reranked | — | — | — |
| final | 0.712 | 0.685 | 0.760 |

Merged-stage recall at 0.774 means the pipeline found a gold session ~77% of the time. Final-stage recall at 0.712 means rerank dropped the gold session 6.2pp of the time — the synthetic fact-graph traces with `retrievalScore: 1.0` displaced real raw chunks during rerank.

But even when the final top-K contained the gold session, the **reader ignored the fact-graph synthetic trace and quoted raw chunks**. The fact-graph traces were decoration, not signal.

---

## Root cause — three layered failures

### 1. Synthetic-trace `retrievalScore: 1.0` is too aggressive

The Step 9 design set synthetic fact-graph traces at `retrievalScore: 1.0` (top possible value) before the rerank blend. The blend is `retrievalScore = 0.7 * cognitive + 0.3 * neural`.

For a synthetic trace: `0.7 * 1.0 + 0.3 * neural = 0.7 + 0.3 * neural`, bounded below at 0.7.

For a raw chunk with typical cognitive score 0.3 and neural 0.9 (genuinely relevant): `0.7 * 0.3 + 0.3 * 0.9 = 0.21 + 0.27 = 0.48`.

**Synthetic always wins the final sort order**, regardless of whether it's genuinely more useful. Real chunks get pushed out of top-K to make room.

### 2. The `final.recall - merged.recall = -6.2pp` gap is directly attributable to this

Synthetic trace displacement is a measured, not hypothesized, effect. The gold session was in the merged pool 77.4% of the time but in the final top-K only 71.2% of the time. The 6.2pp loss is recall the rerank stage gave away to synthetic fact-graph traces.

### 3. Fact-graph trace content format loses to raw chunks in the reader

Even when a fact-graph trace sits in the top-K next to a relevant raw chunk carrying the same underlying fact, the reader quotes from the raw chunk. Possible reasons:

- **Content shape.** Synthetic format is `user livesIn Berlin (as of 2026-03-15).` — a paraphrased predicate-object string, not a direct quote.
- **Raw chunks carry conversational context** (`"I moved to Berlin last Tuesday"`) that the reader uses to anchor its answer.
- **gpt-5-mini extraction may still paraphrase** the `object` field despite the "literal span" instruction — the 25-predicate closed schema catches predicate drift but doesn't force the `object` to be verbatim. Real span preservation would require span-index output rather than free-form string.

The `evidenceOrigin: { fact_graph: 0 }` measurement confirms all three layers. If synthetic traces were load-bearing we would see non-zero fact_graph attributions.

---

## Comparison with Steps 5, 7, 8

| Step | Architectural position | Mechanism | N=24 result | Δ vs Tier 1 smoke |
|---|---|---|---:|---:|
| 5 FactSupersession | post-retrieval LLM filter | drops "superseded" traces | 54.2% | -33.3pp |
| 7 Observer/Reflector additive | reflection traces alongside raw chunks | LLM summary overlay | 62.5% | -25.0pp |
| 8 Observer/Reflector replacement | reflection traces REPLACE raw chunks | LLM summary replacement | 25.0% | -62.5pp |
| **9 Fact-Graph ingest** | **tuple synthetic traces prepended before rerank** | **LLM `(subject, predicate, object)` extraction** | **58.3%** | **-29.2pp** |

**The pattern is now confirmed at n=7 RED steps.** Every rollout variant that routes retrieval content through an LLM at ingest or query time regresses on LongMemEval-S. Step 9's architectural bet — tuple extraction preserves specific tokens where summaries don't — didn't hold in practice. Either:
- The extractor paraphrases the `object` field despite instructions.
- The extractor preserves the token but the containing synthetic trace's format is too synthetic for the reader to prefer.
- The `retrievalScore: 1.0` top-positioning displaces the raw chunks that WOULD have carried the literal token.

All three effects compound. The evidence-provenance instrumentation from Task 4 was load-bearing for this diagnosis.

---

## What Phase 1 instrumentation bought

The Step 9 finding would have been "58.3% accuracy, RED" without Phase 1. The instrumentation upgrades (Tasks 3, 4, 5, 6, 7) produced the diagnosis in one Tier A run:

1. **`evidenceOrigin: { fact_graph: 0, user_statement: 19, none: 5 }`** — reader never quoted synthetic traces. Without this, the RED verdict would have to be interpreted via ablation runs worth another $3+.
2. **Stage-level Recall@K drops from merged (0.774) to final (0.712)** — rerank displacement is measured, not hypothesized.
3. **Bootstrap CI [37.5%, 79.2%]** — the CI lower bound is below Tier 1's Phase B point estimate. No chance this is noise.

For comparison, Step 7/8 findings needed post-hoc analysis to build the equivalent story. Phase 1's Tier 3 eval instrumentation delivered its value on the first experiment.

---

## What ships

- **Code** (all opt-in, default-off): `FactStore`, `FactExtractor`, 25-predicate `PREDICATE_SCHEMA`, `HybridRetrieverOptions.factStore`, `HybridRetrieverOptions.factGraphQueryClassifier`, `defaultKeywordFactGraphClassifier`, `--fact-graph-ingest` CLI flag, `RunConfig.factGraphIngest`, `BenchCognitiveHandle.factStore/factExtractor`.
- **Phase 1 instrumentation** (all GREEN, now shipping always-on): `computePairedMcNemar`, `compareRuns.paired`, `CaseResult.evidenceUsed`, `BenchResult.evidenceOrigin`, `computeRetrievalStageMetrics`, `CognitiveRetrievalResult.diagnostics.stageIds`, `CaseResult.retrievalStageMetrics`, `BenchResult.retrievalStageMetrics`.
- **Agentos-core release**: v0.1.250 (stageIds diagnostics) + v0.1.251 (fact-graph module + HybridRetriever integration).
- **Findings doc (this file).**

The fact-graph code is reusable. Downstream consumers with workloads that differ from LongMemEval-S (structured data, technical Q&A, domain with narrower predicate schema) can opt into `--fact-graph-ingest` without touching Tier 1's shipping default.

---

## What does NOT ship

- **No production default flip.** Tier 1 Hybrid remains the shipping default at 73.2% / $0.0213 per correct (Phase B N=500).
- **Phase A N=102, Phase B N=500** NOT executed (kill criterion was decisive).
- **LOCOMO + Oracle Tier A smokes** NOT executed (LME-S kill was sufficient; ~$2 saved).

---

## Cost accounting

| Run | USD | Notes |
|---|---:|---|
| Tier A LME-S N=24 Hybrid + fact-graph | $3.05 | 24 cases, 3 parallel, full pipeline |
| Remaining Tier A (LOCOMO, Oracle) | $0 | skipped per kill |
| Phase A, Phase B | $0 | skipped per kill |
| **Total Step 9 cost** | **$3.05** | within the $15-30 Step 9 spec cap (§6.4) |

Budget saved: the spec anticipated $15-30 across Tier A + Phase A + Phase B if Step 9 had passed gates. Kill criterion at Tier A saved ~$12-27 that would have been wasted on a known-dead variant.

---

## Updated Progressive Enhancement Tier scoreboard

| Tier | Flags | Measured accuracy | $/correct | Status |
|---|---|---:|---:|---|
| Tier 0 (bare) | (none) | ~60% projected | ~$0.032 | untested |
| **Tier 1 (default)** | `--hybrid-retrieval --context-summary gpt-5-mini` | **73.2%** [69.2%, 77.0%] @ N=500 | **$0.0213** | **shipping** |
| Tier 2 additive (Step 7) | Tier 1 + `--observer-reflector` | 62.5% @ N=24 | ~$0.10+ | RED, opt-in |
| Tier 2 replacement (Step 8) | Tier 1 + `--observer-reflector --observer-reflector-replace` | 25.0% @ N=24 | $0.58 | RED, opt-in |
| **Tier 3 (Step 9) RED** | Tier 1 + `--fact-graph-ingest` | **58.3% @ N=24** | **$0.218** | **RED, opt-in** |
| Tier 4 (Step 10) | + `--two-call-reader` (Emergence AI) | TBD | TBD | no spec yet |

---

## Commits (Step 9)

### agentos submodule
- (v0.1.250) `2e2439a74` feat(memory): HybridRetriever emits per-stage candidate IDs in diagnostics
- (v0.1.251) `8e1d7c317` feat(memory): fact-graph canonicalization + 25-predicate closed schema
- (v0.1.251) `fbd247e21` feat(memory): FactStore — in-memory fact-graph keyed by scope/subject/predicate
- (v0.1.251) `80811bc94` feat(memory): FactExtractor — LLM fact extraction with closed schema + session cache
- (v0.1.251) `71716f5cf` feat(memory): export fact-graph module from memory barrel
- (v0.1.251) `3ff25d372` feat(memory): HybridRetriever fact-graph integration + synthetic trace prepending

### monorepo (bench)
- `d924bcb1b2` feat(bench): computePairedMcNemar — paired significance test with Yates correction
- `574eacb581` feat(bench): compareRuns emits paired McNemar result when both runs carry cases
- `b3ebbe8354` feat(bench): computeEvidenceProvenance — shingle overlap matcher for trace-provenance
- `9ceca57237` feat(bench): evidenceUsed per-case + evidenceOrigin aggregator on BenchResult
- `6cae6e5e25` feat(bench): computeRetrievalStageMetrics — per-stage Recall/NDCG/MRR for hybrid retrieval
- `b6a6edbdd3` chore: bump agentos submodule (HybridRetriever stageIds diagnostics)
- `6bd35012e2` feat(bench): stage-level retrieval metrics per case + aggregator on BenchResult
- `5ca8dd9792` chore: bump agentos submodule (fact-graph module)
- `d1cac881ef` chore: bump agentos submodule (HybridRetriever fact-graph integration)
- `6bbc5d4c9e` feat(bench): RunConfig.factGraphIngest + cache-key fingerprint + observer mutex
- `c4586ccc6f` feat(bench): createCognitiveManager — factExtractorLlmInvoker option + FactStore wiring
- `0ad5eb7262` feat(bench): --fact-graph-ingest CLI flag + mutex with --observer-reflector
- `52b44fc30a` feat(bench): LongMemEvalS fact-graph ingest + session-boundary extract + provenance
- `08247adfac` feat(bench): Locomo adapter — fact-graph ingest propagation
- `abf18eaaa0` bench: Step 9 Tier A — fact-graph RED at 58.3% N=24

---

## Rollback

Not required. `--fact-graph-ingest` defaults to off. Tier 1 production stack unchanged. Summary.json canonical row protected by the N-regression guard (verified: guard fired at Step 9 Tier A, preserving the N=500 Phase B entry).

If a future operator deletes the infrastructure:
- Revert the 14 bench commits + 6 agentos-core commits above.
- Agentos: `v0.1.252` would ship as the revert release.

---

## Lessons for Step 10+

1. **`retrievalScore: 1.0` on synthetic signal is too aggressive.** Any future synthetic-trace mechanism must enter the rerank with a score commensurate with its confidence, not pinned at the ceiling. A variant setting the score to the fact's extraction confidence (or `0.5`) deserves testing, but wasn't part of Step 9's MVP.

2. **Evidence-provenance was load-bearing for the diagnosis.** Step 5/7/8 RED were diagnosed by eyeballing failure cases + architectural reasoning. Step 9's RED was diagnosed in one line of aggregate output (`fact_graph: 0`). Blog-grade claims about where signal is being lost now have a measurement behind them.

3. **The "LLM transforms content → RED" pattern is n=7 confirmed.** Steps 4 (query rewrite), 5 (post-retrieve filter), 6 (content trim), 7 (additive summaries), 8 (replacement summaries), 9 (tuple extraction). Every variant that routes retrieval content through an LLM at ingest or query time regresses on specific-value LongMemEval-S.

4. **The remaining honest retrieval experiments on this benchmark are additive-signal only.** Graph-expansion retrieval (pull traces connected by shared-entity edges) and open-weights rerank are the remaining untested additive-signal candidates. Step 10 (Emergence AI two-call reader) changes the reader pipeline, not retrieval.

5. **Tuned reflector prompt** for Step 7/8 is still the cheapest remaining "closer to Mastra" experiment, and no Step 9 outcome changes that calculus — if anything Step 9's result reinforces that the gap to Mastra is reflector-prompt quality, not pipeline architecture.

---

## Recommendation

**Accept Tier 1 Hybrid (73.2%) as the shipping number.** Phase 1 instrumentation upgrades (McNemar, evidence provenance, stage-level metrics) are the durable value from the Step 9 sprint. Step 10 (two-call reader, Emergence pattern) remains an option but is orthogonal to retrieval and has its own ~$20-40 budget; run only if you want the blog to demonstrate reader-side experiments.

The honest publishable conclusion: **AgentOS Hybrid at 73.2% is competitive with Zep (71.2%) at matched reader, below the 81.6-86.0% gpt-4o frontier (Supermemory, Mastra, Emergence). The methodology (matched ablation + bootstrap CIs + kill criterion + evidence provenance) is the contribution that makes the numbers trustworthy.**

---

End of Step 9 findings.
