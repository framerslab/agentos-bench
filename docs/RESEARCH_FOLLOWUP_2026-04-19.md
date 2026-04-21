# Research Follow-up — SOTA Survey for Option 2 & Beyond, 2026-04-19 (late)

**Purpose:** targeted second-round deep-research sweep, pulled before committing to Option 2 design. Covers benchmark methodology issues, named session-level retrieval techniques, newer benchmarks, and statistical-rigor tooling. Supersedes nothing; complements `SOTA_RESEARCH_2026-04-19.md` and `INDUSTRY_CONTEXTUAL_RETRIEVAL_RESEARCH_2026-04-19.md`.

**Method:** 12 parallel Serper + Tavily searches across 6 dimensions → 120 snippets → deduped to 102 unique URLs → Cohere `rerank-v3.5` to top 15 per dimension → full-fetched 13 highest-value sources (Firecrawl CLI + API, Tavily extract fallback for two that firecrawl rejected).

**Headline takeaways (read this first):**
1. **LoCoMo's answer key is 6.4% wrong; its default judge accepts 63% of intentionally-wrong-but-topically-adjacent answers.** Our published deltas below ~5pp on LoCoMo sit inside judge noise.
2. **LongMemEval-S at 115K tokens is partly a context-window test, not a pure memory test** — this reframes our 68.8%→94.87% multi-session gap. Mastra's lead is partly "they stuffed the whole conversation into reader context," not pure algorithmic superiority.
3. **Session-level hierarchical retrieval is a named, peer-reviewed pattern in 2025-26** (xMemory + TACITREE). Option 2 is not novel — it is the canonical thing. This is a validation, not a risk.
4. **New benchmarks (EverMemBench, StreamMemBench, IMPLEXCONV, LoCoMo-Plus) target exactly the gaps the old benchmarks hide** — multi-party attribution, streaming evidence dependencies, implicit reasoning, multi-hop-in-multi-party.
5. **Bootstrap confidence intervals + paired significance tests are the ecosystem ask** (NIST Feb 2026, Spark-LLM-Eval Jan 2026) — and we currently don't report them.

---

## 1. Benchmark methodology issues — the LoCoMo audit (CRITICAL)

