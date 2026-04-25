---
title: SOTA Cited-Evidence Survey — 2026-04-25
scope: Comprehensive primary-source-cited audit of agent memory / RAG SOTA libraries, scoped to fill the gaps not covered by SOTA_RESEARCH_2026-04-19 + COMPETITOR_METHODOLOGY_AUDIT_2026-04-24.
sources: 23 primary sources read end-to-end via WebFetch, plus 20 multi-provider search artifacts (Tavily + Serper) at .firecrawl/agentos-sota-2026-04-25/.
purpose: Research foundation for Stage E / H / I / J / K / L / M experiment families. Three substantive corrections to the prior next-session handoff are documented in §12.
---

## 0. Bottom line

**AgentOS substrate** (verified from source): 4 shipping orchestration primitives — `CognitivePipeline`, `IngestRouter`, `MemoryRouter` (+ `AdaptiveMemoryRouter`), `ReadRouter` — sit on top of `CognitiveMemoryManager` (HEXACO encoding, Ebbinghaus decay, Baddeley working memory, ACT-R spreading activation, observer/reflector, prospective memory, 8 cognitive mechanisms). The substrate is real; the orchestrators are dispatcher-only and need executor implementations for `fact-graph` / `summarized` / `observational` ingest variants.

**SOTA gap landscape** (cited below):

- LongMemEval-S — Mem0 platform v3 **93.4%** (claimed), Mastra OM **94.87% gpt-5-mini / 84.23% gpt-4o**, Hindsight **91.4% gemini-3-pro**, Supermemory **81.6% gpt-4o**, AgentOS **76.6%** at $0.058/correct.
- LOCOMO — Mem0 **91.6%** (claimed), Hindsight **89.61% OSS-120B**, AgentOS **51.5% K=20**.
- BEAM 10M — Hindsight **64.1%** (open SOTA), Honcho 40.6%, RAG 24.9%; Mem0 has **not** published BEAM scores despite founding the BEAM blog.

**Three load-bearing methodology issues** documented in primary sources:

1. LOCOMO 6.4% wrong answer key + 62.81% judge FPR on vague answers (Penfield Labs).
2. Hindsight numbers measured by Hindsight team's own Gemini-judge harness (vendor bias on cross-vendor comparison tables).
3. Mem0's 93.4% LongMemEval is "managed platform" only and not in their OSS SDK (Mem0's own docs).

The most important single finding for our Stage E/H/I/J/K plan: **Mem0 v3's headline lift came from removing the graph store and going single-pass ADD-only with hybrid retrieval — not from richer fact-graph extraction.** This invalidates one of our planned Stage I architecture candidates and changes priority order.

---

## 1. AgentOS substrate — verified from source

| Primitive | Doc | Source |
|---|---|---|
| Cognitive Pipeline | `packages/agentos/docs/COGNITIVE_PIPELINE.md` | `packages/agentos/src/cognitive-pipeline/` |
| Memory Router | `packages/agentos/docs/MEMORY_ROUTER.md` | `packages/agentos/src/memory-router/MemoryRouter.ts` |
| Ingest Router | `packages/agentos/docs/INGEST_ROUTER.md` | `packages/agentos/src/ingest-router/IngestRouter.ts` |
| Read Router | `packages/agentos/docs/READ_ROUTER.md` | `packages/agentos/src/read-router/ReadRouter.ts` |
| Adaptive Memory Router | `packages/agentos/docs/ADAPTIVE_MEMORY_ROUTER.md` | `packages/agentos/src/memory-router/adaptive.ts` |
| Cognitive Memory Manager | `packages/agentos/docs/memory/COGNITIVE_MEMORY.md` | `packages/agentos/src/memory/CognitiveMemoryManager.ts` |
| Cognitive Mechanisms (8) | `packages/agentos/docs/memory/COGNITIVE_MECHANISMS.md` | `packages/agentos/src/memory/mechanisms/` |

**The dispatcher-only gap that matters for SOTA push:** `IngestRouter` ships `fact-graph`, `summarized`, `observational`, and `hybrid` as strategy IDs **without executor implementations** — those are exactly the architectures Mem0 (formerly fact-graph; v3 dropped it), Anthropic (contextual retrieval = summarized), and Mastra (observational) win on. Implementing those executors **is** the SOTA push. The orchestrator is ready; the architecture executors are not.

---

## 2. Hindsight typed-network observer (arxiv:2512.12818)

**Sources:**
- arxiv.org/html/2512.12818v1 (paper)
- hindsight.vectorize.io/blog/2026/04/02/beam-sota
- hindsight.vectorize.io/guides/2026/04/21/comparison-agent-memory-benchmark-hindsight-vs-alternatives
- github.com/vectorize-io/agent-memory-benchmark

