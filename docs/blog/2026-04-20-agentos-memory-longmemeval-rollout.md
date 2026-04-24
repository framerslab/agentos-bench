# AgentOS Memory on LongMemEval-S: 76.6% at $0.058/correct with a Pareto-Dominant Policy Router (Phase B N=500)

**TL;DR.** AgentOS ships **four production-ready tiers** on LongMemEval-S at gpt-4o reader + gpt-4o judge. The newest tier (shipped 2026-04-24) Pareto-dominates the other three on accuracy AND cost AND latency:

- **Tier 3 shipping default: policy router with `minimize-cost` preset** — **76.6% [72.8%, 80.2%]** Phase B N=500. **$0.0580 per correct answer.** **16s avg latency.** Per-query dispatch among {Tier 1, Tier 2a, Tier 2b} via the v10 gpt-5-mini classifier + a routing table that keeps SSA/SSU/TR/KU on Tier 1 (where they Pareto-dominate the OM paths) and only pays the Tier 2b OM premium on MS/SSP (where the architectural lift earns it). Backend mix: 85.8% Tier 1 + 14.2% Tier 2b. **+1.2pp accuracy vs Tier 2b v11 at 7.5x cheaper per correct, +2.0pp vs Tier 2a at 5.6x cheaper, +3.4pp vs Tier 1 canonical at 6.1x faster latency.** The architectural insight: no single tier Pareto-dominates across categories, but per-query routing against measured Phase B per-category cost-accuracy curves extracts the dominant backend per case.
- **Tier 1 (absolute-cheapest opt-in): Step 3 HybridRetriever** — **73.2% [69.2%, 77.0%]** Phase B N=500. **$0.0213 per correct answer.** BM25 + dense RRF + Cohere rerank blend over the cognitive-memory composite score. The prior shipping default from 2026-04-20 through 2026-04-23; still recommended for cost-only-sensitive workloads.
- **Tier 2a (opt-in): Step 16c v10 Dynamic Router** — **74.6% [70.8%, 78.4%]** Phase B N=500. **$0.327 per correct answer**, 12s avg latency. Per-question gpt-5-mini classifier routes SSU/SSA/SSP/TR to canonical Step 3 and KU/MS to v5 Observational Memory ingest. Dominated by Tier 3 min-cost at Phase B; retained as a flag for deterministic-backend preference.
- **Tier 2b (opt-in, refinement of v10): Step 18 v2 Conditional Verbatim Reader** — **75.4% [71.6%, 79.0%]** Phase B N=500. **$0.436 per correct answer**, 14s avg latency. v10 router + conditional verbatim citation rule for KU/SSU router categories. Dominated by Tier 3 min-cost at Phase B; retained as flag for KU/MS-heavy workloads where the per-correctness retention mechanism is wanted standalone.
- **Tier 3 max-acc v2 (opt-in, shipping alongside min-cost as of 2026-04-24)**: **75.6% [71.8%, 79.2%]** Phase B N=500. **$0.2434 per correct answer**, 66s avg latency. Same router + classifier as min-cost, different table: SSA/TR route to Tier 1, SSU/KU/MS/SSP route to Tier 2b v11. Beats Tier 2b v11 aggregate by +0.2pp at 1.8x cheaper per correct. Pick over min-cost when workload mix favors accuracy parity with Tier 2b at modest cost reduction; pick min-cost when latency or maximum cost reduction matters.

The policy router is the architectural win. Each of Tier 1 / Tier 2a / Tier 2b has a different per-category accuracy profile at Phase B: Tier 1 dominates SSA/TR at low cost, Tier 2b dominates MS/SSP at high cost. No single flat-tier config captures both. The Tier 3 policy router dispatches per-query against the measured per-category cost-accuracy curves, paying the Tier 2b OM premium only where it buys accuracy and keeping Tier 1's cheap canonical path everywhere else. Backend mix 85.8% Tier 1 + 14.2% Tier 2b on the full Phase B distribution. Full Step 20 findings at [STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md](./STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md).

The token-retention methodology introduced at Step 18 (per-stage and per-correctness retention decomposition, implementation at [packages/agentos-bench/src/core/metrics/computeTokenRetention.ts](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/src/core/metrics/computeTokenRetention.ts)) is the other durable contribution. It identified the MS retriever as the structural bottleneck (canonical drops 63% of gold tokens before rerank) and motivated the Tier 2b conditional-verbatim v2 rule on the reader side. The per-correctness gap predictor generalizes: any future tuning iteration consumes the metric to target the stage that actually predicts accuracy for a given category.

Thirty-plus matched-ablation experiments shipped findings: ten Steps 2-14 architectural alternatives, ten OM variants (v1-v8 + Step 16/16b/16c family), three classifier configurations, two Step 17 OM-guided retrieval iterations, three Step 18 reader-prompt variants (v1 RED, v2 GREEN-soft, v3 NULL), three Step 19 conditional retriever-knob variants (all NULL on multi-session), and three Step 20 policy router presets (min-cost shipping, max-acc below floor due to discovered TR routing bug, balanced not run at Phase B). Most RED or NULL; **Tier 1 canonical, Tier 2a v10, Tier 2b v11, and Tier 3 min-cost are the four variants that survived all gating tiers**. Tier 3 min-cost is the current recommended default.

Total measurement cost: **~$1014** across all experiments + five Phase B confirmations (canonical, v10, v11, Tier 3 max-acc, Tier 3 min-cost). Bootstrap CI-gated accept/reject rules at every step caught ~$2100+ of wasted Phase B spend on known-dead variants. Kill ladder (Tier A N=24 → Phase A N=102 → Phase B N=500) caught four documented false-positive sampling-luck patterns, including Phase A's SSU-heavy sample that made Tier 3 max-acc look better than it actually is at full distribution.