**Source:** [Penfield Labs, April 2026](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) + [audit repo](https://github.com/dial481/locomo-audit)

### LoCoMo ground-truth errors
> "We conducted a systematic audit of the ground truth and identified 99 score-corrupting errors in 1,540 questions (6.4%). Error categories include hallucinated facts in the answer key, incorrect temporal reasoning, and speaker attribution errors. The theoretical maximum score for a perfect system is approximately 93.6%."

For context: [arxiv 2103.14749](https://arxiv.org/abs/2103.14749) reports ~3.3% label errors across 10 major ML benchmarks "destabilize model rankings." LoCoMo sits at nearly 2× that baseline.

### LoCoMo judge false-positive rate
> "We generated intentionally wrong but topically adjacent answers for all 1,540 questions and scored them using the same judge configuration and prompts used in published evaluations. The judge accepted 62.81% of them. Specific factual errors (wrong name, wrong date) were caught approximately 89% of the time. However, vague answers that identified the correct topic while missing every specific detail passed nearly two-thirds of the time. This is precisely the failure mode of weak retrieval — locating the right conversation but extracting nothing specific — and the benchmark rewards it."

### LongMemEval-S as a context-window test
> "LongMemEval-S uses approximately 115K tokens of context per question. Current models support 200K to 1M token context windows. The entire test corpus fits in a single context window for most current models. Mastra's illustrates this: their full-context baseline scored 60.20% with gpt-4o (128K context window, near the 115K threshold). Their observational memory system scored 84.23% with the same model, largely by compressing context to fit more comfortably."

### The no-standardized-pipeline problem
> "There is also no standardized evaluation pipeline. Each system uses its own ingestion method, its own answer generation prompt, and sometimes entirely different models. Scores are then compared in tables as if they share a common methodology. Multiple independent researchers have documented inability to reproduce published results."

### Requirements the audit proposes
1. Corpus size must exceed context windows (cites [arxiv 2510.27246](https://arxiv.org/abs/2510.27246) with 10M-token conversations)
2. Current-generation judge models (gpt-4o-mini ceiling is a problem)
3. **Judge reliability must be validated adversarially** (63% acceptance rate means score deltas < 63% are uninterpretable)
4. Realistic turn-based ingestion
5. Standardized or fully-disclosed evaluation pipelines
6. Verified ground truth

**Implication for us:**
- The blog post must disclose the judge's false-positive rate against our own answers. Easy experiment: pass each correct answer and a topically-adjacent distractor through gpt-4o (our judge, not gpt-4o-mini); report the acceptance gap.
- Below ~5pp, we should report LoCoMo deltas as "within judge noise" rather than declaring a winner.
- Cross-reader arguments ("Mastra at gpt-5-mini vs AgentOS at gpt-5-mini") need confidence intervals — a 2-3pp gap between N=500 runs at 80-95% accuracy has roughly ±2-3pp CI at 95% confidence via Wilson/bootstrap.

---

## 2. Session-level / hierarchical retrieval — Option 2 validated

### xMemory (arxiv 2602.02007v3, 2026) — closest architectural match
**Title:** *Beyond RAG for Agent Memory: Retrieval by Decoupling and Aggregation.* [arxiv 2602.02007v3](https://arxiv.org/abs/2602.02007v3).

> "We construct a four-level hierarchy from raw messages to abstract units: an *episode* summarises a contiguous message block, *semantics* distil reusable facts from episodes to disentangle highly similar histories, and *themes* group related semantics for high-level access."

Two-stage retrieval:
- **Stage I (RepSel)** — query-aware representative selection on theme + semantic kNN graph. Broadens recall with diversity constraint.
- **Stage II (UncSion)** — uncertainty-adaptive evidence inclusion. Expands to episodic/raw only when the reader's uncertainty decreases.

Theoretical backing: information-theoretic argument (Fano inequality) for branching factor. "Any routing step that must choose among a large candidate set under bounded discriminative evidence incurs a non-trivial lower bound on the misrouting probability that grows with the logarithm of the candidate set size."

Ablation headline (LoCoMo, Qwen3-8B):
- Naive RAG → BLEU 27.92 / F1 36.42
- **Memory-only (hierarchy + naive similarity) → BLEU 31.81 / F1 40.77** — hierarchy alone already a major lift
- +RepSel: more gain, +UncSion: more gain, both: best

**Relevance to us:** this IS the pattern we proposed as Option 2. "Session summary → top-K sessions → top-M chunks" maps 1:1 to theme → semantic → episode → raw, with our sessions playing the role of their themes.

### TACITREE (EMNLP 2025, UCSD)
**Title:** *Toward Multi-Session Personalized Conversation: A Large-Scale Dataset and Hierarchical Tree Framework.* [ACL 2025 EMNLP](https://aclanthology.org/2025.emnlp-main.580.pdf).

> "TACITREE overcomes this by structuring conversational history into a hierarchical tree, where lower-level nodes capture fine-grained details and higher-level nodes aggregate these into abstract summaries. [...] Instead of brute-force searching all data, TACITREE enables an efficient, level-based retrieval process where models refine their search by progressively selecting relevant details."

Also introduces **IMPLEXCONV**: 2,500 examples × ~100 sessions each = 255K sessions, 60K tokens/conv. Specifically targets implicit reasoning where relevant info has "low semantic similarity to the query" and is "embedded in subtle, syntactic, or semantically distant connections." Directly addresses the retrieval shortcoming Mastra OM sidesteps via compression.

Dataset comparison table from the paper:

| Dataset | Conv/Sessions | Turns/Conv | Tokens | Implicit Reason |
|---|---:|---:|---:|---|
| LoCoMo | 10/1K | 304.9 | 9,209 | No |
| LongMemEval | 500/50K | ~5K | 115K | No |
| **IMPLEXCONV** | **2,500/255K** | 2K | 60K | **Yes** |

### HyperMem (arxiv 2604.08256)
Three-level hypergraph memory. Hyperedges connect arbitrary node sets (not pairwise). Topic-guided hierarchical retrieval. Surveys related: G-Memory, LightMem (efficient memory-aug), MemGPT, MemOS (OS-like abstractions), and hierarchical index tree methods RAPTOR, SiReRAG, HiRAG.

> "HyperMem explicitly groups topically related memories via hyperedges and employs topic-guided hierarchical retrieval to ensure relevance across temporal gaps."

Relevant as a more ambitious future target; for Option 2 the simpler xMemory/TACITREE pattern is the MVP.

### Supporting context
- **RAPTOR** (still going): tree-indexed abstractive retrieval, widely cited.
- **SiReRAG** (2025): indexes similar + related information for multi-hop reasoning.
- **HiRAG** (2025): retrieval-augmented generation with hierarchical knowledge.
- **HyperGraphRAG** (2025): hypergraph-structured knowledge retrieval.

---

## 3. New benchmarks 2025-2026 (beyond LongMemEval / LOCOMO / BEAM)

### EverMemBench (arxiv 2602.01313, 2026)
> "We introduce EverMemBench, a benchmark featuring multi-party, multi-group conversations spanning over 1 million tokens with temporally evolving information, cross-topic interleaving, and role-specific personas. EverMemBench evaluates memory systems across three dimensions through 1,000+ QA pairs: fine-grained recall, memory awareness, and user profile understanding."

Headline findings:
- **Multi-hop reasoning collapses in multi-party settings; even oracle models achieve only 26%.**
- Temporal reasoning remains unsolved, requiring version semantics beyond timestamp matching.
- Memory awareness is bottlenecked by retrieval.
- Communication style / persona is fundamentally pattern-abstraction, not single-fact retrieval.

### StreamMemBench (ICLR 2026 Lifelong Agent Workshop)
[OpenReview PDF](https://openreview.net/pdf/e725180a5325324bde84e338215daeeaaaabf674.pdf).

> "We propose a streaming evaluation framework that structures user-agent conversations into streaming episodes with explicit Evidence-Query dependencies and evaluates memory through a four-stage pipeline (Formation, Management, Retrieval, Application) with stage-level accuracy and efficiency metrics."

Key findings:
- "Simply converting existing static benchmarks into a streaming format is insufficient: retrieval and application accuracy can diverge substantially, indicating that some tasks remain solvable without faithfully retrieving the intended evidence." → shortcut solving.
- "StreamMemBench, a natively streaming benchmark with per-episode evidence boundaries and evidence-linked distractors that ensure correct answers require the memory pipeline."
- Across 5 memory systems × 3 datasets: "formation accuracy saturates while efficiency differs by ~10×; retrieval-application divergence serves as a reliable diagnostic signal."

This is a direct critique of our existing metrics: we report end-to-end accuracy without stage-level attribution.

### ConvoMem (arxiv 2511.10523, Nov 2025, Salesforce AI Research)
> "Why Your First 150 Conversations Don't Need RAG."

Categories: multi-message evidence distribution, user facts, assistant facts, abstention, preferences, changing facts, implicit connections. Core claim: for small corpora, full-context beats RAG; the "Memory-RAG convergence point" is around 150 conversations.

Relevance: validates Mastra OM's compress-to-context approach at small scales. At scale (LongMemEval's 500-case haystacks, 10s of sessions per case) we're already past the convergence; RAG-style memory wins.

### LoCoMo-Plus (arxiv 2602.10715)
> "Introduces a genuinely interesting new category: cognitive questions testing implicit inference rather than factual recall. These use cue-trigger pairs with deliberate semantic disconnect — the system must connect 'I just adopted a rescue dog' (cue) to 'what kind of pet food should I buy?' (trigger) across sessions without lexical overlap."

Inherits the LoCoMo evaluation infrastructure problems.

### MemoryAgentBench (ICLR 2026, [HUST-AI-HYZ/MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench))
Repo exists; code under active development.

### Arxiv 2510.27246 — 10M-token conversations
Referenced by the Penfield Labs audit as moving toward "corpus size exceeds context windows" requirement. Not fully scraped in this sweep; worth a follow-up.

---

## 4. Statistical rigor + honest-numbers tooling

### Spark-LLM-Eval (arxiv 2603.28769, Jan 2026)
> "Reporting that 'Model A achieves 73.2% accuracy' tells us little without confidence intervals. When comparing two models, we need to know whether a 2% improvement is statistically meaningful or just noise."

Framework contributions:
- **Bootstrap confidence intervals for all metrics** (percentile method by default).
- **Paired significance tests**: McNemar's for binary outcomes, Wilcoxon signed-rank for ordinal/continuous, paired t-test when normality holds.
- Content-addressable response caching backed by Delta Lake (we do similar with case-run + embedding caches).
- Distributed execution via Spark.

> "Despite this foundation, many evaluation frameworks report only point estimates. When confidence intervals appear, they often use simple formulas that assume independence or normality, assumptions that may not hold for LLM outputs."

### NIST (Feb 2026)
[New Report: Expanding the AI Evaluation Toolbox with Statistical Models](https://www.nist.gov/news-events/news/2026/02/new-report-expanding-ai-evaluation-toolbox-statistical-models). Policy-level push for statistical rigor in AI evaluation. Worth citing in the blog.

### Relevant companion paper on label errors
[arxiv 2103.14749 — Pervasive Label Errors in Test Sets](https://arxiv.org/abs/2103.14749). 3.3% average across 10 ML benchmarks. Referenced directly by the LoCoMo audit.

---

## 5. New SOTA retrieval techniques surveyed (less urgent)

- **HippoRAG** — neurobiologically-inspired, PageRank over entity graph extracted at ingest. The paper was released May 2024; now has a follow-up "HippoRAG 2" (2025). Valuable reference but not a direct substitute for Option 2.
- **Graph-RAG multi-hop** (bdtechtalks substack, 2025) — positions graph structure over entities as a multi-hop retrieval primitive. Complementary to session-level retrieval, not a substitute.
- **Mem0 / MemInsight / A-MEM / Nemori / MemOS / MemoryOS** — all 2025 systems stressing fact extraction + persistent layers. Different architectural commitment from ours.

---

## 6. Production eval tooling (D5)

Less load-bearing for our decisions — listed for completeness:
- **Confident-AI DeepEval** — widely adopted, supports LLM-as-judge + G-Eval metrics.
- **Arize Phoenix** — strong on tracing + live production eval.
- **LangSmith** — LangChain-integrated; good for orchestration traces.
- **Braintrust** — pure-play LLM eval platform; strong statistical rigor story.
- **TruLens** — RAG triad (context relevance, groundedness, answer relevance).

None ship an agent-memory-specific recipe out of the box. RAGAS has component-wise retrieval metrics (context precision, context recall) that are close to what we compute internally. Worth a section in the blog showing our session-level Recall@K / NDCG@K / MRR parallels RAGAS's context precision/recall.

---

## 7. Immediate implications for our plan

### A. Rescope the Option 2 spec

xMemory's four-level hierarchy is the canonical reference. The agentos-core component should mirror the naming and structure:

- `episode`: a contiguous turn-pair or small chunk (what we currently produce via `chunkSessionTurns`)
- `semantic`: a fact or proposition distilled from a session or group of episodes (overlaps with what Mem0-style fact extraction would produce)
- `theme` / `session`: a whole conversation session summary (what our `SessionSummarizer` already produces)

MVP Option 2 only implements the theme/session layer: embed session summaries, retrieve top-K sessions, include top-M chunks each. Full xMemory four-level is a Phase 2 target.

### B. Add judge-adversarial probe as a bench default

For each case, in addition to running the memory system's answer, synthesize a "topically adjacent but wrong" distractor (using gpt-4o-mini) and score it with the same judge. Report the false-positive rate per case-type. A blog number "85% accuracy, 12% judge-false-positive rate" is more defensible than "85% accuracy."

### C. Add bootstrap CIs + paired tests to `BenchResult`

`BenchResult.accuracyCI` (95% percentile bootstrap, 10k resamples) and paired-run comparison helper (McNemar's). This is Tier-1 for the blog.

### D. Deprioritize multi-session chase below 5pp on LongMemEval-S

If Option 2 closes multi-session 68.8%→80%+, that's outside judge noise and meaningful. Chasing the last few points to match Mastra OM's 87.2% is inside noise AND partly measures context-window packing, not memory quality.

### E. Explore IMPLEXCONV / EverMemBench as a secondary benchmark

LongMemEval-S + LoCoMo are noisy and partly context-window tests. Adding IMPLEXCONV (implicit reasoning) or EverMemBench (multi-party) as a second/third benchmark cell in the blog post would materially strengthen the "honest numbers" story. Cost: dataset ingest + new adapter. Not gating Option 2.

---

## 8. Complete source bibliography (top-ranked by Cohere)

| # | Source | Dim | Cohere relevance | Notes |
|---:|---|---|---:|---|
| 1 | [LoCoMo audit — Penfield Labs](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) | D2 | 0.723 | 6.4% answer key errors, 63% judge acceptance of wrong answers |
| 2 | [xMemory — Beyond RAG for Agent Memory](https://arxiv.org/abs/2602.02007) | D1 | 0.255 | 4-level hierarchy, 2-stage retrieval, LoCoMo evaluation |
| 3 | [EverMemBench](https://arxiv.org/abs/2602.01313) | D3 | 0.722 | 1M+ tokens, multi-party, oracle multi-hop = 26% |
| 4 | [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) | D3 | 0.704 | landscape overview |
| 5 | [Reddit AI Memory flaws thread](https://www.reddit.com/r/AIMemory/comments/1s1jlnd/serious_flaws_in_two_popular_ai_memory_benchmarks/) | D2 | 0.704 | community take on LoCoMo/LongMemEval issues |
| 6 | [ConvoMem benchmark](https://arxiv.org/abs/2511.10523) | D2/D3 | 0.646 | Salesforce, "first 150 conversations don't need RAG" |
| 7 | [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench) | D3 | 0.638 | ICLR 2026 paper + code |
| 8 | [Mastra OM Research](https://mastra.ai/research/observational-memory) | D2 | 0.629 | source of the 60.2% full-context vs 84.2% OM @ gpt-4o data |
| 9 | [StreamMemBench](https://openreview.net/pdf/e725180a5325324bde84e338215daeeaaaabf674.pdf) | D3 | 0.627 | streaming eval, 4-stage pipeline, retrieval-application divergence |
| 10 | [Confidence self-consistency (ACL 2025)](https://aclanthology.org/2025.findings-acl.1030.pdf) | D6 | 0.614 | statistical rigor in LLM eval |
| 11 | [TACITREE / IMPLEXCONV (EMNLP 2025)](https://aclanthology.org/2025.emnlp-main.580.pdf) | D1 | 0.340 | hierarchical tree for multi-session, 2500-conv dataset |
| 12 | [HyperMem](https://arxiv.org/abs/2604.08256) | D1 | 0.301 | 3-level hypergraph memory |
| 13 | [Spark-LLM-Eval](https://arxiv.org/abs/2603.28769) | D6 | 0.511 | bootstrap CI + McNemar/Wilcoxon for LLM eval |
| 14 | [NIST statistical AI eval](https://www.nist.gov/news-events/news/2026/02/new-report-expanding-ai-evaluation-toolbox-statistical-models) | D6 | 0.368 | policy-level push |
| 15 | [HippoRAG author podcast](https://www.cognitiverevolution.ai/long-term-memory-for-llms-with-hipporag-author-bernal-jimenez-gutierrez/) | D4 | 0.428 | context on neurobiological retrieval approach |
| 16 | [arxiv 2510.27246 — 10M-token conversations](https://arxiv.org/abs/2510.27246) | D3 | mentioned | bigger corpus than context window |
| 17 | [arxiv 2103.14749 — label errors in test sets](https://arxiv.org/abs/2103.14749) | D6 | mentioned | 3.3% average across 10 ML benchmarks destabilizes rankings |
| 18 | [LoCoMo audit repo](https://github.com/dial481/locomo-audit) | D2 | mentioned | all 99 errors + methodology |
| 19 | [Confident AI top 7 LLM eval tools 2026](https://www.confident-ai.com/knowledge-base/best-llm-evaluation-tools) | D5 | 0.539 | eval tooling survey |
| 20 | [AI Agents 2026 practical architecture](https://andriifurmanets.com/blogs/ai-agents-2026-practical-architecture-tools-memory-evals-guardrails) | D5 | 0.572 | eval recipes blog |

102 unique URLs scraped across 6 dimensions × 2 providers (Serper, Tavily). Top 15 per dimension reranked via Cohere `rerank-v3.5`. Of the 13 fully-fetched sources, 11 via Firecrawl CLI, 2 via Tavily extract (Reddit + dev.to where Firecrawl credits were exhausted or auth-blocked).

---

End of follow-up research.