### 2.1 Architecture (verbatim from paper)

**Memory unit (Equation 1):** `f = (u, b, t, v, τs, τe, τm, ℓ, c, x)` — unique ID, bank ID, narrative text, embedding vector, occurrence interval, mention timestamp, fact type, confidence, auxiliary metadata.

**Four typed networks** (this is the actual schema, not "entity/relation/episode" as our prior research notes assumed):

- **𝒲 (World):** "objective facts about the external world"
- **ℬ (Experience):** "biographical information…written in the first person"
- **𝒪 (Opinion):** tuple `(t, c, τ)` = text, confidence ∈[0,1], timestamp
- **𝒮 (Observation):** "preference-neutral summaries of entities"

### 2.2 Fact extraction pipeline (verbatim)

> "decompose[d] into…1) coreference resolution, 2) temporal expression normalization and range extraction, 3) participant attribution, 4) preservation of explicit reasoning, 5) fact type classification, 6) entity extraction."

Output schema: "narrative text of each fact, normalized temporal information (including ranges), participants and their roles, a fact type indicating the target network, and a set of mentioned entities."

### 2.3 Retrieval (Four-way fusion)

**Spreading activation (Eq. 12):** `A(fj, t+1) = max[(fi,fj,w,ℓ)∈E] [A(fi,t) · w · δ · μ(ℓ)]` — δ ∈ (0,1) decay, μ(ℓ) link-type multiplier.

| Link | Weight |
|---|---|
| Temporal | `exp(−Δtij / σt)` |
| Semantic | cosine ≥ θs |
| Entity | bidirectional, w=1.0 |
| Causal | LLM-extracted, w=1.0 |

**Fusion:** RRF over `{semantic, BM25, graph spreading activation, temporal interval overlap}` with k=60.

### 2.4 Numbers (verbatim)

LongMemEval-S (500 questions):

| System | Overall | SSU | MS | TR |
|---|---:|---:|---:|---:|
| Full-Context GPT-4o | 60.2% | 81.4% | 44.3% | 45.1% |
| Hindsight OSS-20B | **83.6%** | 95.7% | 79.7% | 79.7% |
| Hindsight OSS-120B | **89.0%** | 100.0% | 81.2% | 85.7% |
| Hindsight Gemini-3-pro | **91.4%** | 97.1% | 87.2% | 91.0% |

LOCOMO: Hindsight OSS-20B **85.67%**, OSS-120B **89.61%**. Prior best Supermemory 75.78%.

BEAM 10M: Hindsight **64.1%**, Honcho 40.6%, RAG 24.9%, LIGHT (BEAM paper proposal) 26.6%. BEAM 1M: Hindsight **73.9%**.

### 2.5 Comparisons (verbatim)