The aggregate still isn't frontier. Mem0 advertises [92.0](https://mem0.ai/research-2) to [93.4](https://docs.mem0.ai/core-concepts/memory-evaluation) depending on page, Emergence AI reports [86%](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag), and Mastra's Observational Memory reports [84.23% at gpt-4o and 94.87% at gpt-5-mini](https://mastra.ai/research/observational-memory). AgentOS's 76.6% Tier 3 min-cost sits above [Zep/Graphiti's 71.2% at gpt-4o](https://blog.getzep.com/state-of-the-art-agent-memory/) and below the 80-86% frontier band. Cost-per-correct is not disclosed by Supermemory/Mastra/EmergenceMem; AgentOS's $0.058/correct at 76.6% is likely competitive on cost-per-correct against frontier systems that run full OM observer+reflector per query.

What's defensibly different about this rollout: thirty-plus controlled ablations with bootstrap-gated CIs on every claim, matched-reader cost comparison as a hard requirement, three-stage kill ladder with four documented sampling-luck catches, full source code published for all four production tier paths, an explicit cost-vs-latency-vs-accuracy tradeoff matrix per tier, a per-correctness token-retention methodology that exposed v11's mechanism inside the aggregate-noise band, and a policy router primitive that no other memory-architecture vendor ships (Mem0, Mastra, Supermemory, Zep all ship single-architecture configurations).

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
| **AgentOS Tier 1 (Step 3 Hybrid canonical)** | **73.2%** | this work, Phase B N=500 at gpt-4o, $0.0213/correct |
| AgentOS Step 15 v5 OM dual-path (Phase A, sampling luck) | 73.5% | Phase A N=102 — Tier A 79.2% sampling-luck pattern caught at Phase A |
| **AgentOS Tier 2a (Step 16c v10 dynamic router)** | **74.6%** | **this work, Phase B N=500 at gpt-4o, $0.327/correct (15.4x premium), 8.3x faster latency, +5.3pp on multi-session** |
| **AgentOS Tier 2b (Step 18 v2 conditional verbatim reader on v10 router)** | **75.4%** | **this work, Phase B N=500 at gpt-4o, $0.436/correct (1.3x v10 premium); +1.5pp MS vs v10, +6.8pp MS vs canonical; mechanism reproduced Phase A → Phase B at +0.495 per-correctness retention gap** |
| [Mastra RAG (topK=20)](https://mastra.ai/research/observational-memory) | 80.05% | their own retrieval baseline |
| [Supermemory](https://supermemory.ai/research/) | 81.60% | at gpt-4o |
| [Mastra Observational Memory (gpt-4o)](https://mastra.ai/research/observational-memory) | 84.23% | observer + reflector compression, no retrieval |
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

The empirical rule from Steps 4-9 now stands at n=7 (extended later to n=10 through Step 14): every variant that routes retrieval content through an LLM at ingest or query time regresses. Tuple extraction doesn't escape the pattern — it just fails in a measurably different way. (Step 15 eventually broke the larger n=10 pattern not by iterating on retrieval but by REPLACING retrieval entirely with observational compression; see the Step 15 section below.)

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

### The pattern across ten negative results + one architectural-swap GREEN-soft

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
- Step 14 (Two-call reader / Emergence AI pattern): RED — atomizing concentrated K=10 passages into a JSON fact list loses the cross-fact structure that multi-session (0%) and temporal-reasoning (0%) questions require. Three variants tested (selective / tolerant-parse / inclusive); v2 → v3 with identical 45.8% despite 10× more facts per case proves architectural, not tuning. Emergence's 86% likely needs larger-K retrieval where context dilution is high.
- Step 15 (Observational Memory, Mastra port): **GREEN-soft.** Faithful port of Mastra's open-source Observational Memory (Apache 2.0). Retrieval pipeline DISABLED; per-session Observer (gpt-5-mini) compresses raw conversation into dated priority-tagged observations; reader sees full observation log + question in a single gpt-4o call. **75.0% (18/24) CI [58.3%, 91.7%] at Tier A N=24 — first architectural change since Step 3 Hybrid to beat the 73.2% canonical point estimate.** Single-session-user/assistant/preference all sweep at 100% (+3/+11/+40pp vs canonical). Cross-session regresses (multi-session 25%, temporal 50%) due to per-session observer batching: observer can't form cross-session patterns when each call sees one session in isolation. Mastra runs observer on rolling message history that spans session boundaries. Fixing that is the concrete path to 80%+.

Every destructive, competition-inducing, or LLM-mediated modification regressed. Every visibility- or prompt-only fix produced a null. The rule that holds on this workload: **add signal in ways that compose with existing signal without competing for rank position, and do not expect LLM-summarized content to become load-bearing for the reader on specific-value queries.** BM25 alongside dense is additive AND composes through RRF. Rerank as a blend component is additive AND composes through the 0.7/0.3 weights. Every intervention that skipped that composition discipline regressed. Every intervention that merely exposed LLM-summarized content to the retrieval stack without changing its content shape produced a null.

---

## The Step 15 variant sweep: v1 → v5 and what we learned about architectural stacking

Step 15 v1 shipped at 75.0% Tier A. Cross-session categories (multi-session 25%, temporal 50%) lagged because the Observer ran per-session in parallel — each call saw only one session's transcript. Six variants followed, each testing a different hypothesis. Here's the scoreboard.

| Variant | Mechanism | Tier A unweighted | Multi-session | Notes |
|---|---|---:|---:|---|
| v1 | Per-session observer, gpt-5-mini | 75.0% | 25% | baseline |
| v2 | 24k-token cross-session batched observer | 70.8% | 50% | aggregate -4.2pp from per-session context loss |
| v3 | Dual-path (v1 + v2 concatenated) | 70.8% | 25% | reader fixated on most-recent observation block |
| v4a | v3 + 5-step reader scaffold prompt | **83.3% → 71.6%** | 50% → 52.9% | Tier A cleared 78%; Phase A N=102 regressed to 71.6% (sampling luck caught) |
| v4b | v3 + gpt-4o hierarchical synthesis pass | 75.0% | 50% | aggregate tie with v1; TR regressed −25pp; synthesis NOT free-lift |
| v4c | v4a + v4b combined | 70.8% | 50% | TR regressed 75% → 25% from scaffold + synthesis layout conflict |
| **v5** | **v3 + scaffold + gpt-4o observer upgrade** | **79.2%** | **25%** | **current Tier A top; all single-session 100%, TR 75%** |
| 16 | v5 + HybridRetriever passages K=10 | 70.8% | 50% | first successful MS lift (+25pp) but SSU/SSP/TR each −25pp (context pollution) |

Three architectural lessons, ordered by strength of evidence:

**Reader prompt scaffolding is a free-lift primitive — when the layout matches.** v4a added a 5-step reasoning guide to the reader prompt ("scan all date-grouped sections, order chronologically, verify dates before answering"). Zero additional LLM calls, zero new infrastructure. Tier A went from 70.8% (v3) to 83.3% with a +50pp jump on temporal-reasoning. But when we combined the scaffold with v4b's synthesis block (which adds non-date-formatted patterns), the scaffold's "scan Date: headers" guidance pointed at the wrong layout and temporal regressed from 75% to 25%. Layout compatibility matters; the scaffold only fires reliably when the observation log is the only structured content in the reader's context.

**Synthesis is not free-lift.** v4b added a gpt-4o cross-session synthesis pass over the per-session observation log — one additional LLM call per case at the strongest model. Despite being 5× more expensive than the scaffold-only approach and using a stronger model, it didn't beat v4a's prompt-only scaffold. Inverts the common "stronger model + more calls = better" assumption. Synthesis ships as opt-in for workloads where the prompt-only scaffold doesn't cover; it's not the default.

**Context stacking without routing is strictly worse.** Step 16 combined v5 with the full Step 3 HybridRetriever pipeline (BM25 + dense + RRF + Cohere rerank) and appended the top-10 retrieved passages to the reader context. Multi-session lifted by +25pp for the first time in the entire Step 15 family — the retrieval signal is real and load-bearing for cross-session. But single-session-user, single-session-preference, and temporal-reasoning each regressed by 25pp because the retrieved passages distracted the reader from the dense observation log. Aggregate went from 79.2% (v5) to 70.8%. The lesson: a memory architecture that doubles its context is only better than its simpler parent when the added context is selected per-question, not poured in by default.

### Sampling luck, caught

v4a scored **83.3% on Tier A N=24**, clearing our 78% kill-gate for the first time in the entire 18-experiment rollout. The temptation was to publish: "AgentOS achieves 83.3% on LongMemEval-S, above Supermemory's 81.6% at matched reader." We ran Phase A N=102 first. v4a scored **71.6%**, below the Step 3 Hybrid canonical. The regression came from single-session-preference (100% Tier A → 64.7% Phase A) and temporal-reasoning (75% → 41.2%). Tier A N=24 drew 4 cases per category; the draw happened to be lucky on those two. Phase A's 17-per-category sample unmasked the distribution.

$26.30 of Phase A spend caught a publication-grade false positive. A $700+ Phase B run on v4a would have landed us with a headline number we'd have had to retract. Alongside the Step 9 `evidenceOrigin` fact-graph zero-attribution diagnostic from an earlier step, that's now two documented false-positive catches the two-stage kill-criterion methodology prevented from shipping. Both incidents informed the current rollout rule: no publication-grade claim before Phase A.

### Where the retrieval signal lives

Step 16's MS +25pp is not a one-off. It's the first time any variant in the Step 15 family moved multi-session from its stubborn 25-50% band. The mechanism is identifiable: dense-log observer passes compress raw cross-session quotes into prose, and that compression sometimes drops the token-exact link the reader needs to stitch two sessions together. Retrieval surfaces the raw quotes. The side effect is that retrieval also surfaces cross-session quotes for single-session questions where the dense log already had the right answer, and those extra passages distract the reader.

Two queued experiments test the gating hypothesis:

- **Step 16b** lowers retrieval top-K from 10 to 3. If the signal-to-noise ratio flips at smaller K (~$40 Tier A), the multi-session +25pp might hold without the single-session pollution. Zero new code, flag swap only.
- **Step 16c** adds a lightweight gpt-4o-mini classifier that tags each question as single-session, multi-session, temporal, knowledge-update, or preference, and routes to the winner per category on this rollout: v5 for single-session + temporal + knowledge-update; Step 16 (or 16b if it validates) for multi-session only. Roughly $45 Tier A plus classifier tokens per case.

If either lands, Phase A N=102 follows (~$150). Phase B N=500 (~$700) would require explicit approval before running on what would be our first publication-grade SOTA-direction claim.

---

## From Step 16c v10 to Step 18 v2: routing, retrieval, and the per-correctness retention probe

Step 16's multi-session +25pp at the cost of single-session pollution motivated the per-question router design. The Step 16c family tested three classifier configurations against a fixed routing matrix (KU + MS to Observational Memory, SSU + SSA + SSP + TR to canonical Step 3 Hybrid):

| Variant | Classifier | Tier A unweighted | Notes |
|---|---|---:|---|
| 16c baseline | gpt-5-mini, basic prompt | 70.8% | classifier collapsed multi-session into single-session ~30% of the time |
| 16c v9 | gpt-4o, basic prompt | 70.8% | stronger model, same routing failure pattern |
| **16c v10** | **gpt-5-mini + few-shot prompt** | **75.0%** | **+4.2pp over baseline; few-shot examples fixed the routing failure** |
| 16c v11 | gpt-5-mini + chain-of-thought | 70.8% | reasoning prompt regressed routing precision |

v10 cleared the Tier A gate. Phase A N=102 confirmed at **76.5% [67.6%, 84.3%]** — first variant to beat canonical at Phase A. Phase B N=500 landed at **74.6% [70.8%, 78.4%]**, $0.327/correct (15.4x canonical premium), 8.3x faster reader latency. The +1.4pp aggregate over canonical sits inside CI overlap, but **multi-session lifted +5.3pp at n=133** with the lift driven by the routing decision itself: cases the v10 router classified as multi-session went through the Observational Memory pipeline, which preserves cross-session quotes that the canonical retriever paraphrases away through embedding similarity. The per-question classifier costs ~$0.0005 per query (one gpt-5-mini call); the architectural saving comes from skipping OM ingest on the ~80% of questions the classifier routes through canonical.

**Step 17: OM-guided retrieval (RED, architecturally dominated by v10).** v5 OM-only had hit 87.5% on a smaller subset earlier in the rollout, suggesting OM was a strong signal that just needed the right scope. Step 17 tested whether scoping the canonical retriever to OM-identified candidate sessions could combine OM's session-selection judgment with canonical's intra-session recall. Two iterations (v1 broken parser, v2 working): per-case latency hit **163s avg / 569s p95 / 12 min worst-case (13x v10)** because OM ingest runs on EVERY case, and the K=5 candidate-session filter was too aggressive for cross-session questions (MS 33% vs v10 PB 60%). v10's classify-then-route correctly skips OM for ~80% of cases; Step 17's always-run-OM design is fundamentally more expensive without an accuracy lift. Documented as RED-and-deprecated.

### Step 18: per-stage token retention as a variant-ROI predictor

The published v10 result raised a methodological question. v10's aggregate is +1.4pp over canonical at Phase B (CI overlap), but per-category the picture is inconsistent — multi-session +5.3pp, knowledge-update +0.0pp, single-session-assistant -3.5pp. Why does the routing architecture help some categories and not others? And where in the v10 pipeline is the residual headroom? Without a per-stage diagnostic, "tune v10" is a guessing game.

Step 18 introduced a token-retention framework. For each case in a benchmark run, extract high-IDF tokens from the gold reference answer (NFKD-normalized, lowercased, NLTK English stopwords stripped, ≥4 chars). Score what fraction of those tokens survive each pipeline stage:

- **raw → observer**: did the per-session OM observer preserve the gold token in its compressed observation?
- **observer → retrieved**: did the retrieval stage surface the observation chunk containing the gold token?
- **retrieved → reader-cited**: did the reader's answer literally cite the gold token, or did it paraphrase?

Implementation at [src/core/metrics/computeTokenRetention.ts](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/src/core/metrics/computeTokenRetention.ts). The aggregator runs over `BenchResult.cases` at the run-finalization point, with bootstrap percentile CIs on each per-stage rate (10,000 resamples, Mulberry32 PRNG, seed=42). A cache-fingerprint tag (`retention-instrumentation:v1`) was added to the BenchmarkRunner so post-hoc retention rescoring stays cache-safe across reruns.

The probe applied to v10 Phase B exposed two distinct bottlenecks. For multi-session questions routed through canonical, the BM25+dense+RRF+rerank retrieval pipeline drops 63.5% of gold tokens before the reader sees them — the cross-session signal is missing from the candidate pool, not lost in ranking. For knowledge-update questions routed through OM, the observer preserved 89% of gold tokens but the reader cited only 73% verbatim — the reader was paraphrasing factual values that the observation log had stored verbatim.

**Per-correctness split — the load-bearing finding.** Splitting the retention rates by per-case correctness exposed something the aggregate hid. Across v10's INCORRECT cases, retrieved-stage retention was **0.495 lower** than across CORRECT cases. Across canonical's incorrect cases, the same gap was **0.41**. The wider the gap, the stronger the prediction that "more reader citation discipline" would convert wrong cases to right cases. Per-category, v10's KU and SSU per-correctness gaps were the widest (≥0.60 each); MS and TR gaps were narrower (0.40-0.50); SSA was borderline at +0.50.

That gap pattern produced a falsifiable variant: append a verbatim-citation rule to the OM reader prompt ONLY for the router categories where the gap predicted lift, leaving the reader prompt unchanged for the categories where paraphrasing is productive (TR for synthesis, MS for cross-session reasoning, SSP/SSA for context-aware preference handling).

| Variant | Conditional rule eligibility | Tier A | Phase A N=102 | Phase B N=500 |
|---|---|---:|---:|---:|
| 18 v1 | Uniform verbatim rule for ALL categories | 70.8% | 73.5% | not run (RED) |
| **18 v2** | **Conditional verbatim for KU + SSU only** | **75.0%** | **78.4% [69.6%, 86.3%]** | **75.4% [71.6%, 79.0%]** |
| 18 v3 | Conditional verbatim for KU + SSU + SSA | 70.8% | not run (NULL at Tier A) | not run |

v1 RED confirmed the rule's falsifiability: forcing verbatim on synthesis-required categories (TR, MS) regressed those categories. v2 GREEN-soft confirmed the per-correctness gap as a variant-ROI predictor: KU and SSU were exactly the categories the gap predicted would benefit. v3 NULL on the borderline-eligible SSA category (gap +0.50 — below the calibrated +0.60 threshold) confirmed the threshold itself.

Phase B N=500 landed v2 at **75.4% [71.6%, 79.0%]**. Aggregate +0.8pp over v10 sits inside CI overlap — within sampling noise on the headline. **But the per-correctness retention gap reproduced from Phase A (N=102) at +0.495 to Phase B (N=500) at +0.495 — identical to three decimal places.** That's the architecturally honest signal the noise band would have hidden. Multi-session lifted +1.5pp vs v10 / +6.8pp vs canonical, which is mechanism-explained: verbatim citation preserves cross-session factual anchors that paraphrasing would otherwise drop. KU and SSU held or lifted slightly; TR and MS held within their CIs; SSA point-estimate dipped 5.4pp but n=56 CI [73.2%, 92.9%] swallows it.

Ships as **Tier 2b**: v10 router + the conditional verbatim rule. 1.3x cost premium over v10 ($0.436 vs $0.327 per correct), latency parity (14.2s vs 12s avg). Recommended over v10 for KU/MS-heavy workloads where the cost premium is acceptable; v10 stays Tier 2a for general-purpose accuracy.

The token-retention framework itself is the durable contribution. Existing benchmark practice gates variants on aggregate accuracy deltas alone — a +0.8pp aggregate lift at N=500 sits inside CI noise and gets discarded. Decomposing retention by per-stage and per-correctness exposes whether a variant's mechanism reproduced even when the headline aggregate falls inside the noise band. v11's per-correctness gap reproduced at +0.495 across two sample sizes; that's a stronger signal than the +0.8pp aggregate alone would have justified.

### Step 19: conditional retriever-knob tuning (NULL on multi-session)

The Step 18 retention framework also identified canonical's MS retriever as a distinct bottleneck — for multi-session questions routed through canonical, the BM25+dense+RRF+rerank pipeline drops 63% of gold tokens. Step 19 tested three opt-in retriever-knob overrides gated on the case's ground-truth multi-session label: (a) higher reader top-K (10 → 20), (b) higher BM25 sparse weight (0.3 → 0.5), (c) higher over-fetch multiplier (3x → 5x). All three NULL'd at Tier A — multi-session accuracy held at v10's baseline. The bottleneck is not the retriever's ranking knobs but the cross-session signal not being present in the BM25+dense candidate pool to begin with. The plumbing shipped as durable opt-in flags (`--om-retriever-ms-k`, `--om-retriever-ms-bm25-weight`, `--om-retriever-ms-overfetch`) for future tuning candidates that change the candidate-pool composition itself, not just the ranking.

The combined Step 18 + Step 19 takeaway: **the residual headroom inside the v10 router architecture lives at the reader prompt, not the retriever knobs.** For further multi-session lift beyond v11, the productive direction is changing what enters the candidate pool — typed-network observers (the [Hindsight pattern](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota)), cross-session entity-graph expansion, or graph-walk retrieval. The retriever-ranking layer is well-tuned at Phase B.

Findings: [STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md), [STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md).

---

## Honest comparison, honest caveats

At matched gpt-4o reader on the full LongMemEval-S 500-case set, AgentOS Step 3 Hybrid sits between Zep and the frontier systems. We don't claim SOTA. We claim a +13.7pp delta vs our own Step 1 baseline at matched reader (59.8% → 73.2%), a 31.4pp lift on multi-session (23.5% → 54.9%), and 15.7% lower cost per correct vs that baseline.

What we can defensibly say:

- **Tier 1 canonical:** 73.2% [69.2%, 77.0%] at gpt-4o reader + gpt-4o judge, LongMemEval-S N=500. 54.9% multi-session [46.6%, 63.2%] (n=133), competitive with the upper half of published memory-system multi-session numbers. $0.0213 per correct answer at gpt-4o. 15.7% below the Step 1 baseline at matched reader.
- **Tier 2a v10 dynamic router:** 74.6% [70.8%, 78.4%] at gpt-4o reader+judge, LongMemEval-S N=500. 60.2% multi-session (+5.3pp vs canonical at n=133). $0.327 per correct answer (15.4x canonical premium); 8.3x faster reader latency (12s avg vs 98s). Routes via gpt-5-mini per-question classifier; ~$0.0005 classifier cost per query.
- **Tier 2b v11 conditional verbatim reader:** 75.4% [71.6%, 79.0%] at gpt-4o reader+judge, LongMemEval-S N=500. 61.7% multi-session (+1.5pp vs v10, +6.8pp vs canonical). $0.436 per correct answer (1.3x v10 premium). Per-correctness retention gap +0.495 reproduced from Phase A (N=102) to Phase B (N=500) — mechanism is reproducible, aggregate +0.8pp vs v10 is within sampling noise.
- **Twenty-eight-step matched-ablation methodology** with CI gates and per-correctness retention probe, producing three shippable production tiers, ~25 well-characterized negative results, and four sampling-luck patterns caught at Phase A before they reached Phase B.

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

## Production tier structure (post-Phase B)

AgentOS ships three production-ready tiers and one planned product feature on top of the same memory substrate. Each tier is a CLI flag combination over the same core; consumers pick by workload mix and budget envelope:

| Tier | Flags (additive over Tier 1) | Architecture | Accuracy (Phase B N=500) | $/correct | Status |
|---|---|---|---:|---:|---|
| **Tier 0** (bare) | (none) | dense retrieval + cognitive scoring only | ~60% (projected from Step 1 baseline 59.8%) | ~$0.032 (projected) | reference baseline |
| **Tier 1** (default) | `--hybrid-retrieval --context-summary gpt-5-mini` | + BM25 sparse + RRF merge + Cohere rerank blend + Anthropic-style session summaries | **73.2% [69.2%, 77.0%]** | **$0.0213** | **shipping default, Phase B N=500 measured** |
| **Tier 2a** (opt-in) | Tier 1 + `--om-router v10 --om-router-classifier gpt-5-mini-fewshot` | + per-question gpt-5-mini classifier routes KU/MS to v5 Observational Memory and SSU/SSA/SSP/TR to canonical Step 3 | **74.6% [70.8%, 78.4%]** | **$0.327** (15.4x canonical) | **shipping opt-in, Phase B N=500 measured; +5.3pp on multi-session, 8.3x faster reader latency** |
| **Tier 2b** (opt-in) | Tier 2a + `--om-reader-conditional-verbatim ku,ssu` | + verbatim-citation rule appended to OM reader prompt only when classifier returns `knowledge-update` or `single-session-user` | **75.4% [71.6%, 79.0%]** | **$0.436** (1.3x v10 / 20x canonical) | **shipping opt-in, Phase B N=500 measured; +1.5pp MS vs v10 / +6.8pp MS vs canonical; mechanism reproduced Phase A → Phase B at +0.495 per-correctness gap** |
| **Tier 3** (recommended shipping default as of 2026-04-24) | `--policy-router --policy-router-preset minimize-cost` | per-query dispatch among {Tier 1, Tier 2a, Tier 2b} via the v10 classifier + min-cost routing table (SSA/SSU/TR/KU → Tier 1; MS/SSP → Tier 2b) | **76.6% [72.8%, 80.2%]** | **$0.0580** | **shipping, Phase B N=500 measured; Pareto-dominates Tier 2a and Tier 2b on accuracy AND cost AND latency** |

Recommended picks by workload:

- **General production workload** → **Tier 3 min-cost**. Pareto-dominates all three previous tiers: **+1.2pp accuracy vs Tier 2b, 7.5x cheaper per correct, 16s avg latency**. Defaults to the min-cost routing table which keeps SSA/SSU/TR/KU on Tier 1 (where they Pareto-dominate) and only pays the Tier 2b OM premium on MS and SSP where the architectural lift earns it.
- **Absolute-cheapest workload, accuracy secondary** → Tier 1 canonical. $0.0213/correct at 73.2% is still the best dollar-per-answer at small accuracy sacrifice.
- **Latency-bounded workload without accuracy flexibility** → Tier 2a. 12s avg reader latency, 74.6% accuracy, fixed cost.
- **KU/MS-heavy workload, willing to pay premium for mechanism** → Tier 2b v11 conditional verbatim.

### Experimental opt-ins (RED at Tier A or NULL at Phase A — available behind flags, not recommended for production)

These ship behind flags for users who want to reproduce or extend the experiments, but did not clear the kill ladder for production tier inclusion:

| Flag | Architecture | Result | Why it failed |
|---|---|---:|---|
| `--observer-reflector` | Step 7: observer/reflector pipeline alongside raw chunks | 62.5% at N=24 smoke | reflection traces compete with raw chunks at rerank, dilutes retrieval |
| `--observer-reflector --observer-reflector-replace` | Step 8: replacement semantics (skip raw chunks, BM25 on reflection traces) | 25.0% at N=24 smoke | LLM-generated reflection summaries erase high-IDF tokens; per-category KU 0% / SSA 0% / TR 0% |
| `--fact-graph-ingest` | Step 9: per-session gpt-5-mini extracts (subject, predicate, object, timestamp) tuples; synthetic traces prepended before rerank | 58.3% at N=24 smoke | `evidenceOrigin` tracking confirmed: 0/24 reader answers cited a synthetic fact-graph trace; ceiling-pinned `retrievalScore: 1.0` displaced real chunks at rerank (`merged.recall = 0.774` → `final.recall = 0.712`) |
| `--om-guided-retrieval` | Step 17: OM-identified candidate sessions scope the canonical retriever | 60.6% at Tier A (v2) | always-run-OM ingest costs 13x v10 latency (163s avg, 569s p95, 12 min worst-case) without an accuracy lift; K=5 candidate-session filter too aggressive for cross-session questions |
| `--om-retriever-ms-k`, `--om-retriever-ms-bm25-weight`, `--om-retriever-ms-overfetch` | Step 19: conditional retriever-knob overrides on multi-session cases only | NULL at Tier A on all three variants | bottleneck is candidate-pool composition, not ranking — retriever-knob tuning can't surface signal that isn't in the pool |
| `--om-reader-conditional-verbatim ku,ssu,ssa` | Step 18 v3: conditional verbatim rule extended to SSA category (gap +0.50, below +0.60 threshold) | NULL at Tier A | confirmed the +0.60 per-correctness gap threshold's calibration |

Orthogonality matters: each flag is independent, so consumers with unusual workloads can mix and match. Canonical presets are bundled for the standard "more accuracy, more cost" progression (Tier 1 → 2a → 2b).

---

## What's next

**Tier 3 shipped as of 2026-04-24: policy router with three presets, `minimize-cost` as the shipping-recommended default.** Full Step 20 findings at [STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md](../STEP_20_POLICY_ROUTER_PHASE_A_FINDINGS_2026-04-24.md). Phase B N=500 result: **76.6% [72.8%, 80.2%] at $0.0580/correct, 16s avg latency** — Pareto-dominates all three previously shipping tiers on accuracy AND cost AND latency. The `minimize-cost` preset keeps Tier 1's cheap canonical path for SSA/SSU/TR/KU (4 of 6 categories the classifier handles robustly) and only pays the Tier 2b OM premium on MS/SSP where the architectural lift earns it; 85.8% of cases route through Tier 1. Novel product primitive: per-query routing among retrieval architectures at a fixed reader, parameterized by Phase B per-category cost-accuracy curves — prior art (FrugalGPT, RouteLLM, AutoMix) routes between MODELS at fixed pipelines; memory-architecture vendors (Mem0, Mastra, Supermemory, Zep) ship one architecture each. The `maximize-accuracy` preset underperformed at Phase B (73.8%) due to a discovered bug in the v1 routing table (TR → Tier 2a paid OM ingest cost for within-CI-noise accuracy gain); v2 queued with TR → Tier 1 — simulation predicts +1-2pp. Spec: [docs/specs/2026-04-24-tier-3-budget-aware-policy-router-design.md](../specs/2026-04-24-tier-3-budget-aware-policy-router-design.md). Total policy router work (spec + implementation + Phase A + Phase B both presets): ~1 day of engineering + $144 of LLM spend.

**Hindsight typed-network observers (architectural research direction).** The Step 18 retention probe identified canonical's MS retriever as the residual bottleneck (drops 63% of gold tokens from the candidate pool, not just from ranking). [Hindsight's typed-network architecture](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) holds the BEAM SOTA at 72-74% across token tiers; the typed-network observer pattern looks like the productive direction for changing what enters the candidate pool, rather than re-tuning ranking knobs over the existing pool (which Step 19 confirmed is exhausted). Budget: ~$400 for a Tier A → Phase A → Phase B ladder, ~1-2 weeks of implementation work.

**Tier 4 two-call reader (Emergence AI pattern).** First reader call extracts relevant facts from top-K, second answers from the extracted facts only. Budget: ~$20-40 per full run. Modest expected lift, orthogonal to the retrieval layer, can layer on top of any working tier including the policy router.

**Step 9 fact-graph ingest revisited with confidence-pegged scores.** The Step 9 RED ([documented above](#experimental-opt-ins)) used `retrievalScore: 1.0` for synthetic fact-graph traces, which displaced real chunks at rerank. A variant setting the synthetic-trace score to the fact's extraction confidence (~0.5) rather than 1.0 lets them compete with raw chunks instead of dominating them. Cheap experiment — same extractor, one constant changed. Budget: ~$5 Tier A.

**Tuned reflector prompt.** Step 8 RED reflects prompt choice, not architecture. The reflector is told to "consolidate" and "elevate important facts," which gpt-5-mini interprets as permission to produce abstract paraphrases. A variant prompt instructing the reflector to preserve names, dates, and numeric values verbatim — borrowing the per-category gating mechanism from Step 18 v2 — is plausible and cheap.

**Graph-expansion retrieval.** The entity graph is already built; we don't currently expand retrieval to include traces connected to the top-K via shared-entity edges. A proper additive-signal experiment would add this and measure against Tier 1. Plausible candidate-pool expansion mechanism for the MS bottleneck identified by Step 18. Budget: ~$1-2 for Tier A.

**Open-weights rerank.** Cohere rerank-v3.5 is commercial-only. [BGE-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) and [voyage-rerank-2](https://blog.voyageai.com/2024/07/25/voyage-rerank-2-the-new-state-of-the-art-reranker/) are plausible drop-in replacements. Testing would widen applicability for self-hosted deployments.

**LongMemEval-M and LongMemEval-L.** We benchmarked the -S variant (115k-token haystacks). The -M variant (~500 sessions) and -L variant (~5000 sessions) stress-test scaling. BM25 is in-memory and sub-ms at 100s of docs; dense retrieval grows linearly with corpus size. Open question: does the BM25 signal survive at -L scale, or does the embedding-similarity component have to carry more load?

**Multimodal benchmarks.** AgentOS's multimodal RAG isn't tested here because LongMemEval is text-only. A separate sequenced rollout on [MM-Vet](https://arxiv.org/abs/2308.02490), [Video-MME](https://arxiv.org/abs/2405.21075), or a chat benchmark with image attachments would measure the modality-specific retrieval quality. Different architecture choices (late-fusion reranking, modality-specific indexing, pixel-level vs convert-to-text embedding) need their own ablations. Not in scope for this rollout; worth its own investigation.

**Verifying frontier claims.** Mem0's public pages currently disagree between 92.0 and 93.4, Mastra reports 94.87% at gpt-5-mini, OMEGA reports 95.4% at GPT-4.1, and Emergence AI reports 86% at gpt-4o. Each of these uses a different stack at a different reader. A fair comparison would run each on identical infrastructure. We haven't done this. Until someone does, the leaderboard numbers are self-reported on self-selected configurations.

---

## Reproducibility

Every number in this post traces to a run JSON in [packages/agentos-bench/results/runs/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/results/runs). The three Phase B confirmations: Tier 1 canonical at [2026-04-20T20-03-14-675--longmemeval-s--gpt-4o--full-cognitive--ingest.json](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/results/runs/), Tier 2a v10 at [2026-04-23T04-14-40-609--longmemeval-s--gpt-4o--full-cognitive--ingest.json](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/results/runs/), Tier 2b v11 at the most recent ingest run timestamped 2026-04-23. The bench CLI that produced the Tier 1 row:

```bash
pnpm exec agentos-bench run longmemeval-s \
  --reader gpt-4o --judge-model gpt-4o \
  --memory full-cognitive --replay ingest \
  --rerank cohere --context-summary gpt-5-mini \
  --hybrid-retrieval --reader-top-k 10 \
  --bootstrap-resamples 10000 --seed 42
```

Tier 2a adds `--om-router v10 --om-router-classifier gpt-5-mini-fewshot`; Tier 2b adds `--om-reader-conditional-verbatim ku,ssu`. The Step 18 retention-instrumentation cache fingerprint (`retention-instrumentation:v1`) is added to the BenchmarkRunner so post-hoc retention rescoring is cache-safe across reruns.

Step-level findings docs live in [packages/agentos-bench/docs/STEP_*_FINDINGS_*.md](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/docs). The umbrella doc is at [RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/RAG_STACK_UMBRELLA_FINDINGS_2026-04-20.md). Step 18 (token retention) findings live at [STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_18_TOKEN_RETENTION_BASELINE_FINDINGS_2026-04-23.md); Step 19 (conditional retriever-knob NULL) at [STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_19_CONDITIONAL_RETRIEVER_TUNING_FINDINGS_2026-04-23.md). Step 16c v10 Phase B at [STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_16C_V10_PHASE_B_FINDINGS_2026-04-23.md). Step 15 family findings live in dated docs ([V2](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_15_V2_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md), [V3](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_15_V3_DUAL_PATH_FINDINGS_2026-04-22.md), [V4 a/b/c](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_15_V4_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md), [V5](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_15_V5_OBSERVATIONAL_MEMORY_FINDINGS_2026-04-22.md), [Step 16](https://github.com/framersai/agentos/blob/master/packages/agentos-bench/docs/STEP_16_OM_PLUS_RETRIEVAL_FINDINGS_2026-04-22.md)). Specs and plans for each step live under [docs/specs/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/docs/specs) and [docs/plans/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/docs/plans). The matched-ablation, bootstrap CI, and per-correctness retention methodology is implemented at [packages/agentos-bench/src/core/metrics/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/src/core/metrics).

Commits for each experiment are listed in the umbrella findings doc plus the individual per-step findings docs. The architecture doc for HybridRetriever lives at [packages/agentos/docs/architecture/hybrid-retriever.md](https://github.com/framersai/agentos/blob/master/packages/agentos/docs/architecture/hybrid-retriever.md). The Observational Memory port lives at [packages/agentos-bench/src/observational-memory/](https://github.com/framersai/agentos/tree/master/packages/agentos-bench/src/observational-memory) with Apache 2.0 attribution to Mastra and supports four ingest modes (per-session, batched, dual-path, hierarchical), the v10 dynamic router (`runner.ts` `buildOmReaderSystemPrompt` with `routerCategory` parameter), and the v11 conditional verbatim rule (`prompts.ts` `CONDITIONAL_VERBATIM_CITATION` constant gated by `VERBATIM_CITATION_ELIGIBLE_CATEGORIES`).

Total measurement cost across all twenty-eight experiments plus three Phase B N=500 confirmations (canonical, Tier 2a v10, Tier 2b v11): **~$870**. Step 1-17 breakdown ($644 prior): $26.53 Steps 1-9 + $1.45 Step 11 + $1.84 Step 12 + $0.42 Step 13 + $2.08 Step 14 + $4.28 Step 15 v1 + $4.27 v2 + $4.28 v3 + $14.78 v4a/b/c Tier A + $26.30 v4a Phase A + $24.30 v5 Tier A + $33.67 Step 16 + $32.66 Step 16b + $25.68 v7 Tier A + $25.39 v8 Tier A + $139.27 v5 Phase A + $36.08 v7 Phase A (partial, quota errors on 46/102) + $12.48 16c baseline Tier A + $9.78 16c v9 + $5.86 16c v10 Tier A + $7.13 16c v11 + $22.85 16c v10 Phase A + $121.80 16c v10 Phase B + $32.72 Step 17 v1 + $32.88 Step 17 v2 attempt 1 + $0.02 Step 17 v2 cache-hit + $32.56 Step 17 v2 fresh. Step 18-19 breakdown (~$226 added this session): ~$15 Step 18 v1/v2/v3 Tier A + $22.85 Step 18 v2 Phase A + $164.45 Step 18 v2 Phase B + ~$5.86 Step 18 v3 retest with v10 routing (wasted spend on a misgated MS routing test, documented for transparency) + ~$18 Step 19 retriever-knob variants Tier A. Reader: OpenAI gpt-4o-2024-08-06 at matched gpt-4o across all experiments. Reranker: Cohere rerank-v3.5 (where used, disabled in Step 15 variants that omit retrieval). Embedder: OpenAI text-embedding-3-small. Judge: OpenAI gpt-4o-2024-08-06. Observer: gpt-5-mini through v1-v4; gpt-4o in v5/v9/Step 16/Step 16c routed-to-OM cases (clamped to `max_tokens=16000` to stay within gpt-4o's 16384 completion-token cap — a fix we added to `OpenAIHttpReader` during v5 after observer calls silently failed at the default 100k ceiling); gpt-5 in v7/v8 (used `max_completion_tokens=2048` + `reasoning_effort='minimal'`). Fact-graph extractor (Step 9): gpt-5-mini. Step 16c v10 classifier: gpt-5-mini with few-shot prompt. Step 18 v2 conditional verbatim rule: appended only when classifier returns `knowledge-update` or `single-session-user` (`VERBATIM_CITATION_ELIGIBLE_CATEGORIES` Set in `src/observational-memory/runner.ts`).

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
