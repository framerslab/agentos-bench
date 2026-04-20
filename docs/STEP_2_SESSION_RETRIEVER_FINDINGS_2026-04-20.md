# Step 2 Findings — SessionRetriever

**Date:** 2026-04-20
**Scope:** new `packages/agentos/src/memory/retrieval/session/` subsystem + bench adapter wiring behind `--session-retrieval` flag.
**Spec:** [2026-04-20-step-2-session-retriever-design.md](../../agentos/docs/superpowers/specs/2026-04-20-step-2-session-retriever-design.md)
**Plan:** [2026-04-20-step-2-session-retriever.md](../../agentos/docs/superpowers/plans/2026-04-20-step-2-session-retriever.md)
**Architecture:** [agentos/docs/architecture/session-retriever.md](../../agentos/docs/architecture/session-retriever.md)

---

## Verdict: RED (on the specific MVP-skip-rerank variant tested)

Fails Step 2 GREEN-soft gate from spec §7.3. Flag stays off by default; baseline production path unchanged. Code preserved as opt-in infrastructure — the failure is attributable to a documented MVP simplification (skipped rerank threading, Engineer's Discretion #1) rather than a fundamental flaw in the hierarchical-retrieval pattern.

**Gate check against Tier B (N=102):**

| Criterion | Required | Measured | Verdict |
|---|---|---|---|
| Multi-session point ≥ 80% | ≥ 80% | 41.2% | FAIL (-38.8pp) |
| Multi-session lower CI > 64.7% | > 64.7% | 17.6% | FAIL |
| Weighted ≥ 79.3% (within 3pp of baseline 82.3%) | ≥ 79.3% | 70.8% | FAIL (-8.5pp) |
| Cost/correct ≤ $0.0031 | ≤ $0.0031 | $0.0022 | PASS |

RED trigger: multi-session regressed > 2pp AND weighted regressed > 3pp.

---

## Tier A → Tier B divergence (the story)

**Tier A (N=24, directional only) looked promising:**

| Benchmark | Step 1 baseline | Step 2 Tier A | Δ (Tier A) |
|---|---:|---:|---:|
| LME-S overall | 79.2% | 79.2% | 0pp |
| LME-S multi-session | 50% (2/4) | 75% (3/4) | **+25pp** |
| LOCOMO overall | 53.3% | 63.3% | **+10pp** |
| LOCOMO adversarial | 17% (1/6) | 50% (3/6) | **+33pp** |
| Oracle overall | 79.2% | 91.7% | **+12.5pp** |

**Tier B (N=102) reversed the signal:**

| Category | Step 1 baseline (CI) | Step 2 (CI) | Δ |
|---|---:|---:|---:|
| Overall unweighted | 85.3% [78.4%, 92.2%] | **78.4%** [70.6%, 86.3%] | **-6.9pp** |
| Weighted | 82.3% [73.6%, 90.7%] | **70.8%** [61.2%, 80.4%] | **-11.5pp** |
| Multi-session (n=17) | 64.7% [41.2%, 88.2%] | **41.2%** [17.6%, 64.7%] | **-23.5pp** |
| Knowledge-update (n=17) | 94.1% [82.4%, 100%] | **70.6%** [47.1%, 88.2%] | **-23.5pp** |
| Temporal-reasoning (n=17) | 76.5% [52.9%, 94.1%] | 70.6% [47.1%, 88.2%] | -5.9pp |
| Single-session-preference (n=17) | 81.3% [62.5%, 100%] | **94.1%** [82.4%, 100%] | +12.8pp |
| Single-session-user (n=17) | 100% | 94.1% [82.4%, 100%] | -5.9pp |
| Single-session-assistant (n=17) | 100% | 100% | 0pp |

**Lesson: Tier A (N=24) variance (~±14pp per category) hides regressions that only surface at N=102.** Step 1's bootstrap-CI infrastructure is exactly the tool that caught this — without CIs we'd have shipped based on the Tier A signal. Validates the Step-1-first ordering in the umbrella framework.

---

## Root cause hypothesis: missing rerank

The baseline pipeline runs Cohere `rerank-v3.5` over the top-30 cognitive-scored candidate pool, blending 0.7 cognitive + 0.3 neural scores. SessionRetriever's MVP (per spec §Engineer's Discretion #1 + plan Task 8.3) **intentionally skips rerank threading** for the first implementation cycle. That's a measured ~11.8pp lift the baseline has that Step 2 lacks.

Looking at per-category regressions:
- **Multi-session -23.5pp**: sessions that contain gold chunks aren't ranked highest by cognitive-only scoring within their buckets; rerank would re-surface them.
- **Knowledge-update -23.5pp**: the LongMemEval questions rely on specific-value chunks that rerank disambiguates from semantically-adjacent distractors. Without rerank, cognitive scoring leans on decay + similarity, and loses the specific-value match.
- **Preference +12.8pp**: preference questions benefit from diverse session coverage without needing precise specific-value retrieval — one category where SessionRetriever-without-rerank genuinely helps.

The hypothesis is testable in a Step 2b / Step 3 follow-up: plumb `RerankerService` into `SessionRetriever` so the merged K×M pool gets the same rerank the baseline enjoys. If that closes the gap, SessionRetriever becomes GREEN (or at least YELLOW). If it doesn't, the hierarchical-retrieval pattern genuinely underperforms on our benchmark and we park it.

---

## Tier A summary (with CIs)

### LongMemEval-S N=24 (Tier A)

| Metric | Step 2 value | 95% CI |
|---|---:|---|
| Unweighted accuracy | 79.2% | [62.5%, 95.8%] |
| Multi-session (n=4) | 75% | [25%, 100%] |

Cost: $0.052. Multi-session +25pp point estimate but n=4 gives ±50pp band — NOT distinguishable from noise.

### LOCOMO N=30 (Tier A)

| Metric | Step 2 value |
|---|---:|
| Unweighted accuracy | 63.3% (+10pp vs 53.3% baseline) |
| Adversarial (n=6) | 50% (+33pp vs 17% baseline) |
| Multi-hop (n=6) | 50% |
| Temporal (n=6) | 67% |

Cost: $0.033. LOCOMO was not re-run at larger scale in Step 2; the +10pp Tier A improvement is directional only. A follow-up LOCOMO N=100+ run (not scheduled for Step 2) would clarify.

### LongMemEval-Oracle N=24 (Tier A)

| Metric | Step 2 value |
|---|---:|
| Unweighted accuracy | 91.7% (+12.5pp vs 79.2% baseline) |

5 of 6 categories at 100%. Multi-session stuck at 50% (Oracle gives the evidence; multi-session is about synthesis not retrieval — expected).

---

## Cost accounting

| Run | Config | USD | Cached? |
|---|---|---:|---|
| Tier A LME-S | N=24, warm cache | 0.052 | mostly |
| Tier A LOCOMO | N=30, warm cache | 0.033 | mostly |
| Tier A Oracle | N=24, warm cache | 0.052 | mostly |
| Tier B Phase A | N=102 | 0.174 | warm summaries, cold reader |
| **Total Step 2** | | **$0.31** | within $3 budget |

---

## What ships

- **All 15 new tests** (5 SessionSummaryStore unit, 6 SessionRetriever unit, 2 integration, 4 bench plumbing) pass and stay in the repo.
- **`SessionSummaryStore` + `SessionRetriever`** live under `packages/agentos/src/memory/retrieval/session/` as first-class agentos-core exports. Callers outside the bench can use them.
- **CLI flag `--session-retrieval`** (plus `-top-sessions` / `-chunks-per-session`) is available but opt-in. Default is off. No change to production behavior.
- **Cache-key fingerprint** `session-retrieval:k=<K>,m=<M>` conditionally appends. Baseline run hashes unchanged.
- **Architecture doc** at `packages/agentos/docs/architecture/session-retriever.md` (tracked).
- **This findings doc** records the negative result with full CIs.

---

## Does NOT ship

- No production-default flip. `--session-retrieval` stays off by default until a rerank-enabled variant proves GREEN.
- No `CASE_RUN_SCHEMA_VERSION` bump. Baseline cache entries stay valid.

---

## Lessons for Steps 3-6

1. **Tier A variance is a trap.** At N=24 per benchmark, per-category CIs are ±14-50pp. Tier A is a regression-catch only, not a signal-detection tool. Tier B at N=102 is the earliest point at which positive claims become defensible.

2. **Ablations require matched baselines.** The right Step 2 experiment compares "baseline with rerank" against "SessionRetriever with rerank," not against "SessionRetriever without rerank." When adding a new retrieval strategy, thread in ALL the scoring aids the baseline uses — the ablation isolates the hierarchical-vs-flat dimension, not the hierarchical-without-rerank-vs-flat-with-rerank comparison.

3. **"Engineer's Discretion" items bite.** Plan §Engineer's Discretion #1 flagged the rerank skip as a trade-off ("might still get Stage-2 cognitive scoring"). The tradeoff was worse than estimated. Future plans: when an Engineer's-Discretion item affects primary metric gates, resolve it in the spec, not the plan.

4. **CI machinery earned its keep.** Step 1's bootstrap-CI infrastructure showed Tier A's +25pp multi-session signal was inside the ±50pp noise floor. Without CIs we'd have shipped. This is the Spark-LLM-Eval / NIST discipline paying off on its first real application.

5. **Multi-session gap remains the dominant target.** Baseline 64.7% [41.2%, 88.2%] vs Mastra OM 87.2%. Step 2 did not close it; Step 6 (CRAG retrieval grading) or a Step 2b (SessionRetriever + rerank) might. The research survey identified Step 2 as the highest-expected-lift option; reality shows rerank is harder to displace than expected.

---

## Step 2b candidate (optional, not scheduled)

A short follow-up experiment to validate the rerank hypothesis would be:

1. Extend `SessionRetriever` ctor to accept `RerankerService` (already typed in the options, just not wired on the adapter side).
2. Bench-side wiring: when `--rerank` + `--session-retrieval` both set, pass `handle.manager.getRerankerService()` (new public getter — tiny agentos core addition) into the `SessionRetriever`.
3. Re-run Tier B Phase A with `--session-retrieval --rerank cohere`.
4. If multi-session improves to ≥ 80% and weighted stays within 3pp of baseline, reclassify as GREEN.
5. Budget: ~$0.60 for the Tier B re-run.

Not doing it in Step 2 because the umbrella framework says "move on to Step 3 on RED." Flag for a parallel sub-experiment if the blog post narrative wants it.

---

## Commits (Step 2)

From agentos core submodule + monorepo:

- `12cfd2e4a` memory: SessionSummaryStore for session-level vector indexing
- `<TBD>` memory: SessionRetriever for two-stage hierarchical retrieval
- `6b16dfabb` memory: SessionRetriever integration tests with real in-memory components
- `1854cd0e3` memory: barrel-export SessionSummaryStore + SessionRetriever; fix PADState import
- `a90819033` docs(memory): architecture doc for SessionRetriever
- `bd720fc530` bench: RunConfig + cache-key fingerprint for session-retrieval
- `bab26bc5c5` bench: wire SessionRetriever through CLI, LongMemEvalS, LOCOMO

(Some hashes are in the agentos submodule, others in the monorepo — see `git log` per package.)

---

## Rollback actions

None required: `--session-retrieval` defaults to off. Baseline production unchanged. Step 2 code remains as opt-in infrastructure.

---

## Next step

Brainstorm Step 3 (HybridSearcher wiring: BM25 + dense RRF via the existing `packages/agentos/src/rag/search/HybridSearcher.ts`). Expected target: LOCOMO adversarial + LME-S knowledge-update specifics. This is the lowest-build-cost step remaining because the code already exists — just needs wiring to the bench.

Optionally revisit Step 2 as "Step 2b" after Steps 3-6, wiring rerank through `SessionRetriever` to test the rerank hypothesis.