vs Mem0: *"focuses on production efficiency with dense retrieval and graph representations, handling fact conflicts through database updates rather than belief evolution"* (Hindsight emphasizes opinion evolution; Mem0 doesn't model belief).

vs Zep: *"builds temporal knowledge graphs…but focuses on objective facts without modeling subjective beliefs or behavioral profiles."*

### 2.6 Code availability + harness vendor-bias caveat

The `vectorize-io/agent-memory-benchmark` repo uses **a Gemini judge** (*"a Gemini model produces an answer from the retrieved context… a second Gemini call scores the answer against gold answers"*). Hindsight's measurements may not match the LongMemEval/LOCOMO official judges that other vendors use. **This is a vendor-bias caveat that should be footnoted on any AgentOS-vs-Hindsight comparison.**

### 2.7 Implication for our Stage E

The Hindsight typed-network is more nuanced than our prior spec assumed:
- **Four typed networks (World/Experience/Opinion/Observation), not three** (entity/relation/episode)
- **Opinion evolution as the differentiating mechanism**

To reproduce: (a) LLM extraction pipeline emitting six-step decomposed outputs, (b) four bidirectional graph types with the typed weights, (c) RRF fusion across four signals. **Bigger scope than the spec at `packages/agentos-bench/docs/specs/2026-04-23-hindsight-typed-network-observer-design.md`** — likely 2-3 weeks rather than 1-2.

---

## 3. Mem0 fact-graph (mem0/memory-benchmarks + Mem0 v3 docs)

**Sources:**
- docs.mem0.ai/migration/oss-v2-to-v3
- docs.mem0.ai/core-concepts/memory-evaluation
- mem0.ai/blog/state-of-ai-agent-memory-2026
- mem0.ai/blog/what-is-beam-memory-benchmark-the-paper-that-shows-1m-context-window-isnt-enough

### 3.1 Mem0 v3 = single-pass ADD-only + hybrid search, NOT graph

**This is the most important finding for our experiment plan. Mem0 v3 removed the graph store:**

> *"Graph store support has been removed from the open-source SDK. It is replaced by built-in entity linking, which runs natively with no external dependencies."*

| Component | v2 | v3 |
|---|---|---|
| Extraction | Two LLM calls (extract + ADD/UPDATE/DELETE diff) | Single LLM call (ADD only) |
| Search | Semantic only | Multi-signal hybrid (semantic + BM25 + entity matching) |
| Graph store | Neo4j / Memgraph | Removed; replaced by entity linking |
| Update semantics | UPDATE/DELETE on existing memories | Append new fact alongside old; retrieval ranking handles staleness |

Quote: *"The model spends its capacity on understanding the input rather than diffing against existing state."*

### 3.2 Numbers (verbatim from docs.mem0.ai)

LongMemEval per-category (v2 → v3):
- Single-session-assistant: **+53.6** (46.4% → **100.0%**)
- Temporal-reasoning: **+42.1** (51.1% → **93.2%**)
- Knowledge-update: **+16.7** (79.5% → **96.2%**)
- **Overall: 93.4%** (+25.6)

LOCOMO per-category (v2 → v3):
- Temporal: **+29.6** (63.2% → **92.8%**)
- Multi-hop: **+23.1** (70.2% → **93.3%**)
- **Overall: 91.6%** (+20.2)

Token efficiency: ~6,800 tokens / query at retrieval.

### 3.3 CRITICAL caveat (verbatim)

> *"Scores reflect Mem0's managed platform, which includes proprietary optimizations not available in the open-source SDK."*

> *"Open-source users should expect directionally similar gains but not identical numbers."*

**Mem0's State of AI Agent Memory 2026 article shows different numbers** when comparing approaches on LOCOMO with their own harness:

| Approach | LLM Score | P95 latency | Tokens |
|---|---:|---:|---:|
| Full-context | 72.9% | 17.12s | ~26k |
| **Mem0g (graph)** | **68.4%** | 2.59s | ~1,800 |
| **Mem0** | **66.9%** | 1.44s | ~1,800 |
| RAG | 61.0% | 0.70s | — |

So Mem0's *own* article shows **66.9%** on LOCOMO using the production stack — vs the **91.6%** "v3 algorithm" claim. The 91.6% appears to be a managed-platform number with proprietary optimizations not reflected in the publicly reproducible config.

### 3.4 Implication for Stage I (LOCOMO architecture push)

The fact-graph executor we planned to implement is *not* what Mem0 v3 actually ships. **If we want to track Mem0's real architecture, we should implement: (a) single-pass ADD-only fact extraction + (b) entity-linking-aware hybrid retrieval, NOT a separate fact-triple graph.** This is closer to what `IngestRouter`'s `summarized` strategy + `MemoryRouter`'s hybrid backend already are. Likely a smaller delta than the fact-graph spec assumed.

---

## 4. Mastra Observational Memory

**Sources:** mastra.ai/docs/memory/observational-memory, mastra.ai/research/observational-memory, the-decoder.com Mastra emoji compression article.

### 4.1 Threshold logic (verbatim)

| Parameter | Default | Purpose |
|---|---|---|
| `messageTokens` | **30,000** | Observer activation |
| `observationTokens` | **40,000** | Reflector activation |
| `observation.bufferTokens` | 0.2 | Buffering = 20% of messageTokens |
| `observation.bufferActivation` | 0.8 | Window clearance trigger |
| `reflection.bufferActivation` | 0.5 | Background reflection start |
| `*.blockAfter` | 1.2 | Safety multiplier |

### 4.2 Traffic-light emoji encoding (Observer output format)

> 🔴 = "important information", 🟡 = "potentially relevant details", 🟢 = "pure context without any particular priority"

Compression ratios (the-decoder.com via Mastra):
- Text-only conversations: **3-6x** (~6x in the LongMemEval benchmark itself)
- Agent tool calls (Playwright/coding): **5-40x**
- Single Playwright screenshot: 50,000 tokens → "few hundred" tokens

### 4.3 Per-category breakdown

From Mastra research page:

| Category | Mastra OM gpt-4o | Mastra OM gpt-5-mini |
|---|---:|---:|
| knowledge-update | 85.9% | 96.2% |
| multi-session | 79.7% | 87.2% |
| single-session-assistant | 82.1% | — |
| single-session-preference | 73.3% | 100% |
| single-session-user | 98.6% | — |
| temporal-reasoning | 85.7% | 95.5% |
| **Overall** | **84.23%** | **94.87%** |

### 4.4 Code location

- Implementation: `github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory`
- Bench runner: `github.com/mastra-ai/mastra/tree/main/explorations/longmemeval`

### 4.5 Single-provider reproducibility caveat

Mastra's headline numbers all use `gemini-2.5-flash` as observer (with gpt-4o or gpt-5-mini as reader). **No published Mastra OM numbers exist with an OpenAI-family observer.** Our Stage E experiment that runs Mastra-style OM at gpt-5-nano observer would be the first public datapoint — publishable as a "single-provider OM" baseline.

---

## 5. Anthropic Contextual Retrieval (verbatim cookbook)

**Sources:** anthropic.com/news/contextual-retrieval, platform.claude.com/cookbook/capabilities-contextual-embeddings-guide.

### 5.1 Verbatim chunk-context generation prompt

```
<document>
{doc_content}
</document>

Here is the chunk we want to situate within the whole document
<chunk>
{chunk_content}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else.
```

### 5.2 Verbatim implementation

```python
def situate_context(doc: str, chunk: str) -> tuple[str, Any]:
    response = self.anthropic_client.messages.create(
        model=MODEL_NAME,  # claude-haiku-4-5
        max_tokens=1000,
        temperature=0.0,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": DOCUMENT_CONTEXT_PROMPT.format(doc_content=doc),
             "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": CHUNK_CONTEXT_PROMPT.format(chunk_content=chunk)},
        ]}],
        extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
    )
    return response.content[0].text, response.usage
```

Embedding step: `text_to_embed = f"{contextualized_text}\n\n{chunk['content']}"` — context **prepended** before embedding.

### 5.3 Cost model (verified)

- $1.02 / million document tokens with prompt caching (assumes 800-token chunks, 8k-token docs, 50-token context instructions, 100 tokens generated context)
- Cookbook real measurement: 737 chunks across 9 codebases, **61.83% input tokens read from cache** → **~$2.85 actual** vs ~$9.20 without caching (69% savings)

### 5.4 Retrieval-failure reduction (cited)

| Configuration | Failure reduction (vs baseline) |
|---|---:|
| Contextual Embeddings alone | **35%** (5.7% → 3.7%) |
| Contextual Embeddings + Contextual BM25 | **49%** (5.7% → 2.9%) |
| + Reranking | **67%** (5.7% → 1.9%) |

Metric: `1 - recall@20` across codebases, fiction, ArXiv, science papers.

**No public LongMemEval / LOCOMO reproductions exist for Anthropic Contextual Retrieval.** This is a real gap — implementing the `summarized` executor and measuring on LongMemEval-S would be the first such datapoint.

### 5.5 Implication for Stage I (LOCOMO push) and IngestRouter

The **summarized** executor we need to implement for `IngestRouter` is essentially this Anthropic recipe. With our existing `gpt-5-mini` adapter, we can run the same algorithm without bringing Claude into the dependency chain:

- Summary-per-session = ~$0.003 per session × ~50 sessions × 500 cases = **~$75 one-time** for full LongMemEval-S
- ~$0.001 per session × ~199 sessions × 1986 cases = **~$400 one-time** for full LOCOMO
- Cached for all subsequent runs

Expected lift: **+10-20pp on multi-session** per Anthropic's own measurements (35% retrieval failure reduction → at our current MS 54.9%, that maps to ~62-66% — closer to OM-v11's 61.7% for free).

