# AgentOS Memory: 73.2% on LongMemEval-S at Matched Reader, and What We Learned From Seven Negative Results

**TL;DR.** AgentOS hit 73.2% unweighted accuracy [69.2%, 77.0%] on LongMemEval-S Phase B N=500 at gpt-4o reader + gpt-4o judge, with 54.9% on multi-session (n=133), 86.8% on knowledge-update, and $0.0213 per correct answer. The result comes from one GREEN feature (BM25 + dense RRF + Cohere rerank blend) out of nine tested. The other seven retrieval ideas (a hierarchical session retriever, HyDE query rewriting, an LLM fact-supersession filter, rerank-guided content splitting, an additive Observer/Reflector overlay, a replacement-semantics Observer/Reflector, and a Mem0-style fact-graph tuple extractor) all regressed. Total measurement cost across nine matched-ablation studies: ~$26.53. A kill-criterion discipline caught seven of eight losing variants at Tier A smokes, saving roughly $30 in wasted Tier B spend.

The headline isn't SOTA. Mem0 currently advertises [92.0](https://mem0.ai/research-2) to [93.4](https://docs.mem0.ai/core-concepts/memory-evaluation) depending on page, Emergence AI reports [86%](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag), and Mastra's Observational Memory reports [84.23% at gpt-4o and 94.87% at gpt-5-mini](https://mastra.ai/research/observational-memory). Our 73.2% sits above [Zep/Graphiti's 71.2% at gpt-4o](https://blog.getzep.com/state-of-the-art-agent-memory/) and below the frontier systems. What we have that most of those don't: eight controlled ablations, bootstrap-gated confidence intervals on every claim, and a methodology that treats matched-reader cost comparison as a hard requirement. The 73.2% is also a PROGRESSIVE-ENHANCEMENT baseline: every AgentOS consumer can opt into additional tiers (observer pipelines, fact graphs, two-call readers) to trade more ingest cost for higher accuracy as their workload warrants.

---

## Why LongMemEval, and why the number you see depends on the methodology

[LongMemEval (Wu et al., ICLR 2025, arXiv:2410.10813)](https://arxiv.org/abs/2410.10813) is a 500-question benchmark for long-term chat-assistant memory. Questions fall into six categories: single-session-user, single-session-assistant, single-session-preference, knowledge-update, multi-session, and temporal-reasoning. The real-world prior over these categories is uneven: multi-session and temporal each account for ~27% of queries, knowledge-update 16%, preferences 6%. Weighted accuracy matters because the distribution over category difficulty is not flat.

[LOCOMO (Maharana et al., ACL 2024, arXiv:2402.17753)](https://arxiv.org/abs/2402.17753) provides a complementary harder regime: 10 conversations averaging 300 turns and 9,000 tokens each, with adversarial questions designed to catch systems that hallucinate across sessions. [Penfield Labs' 2024 audit of LOCOMO](https://github.com/dial481/locomo-audit) found the ground-truth answer key contains roughly 99 errors across the 10 conversations, and the published judge accepts up to 63% of intentionally-wrong answers as correct. If you run LOCOMO naively, you're measuring a combination of your system plus the judge's false-positive rate.

That audit is why we added a judge-adversarial probe to our methodology (Step 1 of the rollout). The probe synthesizes topically-adjacent wrong answers, runs them through the same gpt-4o judge, and reports the false-positive rate as a floor. If a proposed improvement lifts accuracy by less than the judge's noise floor, it isn't a real improvement. On LongMemEval-style cases with gpt-4o judging, the FPR is manageable (low teens), but the probe runs every time so we never over-claim tiny deltas.

The published leaderboard at gpt-4o reader, roughly sorted, looks like this:

| System | LongMemEval-S | Notes |
|---|---:|---|
| Vanilla full-context (baseline) | ~60% | [Zep replication at gpt-4o](https://blog.getzep.com/state-of-the-art-agent-memory/) |
| [Zep / Graphiti](https://blog.getzep.com/state-of-the-art-agent-memory/) | 71.2% | temporal knowledge graph |
| **AgentOS Step 3 Hybrid** | **73.2%** | this work, Phase B N=500 |
| [Mastra Observational Memory (gpt-4o)](https://mastra.ai/research/observational-memory) | 84.23% | observer + reflector compression |
| [Emergence AI RAG](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag) | 86% | two-stage session retrieval + NDCG |
| [Mem0](https://mem0.ai/research-2) | 92.0-93.4* | public benchmark page and docs currently disagree |
| [Mastra Observational Memory (gpt-5-mini)](https://mastra.ai/research/observational-memory) | 94.87% | different reader, not matched |

* Mem0's public benchmark page advertises 92.0 on LongMemEval, while Mem0's docs page reports 93.4. We treat that as a source-verification caveat until the public numbers converge.

Our number at matched reader puts us between Zep and the frontier, not at the frontier. We'll explain what we added on top of the baseline, what we tried that didn't work, and why the methodology matters for anyone trying to trust these numbers.

---

## The architecture that worked: BM25 + dense RRF + rerank blend on top of cognitive scoring

AgentOS is not just a memory store. The framework ships with working memory slots (Baddeley's 7±2 model, modulated by HEXACO traits), PAD emotional congruence scoring, spreading activation over an entity-relation graph, consolidation mechanisms (reconsolidation, retrieval-induced forgetting, emotion regulation), and a multimodal indexer that bridges images, audio, video, and PDFs into the same vector store and cognitive memory. The piece that moves LongMemEval numbers is the retrieval layer, so that's what the rest of this post covers.

### Step 0: what the baseline already had

Before the six-step rollout started, AgentOS retrieval combined two things.

First, a six-signal cognitive priority score computed over trace candidates:

```typescript
// packages/agentos/src/memory/core/decay/RetrievalPriorityScorer.ts
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  strength: 0.25,
  similarity: 0.35,
  recency: 0.10,
  emotionalCongruence: 0.15,
  graphActivation: 0.10,
  importance: 0.05,
};
```

Similarity is cosine similarity of the query embedding to the trace embedding. Strength is a time-decayed encoding strength per Ebbinghaus's classical forgetting curve. Recency is exponential decay from the last access. EmotionalCongruence aligns the current PAD mood with the trace's stored valence. GraphActivation is spreading activation (Anderson 1976) from entities mentioned in the query across the knowledge graph. Importance blends provenance confidence with a base term.

Second, [Anthropic's September 2024 Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval). Every chunk gets prepended with a brief LLM-generated summary of the session it came from before embedding. Anthropic reported a 35% reduction in retrieval failure from contextual embeddings alone, 49% combined with contextual BM25, and 67% when reranking was added. We use the same shape: session summaries generated by gpt-5-mini at ingest, cached on disk, prepended before embedding.

The Step 1 baseline run at matched gpt-4o reader scored 59.8% unweighted at Phase A N=102. Enough to motivate the next steps, not good enough to ship.

### Step 3: hybrid retrieval, the only GREEN feature

The change that moved the number is a straightforward combination of three signal sources, fused at query time and passed through a neural reranker.

```typescript
// packages/agentos/src/memory/retrieval/hybrid/HybridRetriever.ts
async retrieve(query, mood, scope, options) {
  // Dense: MemoryStore.query with 6-signal cognitive scoring,
  //        over-fetching at topK = recallTopK * 3.
  const { scored: denseScored } = await this.memoryStore.query(
    effectiveQuery, mood, { topK: overFetchTopK, scopes: [scope] },
  );

  // Sparse: per-instance BM25Index (k1=1.5, b=0.75).
  const sparseResults = this.bm25.search(effectiveQuery, overFetchTopK);

  // Rank-based fusion via Cormack et al. 2009.
  const merged = reciprocalRankFusion(denseRanked, sparseRanked, {
    denseWeight: 0.7, sparseWeight: 0.3, k: 60,
  });

  // Hydrate sparse-only IDs against dense pool (MVP: skipped, ~0% drop rate).
  // Then rerank.

  if (this.rerankerService && hydrated.length > 0) {
    const rerankerOutput = await this.rerankerService.rerank(
      { query, documents: hydrated.map(t => ({ id, content, originalScore })) },
      { topN: hydrated.length },
    );
    for (const trace of hydrated) {
      const neural = neuralScores.get(trace.id);
      trace.retrievalScore = 0.7 * trace.retrievalScore + 0.3 * neural;
    }
  }
}
```

Three decisions worth calling out:

**Rank-based fusion, not score-based.** Dense scorers (cosine similarity, cognitive composites) and BM25 produce values on different scales with different distributions. Score-weighted fusion needs per-run calibration. [Reciprocal Rank Fusion (Cormack, Clarke, Büttcher, SIGIR 2009)](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf) sidesteps this with `score(d) = w_dense / (k + rank_dense) + w_sparse / (k + rank_sparse)`. Published RAG literature consistently prefers RRF for heterogeneous retrievers. The constant k=60 and the 0.7/0.3 weights match Anthropic's contextual retrieval blog and Cormack's original paper.

**Cross-encoder rerank over the merged pool, not either list alone.** We over-fetch at 3x the recall target (K=30 when recallTopK=10), run the union through [Cohere's rerank-v3.5](https://docs.cohere.com/docs/rerank-overview), and blend 0.7 cognitive + 0.3 neural on the final score. Running rerank on the merged pool means it gets to see exact-term anchors BM25 found that dense missed, and vice versa. The 0.7/0.3 blend is inherited from the baseline and wasn't tuned for this rollout.

**Dense side keeps the six-signal cognitive composite.** We don't replace cognitive scoring with plain cosine similarity. Recency, spreading activation, and emotional congruence still participate. The hybrid layer adds sparse signal on top, not instead of.

Empirical pattern on LongMemEval: sparse retrieval bridges sessions. Multi-session questions need facts from two or more sessions; dense embeddings tend to cluster retrieval within the single most-semantically-similar session. Exact-term anchors from BM25 (names, dates, specific values) pull in chunks from the OTHER session the dense path missed. At Phase B N=500, multi-session accuracy went from 23.5% on the baseline to 54.9% with Hybrid, a +31.4pp improvement at matched reader.

Data flow end to end looks like this:

```
User query ──► embed query ──► dense retrieval (MemoryStore, 30 traces)
           ──► BM25 search (same query over in-memory index, 30 trace IDs)
                                    │
                                    ▼
                        Reciprocal Rank Fusion
                        (w=0.7 dense, w=0.3 sparse, k=60)
                                    │
                                    ▼
                        Hydrate to ScoredMemoryTrace[]
                                    │
                                    ▼
                        Cohere rerank-v3.5 over merged pool
                                    │
                                    ▼
                   retrievalScore = 0.7 × cognitive + 0.3 × neural
                                    │
                                    ▼
                          Sort desc, slice to K=10
                                    │
                                    ▼
                            Reader (gpt-4o)
```

Total extra cost over the baseline: about $0.0001 per query for the rerank call, plus BM25 lookups that run in memory in under a millisecond. At Phase B on 500 cases: `$7.80 total`, `$0.0213 per correct answer`, which is 15.7% cheaper per correct than the Step 1 baseline at matched reader because the accuracy lift reduces the wasted-reader-cost fraction.

---

## The methodology that makes the number trustworthy

Most published memory-system numbers don't ship with matched-ablation deltas or bootstrap CIs. Zep compared against full-context baselines. Mem0's research page reports a token-efficiency headline. Emergence AI's blog post describes a two-stage retrieval architecture but doesn't isolate the ablation. We adopted five disciplines specifically to avoid the common traps.

**Bootstrap percentile CIs on every headline.** Each accuracy ships with a 95% CI from 10,000 percentile-bootstrap resamples using a seedable Mulberry32 PRNG. Phase A N=102 yields ±4-5pp aggregate CI; per-category at n=17 yields ±20pp; Phase B N=500 tightens the aggregate CI to ±4pp. Implementation at [packages/agentos-bench/src/core/metrics/computeBootstrapCI.ts](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/src/core/metrics/computeBootstrapCI.ts). The CI gate prevents over-claiming: a 2pp delta at n=17 isn't a real signal, and the probe will say so.

**Matched reader, matched judge.** Every proposed feature is measured against a baseline with the same reader model, same judge model, same embedder, and same infrastructure. Our first run at gpt-5-mini reader reported 91.2% unweighted. At matched gpt-4o reader the same stack scores 73.2%. That 17.7pp gap is not architectural, it's the reader plus the reader-judge-same-family bias identified by [Zheng et al. (NeurIPS 2023, arXiv:2306.05685)](https://arxiv.org/abs/2306.05685): gpt-4o judging gpt-5-mini output is systematically more generous than gpt-4o judging gpt-4o output. Reporting unmatched numbers would have put us above 90%, which is not what the system actually does when you match the competitor's reader.

**Matched ablation.** Step 2 of our rollout failed for exactly this reason. We built a hierarchical session retriever without threading the neural reranker into it (an Engineer's Discretion shortcut). Against a baseline that did have rerank, the unmatched session retriever dropped multi-session from 64.7% to 41.2%. Step 3 threaded rerank from day one, and the comparison finally measured what we thought it was measuring.

**Tier A smokes with kill criteria before Tier B fires.** Every step runs smoke runs at N=24 (LongMemEval-S) and N=30 (LOCOMO) before the CI-gated N=102 or N=500 measurements. If the smoke drops more than 5pp weighted vs reference, Tier B doesn't fire. This discipline saved five Tier B runs (~$20 of spend) on Steps 4, 5, 6, 7, and 8 when the smokes made the verdict clear.

**Serial just-in-time spec authoring.** Step N's spec waits for Step N-1's measured results. This prevents locking in the wrong success criteria. Step 4's spec threaded rerank from day one specifically because Step 3's result made rerank's dominance visible.

Nothing here is novel. The bootstrap CI, the matched-reader discipline, the kill criterion, the matched ablation: all of this is standard empirical ML practice. It's rare to see all of it applied together in memory-system benchmarking, and that's the gap we're trying to close.

---

## Seven things we tried that didn't work, and what they teach you

### Step 2: SessionRetriever without rerank threading

The idea: two-stage hierarchical retrieval. Stage 1 selects top-K sessions by summary similarity. Stage 2 takes top-M chunks from each selected session. Modeled on [xMemory](https://arxiv.org/abs/2602.02007) and [TACITREE (EMNLP 2025)](https://aclanthology.org/2025.emnlp-main.X), where hierarchical memory outperforms flat retrieval on long-horizon tasks.

What happened: multi-session dropped from 64.7% to 41.2% at gpt-5-mini Phase A, a 23.5pp regression. Root cause: the new `SessionRetriever` class didn't call `RerankerService`. The baseline it was compared against had rerank. So the comparison was "baseline + rerank" vs "new retriever, no rerank." Step 3 later proved rerank contributes the majority of the final quality gain. Removing it caused Step 2's collapse.

Lesson: every new retrieval strategy must thread every existing signal source from day one. Matched ablation is a non-negotiable discipline. The feature itself may be fine; the unmatched baseline made it look broken.

### Step 4: HyDE (hypothetical document embeddings)

The idea: [HyDE (Gao et al., arXiv:2212.10496, ACL 2023)](https://arxiv.org/abs/2212.10496) instructs an LLM to generate a hypothetical document answering the query, then embeds the hypothesis instead of the raw query. Published wins on BEIR, Mr. TyDi, and domain-shifted zero-shot retrieval are real.

What happened: on LongMemEval-S at gpt-5-mini, isolated HyDE dropped unweighted from 85.3% to 50.0%. Combined with Step 3 Hybrid, it dropped 87.5% to 66.7%. Both cells killed at Tier A. Multi-session went to 0% in the isolated cell and 25% in the combined cell.

Root cause: LongMemEval queries are specific-value dominant. Names, dates, concrete preferences. The LLM's hypothesis paraphrases these away, replacing "my dog's name" with "the user's pet" and "moved to Berlin last month" with "the user changed residence recently." The paraphrased hypothesis embeds into a DIFFERENT region of embedding space than the raw query, farther from actual stored traces, not closer. HyDE's published wins are on abstract-query corpora where raw queries are under-specified and benefit from expansion. Specific-value benchmarks are the wrong regime.

Lesson: LLM-generated query expansion fails on workloads where the query already carries high-IDF signal. Don't test HyDE's bounds at a workload that explicitly tests concrete-fact recall.

### Step 5: FactSupersession (LLM drops outdated traces)

The idea: post-retrieval LLM call per query identifies traces whose facts are superseded by later traces about the same subject, drops the outdated ones. Targets the knowledge-update ceiling (94.1% at Step 3 with one case shy of the strict 95% gate).

What happened: knowledge-update dropped from 100% to 75% at gpt-5-mini N=24 in both isolated and combined cells. Unweighted dropped 85.3% to 54.2% isolated, 87.5% to 54.2% combined. Killed immediately at Tier A.

Root cause: gpt-5-mini over-drops. The system prompt said "supersession requires contradiction on same (subject, predicate)." In practice, the LLM drops traces it judges "less relevant" or "older" even when those traces are the ONLY source of the needed fact. Safety clamps protected against drop-all adversarial output (the full list getting flagged), but not against "drop 7 of 10." Multi-session collapsed to 0% because the filter dropped one of the two traces multi-session needs to bridge.

Lesson: LLM-as-filter on top-K retrieval output degrades recall on specific-value benchmarks. The reader handles ambiguity (retrieved noise plus signal) BETTER than a filter LLM handles precision (discriminating relevant from superseded). This is a concrete counterexample to [CRAG (Yan et al., arXiv:2401.15884)](https://arxiv.org/abs/2401.15884) in this regime. CRAG uses a T5-based 0.77B retrieval evaluator plus web-search fallback, not gpt-5-mini on stored memory. The mechanism doesn't transfer.

### Step 6: Split-on-Ambiguous (rerank-score-guided content trimming)

The idea: bottom 30% of traces by first-pass rerank score get split at sentence boundaries. Both halves rescored with the same Cohere reranker. The trace's content is replaced with the better half only if the better half outscores the original. Monotonic in rerank-score space.

What happened: at Phase A N=24, Hybrid + Split dropped unweighted 87.5% to 58.3%, a 29.2pp regression. Killed at Tier A.

Root cause: the monotonic guarantee was on the wrong axis. A half-chunk that scores HIGHER on rerank (because it's concentrated on query-relevant tokens) can have LOWER reader utility because it discards the contextual sentences the reader needs to synthesize an answer. "Monotonic on rerank score" is not the same as "monotonic on reader utility." Trusting the rerank score as a general-purpose quality oracle broke on specific-value cases where the reader's synthesis step requires surrounding context.

Lesson: rerank scores are good at ordering doc-query relevance. They are not a general-purpose content-selection oracle. Don't trust a single quality metric for something it wasn't built for.

### Step 7: Observer/Reflector pipeline (additive overlay)

The idea: wire the dormant `MemoryObserver` + `MemoryReflector` pipeline already implemented in AgentOS core ([packages/agentos/src/memory/pipeline/observation](https://github.com/framersai/agentos/tree/master/packages/agentos/src/memory/pipeline/observation)). Three tiers: raw notes extracted at 30k-token buffer intervals, compressed observations at 50 notes, reflections at 40k compressed-observation tokens. Reflection-derived traces get encoded into the same MemoryStore the HybridRetriever queries. The AgentOS code comment literally says "Three-tier agentic memory pipeline (Mastra-style)". We'd expected to match Mastra's [84.23% at gpt-4o](https://mastra.ai/research/observational-memory).

What happened: Tier A smoke on LME-S N=24 dropped unweighted 87.5% → 62.5%, a 25.0pp regression. Multi-session collapsed from 75% → 25%. Killed immediately.

Root cause (four compounding factors):

1. **Additive overlay dilutes retrieval.** We ADD reflection traces alongside raw chunks; Mastra REPLACES the raw message history with the observation log. Our pool gets noisier, not cleaner. Abstract summaries rank high enough on cosine similarity to displace the specific-value chunks the reader needs.
2. **BM25 index mismatch.** Raw chunks are indexed into BM25 via the existing ingest hook; reflection-derived traces go through `manager.encode()` inside `manager.observe()` and bypass that hook. Dense retrieval sees both; sparse sees only raw chunks. RRF merge over asymmetric lists favors the less-precise dense-matched reflection traces.
3. **Supersession is destructive.** `MemoryReflector` detects conflicting claims between observation notes and stored traces and soft-deletes superseded traces via `store.softDelete(id)`. On LongMemEval where every stored trace might be the answer-bearing one, this is pure loss. Knowledge-update dropped 100% → 75%.
4. **Personality-biased observer prompt misses benchmark-relevant detail.** The observer is instructed to prioritize emotional shifts, commitments, preferences, creative tangents (HEXACO-weighted). LongMemEval rewards factual-value recall; the observer extracts the wrong axis.

Lesson: "enable the pipeline that already exists" treated the change as plumbing. It's architecture. Mastra's 84% comes from REPLACEMENT of raw message history; we bolted an ADDITIVE overlay on top of a working retrieval stack. Two fundamentally different shapes.

### Step 8: Observer/Reflector as replacement (the architecturally-correct fix)

The idea: address Step 7's additive-overlay root cause head-on. Skip raw chunk encoding when the observer is on, force reflection at session boundaries via a new `CognitiveMemoryManager.flushReflection()` method, index reflection traces into BM25 so dense and sparse see symmetric views. This is the Mastra-parity architecture our Step 7 wiring was not.

What happened: two Tier A runs. Run 1 (with an unexpected scope bug) scored 4.2%. The `MemoryReflector.reflect()` call lets the LLM invent `scopeId` from content topics, so reflection traces like `scope: 'user', scopeId: 'running_01'` landed in separate vector-store collections from where retrieval queried (`scope: 'user', scopeId: 'bench'`). Fix: a new `scopeOverride` parameter on `flushReflection`. Run 2 with the fix: **25.0% at N=24, down 62.5pp from the 87.5% Tier 1 smoke baseline**.

Per-category in Run 2: preference 75%, user 50%, multi-session 25%, **knowledge-update 0%, assistant 0%, temporal 0%**. The pattern is architectural, not plumbing. Replacement preserves abstract category information (preferences summarize cleanly) but destroys specific-value recall. The reader needs the literal "I moved to Berlin on March 15" token, and the reflector's compressed "user changed residence" paraphrase doesn't carry it.

Root cause: LLM-generated summaries erase the specific tokens the reader needs. Same failure mode as Step 5 FactSupersession at a different layer of the pipeline. Step 5 RED'd on post-retrieval LLM filter; Step 8 RED'd on ingest-via-reflection. The LLM layer is the common cause. Mastra's 84.23% at gpt-4o does not reproduce in our implementation; the most likely gap is their reflector prompt being tuned to preserve high-IDF tokens (names, dates, numeric values) where ours says "consolidate and elevate important facts" and in practice produces abstract paraphrases.

What ships regardless: `getReflector()` accessor + `flushReflection(mood?, scopeOverride?)` as agentos-core primitives (v0.1.249). Downstream consumers that want forced reflection at explicit boundaries now have the API. A tuned-prompt Step 11 variant is the cheapest remaining Observer/Reflector experiment to close the Mastra gap; not scheduled yet.

### Step 9: Fact-Graph Ingest (Mem0 tuple pattern)

The idea: per-session gpt-5-mini extractor emits `(subject, predicate, object, timestamp)` tuples using a closed 25-predicate schema. Synthetic `ScoredMemoryTrace` objects with `retrievalScore: 1.0` and `sourceType: 'fact_graph'` prepend to the `HybridRetriever` merged pool BEFORE rerank. Architectural bet: tuple extraction preserves the literal `object` token where Steps 5/7/8 paraphrased it away.

What happened: Tier A N=24 unweighted **58.3%**, 29.2pp below the 87.5% Tier 1 smoke baseline. Cost $3.05 total, $0.218 per correct (10× Tier 1). Killed at Tier A; no Phase A or Phase B ran.

The decisive diagnosis came from an evaluation-layer upgrade we shipped alongside Step 9: a `BenchResult.evidenceOrigin` aggregator that buckets each case's reader answer by the `sourceType` of the retrieved trace with maximum shingle overlap. The Step 9 Tier A run emitted:

```
evidenceOrigin: { user_statement: 19, fact_graph: 0, none: 5 }
```

Zero of 24 cases attributed the reader's answer to a fact-graph synthetic trace. The reader quoted from raw chunks (`user_statement`) on every correct answer. The synthetic traces were decorative, not load-bearing.

Root cause has three compounding layers:

1. **`retrievalScore: 1.0` on synthetic traces was too aggressive.** The blend is `0.7 * cognitive + 0.3 * neural`. Synthetic at cognitive=1.0 gets ≥0.7 post-blend; real chunks at cognitive=~0.3 cap at ~0.48. Synthetic always wins the final sort, displacing raw chunks from top-K.
2. **Stage-level metrics measured the displacement directly.** `merged.recall = 0.774` but `final.recall = 0.712` — the 6.2pp drop is rerank handing away recall to synthetic traces.
3. **Fact-graph trace format loses to raw chunks even when both are in top-K.** Synthetic content reads like `"user livesIn Berlin (as of 2026-03-15)"`; raw chunks carry conversational context (`"I moved to Berlin last Tuesday"`) that the reader uses to anchor answers. The extractor likely paraphrases `object` despite the "literal span" instruction, and the synthetic format adds nothing the raw chunk doesn't already contain.

The empirical rule from Steps 4-9 now stands at n=7: every variant that routes retrieval content through an LLM at ingest or query time regresses. Tuple extraction doesn't escape the pattern — it just fails in a measurably different way.

### Step 11: Tuned reflector prompt (null result)

After Step 9 closed the fact-graph line, the cheapest remaining Mastra-gap experiment was prompt quality. The Step 7 / Step 8 findings identified four possible root causes for Observer/Reflector regression; three are mechanism-level (overlay dilution, BM25 mismatch, supersession) and one is prompt-level (the reflector paraphrases rather than preserving high-IDF tokens). Step 11 isolates the prompt-level hypothesis by adding explicit verbatim-preservation rules and concrete paraphrase-vs-literal examples to the reflector's system prompt, then re-running ADDITIVE mode at Tier A.

Result: 62.5% unweighted at N=24, identical to Step 7. `evidenceOrigin` shows the reader still quoted reflection traces zero times. Prompt tuning alone does not close the gap. Ships: the tuned prompt as a strict superset of the original (no regression surface on non-benchmark workloads), `REFLECTOR_PROMPT_HASH` exported for content-addressed cache invalidation, and the bench's cache key now hashes the prompt text so future prompt edits auto-invalidate.

### Step 12: BM25 parity for reflection traces (null result)

Step 11 eliminated prompt-quality from the gap explanation. The remaining mechanism-level hypothesis was BM25 index parity: reflection traces in ADDITIVE mode go through `manager.encode()` which populates the dense store but bypasses the bench's BM25 ingest hook. Step 12 adds an end-of-replay sweep that enumerates every `sourceType: 'reflection'` trace in `MemoryStore` and indexes it into the sparse side.

Result: 62.5% unweighted at N=24, identical to Step 7 and Step 11. Stage-level retrieval metrics match Step 11 exactly (sparse.recall 0.882, merged.recall 0.774, final.recall 0.740). `evidenceOrigin: { user_statement: 20, none: 4 }` — zero reflection attributions for the third consecutive Observer/Reflector variant. The sweep ran and reflection traces are now in BM25; they simply cannot outscore raw chunks on query-relevant high-IDF tokens. BM25's length-normalized tf-idf favors a compact raw chunk over a consolidated reflection summary on LongMemEval-S's specific-value question distribution, regardless of verbatim-preservation in the prompt.

Three independent mechanisms now converge on the same conclusion: **reflection traces are not load-bearing for the reader on this benchmark**. Neither a better prompt (Step 11) nor better retrieval visibility (Step 12) nor synthetic-trace injection (Step 9) lifts the 62.5% floor.

### Step 13: Graph activation wire-up (the audit-driven experiment)

During Step 12 exploration, a broader audit of the agentos memory architecture surfaced an architectural bug: `RetrievalPriorityScorer` declares a 6-signal cognitive composite with `graphActivation` weighted at 10%, but the input value is hardcoded to 0 at `MemoryStore.ts:376` and `HybridRetriever.ts:560`. The `SqliteKnowledgeGraph` is populated via `recordMemory` but with `entityIds: []`, so the graph gets memory nodes with zero edges. The declared 6-signal composite was effectively a 5-signal composite with a silent sixth.

Step 13 closes the gap end-to-end: a new `HeuristicEntityExtractor` module (five regex pattern families covering proper nouns, ISO dates, named dates, currency amounts, and numeric-with-unit quantities, zero LLM calls, deterministic), threading `trace.entities` through to the KG as entity nodes and bidirectional `related_to:co_occurs` relations, Anderson spreading activation seeded from query-extracted entities at retrieve time. Dodges the n=8 LLM-mediated-content pattern by construction.

The mechanism works at upstream stages. Stage metrics vs Step 12 baseline: sparse recall +3.5pp (0.882 → 0.917), merged recall +2.7pp (0.774 → 0.801). Graph activation IS boosting candidates that share query entities. But rerank drops recall −10.6pp — Cohere `rerank-v3.5` correctly penalizes candidates where the entity match is topically coincidental, and the 0.7 cognitive + 0.3 neural blend still lets activation-inflated scores propagate into the final ordering, pushing genuinely-relevant candidates out. Final recall ends up roughly unchanged, but the reader sees reordered context where entity-coincidental candidates appear near gold, and conversion rate drops from 83% to 67%.

Result: Tier A N=24 unweighted 50.0%, CI [29.2%, 70.8%], RED at 27pp below the 77% kill gate. Multi-session +8pp point estimate (the target category) but confounded by a n=3 vs n=4 sample shift. Temporal-reasoning regresses 25pp. Classic noise-amplification: the signal helps where entities bridge sessions meaningfully (multi-session) but hurts where entity coincidence is irrelevant (temporal relations, preference statements).

Step 13 falsifies a stronger version of the n=8 pattern: even a zero-LLM additive signal can regress when the signal's correspondence to the benchmark's query distribution is loose. Graph activation over shared-entity co-occurrence is too loose for specific-value LongMemEval-S. The pattern now reads: **"adding scoring signals to the hybrid retrieval stack regresses on this workload unless the signal is tightly aligned with the query distribution."**

Ships regardless of RED verdict: the `HeuristicEntityExtractor` module (reusable across benchmarks with different query shapes), the `trace.entities → entityIds` thread-through fix (strict improvement for downstream consumers already populating entities), and the feature-gated full pipeline (default off).

### The pattern across nine negative results

Every failed step modified or removed retrieval output before the reader saw it, OR added output that competed with the existing signal, OR introduced an LLM intermediate step that paraphrased away specific tokens, OR made reflection content visible without changing the fact that it loses to raw chunks on tf-idf.

- Step 2 (SessionRetriever w/o rerank): removed the rerank signal.
- Step 4 (HyDE): replaced the query with a paraphrase.
- Step 5 (FactSupersession): dropped traces.
- Step 6 (Split-on-Ambiguous): trimmed trace content.
- Step 7 (Observer additive overlay): added reflection traces that competed with raw chunks.
- Step 8 (Observer replacement semantics): replaced raw chunks with LLM summaries that erased specific-value tokens.
- Step 9 (Fact-graph tuple injection): synthetic traces with `retrievalScore: 1.0` displaced raw chunks and the reader still quoted raw.
- Step 11 (Tuned reflector prompt): null — prompt-level fix does not move the number.
- Step 12 (BM25 parity sweep): null — visibility-level fix does not move the number.
- Step 13 (Heuristic graph activation): RED — zero-LLM additive signal over entity co-occurrence is noise-amplified; rerank correctly penalizes entity-coincidental candidates, reader conversion drops.

Every destructive, competition-inducing, or LLM-mediated modification regressed. Every visibility- or prompt-only fix produced a null. The rule that holds on this workload: **add signal in ways that compose with existing signal without competing for rank position, and do not expect LLM-summarized content to become load-bearing for the reader on specific-value queries.** BM25 alongside dense is additive AND composes through RRF. Rerank as a blend component is additive AND composes through the 0.7/0.3 weights. Every intervention that skipped that composition discipline regressed. Every intervention that merely exposed LLM-summarized content to the retrieval stack without changing its content shape produced a null.

---

## Honest comparison, honest caveats

At matched gpt-4o reader on the full LongMemEval-S 500-case set, AgentOS Step 3 Hybrid sits between Zep and the frontier systems. We don't claim SOTA. We claim a +13.7pp delta vs our own Step 1 baseline at matched reader (59.8% → 73.2%), a 31.4pp lift on multi-session (23.5% → 54.9%), and 15.7% lower cost per correct vs that baseline.

What we can defensibly say:

- 73.2% unweighted [69.2%, 77.0%] at gpt-4o reader + gpt-4o judge, LongMemEval-S N=500.
- 54.9% multi-session [46.6%, 63.2%] (n=133), competitive with the upper half of published memory-system multi-session numbers.
- $0.0213 per correct answer at gpt-4o. 15.7% below the Step 1 baseline at matched reader.
- Nine-step matched-ablation methodology with CI gates, producing one shippable feature and seven well-characterized negative results.

What we can't defensibly say:

- "SOTA." Mem0 currently advertises 92.0-93.4 across two public pages, Emergence AI publishes 86%, and Mastra publishes 84.23% at gpt-4o. We haven't matched them.
- "Cheaper than X." Mem0 publishes token counts, not cost-per-correct. Emergence AI doesn't publish cost. Without matched-reader + matched-cost data from each competitor running on identical infrastructure, a comparative cost claim is unsupported.
- "Strong on all categories." Multi-session 54.9% is competitive but not frontier. Mastra's observational memory reports 87.2% at gpt-5-mini, which is dramatically higher. The frontier is reachable; we haven't reached it.

The matched-ablation methodology is what we're most confident in. The number is what the methodology produced.

---

## Why batteries-included matters, even if you're only looking at retrieval

AgentOS ships the six-signal cognitive scorer (strength, similarity, recency, emotional congruence, graph activation, importance), HEXACO-modulated working memory (Baddeley's 7±2 model with +1 slot for high Openness and -1 for high Conscientiousness, clamped to [5,9]), PAD emotional congruence blending, Anderson-style spreading activation over an entity-relation graph, consolidation mechanisms (reconsolidation, retrieval-induced forgetting, emotion regulation, schema encoding), SQLite/Postgres-backed persistence with WAL journaling, a deep-research module that parallel-queries Firecrawl + Serper + Tavily + Brave with Cohere rerank across results, and a multimodal indexer that describes images via vision LLM, transcribes audio via STT, and routes everything through the same vector store and cognitive memory.

For LongMemEval specifically, a few of these matter more than others:

**Recency decay and encoding strength.** Knowledge-update questions rely on the recency component of the cognitive composite to bias retrieval toward the later-stated fact. Without recency scoring, a supersession pass has to run at query time (Step 5's failure). With recency as a baseline signal, Step 3 Hybrid hits 86.8% on KU without any post-retrieval filtering.

**Spreading activation on the entity graph.** Multi-session questions often reference entities mentioned in earlier sessions. When the query mentions one of those entities, graph activation spreads through the entity-relation graph and surfaces traces that the raw embedding similarity wouldn't rank highly. It's a second additive signal on top of BM25.

**HEXACO trait modulation.** For conversational characters (wilds-ai deployments), encoding biases matter for personality-consistent recall. A high-Openness character retains more novel-but-unverified memories; a high-Conscientiousness character discounts unverified content. Bare memory stores lose this axis entirely.

**Consolidation mechanisms.** Reconsolidation strengthens frequently-retrieved traces and weakens ones that never get recalled. Retrieval-induced forgetting (Anderson, Bjork, Bjork 1994) weakens semantic neighbors of retrieved items to reduce interference. These mechanisms are running during long conversations, stabilizing what the system recalls on distant queries.

**Multimodal RAG.** AgentOS includes a multimodal indexer at [packages/agentos/src/rag/multimodal](https://github.com/framersai/agentos/tree/master/packages/agentos/src/rag/multimodal) that bridges images (via vision LLM descriptions), audio (via STT transcripts), and PDFs into the same vector store. The convert-to-text approach means best-in-class text embedders (text-embedding-3-small, text-embedding-3-large, Voyage) apply to all modalities. No separate CLIP tower, no modality-specific retrieval pipeline. Characters in production can "recall" having seen an image because the image's description lives in the same cognitive memory as conversational turns.

None of this shows up in the LongMemEval-S number. LongMemEval is text-only, short-session-horizon, specific-value-dominant. A production system handling voice + images + long-running characters needs the rest.

---

## Progressive Enhancement Tiers

Step 3 Hybrid is the default, but AgentOS ships the plumbing for higher-accuracy configurations that trade more cost for more recall. Every tier composes on top of the previous and is configurable on/off via CLI flags:

| Tier | Flags (additive) | Architecture added | Accuracy at gpt-4o | $/correct at gpt-4o | Status |
|---|---|---|---:|---:|---|
| **Tier 0** (bare) | (none) | dense retrieval + cognitive scoring only | ~60% (projected) | ~$0.032 (projected) | untested baseline |
| **Tier 1** (default) | `--hybrid-retrieval --context-summary gpt-5-mini` | + BM25 sparse + RRF merge + Cohere rerank blend + Anthropic-style session summaries | **73.2% [69.2%, 77.0%]** | **$0.0213** | **shipping, Phase B N=500 measured** |
| Tier 2 ADDITIVE (opt-in) | Tier 1 + `--observer-reflector` | + MemoryObserver / MemoryReflector pipeline alongside raw chunks | 62.5% at N=24 smoke | ~$0.10+ (gpt-5-mini observer) | RED at Tier A, opt-in only |
| Tier 2 REPLACEMENT (opt-in) | Tier 1 + `--observer-reflector --observer-reflector-replace` | + REPLACEMENT semantics (skip raw chunk encode, force reflection at session boundaries, BM25 on reflection traces) | 25.0% at N=24 smoke | $0.58 (gpt-5-mini observer) | RED at Tier A, opt-in only |
| Tier 3 (Step 9 RED) | Tier 1 + `--fact-graph-ingest` | + per-session LLM (subject, predicate, object, timestamp) tuple extraction with closed 25-predicate schema; synthetic traces prepended before rerank | 58.3% at N=24 smoke | $0.218 | RED at Tier A, opt-in only |
| Tier 4 (planned) | any tier + `--two-call-reader` | + extract-then-answer reader pipeline (Emergence AI pattern) | not measured | not measured | spec pending |

Tier 2 ADDITIVE regressed because adding reflection traces alongside raw chunks dilutes retrieval. Abstract summaries rank high enough on cosine similarity to displace the specific-value chunks the reader needs. Tier 2 REPLACEMENT (the architecturally-correct fix matching Mastra's semantics) regressed further because LLM-generated reflection summaries erase the high-IDF tokens LongMemEval's specific-value categories require. Per-category in Tier 2 REPLACEMENT: preference 75%, user 50%, multi-session 25%, knowledge-update 0%, assistant 0%, temporal 0%. The pattern is clear: summary-based approaches preserve category information but destroy fact information on this workload. A tuned reflector prompt designed to preserve names, dates, and numeric values verbatim is the cheapest remaining experiment to close the gap to Mastra's 84.23% at gpt-4o, but that's prompt engineering more than architecture.

Tiers 3 and 4 match published frontier architectures (Mem0's fact graph, Emergence AI's two-call reader). Tier 3 is architecturally different from Steps 5/7/8 because tuple extraction preserves the literal `object` token where summary-based approaches paraphrase it away. If tested and GREEN, Tier 3 is the plausible path to closing the gap to the current frontier tier. The current Tier 1 result is the cost-optimized default; anyone who wants frontier accuracy can opt into the higher tiers once their architectures land.

Orthogonality matters: each tier's flag is independent, so consumers with unusual workloads can mix and match (e.g., fact-graph ingest without observer/reflector, or two-call reader without fact-graph). Canonical presets are bundled for the common "more accuracy, more cost" progression.

---

## What's next

**Production default flip.** Step 3 Hybrid has CI-gated evidence at Phase B. The decision to flip from opt-in to default-on is a product call, not a benchmark call. The evidence supports the flip.

**Tier 3 fact-graph ingest (Mem0 pattern) — ran, RED.** Per-session gpt-5-mini extractor emits `(subject, predicate, object, timestamp)` tuples using a closed 25-predicate schema. Synthetic traces with `retrievalScore: 1.0` prepend to the merged pool before rerank. **Result: 58.3% at N=24, 29.2pp below Tier 1 smoke; killed at Tier A.** The decisive data point: `evidenceOrigin: { fact_graph: 0, user_statement: 19, none: 5 }` — zero of 24 reader answers quoted a synthetic fact-graph trace; the reader pulled from raw chunks every time. Synthetic traces with ceiling-pinned scores displaced real chunks during rerank (measured: `merged.recall = 0.774` → `final.recall = 0.712`, a 6.2pp loss to displacement). Ships opt-in behind `--fact-graph-ingest`. Next experiment worth trying in this direction would be setting synthetic-trace `retrievalScore` to the fact's extraction confidence (~0.5) rather than 1.0, so they compete with raw chunks instead of dominating them.

**Tier 4 two-call reader (Emergence AI pattern).** First reader call extracts relevant facts from top-K, second answers from the extracted facts only. Budget: ~$20-40 per full run. Modest expected lift, orthogonal to the retrieval layer, and can layer on top of any working tier.

**Tuned reflector prompt.** Step 8 RED most likely reflects prompt choice, not architecture. The reflector is told to "consolidate" and "elevate important facts," which gpt-5-mini interprets as permission to produce abstract paraphrases. A variant prompt instructing the reflector to preserve names, dates, and numeric values verbatim is the cheapest remaining experiment to close the gap to Mastra's 84.23% at gpt-4o. Step 9's RED raised this priority: with fact-graph tuples also regressing (different mechanism, same pattern), a reflector-prompt variant is now the highest-value remaining experiment in the reflector family.

**Graph-expansion retrieval.** The entity graph is already built; we don't currently expand retrieval to include traces connected to the top-K via shared-entity edges. A proper additive-signal experiment would add this and measure against Tier 1. Budget: ~$1-2 for Tier A.

**Open-weights rerank.** Cohere rerank-v3.5 is commercial-only. [BGE-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) and [voyage-rerank-2](https://blog.voyageai.com/2024/07/25/voyage-rerank-2-the-new-state-of-the-art-reranker/) are plausible drop-in replacements. Testing would widen applicability for self-hosted deployments.

**LongMemEval-M and LongMemEval-L.** We benchmarked the -S variant (115k-token haystacks). The -M variant (~500 sessions) and -L variant (~5000 sessions) stress-test scaling. BM25 is in-memory and sub-ms at 100s of docs; dense retrieval grows linearly with corpus size. Open question: does the BM25 signal survive at -L scale, or does the embedding-similarity component have to carry more load?

**Multimodal benchmarks.** AgentOS's multimodal RAG isn't tested here because LongMemEval is text-only. A separate sequenced rollout on [MM-Vet](https://arxiv.org/abs/2308.02490), [Video-MME](https://arxiv.org/abs/2405.21075), or a chat benchmark with image attachments would measure the modality-specific retrieval quality. Different architecture choices (late-fusion reranking, modality-specific indexing, pixel-level vs convert-to-text embedding) need their own ablations. Not in scope for this rollout; worth its own investigation.

**Verifying frontier claims.** Mem0's public pages currently disagree between 92.0 and 93.4, Mastra reports 94.87% at gpt-5-mini, OMEGA reports 95.4% at GPT-4.1, and Emergence AI reports 86% at gpt-4o. Each of these uses a different stack at a different reader. A fair comparison would run each on identical infrastructure. We haven't done this. Until someone does, the leaderboard numbers are self-reported on self-selected configurations.

---

## Reproducibility

Every number in this post comes from [packages/agentos-bench/results/runs/2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/results/runs/) (Step 3 Hybrid Phase B N=500 at gpt-4o) and the sibling run files for Phase A cells and step-specific measurements. The bench CLI that produced them is:

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --rerank cohere --context-summary gpt-5-mini \
  --hybrid-retrieval --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42
```

Seven step findings docs (GREEN-soft for Step 3, RED for Steps 2, 4, 5, 6, 7, infra for Step 1) live in [packages/agentos-bench/docs/STEP_*_FINDINGS_2026-04-20.md](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/docs). The umbrella doc is at [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md). The matched-ablation and bootstrap CI methodology is implemented at [packages/agentos-bench/src/core/metrics/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/src/core/metrics).

Commits for each of the nine steps are listed in the umbrella findings doc plus the Step 7, Step 8, and Step 9 findings docs. The architecture doc for HybridRetriever lives at [packages/agentos/docs/architecture/hybrid-retriever.md](https://github.com/framersai/agentos/blob/master/packages/agentos/docs/architecture/hybrid-retriever.md).

Total measurement cost for the nine-step rollout plus Phase B N=500 confirmation: ~$26.53. Reader: OpenAI gpt-4o-2024-08-06 and gpt-5-mini. Reranker: Cohere rerank-v3.5. Embedder: OpenAI text-embedding-3-small. Judge: OpenAI gpt-4o-2024-08-06. Observer/reflector invoker (when enabled): gpt-5-mini. Fact-graph extractor (when enabled): gpt-5-mini.

---

## References

- Wu, D., Wang, H., Yu, W., Zhang, Y., Chang, K., Yu, D. (2024). [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813). ICLR 2025.
- Maharana, A., Lee, D., Tulyakov, S., Bansal, M., Barbieri, F., Fang, Y. (2024). [Evaluating Very Long-Term Conversational Memory of LLM Agents](https://arxiv.org/abs/2402.17753). ACL 2024.
- Cormack, G.V., Clarke, C.L.A., Büttcher, S. (2009). [Reciprocal Rank Fusion outperforms Condorcet and Individual Rank Learning Methods](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf). SIGIR 2009.
- Robertson, S., Zaragoza, H. (2009). The Probabilistic Relevance Framework: BM25 and Beyond. Foundations and Trends in Information Retrieval.
- Anthropic (2024). [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval).
- Gao, L., Ma, X., Lin, J., Callan, J. (2022). [Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE)](https://arxiv.org/abs/2212.10496). arXiv.
- Yan, S., Gu, J., Zhu, Y., Ling, Z. (2024). [Corrective Retrieval Augmented Generation (CRAG)](https://arxiv.org/abs/2401.15884). arXiv.
- Zheng, L., Chiang, W.-L., et al. (2023). [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685). NeurIPS 2023.
- Penfield Labs (2024). [LoCoMo ground-truth audit](https://github.com/dial481/locomo-audit).
- Zep blog (2025). [Zep Is The New State of the Art in Agent Memory](https://blog.getzep.com/state-of-the-art-agent-memory/).
- Emergence AI blog (2024). [SOTA on LongMemEval with RAG](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag).
- Mastra research (2026). [Observational Memory: 95% on LongMemEval](https://mastra.ai/research/observational-memory).
- Mem0 research (2026). [Token-Efficient Memory Algorithm](https://mem0.ai/research).
- Baddeley, A.D., Hitch, G. (1974). Working Memory. In Bower, G.H. (ed.), The Psychology of Learning and Motivation, Vol. 8.
- Miller, G.A. (1956). The Magical Number Seven, Plus or Minus Two: Some Limits on our Capacity for Processing Information. Psychological Review.
- Anderson, J.R. (1976). Language, Memory, and Thought. Erlbaum.
- Anderson, M.C., Bjork, R.A., Bjork, E.L. (1994). Remembering Can Cause Forgetting: Retrieval Dynamics in Long-Term Memory. Journal of Experimental Psychology.
- Ashton, M.C., Lee, K. (2007). [Empirical, Theoretical, and Practical Advantages of the HEXACO Model of Personality Structure](https://psycnet.apa.org/doi/10.1177/1088868306294907). Personality and Social Psychology Review.
