# Stage F-2: LOCOMO Abstention Tuning — Findings (2026-04-24, corrected)

**Status:** COMPLETE. This doc reflects the corrected pipeline. The original first publication of this doc claimed Stage F-2 tuned LOCOMO at 51.5% [49.2%, 53.7%] aggregate (+1.6pp vs OOD); that number was actually `--reader-top-k 20` alone because the `--no-abstention` flag was silently dropped at runtime by a missing field in `resolveRunConfig`. The bug was caught in the next experiment's ablation, fixed with TDD, and the corrected numbers are below. Full bug story and audit at [STAGE_F2_CORRECTION_2026-04-24.md](STAGE_F2_CORRECTION_2026-04-24.md).

**Predecessor:** [Stage F-1 OOD baseline](SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md) — LOCOMO N=1986 at recallTopK=10 with the canonical v9 abstention prompt. Result: 49.9% aggregate, single-hop 20.6%.

**Experiment:** §4.1 of [NEXT_SESSION_CONTINUATION_2026-04-24_STAGE_G_FINAL.md](NEXT_SESSION_CONTINUATION_2026-04-24_STAGE_G_FINAL.md) (LOCOMO abstention tuning) plus §4.1 of the [Stage F-2 handoff](NEXT_SESSION_CONTINUATION_2026-04-24_STAGE_F2_FINAL.md) (Stage F-3 ablation).

## 1. TL;DR

Three LOCOMO configurations measured at N=1986, gpt-4o reader, gpt-4o-2024-08-06 judge + rubricVersion 2026-04-18.1, seed=42:

| Configuration | Accuracy | 95% CI | $/correct | Avg latency | Δ vs OOD |
|---|---:|---|---:|---:|---:|
| **K=20 alone** (Pareto-best LOCOMO tuning) | **51.5%** | [49.2%, 53.7%] | $0.0099 | 1.45s | **+1.6pp** |
| K=10 baseline (Stage F-1 OOD, no tuning) | 49.9% | [47.7%, 52.1%] | $0.0123 | 2.58s | — |
| K=20 + `--no-abstention` (Stage F-2 corrected) | 47.3% | [45.2%, 49.5%] | $0.0107 | 1.20s | −2.6pp |
| `--no-abstention` alone at K=10 (Stage F-3 Run B) | 42.1% | [40.0%, 44.3%] | $0.0082 | 1.19s | −7.8pp |

**Headline:** K=20 retrieval bump is the only tuning knob that helped. The `--no-abstention` prompt change is a category-specific trade-off — it gains +13.5pp on temporal and +6.7pp on open-domain at K=20, but adversarial collapses 83.4% → 54.3% (-29.1pp) when the reader is forced to commit on every question. LOCOMO is 22.5% adversarial by case count, so the prompt change net-regresses aggregate.

§4.1 of the prior handoff predicted "+10-15pp aggregate" from this tuning. Actual: -2.6pp. The mechanism explanation (prompt-induced refusal suppression on adversarial) was wrong as published in the bugged version. The corrected mechanism is real and matches a priori theory.

## 2. Methodology invariants

Unchanged from Stage F-1 and Phase B shipping numbers:

- **Reader:** `gpt-4o` via OpenAI. Temperature 0. Max 256 answer tokens.
- **Retriever:** HybridRetriever (BM25 + dense RRF + Cohere rerank-v3.5). `--hybrid-retrieval --rerank cohere`.
- **Judge:** `gpt-4o-2024-08-06`. Rubric version `2026-04-18.1`. System prompt empty.
- **Bootstrap:** 10,000 resamples via Mulberry32 PRNG, seed=42. 95% percentile CIs.
- **Dataset:** `data/locomo10.json` — 10 conversations, 1986 QA pairs, 5 categories.

Configurations tested (after the `noAbstention` resolveRunConfig fix shipped):
- Stage F-1: K=10 default, v9 abstention prompt — the OOD baseline.
- Stage F-2 corrected: `--reader-top-k 20 --no-abstention` — both knobs truly applied.
- Stage F-3 Run A: `--reader-top-k 20` alone — isolated retrieval effect (cache-hit from the pre-fix corrupt Stage F-2, which was silently the same configuration).
- Stage F-3 Run B: `--no-abstention` alone at K=10 default — isolated prompt effect.