---

## 6. Emergence AI Simple Fast (Calvin Ku critique)

**Sources:** emergence.ai/blog/sota-on-longmemeval-with-rag, github.com/EmergenceAI/emergence_simple_fast, medium.com Calvin Ku critique.

### 6.1 top_k=42 magic number

Calvin Ku confirmed: *"They set k=42 for everything,"* fixed across all dataset evaluations. (Repo: 13 stars, 5 forks, Python 100%.)

### 6.2 Calvin Ku's reproductions (gpt-4o-mini)

| Benchmark | Emergence (k=42) reproduced | Notes |
|---|---:|---|
| LongMemEval | **71.2%** | (matches Zep) |
| MSC | ~85%+ | from chart |
| LOCOMO | "significantly lower" | "huge red flag" |

Cost: **~$1.50** for gpt-4o-mini run vs ~$30 at gpt-4o.

### 6.3 Calvin Ku's adaptive-k variant

- Token budgets (8192 limit) instead of fixed chunk count
- MMR (Maximal Marginal Relevance) for diversity reranking
- Top-p (nucleus) selection for dynamic thresholding
- Resulting **adaptive average k = 62.5**, +33% cost ($1.99)

### 6.4 Implication for Stage H (session-NDCG K=20)

Calvin's adaptive-k average is **62.5, not 20.** Our prior plan to test session-NDCG at K=20 may be undersized. **Recommend re-scoping Stage H to test K=20, K=42, K=62, K=100** as a small sweep at our existing K=20 + Cohere rerank baseline. The ~$60 budget for one Stage H sweep stretches to ~$240 for the full sweep, but each cell is independent and can be parallelized.

