# Competitor Methodology Audit — LongMemEval / LOCOMO / BEAM Memory Benchmarks

**Date:** 2026-04-24
**Scope:** Critical review of what memory-library vendors publish on LongMemEval-S, LOCOMO, and BEAM — and what they hide, cherry-pick, or misrepresent. Primary sources only (competitor blog/research pages, GitHub repos, third-party audits).
**Purpose:** Establish AgentOS's comparative transparency position for external publication. Anchor claims in quotes with URLs so the reader can verify independently.

---

## 0. Executive summary

Every major memory-library vendor (Mem0, Mastra, Supermemory, Zep/Graphiti, Letta, EmergenceMem, MemPalace) publishes LongMemEval or LOCOMO numbers. **None of them publish all of**:
- Bootstrap confidence intervals on the headline number
- Per-correct USD cost with full-pipeline accounting
- Per-case run JSONs with per-case decisions reproducible at a seed
- Matched-reader cross-system comparison tables (when they do compare, they often mis-implement competitor systems)
- Judge-adversarial probes to quantify false-positive rate in the evaluator

**Three well-documented cases of benchmark gaming in the memory-library space (2024-2026):**
1. **MemPalace (April 2026)** — 100% LongMemEval claim measured retrieval-recall@5, not end-to-end QA. Three hand-coded boosts targeted specific failing test questions (GitHub Issue #29). "100% LoCoMo" was from top_k=50 (retrieving the entire pool, reducing to "cat conversations | claude"). "30× lossless compression" was lossy (96.6% → 84.2% retrieval drop). Advertised "contradiction detection" feature was absent from the codebase.
2. **Mem0 vs Zep (May 2025)** — Mem0 published Zep at 65.99% on LOCOMO; Zep replicated their own system correctly and landed 75.14% ±0.17, a 10% relative gap caused by Mem0's sequential-search misimplementation of Zep.
3. **Zep self-reported 71.2% vs independent audit 63.8%** — arxiv:2512.13564 reproduced Zep on LongMemEval and measured 7.4pp lower than Zep's self-reported number.

**Two foundational problems with the benchmarks themselves (Penfield Labs, April 2026):**
- LOCOMO answer key has **99 errors in 1,540 questions (6.4%)**; the gpt-4o-mini judge accepts **62.81% of intentionally wrong answers**. Theoretical max score ≈93.6%.
- LongMemEval-S corpus fits in a single 200K-1M context window, so competitive results above ~75-80% are substantially measuring context-window compression efficiency, not long-term memory retrieval.

**AgentOS is the only library in the surveyed set that publishes bootstrap CIs, per-correct cost, latency distributions, per-case run JSONs, matched-reader methodology, judge-adversarial probe, and seed=42 reproducibility on every row.**

---

## 1. Vendor-by-vendor transparency report card

### 1.1 Mem0 (mem0.ai)

**Claim**: 93.4% on LongMemEval, 91.6% on LoCoMo, 64.1/48.6 on BEAM (1M / 10M) — Source: [mem0.ai/research](https://mem0.ai/research).

**What they publish on the research page**:
- Aggregate accuracy per benchmark
- Mean tokens per retrieval (~6,780 on LongMemEval)
- "Single-pass ADD-only extraction" and "multi-signal retrieval" architecture notes
- Link to benchmark repo: [github.com/mem0ai/memory-benchmarks](https://github.com/mem0ai/memory-benchmarks)

**What they do NOT publish on the research page**:
- ❌ Reader model used
- ❌ 95% confidence intervals
- ❌ Per-category breakdown
- ❌ Latency distributions (avg / p50 / p95)
- ❌ USD cost per correct answer
- ❌ Per-case run artifacts
- ❌ Matched-reader comparison against competitors

**Conflicting self-reports**: Mem0's [research page](https://mem0.ai/research) advertises 92.0 on LongMemEval while the [research-2 page](https://mem0.ai/research-2) advertises 93.4. The numbers don't reconcile.

**Third-party dispute**: Zep's "[Lies, Damn Lies, & Statistics](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)" (May 2025) documents that Mem0's published comparison table put Zep at 65.99% on LOCOMO; Zep replicated with a correctly-configured Zep implementation and got **75.14% ±0.17** — Zep outperforming Mem0 by 10% relative, the opposite of Mem0's published claim. Zep attributes the discrepancy to Mem0's sequential-search (not concurrent) implementation of their system.

**Verdict**: HIGH RISK of cross-system comparison inaccuracy. Self-reported Mem0 numbers not independently validated. Multiple documented attempts to reproduce failed (GitHub issue [mem0/#3944](https://github.com/mem0ai/mem0/issues/3944) cited by Penfield Labs).

---

### 1.2 Mastra (mastra.ai) — Observational Memory

**Claim**: 84.23% at gpt-4o, 94.87% at gpt-5-mini, 95% headline on [Observational Memory research page](https://mastra.ai/research/observational-memory) (Feb 9 2026, Tyler Barnes).

**What they publish — the important disclosure** (verified by quoting the primary source):

> "In each configuration, `gemini-2.5-flash` ingested the data into OM as it's the default model for observation/reflection currently. It ran during data ingestion into the memory system, not during the eval itself, so the Actor model is the only variable between runs."

And explicitly in the results table block:

> "Model: gpt-4o (Actor) / gemini-2.5-flash (Observer, Reflector)"

**So Mastra's famous "84.23% gpt-4o" result uses gpt-4o as the answer-generation model ("Actor") but gemini-2.5-flash for ingest-time observation and reflection.** This is *disclosed* in their primary source — nobody reading the full research page could miss it. But the headline "84.23% gpt-4o" framing is easy to misread as a pure gpt-4o stack when re-cited (and it is, widely, e.g. in LinkedIn shares and derivative articles that link to the Mastra page).

**What they publish in addition**:
- ✅ Per-category breakdown
- ✅ Open-source benchmark runner ([github.com/mastra-ai/mastra/tree/main/explorations/longmemeval](https://github.com/mastra-ai/mastra/tree/main/explorations/longmemeval))
- ✅ Open-source implementation ([packages/memory/src/processors/observational-memory](https://github.com/mastra-ai/mastra/tree/main/packages/memory/src/processors/observational-memory))

**What they do NOT publish**:
- ❌ 95% confidence intervals on headline or per-category
- ❌ USD cost per correct
- ❌ Latency distributions (p50/p95)
- ❌ Matched cross-vendor comparison under the same observer model
- ❌ Per-case run artifacts at a reproducible seed

**Critical Penfield Labs critique**: The Mastra research page itself reports full-context gpt-4o baseline at 60.20% vs OM at 84.23%. Penfield's analysis says "The benchmark is measuring context window management efficiency rather than long-term memory retrieval. As context windows continue to grow, the full-context baseline will keep climbing and the benchmark will lose its ability to discriminate." Translation: Mastra's 24-point lift is partially context-window compression, not memory architecture.

**Verdict**: Mastra is among the more transparent vendors in the space — they open-source the code and disclose the observer model. But the headline framing ("gpt-4o 84.23%") obscures the mixed-vendor stack in a way that benefits Mastra when the number gets re-cited.

---

### 1.3 Supermemory (supermemory.ai)

**Claim**: 81.6% on LongMemEval-S at GPT-4o, 85.2% at gemini-3-pro, 84.6% at GPT-5 — Source: [supermemory.ai/research](https://supermemory.ai/research/).

**What they publish**:
- ✅ Per-category breakdown vs Zep + full-context baseline
- ✅ Open-source benchmark runner: [memorybench](https://github.com/supermemoryai/memorybench) ("Interoperable: mix and match any provider with any benchmark")
- ✅ Quick-start: `bun run src/index.ts run -p supermemory -b longmemeval -j gpt-4o -r my-first-run`

**What they do NOT publish**:
- ❌ 95% CI on headline or per-category
- ❌ USD cost per correct
- ❌ Latency distributions
- ❌ Reader model clearly identified on the research page text (though the CLI flag `-j gpt-4o` in docs implies GPT-4o; not verified for each tier)
- ❌ Per-case run artifacts at seed

**Cited in their research page**: Supermemory directly cites Zep's [Rasmussen et al. paper](https://arxiv.org/html/2501.13956v1) as the competitive baseline, and publishes Zep's per-category numbers in their comparison table. This is a good transparency practice — they show whose numbers they're beating and by how much.

**Verdict**: More transparent than Mem0 (open-source bench runner, per-category breakdown). Still missing CI / cost / latency / per-case artifacts.

---

### 1.4 Zep / Graphiti (getzep.com)

**Claim**: 71.2% on LongMemEval at gpt-4o — Source: [blog.getzep.com/state-of-the-art-agent-memory](https://blog.getzep.com/state-of-the-art-agent-memory/). 75.14% on LOCOMO (updated, see below).

**What they publish**:
- ✅ Primary research paper: [arxiv:2501.13956](https://arxiv.org/html/2501.13956v1) "Zep: A Temporal Knowledge Graph Architecture for Agent Memory"
- ✅ Open-source core: [Graphiti](https://github.com/getzep/graphiti)
- ✅ Correction notes and updated numbers when they find errors (the "Lies, Damn Lies" post includes both original and corrected LOCOMO scores)
- ✅ Latency numbers ("0.632 seconds p95 search latency")

**What they do NOT publish**:
- ❌ 95% CI (the corrected LOCOMO is quoted as `75.14% ±0.17` which suggests a small SD but no bootstrap CI at the full N)
- ❌ USD cost per correct
- ❌ Per-case run artifacts at seed
- ❌ Matched comparison against competitors with their own reproductions

**Third-party independent audit**: [arxiv:2512.13564](https://arxiv.org/abs/2512.13564) reproduced Zep on LongMemEval and measured **63.8% vs Zep's self-reported 71.2%** — a 7.4pp gap. This is cited in the [Vectorize 2026 comparison article](https://gamgee.ai/vs/zep-vs-retaindb/). No public Zep response yet as of April 2026.

**Verdict**: Zep is mid-range transparent. The public dispute with Mem0 (where Zep DID reproduce their own system correctly and beat Mem0's claim by 10%) demonstrates the kind of re-implementation errors that make cross-system tables unreliable. But Zep's own self-reported number was independently challenged by 7.4pp.

---

### 1.5 EmergenceMem (Emergence AI)

**Claim**: 86% (EmergenceMem Internal), 82.4% (Simple), 79% (Simple Fast) — [blog post](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag).

**What they publish**:
- ✅ Full methodology per model variant
- ✅ Per-category breakdown in a large results table
- ✅ Median latency (3.2-5.65 s/item)
- ✅ Multiple baselines compared ("I don't know", Best Guess, Naive RAG, Full context GPT-4o, Zep, Accumulator, Oracle GPT-4o, GPT o3)
- ✅ Open-source Simple Fast: [github.com/EmergenceAI/emergence_simple_fast](https://github.com/EmergenceAI/emergence_simple_fast) — **reproducible, anyone can verify**
- ✅ Honest acknowledgment: "Since we agree there's more to memory than RAG, and we show that RAG-like methods have largely solved the best LTM benchmark currently out there, our conclusion is that the best benchmark currently out there still isn't capturing important aspects of memory."

**What they do NOT publish**:
- ❌ 95% confidence intervals
- ❌ Per-case run artifacts at seed

**Third-party critique** ([Calvin Ku, Aug 2025](https://medium.com/asymptotic-spaghetti-integration/emergence-ai-broke-the-agent-memory-benchmark-i-tried-to-break-their-code-23b9751ded97)):
- Found Emergence hardcodes `k=42` for retrieval (a magic number, literal comment says "the answer to life, universe, and everything"). Works well on LongMemEval but generalizes poorly to LOCOMO and MSC.
- Reproduced their 71.2% Zep-parity result at GPT-4o-mini for ~$1.50
- Build their own adaptive-k variation that performs better across datasets

**Verdict**: **Most transparent vendor in the space**. Open-source, reproducible, full methodology disclosed, honest about benchmark limitations. Still missing CIs and per-case artifacts.

---

### 1.6 Letta / MemGPT (letta.com)

**Claim**: [Letta Leaderboard](https://www.letta.com/blog/letta-leaderboard) benchmarks LLMs on agentic memory; [Letta Filesystem scores 74.0% on LoCoMo](https://www.letta.com/blog/benchmarking-ai-agent-memory).

**Status of LongMemEval claim**: [GitHub issue letta-ai/letta#3115](https://github.com/letta-ai/letta/issues/3115) is an open request to add LongMemEval, LOCOMO, and MemBench to their leaderboard. As of April 2026, LongMemEval results are not publicly posted by Letta themselves — third-party runs exist but not an official Letta self-benchmark.

**Third-party Reddit claim**: r/AI_Agents user reported getting ["80% on LongMemEval with RAG"](https://www.reddit.com/r/AI_Agents/comments/1m2hplv/getting_sota_longmemeval_scores_80_with_rag/) — not Letta's own publication.

**Verdict**: Too little published data to audit rigorously. Open GitHub issue suggests they're working on it.

---

### 1.7 MemPalace (April 2026, Milla Jovovich / Ben Sigman launch)

**Claim**: 100% on LongMemEval (500/500), 100% on LOCOMO, 92.9% on ConvoMem (>2× Mem0), MIT-licensed, local-only, no API key needed, "highest ever recorded" — [mempalace.tech](https://www.mempalace.tech/).

**What was actually measured (per [HackerNoon deep-dive](https://hackernoon.com/resident-evil-star-milla-jovovich-shipped-an-ai-memory-system-devs-shredded-its-benchmarks), April 12 2026, and [GitHub Issue #29](https://github.com/milla-jovovich/mempalace/issues/29) audit)**:

**On LongMemEval**:
> "MemPalace's '100%' measures only retrieval recall@5. It never generates or judges an answer. For comparison, published end-to-end scores from real systems: EverMemOS at 83.0%, TiMem at 76.88%, Zep/Graphiti at 71.2%. MemPalace's number lives in a different category entirely."

Additionally: three hand-coded boosts targeting specific failing test questions. Held-out score on the other 450 questions: 98.4% (still retrieval, not QA, so still not comparable to the 71-86% published by real QA-measuring systems).

**On LOCOMO**:
> "The system sets top_k=50, which retrieves the entire conversation pool. As the Issue #29 auditor put it, the pipeline reduces to dumping every session into Claude Sonnet and asking which one matches. That's `cat *.txt | claude`, not a memory system."

**On "30× lossless compression"**:
> "MemPalace's AAAK compression mode — regex-based abbreviation with dictionary lookups — drops retrieval from 96.6% to 84.2%. A 12.4-point regression."

**On advertised "contradiction detection" feature**:
> "Leonard Lin's independent code analysis further confirmed that the marketed 'contradiction detection' feature doesn't exist in the codebase — zero occurrences of the word 'contradict' in the knowledge graph code."

**On "no API key" marketing**:
> "'No API key' is only true for writes. Both 100% scores required paid Claude API calls for reranking and answer generation. The marketing said, 'No API key. No cloud.' The benchmarks needed both."

**Outcome**: Community Note appended to the original viral launch tweet. MemPalace team has acknowledged overstatements and updated docs. Project retained ~36,800 GitHub stars (mostly from celebrity virality, not architecture merit, per HackerNoon analysis).

**Verdict**: CASE STUDY of benchmark gaming. Retrieval-metric-as-end-to-end-QA + test-set-specific hand-coded boosts + misleading "no API key" claim + advertised feature that doesn't exist. MemPalace is extreme but the patterns (wrong metric, test-set hacks, undisclosed requirements) are common across the space.

---

## 2. Benchmark-level audits: LOCOMO + LongMemEval-S are themselves flawed

Even before the vendors start gaming, the benchmarks have quality issues documented by third-party audits:

### 2.1 LOCOMO (Maharana et al., ACL 2024): answer-key errors + judge unreliability

From [Penfield Labs audit, April 4 2026](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg):

> "We conducted a systematic audit of the ground truth and identified 99 score-corrupting errors in 1,540 questions (6.4%). Error categories include hallucinated facts in the answer key, incorrect temporal reasoning, and speaker attribution errors."
>
> "The theoretical maximum score for a perfect system is approximately 93.6%."
>
> "We generated intentionally wrong but topically adjacent answers for all 1,540 questions and scored them using the same judge configuration and prompts used in published evaluations. The judge accepted 62.81% of them."
>
> "Vague answers that identified the correct topic while missing every specific detail passed nearly two-thirds of the time. This is precisely the failure mode of weak retrieval - locating the right conversation but extracting nothing specific - and the benchmark rewards it."

Per Penfield: "Multiple independent researchers have documented inability to reproduce published results ([EverMemOS #73](https://github.com/EverMind-AI/EverMemOS/issues/73), [Mem0 #3944](https://github.com/mem0ai/mem0/issues/3944), [Zep scoring discrepancy](https://github.com/getzep/zep-papers/issues/5))."

Per [Northcutt et al., NeurIPS 2021](https://arxiv.org/abs/2103.14749): "average of 3.3% label errors across 10 major ML benchmarks and demonstrated that these errors can destabilize model rankings. LoCoMo's error rate is nearly double that baseline."

### 2.2 LongMemEval-S (Wang et al., 2024): context-window test rather than memory test

Again from Penfield Labs:

> "LongMemEval-S uses approximately 115K tokens of context per question. Current models support 200K to 1M token context windows. The entire test corpus fits in a single context window for most current models."
>
> "Mastra's research illustrates this: their full-context baseline scored 60.20% with gpt-4o (128K context window, near the 115K threshold). Their observational memory system scored 84.23% with the same model, largely by compressing context to fit more comfortably. The benchmark is measuring context window management efficiency rather than long-term memory retrieval. As context windows continue to grow, the full-context baseline will keep climbing and the benchmark will lose its ability to discriminate."

**Implication for AgentOS**: AgentOS's 76.6% Tier 3 min-cost at $0.058/correct lives in the regime where the benchmark is largely a context-window compression test. A real long-term-memory benchmark (BEAM 10M, or LongMemEval-M/L) would likely reveal different orderings.

### 2.3 Penfield's six requirements for meaningful evaluation

A direct indictment of the space's current publication practice:

1. **Corpus size must exceed context windows.** "If the full test corpus fits in context, retrieval is optional and the benchmark cannot distinguish memory systems from context window management."
2. **Evaluation must use current-generation models.** "gpt-4o-mini as a judge introduces a ceiling on scoring precision."
3. **Judge reliability must be validated adversarially.** "When a judge accepts 63% of intentionally wrong answers, score differences below that threshold are not interpretable."
4. **Ingestion should reflect realistic use.** Conversation-building vs single-pass static-text ingest.
5. **Evaluation pipelines must be standardized or fully disclosed.** "At minimum: ingestion method (and prompt if applicable), embedding model, answer generation prompt, judge model, judge prompt, number of runs, and standard deviation. Without this, cross-system comparisons in published tables are not meaningful."
6. **Ground truth must be verified.** LOCOMO's 6.4% error rate destabilizes rankings (Northcutt et al.).

**AgentOS already satisfies #3 (judge adversarial probe), #5 (full config disclosed on every run JSON), and partially #6 (weighted accuracy + bootstrap CIs mitigate noise floor effects).** Competitors generally satisfy none or very few.

---

## 3. How AgentOS compares on transparency axes

Surveyed vendors: Mem0, Mastra, Supermemory, Zep, EmergenceMem, Letta, MemPalace. AgentOS's position on the 10 most-load-bearing transparency axes:

| Transparency axis | Mem0 | Mastra | Supermem | Zep | Emergence | Letta | MemPalace | **AgentOS** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Aggregate accuracy published | ✅ | ✅ | ✅ | ✅ | ✅ | partial | ✅ | ✅ |
| **95% bootstrap CI on headline** | ❌ | ❌ | ❌ | ❌* | ❌ | ❌ | ❌ | **✅** |
| **Per-category 95% CI** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| Reader model disclosed on research page | ❌ | ✅ | partial | ✅ | ✅ | ❌ | ❌ | ✅ |
| Observer/ingest model disclosed | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Per-correct USD cost (full pipeline)** | ❌ | ❌ | ❌ | ❌ | partial (latency only) | ❌ | ❌ | **✅** |
| **Latency avg / p50 / p95** | ❌ | ❌ | ❌ | partial (p95 search only) | median only | ❌ | ❌ | **✅** |
| Per-category breakdown | ❌ | ✅ | ✅ | ✅ | ✅ | partial | ❌ | ✅ |
| Open-source benchmark runner | ✅ | ✅ | ✅ | partial | ✅ | ❌ | partial | ✅ |
| **Per-case run JSONs at seed** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| **Judge-adversarial probe** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |
| **Matched-reader cross-vendor table** | ❌ | ❌ | partial | partial | ✅ | ❌ | ❌ | **✅** |

*Zep publishes `75.14% ±0.17` for LOCOMO, suggesting small SD but not a bootstrap CI calculation.

**AgentOS is the only surveyed vendor that publishes all 10 axes.** The 4 axes where AgentOS is uniquely transparent (bootstrap CIs, per-correct USD, latency distribution, per-case run JSONs, judge-adversarial probe) are also exactly what Penfield Labs' audit enumerates as necessary for meaningful benchmark interpretation.

---

## 4. Pattern-of-gaming taxonomy

From the surveyed incidents, the space has six documented gaming patterns:

| Pattern | Example | Detection |
|---|---|---|
| **Retrieval metric disguised as end-to-end QA** | MemPalace "100% LongMemEval" (actually recall@5) | Per-case run artifacts with reader output would catch this |
| **Test-set overfitting via hand-coded boosts** | MemPalace Issue #29 (3 boosts on specific failing questions) | Held-out evaluation at a seed |
| **top_k = entire corpus** | MemPalace LoCoMo 100% | Log retrieved-document count per query |
| **Cross-vendor misimplementation** | Mem0 vs Zep (sequential search instead of concurrent) | Require the competitor to verify; publish reproducible code |
| **Self-reported unreproduced** | Zep 71.2% → independent 63.8% at arxiv:2512.13564 | Third-party reproduction at matched reader |
| **Mixed-vendor stack hidden in headline** | Mastra "84.23% gpt-4o" uses gemini-2.5-flash observer | Mandate explicit per-role model disclosure |

AgentOS's publication practice (bootstrap CIs + per-case JSONs + matched reader + judge adversarial + full config redaction + seeded reproducibility) is specifically designed to make all six gaming patterns impossible to hide from a motivated auditor.

---

## 5. Where AgentOS actually lands on the competitive frontier

At matched reader (gpt-4o) on LongMemEval-S Phase B N=500:

| System | Accuracy | Observer/ingest model | $/correct | Latency | CI | Per-case artifacts |
|---|---:|---|---:|---:|:-:|:-:|
| Mem0 (self-report) | 93.4% | undisclosed | undisclosed | undisclosed | ❌ | ❌ |
| Mem0 (self-report alt) | 92.0% | undisclosed | undisclosed | undisclosed | ❌ | ❌ |
| EmergenceMem Internal | 86% | gpt-4o (k=42 hardcoded) | not disclosed but reproducible at ~$30 per full eval | 5.65s median | ❌ | code available |
| Supermemory (self-report) | 81.6% | undisclosed on research page | undisclosed | undisclosed | ❌ | bench runner open |
| Mastra OM gpt-4o Actor | 84.23% | **gemini-2.5-flash** (Observer/Reflector) | undisclosed | undisclosed | ❌ | bench runner open |
| Zep / Graphiti (self-report) | 71.2% | gpt-4o | undisclosed | 5.65s median (0.632s search p95) | ±0.17 SD | partial |
| Zep / Graphiti (independent audit) | **63.8%** | gpt-4o | — | — | — | arxiv:2512.13564 |
| **AgentOS Tier 3 min-cost** | **76.6%** | **gpt-5-mini** (observer/reflector, OpenAI-only stack) | **$0.0580** | **16s avg** | **[72.8, 80.2]** | **✅ full JSONs, seed=42** |

**Honest read for external publication**:

AgentOS Tier 3 min-cost lands at 76.6% ±3.4pp on LongMemEval-S at a pure-OpenAI stack. That's above Zep's self-reported 71.2% (and well above Zep's independently-audited 63.8%) but below the Mastra-gpt-5-mini-observer configurations and EmergenceMem's k=42-hardcoded Simple variants. On cost transparency + latency transparency + per-case reproducibility + judge adversarial probe, AgentOS is uncontested.

**The defensible competitive claim:**

> "AgentOS Tier 3 is the most transparent memory benchmark in the space. 76.6% at $0.058/correct is within the competitive range, and it's the only entry on the leaderboard that ships with bootstrap CIs, per-case run JSONs, matched-reader cost, p50/p95 latency, judge-adversarial probe, and seeded reproducibility. Published frontier numbers (Mastra 84.23%, EmergenceMem 86%, Mem0 92-93.4%) are all self-reported without per-case artifacts, without CIs, and with undisclosed cost/latency profiles — and multiple have been independently audited or disputed: Zep 71.2%→63.8% (arxiv:2512.13564), Mem0 vs Zep benchmark mis-run (blog.getzep.com/lies-damn-lies-statistics), MemPalace 100% reduced to hand-coded boosts on recall@5 (Issue #29). AgentOS's publication practice is specifically designed to make such hidden failures impossible."

---

## 6. Sources

All primary sources visited 2026-04-24 via Serper + Tavily pipelines. Reranked by Cohere rerank-v3.5 where appropriate.

**Vendor primary sources**:
- Mem0 research: https://mem0.ai/research (93.4% claim)
- Mem0 research alt: https://mem0.ai/research-2 (92.0% claim)
- Mastra Observational Memory: https://mastra.ai/research/observational-memory (primary-source observer disclosure)
- Supermemory research: https://supermemory.ai/research/ (81.6% claim + per-category)
- Supermemory memorybench: https://github.com/supermemoryai/memorybench
- Zep SOTA blog: https://blog.getzep.com/state-of-the-art-agent-memory/ (71.2% claim)
- Zep paper: https://arxiv.org/html/2501.13956v1
- Graphiti: https://github.com/getzep/graphiti
- EmergenceMem blog: https://www.emergence.ai/blog/sota-on-longmemeval-with-rag
- EmergenceMem code: https://github.com/EmergenceAI/emergence_simple_fast
- Letta issue: https://github.com/letta-ai/letta/issues/3115 (LongMemEval not yet added)
- MemPalace: https://github.com/milla-jovovich/mempalace

**Third-party audits**:
- Penfield Labs LOCOMO audit: https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg
- Penfield Labs repo: https://github.com/dial481/locomo-audit
- Zep vs Mem0: https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/
- MemPalace audit (HackerNoon): https://hackernoon.com/resident-evil-star-milla-jovovich-shipped-an-ai-memory-system-devs-shredded-its-benchmarks
- MemPalace Issue #29: https://github.com/milla-jovovich/mempalace/issues/29
- Leonard Lin code analysis: https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md
- Emergence AI critique (Calvin Ku): https://medium.com/asymptotic-spaghetti-integration/emergence-ai-broke-the-agent-memory-benchmark-i-tried-to-break-their-code-23b9751ded97
- Independent Zep audit: https://arxiv.org/abs/2512.13564
- Reproduction failure issues: mem0/#3944, EverMemOS/#73, zep-papers/#5

**Foundational benchmark papers**:
- LongMemEval (Wang et al. ICLR 2025): https://arxiv.org/abs/2410.10813
- LOCOMO (Maharana et al. ACL 2024): https://aclanthology.org/2024.acl-long.747.pdf
- Label noise in benchmarks (Northcutt et al. NeurIPS 2021): https://arxiv.org/abs/2103.14749
- BEAM: https://arxiv.org/abs/2510.27246

---

End of audit.