## 3. Implementation (what shipped, post-correction)

The Stage F-2 implementation has the original feature changes plus a one-line correction in `resolveRunConfig`:

- `src/core/IBenchmark.ts` — `RunConfig.noAbstention?: boolean` + `OPTIONAL_RUN_CONFIG_KEYS` entry, **and `export const` so the contract test can drive itself off the canonical list**.
- `src/core/BenchmarkRunner.ts` — `noAbstention: cfg.noAbstention,` line added to `resolveRunConfig` (the missing line that caused the original publication bug). Conditional fingerprint `stage-f2-no-abstention:v1` was already correct; it just never fired before because `config.noAbstention` was always undefined.
- `src/cli.ts` — `--no-abstention` flag (commander negation pattern).
- `src/benchmarks/longmemeval/LongMemEvalS.ts` — three prompt builders (`buildFullCognitivePrompt`, `buildBaseMemoryPrompt`, `buildNoMemorySystemPrompt`) accept an `options?: { noAbstention?: boolean }` parameter and swap the v9 abstention lines for a commit directive when set.
- `src/benchmarks/locomo/Locomo.ts` — same treatment for LOCOMO's two adapter-local prompt builders.
- `tests/step15ObservationalMemory.wiring.spec.ts` — three fingerprint-presence/absence tests (these passed even when the bug existed because they bypass `resolveRunConfig`).
- **`tests/resolveRunConfigContract.spec.ts` (NEW)** — contract test driven by `OPTIONAL_RUN_CONFIG_KEYS`. For every key, asserts `resolveRunConfig` propagates a sample value. Catches the class of bug that allowed the original mis-publication.

Build + targeted tests: `pnpm build` clean; 513/513 tests pass (was 458 before the contract test).

Prompt text substituted when `noAbstention=true`:

| Path | v9 / default | Stage F-2 no-abstention |
|---|---|---|
| full-cognitive | "When you abstain (no excerpt contains relevant information), write the answer as: 'Answer: I don't know — the excerpts do not mention <topic>'..." + "If the evidence is partial or indirect, give your best single answer..." | "Every question in this benchmark has an answer supported by the retrieved excerpts below. You must commit to a specific answer drawn from the excerpts. Do NOT respond 'I don't know' and do NOT abstain. If multiple excerpts partially address the question, synthesize the most likely answer. If evidence is sparse, pick the closest-matching excerpt and extract your best inference from it." |
| base-memory (both adapters) | "Only say 'I don't know' when no excerpt is relevant to the question at all." | "Every question has an answer supported by the excerpts. Never respond 'I don't know' — commit to your best-effort answer drawn from the closest-matching excerpt." |
| no-memory (both adapters) | "Be concise. If ... does not contain the answer, say 'I don't know'." | "Be concise. Every question has an answer ... commit to your best-effort answer and never say 'I don't know'." |

## 4. Phase B results (N=1986)

### 4.1 Aggregate

| Run | Accuracy | 95% CI | Cost | $/correct | Avg latency | Δ vs F-1 |
|---|---:|---|---:|---:|---:|---:|
| Stage F-1 baseline (K=10, v9 abstention) | 49.9% | [47.7%, 52.1%] | $12.17 | $0.0123 | 2.58s | — |
| Stage F-3 Run A: K=20 alone (v9 abstention) | **51.5%** | [49.2%, 53.7%] | $10.13 | $0.0099 | 1.45s | **+1.6pp** |
| Stage F-3 Run B: `--no-abstention` alone, K=10 default | 42.1% | [40.0%, 44.3%] | $6.83 | $0.0082 | 1.19s | **−7.8pp** |
| Stage F-2 corrected: K=20 + `--no-abstention` | 47.3% | [45.2%, 49.5%] | $10.02 | $0.0107 | 1.20s | −2.6pp |

### 4.2 Per-category

| Category | n | F-1 baseline | K=20 alone | --no-absention K=10 | K=20 + --no-abstention |
|---|---:|---:|---:|---:|---:|
| single-hop | 282 | 20.6% | 23.4% (+2.8) | 19.5% (−1.1) | 22.3% (+1.7) |
| multi-hop | 321 | 39.6% | 37.7% (−1.9) | 37.4% (−2.2) | 41.1% (+1.5) |
| temporal | 96 | 27.1% | 28.1% (+1.0) | **34.4% (+7.3)** | **40.6% (+13.5)** |
| open-domain | 841 | 48.5% | 51.7% (+3.2) | 44.8% (−3.7) | **55.2% (+6.7)** |
| adversarial | 446 | 83.4% | 83.6% (+0.2) | **56.5% (−26.9)** | **54.3% (−29.1)** |
| **Aggregate** | **1986** | **49.9%** | **51.5%** | **42.1%** | **47.3%** |