---

## 7. LOCOMO architecture insights + Penfield audit (full)

**Sources:** dev.to/penfieldlabs LOCOMO audit article, github.com/dial481/locomo-audit.

### 7.1 Penfield's seven major findings (verbatim from repo)

1. **99 of 1,540 questions (6.4%)** have wrong golden answers (hallucinated facts, wrong dates, wrong speaker attribution — 24 questions misattributed)
2. Statistical validity issues across categories (sample sizes 96-841 with insufficient power)
3. Token cost misrepresentation: **claimed 2,298 avg tokens vs actual 6,669**
4. Judge leniency: **62.81% of vague-topical wrong answers accepted**
5. Scores exceed mathematical ceilings (theoretical max ≈ **93.6%** given the 6.4% answer key error rate)
6. EverMemOS uses **2-3 sequential LLM calls** vs competitors' single calls (ungated comparison)
7. Category 5 contains **446 adversarial questions** never evaluated

### 7.2 Judge failure rates (verbatim)

| Strategy | Fail rate (judge accepts wrong answer) |
|---|---:|
| Specific-but-wrong (wrong name/date) | **10.61%** |
| Vague-but-topical | **62.81%** |

Quote: *"This represents precisely the failure mode of weak retrieval — correctly locating relevant conversations while extracting no specific details."*

### 7.3 Implication for AgentOS LOCOMO claim

Our **51.5%** at K=20 + 0% judge FPR (from Stage G-LOCOMO) compares against vendor claims that range from 66.9% (Mem0 own article) to 91.6% (Mem0 managed claim). **Our 0% judge FPR vs Penfield's 62.81% on LOCOMO's default judge means up to 14pp of vendor gap could be judge permissiveness.** A vendor publishing 75% on LOCOMO's default judge might be measuring 75 - (0.6281 × ~10pp tail of vague answers) = ~69% on a strict judge — closer to our 51.5%.

### 7.4 Markmhendrickson critique (independent corroboration)

markmhendrickson.com/posts/agent-memory-breaks-before-retrieval: *"State integrity degrades at 500K to 2M tokens. Roughly one-fifth to one-tenth the scale where retrieval architecture becomes critical."* He documents that contradiction resolution scores "near zero at every tier, including 100K" — suggesting that the BEAM 10M tier is *measuring something else than what we think.*

---

## 8. BEAM benchmark (paper + Mem0 + Hindsight)

**Sources:** arxiv.org/html/2510.27246v1 (BEAM paper), github.com/mohammadtavakoli78/BEAM, mem0.ai BEAM blog.

### 8.1 Spec (verbatim)

- **10 memory abilities**: Abstention, Information Extraction, Multi-hop Reasoning, Preference Following, Summarization, Temporal Reasoning, Information Update + 3 new (Instruction Following, Event Ordering, Contradiction Resolution)
- **100 conversations**, 100K to 10M tokens, **2,000 probing questions** (20 per conversation)
- Synthetic generation via structured plans with recursive decomposition
- Judge: **GPT-4.1-mini**, nugget-based scoring 0/0.5/1, averaged across nuggets
- Event Ordering uses Kendall tau-b coefficient (not the standard nugget judge)
- Embedding: `BAAI/bge-small-en-v1.5`, vector store FAISS
- Context window for RAG and proposed method: **32K** (vs Qwen2.5-32B 128K context)

### 8.2 Reproducibility

> *"To support future work, we release all code, data, and evaluation scripts."* — github.com/mohammadtavakoli78/BEAM

All prompts in Appendix G (Listings 1-44).

### 8.3 SOTA at 10M tokens (independently verified across two sources)

| System | BEAM 10M |
|---|---:|
| **Hindsight** | **64.1%** |
| Honcho | 40.6% |
| LIGHT (BEAM paper proposal) | 26.6% |
| RAG baseline | 24.9% |

Hindsight 1M tier: **73.9%**. **Mem0 has not published BEAM scores** despite having a blog about BEAM — this is an inferable competitive signal.

### 8.4 LIGHT (BEAM paper's own proposal)

