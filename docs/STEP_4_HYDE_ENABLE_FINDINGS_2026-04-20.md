# Step 4 Findings — HyDE Enable (Opt-in Flag)

**Date:** 2026-04-20
**Scope:** new `--hyde` CLI flag threading HyDE through `CognitiveMemoryManager.retrieve` (baseline branch) and `HybridRetriever` (combined branch).
**Spec:** [2026-04-20-step-4-hyde-enable-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-4-hyde-enable-design.md)
**Plan:** [2026-04-20-step-4-hyde-enable.md](../../agentos/docs/superpowers/plans/2026-04-20-step-4-hyde-enable.md)

---

## Verdict: RED (both cells)

Tier A smokes on LongMemEval-S N=24 triggered the kill criterion on BOTH ablation cells. Tier B Phase A N=102 runs were not executed per plan §8.7 stop-before-Tier-B rule.

| Cell | Configuration | LME-S N=24 unweighted | Δ vs reference | Kill? |
|---|---|---:|---:|---|
| Cell A (isolated) | Baseline + `--hyde` | **50.0%** (12/24) | -29.2pp vs Step 1 baseline 79.2% | YES (threshold 79%) |
| Cell B (combined) | Hybrid + `--hyde` | **66.7%** (16/24) | -20.8pp vs Step 3 hybrid 87.5% | YES (threshold 82%) |

Both cells fail their respective kill criteria. HyDE in its current form actively regresses retrieval quality on LongMemEval-S — particularly on multi-session and specific-value categories. The empirical result matches the risk surface in spec §10 ("HyDE hypothesis worse than raw query on specific-value questions"): LongMemEval-S is dominated by specific-value queries (knowledge-update, preferences, user facts), and paraphrasing them into LLM-generated hypotheses strips the concrete tokens the dense embedding needs.

---

## Tier A Cell A — Baseline + `--hyde` (N=24, gpt-5-mini reader, Cohere rerank, ctx-summary on)

| Category | n | Accuracy | Step 1 baseline | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | -25pp |
| multi-session | 4 | **0.0%** | 50% | -50pp |
| single-session-assistant | 4 | 100% | 100% | 0 |
| single-session-preference | 4 | 50.0% | 100% | -50pp |
| single-session-user | 4 | 50.0% | 100% | -50pp |
| temporal-reasoning | 4 | 25.0% | 50% | -25pp |
| **Unweighted** | 24 | **50.0%** | 79.2% | **-29.2pp** |

Cost: $0.076 (24 cases). Cost/correct: $0.0063.

Every category regresses except single-session-assistant (which was already at ceiling). Multi-session drops to 0% — HyDE systematically breaks cross-session retrieval when the hypothesis text diverges from the actual stored trace content.

Per-category CIs at n=4 are ±50pp (single cases flip the percentage). Point estimates are noisy, but the uniform direction of regression across 5 of 6 categories makes the aggregate signal decisive.

---

## Tier A Cell B — Hybrid + `--hyde` (N=24, gpt-5-mini reader, Cohere rerank, ctx-summary on)

| Category | n | Accuracy | Step 3 Hybrid alone | Δ |
|---|---:|---:|---:|---:|
| knowledge-update | 4 | 75.0% | 100% | -25pp |
| multi-session | 4 | 25.0% | 75% | -50pp |
| single-session-assistant | 4 | 100% | 100% | 0 |
| single-session-preference | 4 | 25.0% | 100% | -75pp |
| single-session-user | 4 | 100% | 100% | 0 |
| temporal-reasoning | 4 | 75.0% | 100% | -25pp |
| **Unweighted** | 24 | **66.7%** | 87.5% | **-20.8pp** |

Cost: $0.077 (24 cases). Cost/correct: $0.0048.

Less severe regression than Cell A, but still decisive. BM25's exact-term anchors partially compensate for HyDE's hypothesis-induced drift on the sparse side — this is why single-session-user holds at 100% (BM25 anchored on name tokens) and temporal-reasoning only drops 25pp (temporal markers like dates survive sparse matching). But multi-session and preference — queries that require specific stored content to match — still collapse.

The rerank step does not rescue the regression because rerank operates on the MERGED pool: if RRF over {dense using bad hypothesis, sparse using bad hypothesis} surfaces the wrong candidates, rerank is stuck re-ordering those wrong candidates.

---

## Why HyDE failed here

The published ACL 2026 work showing HyDE + rerank wins on conversational QA was measured on abstract / vague queries against document corpora. LongMemEval-S is the opposite regime:

1. **Specific-value dominance.** Most LongMemEval-S questions ask about concrete facts (names, dates, preferences, knowledge updates). The raw query already contains the high-IDF tokens that BM25 and dense embedding need. The LLM-generated hypothesis paraphrases these away.
2. **Memory traces are short and specific.** Stored traces (chunked turns) are 100-500 tokens with concrete content. The hypothesis is 150 tokens of general expectation ("User probably likes outdoor activities..."). Cosine similarity to a 300-token hypothesis-text peaks FURTHER from the actual 300-token trace than the raw query peaks.
3. **Context-summary already solves the vague-query gap.** The v9 prompt + session-summary contextual retrieval (Step 0 default) already embeds each chunk prepended with its session context — so vague queries already match against richer chunk representations. HyDE's role was to bridge query↔chunk semantic gap; that gap is already smaller than HyDE assumes.
4. **Multi-session specifically.** Multi-session requires retrieval to span sessions. HyDE's hypothesis anchors on ONE hallucinated session's content, then dense search pulls that single-session's chunks and misses the other sessions. Cross-session recall collapses. Hybrid's BM25 side partially saves this (exact-term matches cross sessions anyway), which is why Cell B is 25% vs Cell A's 0% on multi-session.