### 4.3 Knob decomposition

Per-knob marginal effects (relative to Stage F-1 baseline) and interaction:

- **K=10 → K=20 (retrieval only):** +1.6pp aggregate. Helps single-hop (+2.8) and open-domain (+3.2). Negligible on adversarial.
- **v9 abstention → `--no-abstention` (prompt only at K=10):** −7.8pp aggregate. Helps temporal (+7.3pp) and (only) temporal — every other non-adversarial category goes flat or negative because the commit directive is general but the test cases at default K don't have enough evidence to commit confidently. Adversarial collapses (−26.9pp) by construction.
- **v9 abstention → `--no-abstention` (prompt only at K=20):** −4.2pp aggregate. K=20 amplifies the temporal gain (+12.5pp delta-of-delta) and converts the open-domain regression to a meaningful gain (+3.5pp delta-of-delta), because more retrieved candidates give the reader enough material to commit honestly. Adversarial damage stays roughly constant (-29.3pp).
- **Combined (K=20 + `--no-abstention`):** −2.6pp aggregate. Sum-of-parts (linear): -7.8 + 1.6 = -6.2pp. Measured: -2.6pp. **+3.6pp positive interaction**: K=20 is non-trivially complementary with the prompt change for non-adversarial categories.

## 5. Interpretation

### 5.1 The corrected mechanism

The pre-fix corrupt finding claimed `--no-abstention` "doesn't monotonically suppress refusal — adversarial stays at 83.6%." That claim was based on a run where the flag was silently dropped, so adversarial of course stayed identical. The corrected finding refutes it cleanly:

- `--no-abstention` at K=20: adversarial drops 83.4% → 54.3% (−29.1pp).
- `--no-abstention` at K=10: adversarial drops 83.4% → 56.5% (−26.9pp).

When the prompt directive actually reaches the reader, adversarial DOES collapse, exactly as a priori reasoning predicted: telling a reader "every question has an answer; never say I don't know" forces wrong commits when the gold answer is genuinely "refuse." The corrupt mechanism story was a corrupt-data artifact.

### 5.2 The Pareto-best LOCOMO tuning is K=20 alone

51.5% [49.2%, 53.7%] at $0.0099/correct, 1.45s avg latency. +1.6pp aggregate vs OOD baseline; CIs overlap, but cost-per-correct is 20% lower and latency is 44% lower. We retract the previously-published claim that "K=20 + `--no-abstention` is the tuned configuration": that combination is a regression on aggregate, despite winning on temporal and open-domain at the per-category level.

If a workload is dominated by temporal and/or open-domain Q's and contains NO adversarial Q's, `--no-abstention` could still be net-positive — the per-category measurements support that. But on LOCOMO's distribution (22.5% adversarial), the flag is net-negative.

### 5.3 Updated Mem0 gap analysis

Mem0 claims 66-68% on LOCOMO. Our best LOCOMO number after this session is 51.5% (K=20 alone). Remaining gap: 14.5–16.5pp.

Components ruled out by this session:

- **Judge permissiveness on our side: ruled out at 0pp.** Stage G-LOCOMO measured 0% [0%, 0%] FPR at n=100 on our gpt-4o judge + rubricVersion 2026-04-18.1.
- **Abstention prompt calibration: ruled out as a positive lever.** The `--no-abstention` flag is a category-specific trade-off, not a Pareto improvement on LOCOMO's distribution.

Components still unknown:

- **Mem0's judge configuration.** Penfield Labs measured 62.81% FPR on LOCOMO's default `gpt-4o-mini` judge. If Mem0 used the default judge, up to 30-60% of their 66-68% headline could be judge-accepted-wrong-answers.
- **Retrieval architecture for dense LOCOMO histories.** Our HybridRetriever was tuned for LongMemEval-S's 50-session sparser haystacks. LOCOMO's 199-260-turn dense histories likely benefit from a different retrieval strategy (graph-based, fact-network, conversation-adaptive K). This is the genuine architectural work.
- **Tuning depth.** Mem0 likely tuned more knobs than two. Our two-knob tuning landed at +1.6pp; a deeper tuning sweep might extract more.