Per Mem0's interpretation: 4 components — retrieval, scratchpad, working memory, noise filtering. Average improvement **3.5%-12.69% over the strongest baselines**. LIGHT scratchpad: *"Once content exceeds a 30K-token threshold…compressed into a 15K-token summary by GPT-4.1-nano."*

### 8.5 Implication for Stage K (BEAM Phase A)

The bench's BEAM adapter is currently a `BeamUnimplementedError` placeholder. Implementing it gives us **the third benchmark for the universality story.** Cost projection in handoff: ~$100 for Phase A N=102. Realistic Phase A target: **mid-30s to mid-40s**, since LOCOMO 49.9% → BEAM 10M is a much harder benchmark (frontier is 64.1% vs LOCOMO frontier ~91%). An AgentOS BEAM score in the 30s with full ablation per ability would be a publishable transparent-weakness datapoint.

### 8.6 Markmhendrickson 500K critique re-applies

The critique that "state integrity degrades at 500K, not 10M" suggests **BEAM 100K and 500K tiers may be more discriminating than 10M** for our architecture (which targets retrieval, not ultra-long context). Recommend running Phase A on 100K + 500K + 1M before splurging on 10M.

---

## 9. LongMemEval-M (1.5M tokens, 500 sessions)

**Source:** xiaowu0162.github.io/long-mem-eval (official site).

Confirmed dataset variants:
- **LongMemEval-S**: ~115K tokens, 30-40 sessions per haystack
- **LongMemEval-M**: **~1.5M tokens, 500 sessions per haystack**
- (No "Oracle" variant on the site — that label is colloquial for the gold-evidence baseline)

The official site doesn't publish a leaderboard, so cross-vendor LongMemEval-M numbers are sparse. Mem0's published numbers (93.4% LongMemEval) are LongMemEval-S only. Mastra's per-category breakdown (84.23% gpt-4o) is LongMemEval-S only. **No vendor publishes LongMemEval-M numbers prominently.**

### 9.1 Implication for Stage J

Running our Tier 3 min-cost preset on LongMemEval-M N=500 at ~$150 budget would produce **the first publicly available LongMemEval-M number for any orchestration-router architecture.** Even if accuracy drops 5-10pp from 76.6%, the publication value is high.

---

## 10. April 2026 publications (last 30 days)

### 10.1 ReasoningBank (Google Research, April 2026)

research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience, github.com/google-research/reasoning-bank.

- **NOT a LongMemEval/LOCOMO/BEAM system** — measured on **WebArena and SWE-Bench-Verified**
- Memory entry shape: `{title, description, content}` — distilled reasoning steps from past experience (success AND failure)
- Direct-append, no consolidation
- WebArena: **+8.3% success rate** over memory-free baseline (Gemini-2.5-Flash)
- SWE-Bench-Verified: **+4.6% success rate, ~3 fewer steps**
- With MaTTS (parallel scaling, k=5): +3% success, 0.4 fewer steps
- Compared only against Synapse and Agent Workflow Memory — **NOT positioned against the agent-memory benchmark stack**

### 10.2 "Agent memory breaks at 500K tokens, not 10 million" (April 2026)

markmhendrickson.com — already cited above. Mentions author's own **WRIT** open benchmark for write-integrity testing on GitHub. Not yet a leaderboard, but worth tracking.

### 10.3 Vectorize "8 Best AI Agent Memory Systems" (2026)

vectorize.io/articles/best-ai-agent-memory-systems — **vendor bias caveat**: published by Vectorize (Hindsight makers), Hindsight ranks first. Numbers cited:

| Framework | LongMemEval |
|---|---:|
| Hindsight | 91.4% |
| SuperMemory | 81.6% |
| Mem0 | **49.0%** ← contradicts Mem0's own 93.4% claim |
| Zep | 63.8% |