---

## What ships

- **Code stays.** `HybridRetriever` gains optional `hydeRetriever` field (wired to use hypothesis for dense + sparse while rerank keeps original query — matched-ablation-correct implementation). `createCognitiveManager` accepts `hydeLlmInvoker`. `RunConfig.hyde` + CLI `--hyde` flag. 6 new tests. All code is opt-in and default-off, so production defaults are unchanged.
- **No production default flip.** `--hyde` stays off; no policy change.
- **Findings doc (this file).**

The code ships because (a) deleting it would lose the matched-ablation infrastructure for re-evaluation on a different workload, (b) a future consumer facing an abstract-query-heavy workload (e.g., semantic search over unstructured docs) might benefit, and (c) keeping the code documents the empirical case for NOT flipping the default.

---

## What does NOT ship

- No production default flip. `--hyde` stays opt-in + off.
- No `CASE_RUN_SCHEMA_VERSION` bump. Baseline cache entries unchanged.
- Tier B runs NOT executed (Tier A kill criteria triggered).
- LOCOMO and Oracle Tier A smokes also NOT executed (the LME-S kill was sufficient; saving ~$0.30 in Tier A and ~$0.20 in Tier B).

---

## Step 4 cost accounting

| Run | USD | Notes |
|---|---:|---|
| Cell A: LME-S N=24 Baseline + HyDE | $0.076 | N=24 stratified |
| Cell B: LME-S N=24 Hybrid + HyDE | $0.077 | N=24 stratified |
| Tier B runs | $0 | skipped per kill |
| **Total** | **$0.153** | Under the $1.00 budget |

---

## Why Step 4 RED + Step 3 GREEN-soft is consistent

Step 3 (HybridRetriever) added a complementary retrieval path (BM25) that surfaced exact-term anchors dense embedding missed. Rerank re-ordered the merged pool by actual relevance. Every component added signal on top of the query.

Step 4 (HyDE) replaces the signal the query already carries with an LLM-generated alternative. On LongMemEval-S where the query is already signal-dense (specific-value tokens), the replacement is a downgrade. The LLM's hypothesis is a paraphrase — information-preserving in human reading but not in embedding space.

Step 3's lesson ("rerank is the dominant value component") still holds: HyDE + rerank combined still regresses, because rerank operates over candidates that HyDE already surfaced from the wrong neighborhood.

---

## Lessons for Steps 5-6

1. **Additive features > replacing features.** Step 3's hybrid retrieval ADDED sparse signal alongside dense; Step 4's HyDE REPLACED the query signal. On a signal-dense workload, additive wins. Steps 5 (FactExtractor) + 6 (CRAG grading) should preserve this discipline: add signal on top of existing retrieval, don't paraphrase it away.
2. **Test at Tier A before committing Tier B.** The kill-criteria pattern caught this regression in $0.15 instead of $3.00. Every future step MUST pass a Tier A smoke before Tier B is fired.
3. **HyDE is not dead — just not for specific-value QA.** A retrieval benchmark dominated by abstract / vague queries (e.g., a search-over-docs task with ambiguous user queries) could still benefit. The code ships for that use case.
4. **Step 2 rerank-skip lesson still load-bearing.** HyDE + matched-rerank still RED means this wasn't a rerank-threading omission. The Step 4 infrastructure got the matched-ablation discipline right; the regression is intrinsic to HyDE on this workload, not a wiring bug.

---

## Commits (Step 4)

agentos core (submodule `framersai/agentos`):
- `9d87e487f` memory: optional HyDE retriever in HybridRetriever (hypothesis for dense+sparse, original query for rerank) + types.ts diagnostic extension + 3 unit tests

Monorepo:
- `7de46b2bed` bench: hydeLlmInvoker option on createCognitiveManager
- `bcc38a9d71` bench: RunConfig.hyde + cache-key fingerprint + integration tests
- `25567a1901` bench: --hyde CLI flag + entry.build passthrough
- `be4e15216f` bench: LongMemEvalS wires --hyde through manager + HybridRetriever
- `157c727910` bench: Locomo adapter --hyde propagation

---

## Rollback

Not required. `--hyde` defaults off. Production retrieval unchanged from Step 3's GREEN-soft default. The code is dormant infrastructure.

If a future operator decides HyDE is category-killing enough to delete the code entirely:
- Revert the 6 commits listed above.
- Remove the `hyde?` field from `RunConfig`.
- Remove `hydeRetriever` from `HybridRetrieverOptions`.
- Remove `hydeLlmInvoker` from `CreateCognitiveManagerOptions`.
- Remove the `hyde` diagnostic from `CognitiveRetrievalResult.diagnostics`.
- `CASE_RUN_SCHEMA_VERSION` stays `'v8'`.

---

## Next step

Brainstorm Step 5 (FactExtractor). The Step 4 RED strengthens Step 5's motivation: the knowledge-update ceiling at 94.1% (Step 3) needs supersession semantics, not query expansion. Step 5 will extract structured facts from trace content and version them, so when a user says "I moved to Berlin" after earlier saying "I live in NYC," retrieval can surface the current fact with correct precedence. Budget ~$1. Measure at Tier A + Tier B. Same kill-criterion discipline.
