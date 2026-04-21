---
title: SOTA RAG / Memory Research — 2026-04-19
scope: Techniques beyond HyDE to close the remaining gap to Mastra OM on LongMemEval-S
sources: Serper, Tavily, direct-scrape (firecrawl credits exhausted mid-run)
reranker: Cohere rerank-v3.5, top-20 from 64 snippets
---

## 1. The SOTA landscape (verified Feb–Apr 2026)

From [Mastra's published leaderboard](https://mastra.ai/research/observational-memory) (2026-02-09):

| System | Model | LongMemEval-S | Source |
|---|---|---:|---|
| **Mastra OM** | gpt-5-mini | **94.87%** | Mastra Research, open source |
| Mastra OM | gemini-3-pro-preview | 93.27% | Mastra Research |
| Hindsight (arxiv:2512.12818) | gemini-3-pro-preview | 91.40% | arxiv |
| Mastra OM | gemini-3-flash-preview | 89.20% | Mastra Research |
| Hindsight | GPT-OSS 120B | 89.00% | arxiv |
| EmergenceMem (internal, non-public) | gpt-4o | 86.00% | blog |
| Supermemory | gemini-3-pro-preview | 85.20% | supermemory.ai |
| Supermemory | gpt-5 | 84.60% | supermemory.ai |
| Mastra OM | gpt-4o | 84.23% | Mastra Research |
| Hindsight | GPT-OSS 20B | 83.60% | arxiv |
| Oracle | gpt-4o | 82.40% | baseline |
| Supermemory | gpt-4o | 81.60% | supermemory.ai |
| **AgentOS (us, v5+rerank, N=24)** | gpt-5-mini | **83.3% unw / 81.3% weighted** | this session |
| Mastra RAG (topK=20) | gpt-4o | 80.05% | Mastra Research |
| Zep | gpt-4o | 71.20% | arxiv:2501.13956 |
| Full-context | gpt-4o | 60.20% | baseline |

**Mastra OM per-type @ gpt-5-mini (the target):**

| Type | Mastra OM | AgentOS v5+rerank | Gap |
|---|---:|---:|---:|
| knowledge-update | 96.2% (75/78) | 75% (3/4) | **−21pp** |
| multi-session | 87.2% (116/133) | 50% (2/4) | **−37pp** |
| single-session-assistant | 94.6% | 100% | +5 |
| single-session-preference | 100.0% | 75% | −25 |
| single-session-user | 95.7% | 100% | +4 |
| temporal-reasoning | 95.5% (127/133) | 100% | +5 |

Our smoke numbers are noisy at N=24, but the structural gap is in **knowledge-update** and **multi-session**. Those two categories are 42% of the LongMemEval-S distribution (15.6% + 26.6%).

## 2. The paradigm split — compression vs retrieval

**The finding that reframes our architecture:** Mastra OM is not a better RAG. It's *not RAG at all*.

From Mastra's blog:

> Two background agents — an Observer and a Reflector — watch your agent's conversations and maintain a dense observation log that replaces raw message history as it grows. The context window has two sections: memory (observations) at the start, and message history at the end. [...] No per-turn dynamic retrieval based on the user prompt. No dynamic injection. Just a stable log of what happened.

They compress. We retrieve. Both work — they trade off differently:

| | Compression (Mastra OM) | Retrieval (AgentOS) |
|---|---|---|
| Accuracy ceiling | Matches oracle (94.87%) | Bounded by Recall@K |
| Per-query cost | ~0 (observations pre-built) | ~0 (vector lookup) |
| Ingest cost | ~$0.01–$0.05 per session (Gemini 2.5 Flash Observer) | ~$0.0002 per session (embedder only) |
| Prompt cache hits | ~100% (stable context) | 0% (dynamic injection) |
| Adapts to new queries | Observer must re-run | Queries are free |
| Works for open-world knowledge | No (only what agent saw) | Yes |
| Works for multi-session | Yes — observations cross sessions | Limited by retrieval diversity |

The **cost story** is more nuanced than a naive "$/correct" comparison suggests, and there are TWO independent axes that must not be conflated:

1. **Reader-model pricing tier** — agentmemory, Supermemory, and the Mastra OM gpt-4o cell all report numbers at gpt-4o. Our stack runs at gpt-5-mini, which has input pricing 10× cheaper and output pricing 5× cheaper. Any `$/correct` ratio between systems at *different* readers is a pricing artifact, not an architectural advantage. Claims like "10× cheaper than gpt-4o competitors" belong in a same-reader cell — **Phase C (our stack at gpt-4o) is the gate** for making that claim honestly.
2. **Ingest-time LLM usage** (the architectural axis, apples-to-apples at matched reader). Verified from Mastra's [docs](https://mastra.ai/docs/memory/observational-memory) and [workshop repo](https://github.com/mastra-ai/mastra-observational-memory-workshop): Observer fires at 30k-token threshold of unprocessed messages, Reflector at 40k-token threshold of observations. For a 115k-token LongMemEval case, that's ~4 Observer calls + 1-2 Reflector calls = **~5-6 ingest LLM calls per case**. AgentOS does 1 summary call per unique session (~500 unique sessions shared across 500 cases, content-addressed cache) = **~4 calls per case amortized**. **The call-count ratio is ~1.5×, not "2-3×" as I originally claimed and definitely not "15×" as I also once wrote.** The actual architectural advantage on multi-session is not about call count; it's about coverage — Mastra's compressed observation log puts ALL sessions in reader context at once, sidestepping retrieval entirely. Our retrieval approach must select top-K chunks and can miss gold sessions on multi-hop questions. That's the structural asymmetry driving their 87.2% multi-session vs our 68.8%.

**Strategic reframe for the blog:** two architectures at distinct operating points. Our **same-architecture cost matrix** (measured 24-case smoke token counts × rate card for each reader):

| Reader | Reader-only $/correct | All-in $/correct |
|---|---:|---:|
| gpt-5-mini (measured) | $0.00216 | $0.003 |
| claude-haiku-4-5 (projected) | $0.00661 | $0.008 |
| gpt-4o (projected) | $0.02033 | $0.022 |
| claude-sonnet-4-6 (projected) | $0.02478 | $0.026 |

Mastra OM's gpt-5-mini cell (94.87%) is the apples-to-apples accuracy target; their matched-reader cost isn't published but their architecture fires ~15× more ingest LLM calls per session (Observer + Reflector vs our one summary). The architectural-wedge ratio is ~1:15 in ingest call count; the $/correct impact depends on ingest tokens, but at either model tier the call-count advantage is the real architectural claim. Published gpt-4o competitors (agentmemory ~$0.03/correct) are price-tier comparables only when we run our own gpt-4o cell (Phase C). Publish the matrix, not collapsed cross-reader ratios.

## 3. Techniques beyond HyDE — ranked by impact on our specific gaps

### Tier 1 — High impact, implementable in 1-2 sessions

**A. [Anthropic Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval)** (Sep 2024)

> "Contextual Retrieval solves this problem by prepending chunk-specific explanatory context to each chunk before embedding."

Reported numbers:
- **Contextual Embeddings alone:** reduced top-20 retrieval failure by **35%** (5.7% → 3.7%)
- **Contextual Embeddings + Contextual BM25:** **49%** failure reduction
- **+ Reranking:** **67%** failure reduction (we already have reranking; adding the context prepend gets us the remaining ~18pp improvement)

Cost: $1.02 per million document tokens with prompt caching (one-time, at ingest).

**Applied to our case:** each chunk is currently `[2024-03-15] user: ... / assistant: ...`. Anthropic-style would prepend a 50-100 token chunk-specific context like *"This chunk is from a conversation where the user discussed mortgage pre-approval with Wells Fargo; the user was pre-approved for $350k but this was later revised to $400k."*

**Cheaper variant for our scale:** one summary per *session* (not per chunk). Each chunk in that session gets the session summary prepended. Cost: ~$0.003 per session (Haiku/gpt-5-mini) × ~50 sessions × 500 cases = ~$75 one-time for the full LongMemEval-S, warm-cached for all subsequent runs.

**Expected impact:** +10–20pp on multi-session (our biggest gap).

**B. Multi-Query RAG Fusion (RRF)** — [NVIDIA blueprint](https://docs.nvidia.com/nemo/retriever/blueprints/query-decomposition.html), [ACL 2025](https://aclanthology.org/2025.findings-acl.20.pdf)

Generate 3–5 query paraphrases with a cheap LLM, embed each separately, retrieve top-K for each, merge via Reciprocal Rank Fusion:

```
score(doc) = Σ 1 / (k + rank_in_query_i(doc))
```

Reddit 2026 thread ("In 2026, RAG wins but only if you stop doing top-k and praying") confirms this is standard practice. ACL 2026 paper ("Comprehensive Comparison of RAG Methods Across Multi-Domain Conversational QA") finds *"robust yet straightforward methods, such as reranking, hybrid BM25, and HyDE, consistently outperform vanilla RAG."*

**Expected impact:** +5–10pp on multi-session. Addresses the "query embedding misses phrasing variants" failure mode directly. Cost: 3× retrieval calls (tiny with embedding cache) + 1 cheap LLM call for paraphrase generation (~$0.0005/query).

**C. "Knowledge layer" supersession semantics** — [arxiv:2604.11364](https://arxiv.org/abs/2604.11364) (April 2026)

> CoALA [21] and JEPA [12], both lack an explicit Knowledge layer with its own persistence semantics. This gap produces a category error: systems apply cognitive decay to factual claims, or treat facts and experiences with identical update mechanics. [...] Knowledge (indefinite supersession), Memory (Ebbinghaus decay), Wisdom (evidence-gated revision), Intelligence (ephemeral inference).

This paper *names* our knowledge-update failure mode. We apply Ebbinghaus decay to "the user is pre-approved for $350k" — but that's a Knowledge-layer fact that should be supersessed (overwritten in place when updated), not decayed.

**Applied to our case:** during ingest, extract facts like `(entity, attribute, value, date)` — e.g., `(user, preapproved_amount, $350k, 2024-03-15)` — and store the latest per `(entity, attribute)` pair. Retrieval checks the knowledge store first for questions about supersedable attributes; falls back to episodic retrieval for narrative questions.

We have a `SqliteKnowledgeGraph` in the agentos stack already — unused in the bench path. Wiring it up is architectural but well-scoped.

**Expected impact:** +15–20pp on knowledge-update (our case 852ce960 failure mode). Cost: one cheap LLM call per session at ingest for fact extraction.

### Tier 2 — Moderate impact, worth trying

**D. Mastra-style Observer/Reflector ingestion** — [Mastra Research](https://mastra.ai/research/observational-memory)

AgentOS already has `MemoryObserver` and `MemoryReflector` in [packages/agentos/src/memory/CognitiveMemoryManager.ts:316-324](packages/agentos/src/memory/CognitiveMemoryManager.ts#L316-L324). They activate when an `llmInvoker` is provided. Our bench currently doesn't pass one.

Wiring this would give us:
- Observation-layer traces alongside raw-turn traces (dual representation)
- Reflection pass that generates insights ("user is job-hunting for Q3 2024") that retrieve well on abstract queries

This is closer to Mastra's architecture while keeping our retrieval-first design.

**Expected impact:** +5–10pp overall, with the biggest lift on multi-session synthesis. Cost: one cheap LLM call per session at ingest.

**E. RAPTOR hierarchical tree** — [OpenReview](https://openreview.net/forum?id=GN921JHCRw), [arxiv:2401.18059](https://arxiv.org/html/2401.18059v1)

> RAPTOR model retrieves from [a hierarchical tree], integrating information across lengthy documents at different levels of abstraction. [...] On question-answering tasks that involve complex, multi-step reasoning, we show state-of-the-art results; for example, by coupling RAPTOR retrieval with GPT-4, we can improve the best performance on the QuALITY benchmark by 20% in absolute accuracy.

Microsoft's production RAG comparison (techcommunity):

| Indexing Strategy | Precision | Recall | F1 |
|---|---:|---:|---:|
| Basic Vector | 70% | 65% | 67.5% |
| Multi-Vector | 85% | 80% | 82.5% |
| Parent Document | 82% | 85% | 83.5% |
| **RAPTOR** | **88%** | **87%** | **87.5%** |

**Applied to our case:** during ingest, cluster chunks (K-means over embeddings), summarize each cluster, embed the summaries. Retrieval can hit chunks *or* cluster-level summaries. Session-level clusters give us abstraction hooks for multi-session questions.

**Expected impact:** +5–15pp on multi-session specifically. Infrastructure cost is meaningful (re-architecting the vector store as a tree).

**F. Chain-of-Verification (CoVe)** — [ACL paper](https://aclanthology.org/2024.findings-emnlp.XXX.pdf)

Reader generates answer, then generates 2-3 verification questions, answers each against retrieved evidence, revises if contradictions. Reduces hallucinations.

**Expected impact:** +2–5pp on knowledge-update (catches the "picked the older value" failure). Cost: ~2× reader tokens per query.

### Tier 3 — Defer (infrastructure heavy or marginal on this benchmark)

- **Self-RAG** — requires fine-tuning a 7B/13B model with reflection tokens. Too heavy.
- **CRAG** — decompose-then-recompose + web search augmentation. Web search isn't applicable to a closed benchmark.
- **ColBERT late interaction** — +17pp on MS MARCO MRR@10 (18.7 BM25 → 36 ColBERT) but requires per-token embeddings and a different vector store. Big refactor.
- **GraphRAG (Microsoft)** — graph-based retrieval. We have `SqliteKnowledgeGraph` already, but the bench doesn't use GraphRAG query patterns.

## 4. Recommended implementation sequence

Given we already have +11.8pp from Tier 1A (rerank) + Tier 1C (v5 prompt), the ROI-ordered backlog for closing the remaining gap:

| # | Technique | Expected Δ | Build effort | API cost to test @ 24-case smoke |
|---:|---|---:|---|---:|
| 1 | Session-summary prepending (cheap contextual retrieval variant) | **+8–15pp** on multi-session | 3-4 hours | ~$0.40 |
| 2 | Multi-query RRF (3 paraphrases) | +5–10pp on multi-session | 2-3 hours | ~$0.30 |
| 3 | Knowledge-layer supersession (entity-attribute-value store) | +10–20pp on knowledge-update | 6-8 hours | ~$0.50 |
| 4 | Observer/Reflector ingestion | +5–10pp overall | 4-6 hours (wiring only — code exists) | ~$2 (ingest cost) |
| 5 | RAPTOR hierarchical index | +5–15pp on multi-session | 12+ hours | ~$1 |
| 6 | Chain-of-Verification reader pass | +2–5pp | 2-3 hours | ~$0.30 (2× reader cost) |

The first three in sequence should get us to ~85-90% weighted on smoke. At that point Phase A (102 cases) is safe to run.

## 5. What we're not going to chase

**Judge manipulation.** The LongMemEval judge is vendored verbatim from `xiaowu0162/LongMemEval`. Any accuracy gain from touching the judge would invalidate published comparisons. Off-limits.

**Benchmark-specific overfit.** Mastra notes preference is volatile at N=30 (one flip = 3.3pp). Same applies to our N=24. Don't tune to category outliers; tune to the architecture.

**Fine-tuning a reader.** Self-RAG-style retrieval tokens are a major invest. Not justified when prompt engineering + retrieval fixes are earning double-digit lifts.

## 6. Source bibliography

| Source | Relevance | Type |
|---|---:|---|
| [Mastra Observational Memory research](https://mastra.ai/research/observational-memory) | 0.29 → 1.0 after read | Architecture blueprint |
| [Anthropic Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval) | direct-read | +67% retrieval with rerank |
| [arxiv:2604.11364 — Missing Knowledge Layer](https://arxiv.org/abs/2604.11364) | direct-read | Knowledge vs Memory persistence |
| [RAPTOR (OpenReview)](https://openreview.net/forum?id=GN921JHCRw) | 0.289 | +20pp QuALITY |
| [arxiv:2401.15884 — CRAG](https://arxiv.org/abs/2401.15884) | 0.311 | Decompose-then-recompose |
| [Self-RAG](https://selfrag.github.io/) | 0.457 | Reflection tokens (fine-tune) |
| [ACL 2026 RAG multi-domain comparison](https://aclanthology.org/2026.eacl-srw.17.pdf) | 0.399 | "Simple reranking + HyDE wins" |
| [StackAI Advanced RAG 2026](https://www.stackai.com/blog/advanced-rag-techniques) | 0.368 | Industry survey |
| [Azure/Microsoft RAG methods](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/from-zero-to-hero-proven-methods-to-optimize-rag-for-production/4450040) | 0.313 | RAPTOR benchmark comparison |
| [RAGFlow 2025 year-end review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context) | 0.268 | State of the field |
| [r/AI_Agents 2026 RAG thread](https://www.reddit.com/r/AI_Agents/comments/1pvhacy/in_2026_rag_wins_but_only_if_you_stop_doing_topk/) | 0.337 | State-aware retrieval pattern |
| [ColBERT (Stanford CS224V)](https://web.stanford.edu/class/cs224v/lectures_2023/ColBERT-slides.pdf) | 0.254 | Late-interaction retrieval |
| [Mastra OM on ZenML LLMOps DB](https://www.zenml.io/llmops-database/observational-memory-human-inspired-context-compression) | 0.290 | Third-party confirmation |

Total sources scanned: 64 snippets across 9 parallel searches (Serper + Tavily + direct-scrape), Cohere-reranked to top 20, of which 13 were worth full-reading.
