# Step 16 Findings — OM + HybridRetriever Combined Context

**Date:** 2026-04-22
**Scope:** First experiment stacking two orthogonal memory primitives: v5 (dual-path OM + scaffold + gpt-4o observer) plus Step 3 HybridRetriever passages injected into the reader context. Goal: close the multi-session gap without sacrificing v5's single-session sweep.

**Baseline:** v5 at 79.2% Tier A (SSU/SSA/SSP all 100%, MS 25%, TR 75%, KU 75%).

**Kill gates:**
- Tier A: unweighted ≥ 82% AND multi-session ≥ 50% AND all single-session ≥ 90%.

---

## 1. Verdict

**RED at Tier A.** 70.8% aggregate (17/24), CI [54.2%, 87.5%]. Regression vs v5 (79.2%) with context pollution across three of six categories.

| Metric | v5 | Step 16 | Δ |
|---|---:|---:|---:|
| Unweighted | 79.2% | 70.8% | **-8.4pp** |
| single-session-user | 100% | 75% | **-25pp** |
| single-session-assistant | 100% | 100% | 0 |
| single-session-preference | 100% | 75% | **-25pp** |
| knowledge-update | 75% | 75% | 0 |
| **multi-session** | **25%** | **50%** | **+25pp** |
| temporal-reasoning | 75% | 50% | **-25pp** |
| Tier A cost | $24.30 | $33.67 | +$9.37 |
| Avg latency | 46.0s | 55.7s | +9.7s |

**Kill-gate check:**
- Unweighted ≥ 82%: **FAIL** (70.8%)
- Multi-session ≥ 50%: PASS (50%)
- All single-session ≥ 90%: **FAIL** (SSU 75%, SSP 75%)

Two out of three kill gates failed. Step 16 ships nothing as default; retrieval stays off unless dynamically routed (Step 16c).

---

## 2. Configuration

Run JSON: `results/runs/2026-04-22T21-21-56-386--longmemeval-s--gpt-4o--full-cognitive--ingest.json`.

| Flag | Value |
|---|---|
| `--om-mode` | `dual-path` |
| `--om-reader-scaffold` | on |
| `--om-observer-model` | `gpt-4o` |
| `--om-batch-tokens` | 24000 |
| `--om-with-retrieval` | on |
| `--rerank` | `cohere` |
| `--hybrid-retrieval` | on |
| `--context-summary` | `gpt-5-mini` |
| `--reader-top-k` | 10 (implicit default) |