Without a cross-harness Mem0 replication, we can't decompose the remaining gap. The 51.5% K=20-alone row stays as the published tuned LOCOMO number, with the OOD baseline as the no-tuning reference.

## 6. Command to reproduce (corrected)

```bash
set -a && source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env && set +a
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm build

# Pareto-best tuning (K=20 alone):
node dist/cli.js run locomo \
  --reader gpt-4o --memory full-cognitive --replay ingest \
  --reader-top-k 20 \
  --hybrid-retrieval --rerank cohere --concurrency 10 --seed 42

# Full ablation (replicate the per-knob decomposition above):
node dist/cli.js run locomo --reader gpt-4o --memory full-cognitive --replay ingest \
  --reader-top-k 20 --no-abstention \
  --hybrid-retrieval --rerank cohere --concurrency 10 --seed 42
node dist/cli.js run locomo --reader gpt-4o --memory full-cognitive --replay ingest \
  --no-abstention \
  --hybrid-retrieval --rerank cohere --concurrency 10 --seed 42
```

Run JSONs:
- Stage F-1 baseline: `results/runs/2026-04-24T18-42-51-243--locomo--gpt-4o--full-cognitive--ingest.json`
- Stage F-3 Run A (K=20 alone): `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json`
- Stage F-2 corrected: `results/runs/2026-04-24T22-05-01-855--locomo--gpt-4o--full-cognitive--ingest.json`
- Stage F-3 Run B (`--no-abstention` K=10): `results/runs/2026-04-24T22-10-48-759--locomo--gpt-4o--full-cognitive--ingest.json`
- Pre-fix corrupt Stage F-2 (kept in git for transparency): `results/runs/2026-04-24T21-17-04-526--locomo--gpt-4o--full-cognitive--ingest.json`

## 7. Follow-up experiments

Updated ranking after the correction:

1. **Stage G-LongMemEval-M** ($0.05): port the judge-FPR probe to the M variant. Cheap; if FPR stays low, our rubric is robust across LongMemEval distribution shifts.
2. **Retrieval architecture for LOCOMO dense histories** (unbounded, requires spec): graph-based retrieval, fact-network routing, or conversation-adaptive K. The remaining 14.5pp gap to Mem0 is plausibly architectural since judge-permissiveness is ruled out on our side and prompt-tuning was net-negative.
3. **Cross-harness Mem0 replication**: only way to isolate Mem0-judge-permissiveness from Mem0-real-architecture in the remaining gap. Requires implementing AgentOS in Mem0's bench (or vice versa). External-team scope.
4. **BEAM Phase A** (~4-8h adapter + ~$100): with `--no-abstention` available as a portable flag (now actually applied), BEAM becomes a cheaper data point.

## 8. Honesty statement

The first publication of this finding stated that Stage F-2 tuned LOCOMO to 51.5% [49.2%, 53.7%] (+1.6pp vs OOD) and claimed adversarial accuracy did not collapse under `--no-abstention`. Both claims were wrong: the 51.5% was K=20 alone (the `--no-abstention` flag was silently dropped at runtime), and adversarial accuracy DOES collapse when the flag is actually applied. Bug story: [STAGE_F2_CORRECTION_2026-04-24.md](STAGE_F2_CORRECTION_2026-04-24.md).

We caught the bug ourselves within ~30 minutes by running the next-experiment ablation (Stage F-3) and noticing that Run A's results were byte-identical to the published Stage F-2 numbers. The fix was one line of code; the test that prevents recurrence (`tests/resolveRunConfigContract.spec.ts`) is a parameterized contract test driven by `OPTIONAL_RUN_CONFIG_KEYS` so any future flag added without updating `resolveRunConfig` fails CI immediately.

The git history preserves the original buggy commit + the correction commit, and the leaderboard preserves both rows (the K=20-alone number that was previously mis-labeled, plus the K=20 + `--no-abstention` corrected regression). This is the same transparency standard we ask other vendors to meet — caught our own number, documented the failure mode, fixed it on the same day, kept the artifacts.