The 49.0% Mem0 number aligns with the **arxiv:2512.13564 reproduction** that found Zep at 63.8% (vs Zep's self-reported 71.2% — a 7.4pp gap), suggesting third-party harnesses systematically measure 10-40pp lower than vendor self-reports.

### 10.4 "Memory for Autonomous LLM Agents" survey (arxiv:2603.07670v1)

Worth quoting for our publication narrative:

> *"MemoryArena: models that score near-perfectly on LoCoMo plummet to 40-60% in MemoryArena."*

> *"The gap between 'has memory' and 'does not have memory' is often larger than the gap between different LLM backbones."*

10 open challenges identified — most relevant to AgentOS: **#1 principled consolidation, #4 learning to forget, #8 deeper neuroscience integration.** Our Cognitive Memory Manager already covers #4 (Ebbinghaus + RIF mechanism) and partially #8 (HEXACO + ACT-R + Baddeley). #1 is open across the field.

---

## 11. Cognitive-architecture grounding (HEXACO + Ebbinghaus + Baddeley + ACT-R for LLM agents)

**Source:** arxiv.org/html/2603.07670v1.

The survey explicitly cites:
- **Baddeley's model**: "the LLM is the executive, the context window is the buffer" — both share a bottleneck of limited capacity
- **Ebbinghaus**: MemoryBank applies exponential decay; "frequently accessed, high-importance memories are reinforced"
- **Hippocampal-neocortical transfer**: proposed for "offline consolidation during idle periods"
- **Spreading activation**: explicitly *"suggested as an unexplored future direction"*

### 11.1 Independent validation of HEXACO-modulated retrieval

**Not found in this search.** No 2025-2026 paper validates that HEXACO personality bias improves retrieval accuracy on standard agent-memory benchmarks. AgentOS's HEXACO-modulated cognitive memory is **architecturally novel in the published academic record** — the closest precedents are MemoryBank (Ebbinghaus only, no personality) and Generative Agents (importance scoring without HEXACO axes). This is a publication gap AgentOS could fill.

The risk: if HEXACO modulation doesn't *measurably* lift retrieval accuracy on LongMemEval/LOCOMO (which test conversational facts, not personality-sensitive content like emotional events), the cognitive-science grounding may be a feature without a benchmark home. Worth running an ablation: **AgentOS with HEXACO modulation OFF vs ON on LongMemEval-S Phase B.** Likely +0-2pp difference. Publishable as honest negative regardless.

---

## 12. What this means for AgentOS's next experiments

### 12.1 Stage E (Hindsight typed-network observer) — scope upgrade

- The actual schema is **four typed networks (World/Experience/Opinion/Observation)**, not three (entity/relation/episode) as our spec assumed
- **Opinion evolution** is the differentiating mechanism vs Mem0's UPDATE/DELETE
- Realistic effort: **2-3 weeks** (was 1-2 in the prior handoff)
- Realistic cost: **$500-$800** (was $400-600 in the handoff)
- Expected: Tier 3 max-acc breaks 78-80% on LongMemEval-S; min-cost stays 76.6%
- **Vendor-bias caveat to publish:** Hindsight's headline 91.4% uses Gemini-3-pro reader; their open-source benchmark uses Gemini judge; the apples-to-apples comparable for our gpt-4o reader is **Hindsight OSS-20B 83.6% / OSS-120B 89.0%**, not 91.4%

### 12.2 Stage H (session-NDCG) — broaden the K sweep

- Calvin Ku's adaptive-k average is **62.5, not 20**
- Re-scope: test **K=20, K=42, K=62, K=100** in one Phase B sweep
- Cost: ~$240 (vs $60 originally)
- Add: combine session-NDCG with two-call extract-then-answer (the ReadRouter `two-call-extract-answer` strategy already ships)

### 12.3 Stage I (LOCOMO architecture push) — pivot

- **Mem0 v3 removed the graph store** — the fact-graph executor we planned is *not* the architecture they win with
- Real Mem0 v3 architecture: **single-pass ADD-only fact extraction + entity-linking-aware hybrid retrieval**
- Implementing this is **closer to our existing canonical-hybrid + summarized executors** than to a new fact-graph
- **Recommended:** implement the **`summarized` executor first** (Anthropic Contextual Retrieval recipe with our gpt-5-mini observer), measure on LOCOMO. Expected: **+8-12pp** on LOCOMO from 51.5% → 60+%. Cost: **~$400 + $75 ingest** for Phase B
- Then if positive, add `entity-linking` to memory router as a 4th backend variant

### 12.4 Stage J (LongMemEval-M) — proceed

- **No vendor publishes LongMemEval-M numbers prominently** — first-mover publication value is real
- Cost ~$150 unchanged
- Add: run Stage G-LongMemEval-M judge FPR probe ($0.05) at the same time

### 12.5 Stage K (BEAM Phase A) — tier-adjust

- **Realistic accuracy**: mid-30s to mid-40s based on Hindsight 64.1% open SOTA vs our LOCOMO 49.9%
- **Recommend**: run **BEAM 100K, 500K, 1M tiers first** before 10M (Markmhendrickson's "breaks at 500K" finding suggests these are more discriminating)
- BEAM uses **GPT-4.1-mini judge** — different from our gpt-4o-2024-08-06. Need to either (a) use BEAM's judge for direct comparability, or (b) re-judge with our rubric and publish both columns with the FPR delta

### 12.6 NEW Stage L: Anthropic Contextual Retrieval `summarized` executor

This is the lowest-hanging fruit not in the original handoff:
- Implement `summarized` executor for `IngestRouter` using exact Anthropic recipe
- Use our existing gpt-5-mini adapter (no Claude dependency for the headline)
- Cost: ~$75 LongMemEval-S + ~$400 LOCOMO ingest one-time, fully cached after
- Expected: +10-20pp on multi-session category specifically (per Anthropic's own measurement)
- Effort: **3-5 days** (smaller than Stage E)

### 12.7 NEW Stage M: HEXACO modulation A/B ablation

- Run AgentOS Phase B **with HEXACO modulation OFF vs ON** on LongMemEval-S
- Expected: +0-2pp difference (likely null result)
- Publication value: **"honest test of cognitive-science grounding on agent memory benchmarks"** — fills the published research gap identified above

### 12.8 Recommended priority order (revised)

For maximum ROI per dollar:

1. **Stage L (Anthropic Contextual Retrieval `summarized`)** — $475, 3-5 days, +10-20pp expected on multi-session
2. **Stage J (LongMemEval-M)** — $150, 1 day, first-mover publication value
3. **Stage H widened (K∈{20,42,62,100})** — $240, 1 day, cheap risk
4. **Stage M (HEXACO A/B)** — $60, 1 day, fills academic gap
5. **Stage I pivoted (entity-linking + Mem0-v3-style ADD-only)** — $400, 1 week, depends on Stage L outcome
6. **Stage K (BEAM 100K + 500K + 1M, NOT 10M)** — $300, 1 week, third benchmark
7. **Stage E (Hindsight 4-network typed observer)** — $500-800, 2-3 weeks, biggest scope

---

## 13. Sources index

All sources cited above. **Bold** = highest authoritative weight.

**Primary sources read in full via WebFetch (23):**

1. **arxiv.org/html/2512.12818v1** — Hindsight paper
2. **hindsight.vectorize.io/blog/2026/04/02/beam-sota** — Hindsight BEAM SOTA
3. hindsight.vectorize.io/guides/2026/04/21 — Hindsight comparison Apr 21
4. **arxiv.org/html/2510.27246v1** — BEAM paper
5. **mastra.ai/research/observational-memory** — Mastra OM research page
6. **mastra.ai/docs/memory/observational-memory** — Mastra OM docs
7. the-decoder.com Mastra emoji compression
8. **anthropic.com/news/contextual-retrieval**
9. **platform.claude.com/cookbook/capabilities-contextual-embeddings-guide** — Anthropic cookbook
10. **docs.mem0.ai/migration/oss-v2-to-v3** — Mem0 v3 architecture
11. **docs.mem0.ai/core-concepts/memory-evaluation** — Mem0 published numbers
12. mem0.ai/blog/state-of-ai-agent-memory-2026
13. mem0.ai/blog/what-is-beam-memory-benchmark
14. **dev.to/penfieldlabs LOCOMO audit**
15. github.com/dial481/locomo-audit
16. **medium.com Calvin Ku Emergence critique**
17. github.com/EmergenceAI/emergence_simple_fast
18. emergence.ai/blog/sota-on-longmemeval-with-rag
19. research.google/blog/reasoningbank
20. vectorize.io/articles/best-ai-agent-memory-systems
21. **arxiv.org/html/2603.07670v1** — Memory for Autonomous LLM Agents survey
22. markmhendrickson.com agent-memory-breaks-before-retrieval
23. xiaowu0162.github.io/long-mem-eval

**AgentOS internal sources verified:**

- `packages/agentos/docs/COGNITIVE_PIPELINE.md`
- `packages/agentos/docs/MEMORY_ROUTER.md`
- `packages/agentos/docs/INGEST_ROUTER.md`
- `packages/agentos/docs/READ_ROUTER.md`
- `packages/agentos/docs/ADAPTIVE_MEMORY_ROUTER.md`
- `packages/agentos/docs/memory/COGNITIVE_MEMORY.md`
- `packages/agentos/docs/memory/COGNITIVE_MECHANISMS.md`
- `packages/agentos/docs/memory/MEMORY_ARCHITECTURE.md`
- `packages/agentos-bench/docs/SOTA_RESEARCH_2026-04-19.md`
- `packages/agentos-bench/docs/COMPETITOR_METHODOLOGY_AUDIT_2026-04-24.md`
- `packages/agentos-bench/docs/NEXT_SESSION_2026-04-25_HANDOFF.md`

Search artifacts: `.firecrawl/agentos-sota-2026-04-25/` (20 JSON files, ~10 MB) — Tavily + Serper raw search results across all 10 topics.