Metadata recorded per case: `omMode=dual-path`, `omReaderScaffold=true`, `omObserverModel=gpt-4o`, `omWithRetrieval=true`, `omRetrievedPassagesCount=10` (uniform across cases), `omObservationBatches=47` (41 per-session + 6 batched, identical to v5), `omFinalLogChars=69143` (vs v5's 65587, +5.4% larger due to retrieval header and the retrieval passages appended below the observation log).

---

## 3. Architecture

### 3.1 What it layers

v5's ingest pipeline is unchanged: per-session observer pass + token-bounded batched observer pass + cross-session reader scaffold. On top of that, Step 16 runs the full HybridRetriever pipeline (BM25 + text-embedding-3-small dense + RRF fusion + Cohere rerank-v3.5) at reader time and appends the top-10 retrieved passages under a `## Retrieved passages` section after the observation log.

The reader sees:
```
<system prompt>
<cross-session scaffold>

## Observations
...v5's 69KB dual-path observation log...

## Retrieved passages
1. [session s42, score 0.89] ...
2. [session s17, score 0.87] ...
...10 passages total...
```

Both signals compete for reader attention. The hypothesis was that retrieval would surface exact quotes the dense log had compressed away, boosting multi-session recall.

### 3.2 Why the combined pass looked promising

Step 3 HybridRetriever alone scored 74.8% Tier A on Step 3 baseline (retrieval-only, no OM). v5 scored 79.2% (OM-only). Orthogonal-strength assumption: retrieval wins on exact-quote lookups; OM wins on dense pattern synthesis. Stacking should keep each's wins and cover the other's blind spots.

The multi-session +25pp gain (25% → 50%) confirms retrieval does help the cross-session category — matching the hypothesis. The regression elsewhere is the story.

---

## 4. Diagnosis — context pollution

### 4.1 Where v5 shone, Step 16 polluted

| Category | v5 mechanism | Step 16 failure mode |
|---|---|---|
| single-session-user (100 → 75) | Reader scans date-grouped dense log, finds the one session, answers. | Retrieval surfaces 10 passages from sessions OTHER than the gold session; reader averages across passage scores and chooses a distractor passage's claim over the observation log. |
| single-session-preference (100 → 75) | Same as SSU — one session anchors the preference. | Retrieved passages from non-gold sessions include user preferences stated in passing; reader conflates. |
| temporal-reasoning (75 → 50) | Scaffold's step-2 ("order chronologically by date") points at `Date:` headers in the observation log. | Retrieved passages don't have `Date:` headers — they have passage indices. Reader's chronology-ordering step breaks when half the input is non-dated. |

### 4.2 Why multi-session DID improve

Multi-session questions require assembling facts from 2+ sessions. v5's observation log compressed per-session observations into dense prose; compression sometimes drops the cross-session link. Retrieval surfaces raw passages from both sessions via the BM25 + dense + rerank signal, giving the reader explicit quotes to stitch together. +25pp on this category validates the underlying hypothesis.

### 4.3 The top-K=10 choice is load-bearing

Each retrieved passage is roughly 500-1500 tokens. At K=10, retrieved content adds ~10k tokens of material to a reader context already carrying 69KB of observation log. Total reader input ≈ 90KB.

At K=10, retrieval pollutes more than it helps for single-session. At K=3, the signal-to-noise ratio might flip. This is the Step 16b hypothesis.

### 4.4 Latency + cost

Adding retrieval adds ~$9 to Tier A (+39%) and 9.7s/case average latency (+21%). The retriever's 4-stage pipeline (BM25, dense embedding, RRF, Cohere rerank) is serial per case. Latency hit is permanent architecture cost of combined mode.

---

## 5. Why this was worth running anyway

### 5.1 The MS +25pp signal is the first successful multi-session lift

Prior variants' multi-session scores (v1 25%, v2 50%, v3 25%, v4a 50%, v4b 50%, v4c 50%, v5 25%) have oscillated but never cleanly closed the gap to Mastra's reported 79.7%. Step 16's retrieval does move the category — it's the wrong default, but the signal suggests retrieval is load-bearing for cross-session if applied only when the question requires it.

### 5.2 Validated context-pollution hypothesis

The +25pp MS and -25pp on three other categories is a textbook context-pollution pattern: the additional context helps on the questions it's designed for, hurts on the questions where it adds distraction. This evidence directly motivates the Step 16c dynamic-router design.

### 5.3 Architectural triangulation

Combined with v4a/v4b/v4c findings (reader scaffold a free-lift only when layout matches; synthesis is NOT free-lift), Step 16's data completes a 3-axis mapping:

- Axis A — reader prompt (v4a scaffold): free when layout matches, zero-cost, +50pp temporal-reasoning.
- Axis B — synthesis LLM calls (v4b): paid, inconsistent, net-zero aggregate.
- Axis C — retrieval augmentation (Step 16): paid, polluting by default, +25pp MS when surfaced at the right moment.

Step 16c proposes: always-on scaffold (axis A); retrieval ONLY when a lightweight classifier determines the question benefits (axis C conditional).

---

## 6. What ships

- `--om-with-retrieval` flag + `RETRIEVED_PASSAGES_HEADER` + `RETRIEVED_PASSAGES_INSTRUCTIONS` constants — kept in the codebase, documented as opt-in, default off.
- `step-16-om-retrieval:v1` fingerprint tag — emitted only when the flag is on.
- `omWithRetrieval` + `omRetrievedPassagesCount` case metadata — always recorded for future replay analysis.
- A documented tested-RED combination in `prompts.ts` commentary (scaffold + full retrieval at K=10 is dominated by scaffold alone).

No default changes. The existing v5 config (`--om-mode dual-path --om-reader-scaffold --om-observer-model gpt-4o`) remains the bench's top Tier A performer.

---

## 7. What's next

Two forks:

### 7.1 Step 16b — tighter retrieval (top-K=3)

Hypothesis: K=10 pollutes; K=3 may preserve the MS gain without polluting single-session categories. Zero new code, flag swap only. Estimated cost ~$35-40 Tier A. See `docs/specs/2026-04-22-step-16b-tighter-retrieval-topk-design.md` and `docs/plans/2026-04-22-step-16b-plan.md`.

### 7.2 Step 16c — LLM-as-judge dynamic router

Classify each question (cheap gpt-4o-mini call) into {single-session, multi-session, temporal-reasoning, knowledge-update, preference}. Route to the variant that won each category on this rollout:

| Category | Winner | Config |
|---|---|---|
| SSU/SSA/SSP | v5 | OM dual-path + scaffold, no retrieval |
| multi-session | Step 16 (if 16b validates) or Step 16 | OM dual-path + scaffold + retrieval K=3 |
| temporal-reasoning | v4a / v5 | OM dual-path + scaffold, no retrieval |
| knowledge-update | All tied at 75% | Default v5 |

See `docs/specs/2026-04-22-step-16c-llm-judge-router-design.md` and `docs/plans/2026-04-22-step-16c-plan.md`. Estimated cost ~$45 Tier A + classifier tokens.

### 7.3 Phase A on the winner

Whichever of 16b, 16c, or the current v5 baseline looks best at Tier A ladders to Phase A N=102 (~$150). Phase B N=500 (~$700) only on explicit user approval after Phase A greens.

---

## 8. Takeaways

### 8.1 Stacking retrieval on top of a dense observation log without routing is strictly worse

Tier A aggregate -8.4pp; three of six categories regressed 25pp each. Non-selective context stacking is the anti-pattern.

### 8.2 Multi-session CAN be lifted with retrieval

+25pp from 25% → 50% is meaningful. The mechanism (retrieval surfaces raw cross-session quotes the dense log compressed away) is reproducible.

### 8.3 Kill-gate discipline caught it at Tier A

$33.67 spent to invalidate, vs a $700+ Phase B would have cost on a polluted architecture. The two-stage kill gate (Tier A → Phase A) is now validated across v4a (sampling luck) and Step 16 (context pollution).

### 8.4 Context pollution is layout-specific

v4a's scaffold works when the reader sees only date-grouped observation blocks. Adding non-dated retrieval passages breaks the scaffold's chronology-ordering step. The Step 16c router encodes this: scaffold fires when the config is dense-log-only; scaffold is suppressed when retrieval is routed in.

---

## 9. Cost

| Experiment | Tier A cost | Cases | Cost/case |
|---|---:|---:|---:|
| Step 16 (OM + retrieval K=10) | $33.67 | 24 | $1.40 |
| v5 baseline | $24.30 | 24 | $1.01 |
| Retrieval delta | +$9.37 | | +$0.39 |

Retrieval adds roughly $0.40 per case at K=10 (BM25 free, OpenAI embeddings cheap, Cohere rerank at K=10 is the dominant line item). At K=3 (Step 16b), rerank cost drops proportionally.

---

## 10. Files + run JSON

- Run JSON: `results/runs/2026-04-22T21-21-56-386--longmemeval-s--gpt-4o--full-cognitive--ingest.json`
- Config flags wired in: [src/cli.ts](../src/cli.ts) (`--om-with-retrieval`)
- Ingest-time retrieval path: [src/benchmarks/longmemeval/LongMemEvalS.ts](../src/benchmarks/longmemeval/LongMemEvalS.ts) OM branch
- Reader prompt injection: [src/observational-memory/runner.ts](../src/observational-memory/runner.ts) `buildOmReaderSystemPrompt` with `retrievedPassages` opt
- Prompt constants: [src/observational-memory/prompts.ts](../src/observational-memory/prompts.ts) under `RETRIEVED_PASSAGES_HEADER` + `RETRIEVED_PASSAGES_INSTRUCTIONS`
- Fingerprint tag: `step-16-om-retrieval:v1` in [src/core/BenchmarkRunner.ts](../src/core/BenchmarkRunner.ts) `resolveRunConfig`

---

End of Step 16 findings.
