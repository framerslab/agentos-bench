# Stage F-2 Correction — `--no-abstention` Flag Was Silently Dropped (2026-04-24)

**Severity:** Stage F-2's published 51.5% LOCOMO "tuned" number was actually `--reader-top-k 20` alone (the `--no-abstention` flag was dropped at runtime). Re-run with the fix produced **47.3% [45.2%, 49.5%]** at $0.0107/correct — the prompt change actually HURT aggregate by 4.2pp because LOCOMO adversarial accuracy collapsed 83.6% → 54.3% (-29.3pp) when the reader was actually told to commit on every question.

**Affected publications:** [STAGE_F2_LOCOMO_ABSTENTION_TUNING_2026-04-24.md](STAGE_F2_LOCOMO_ABSTENTION_TUNING_2026-04-24.md), the LOCOMO tuned row in [LEADERBOARD.md](../results/LEADERBOARD.md), and the Stage F-2 subsection in [blog/2026-04-24-memory-benchmark-transparency-audit.md](../../../apps/agentos-live-docs/blog/2026-04-24-memory-benchmark-transparency-audit.md). All three were committed and pushed before the bug was caught.

**Affected metrics scope:** ONLY Stage F-2 LOCOMO tuned 51.5%. Audit confirmed every other published number is unaffected — see §3 below.

## 1. The bug

`resolveRunConfig` in `src/core/BenchmarkRunner.ts` converts a CLI-built `RunConfig` into the runtime `BenchContext['config']` via an explicit field-by-field copy. When the Stage F-2 `--no-abstention` flag was added, three places needed to be updated:

1. The `RunConfig` interface (in `src/core/IBenchmark.ts`) — done.
2. The `OPTIONAL_RUN_CONFIG_KEYS` tuple (in `src/core/IBenchmark.ts`) — done.
3. The explicit copy line `noAbstention: cfg.noAbstention,` in `resolveRunConfig` — **missed.**

TypeScript could not catch this. The compile-time guard at `IBenchmark.ts:786` only verifies that every key in `OPTIONAL_RUN_CONFIG_KEYS` exists on `RunConfig` — it does NOT verify that `resolveRunConfig` propagates each one. The fingerprint unit tests added with Stage F-2 (`tests/step15ObservationalMemory.wiring.spec.ts`) called `computeCaseRunKeyParts` directly with a hand-built config that had `noAbstention: true` set — they bypassed `resolveRunConfig` entirely.

Runtime consequences:

- `ctx.config.noAbstention` was always `undefined` regardless of the CLI flag.
- The fingerprint conditional `if (config.noAbstention)` in `computeCaseRunKeyParts` never appended `stage-f2-no-abstention:v1`. So Stage F-2 stored its case-results under the SAME cache key as a K=20-only run. A subsequent K=20-only run (Stage F-3 Run A, the first run that exposed the bug) hit Stage F-2's cache and returned identical answers.
- The five prompt-builder branches in `LongMemEvalS.ts` and `Locomo.ts` reading `options?.noAbstention` from `ctx.config.noAbstention` always saw `undefined`, so the v9 abstention prompt was used instead of the commit directive.

The Stage F-2 run we published as "K=20 + `--no-abstention` tuned" was actually "K=20 alone with v9 abstention." The `--no-abstention` flag had zero effect.

## 2. How the bug was caught

Stage F-3 ablation (queued the next experiment after Stage F-2 in the handoff §4.1) launched two LOCOMO runs:

- Run A: `--reader-top-k 20` only (no `--no-abstention`)
- Run B: `--no-abstention` only (K=10 default)

Run A finished in seconds with `totalUsd=$0` (full cache hit) and accuracy 51.5% — bit-for-bit identical to Stage F-2's published number. That was the smoking gun: with a different config, you should get either fresh API calls (cache miss) or a different answer (cache key collision implies same runtime). The first case JSON's `actualOutput` matched Stage F-2's `actualOutput` byte-for-byte — confirming the cache key collision and the silent flag drop.

The fix and the audit took ~10 minutes total: write a contract test driven by `OPTIONAL_RUN_CONFIG_KEYS`, watch it fail on `noAbstention` only, add the missing copy line, watch it pass.

## 3. Audit: which OTHER metrics are affected

Same class of bug (field present in `RunConfig` + `OPTIONAL_RUN_CONFIG_KEYS` but missing from `resolveRunConfig`):

We ran the contract test against every key in `OPTIONAL_RUN_CONFIG_KEYS` (54 fields). Result: **only `noAbstention` was missing**. Every other field round-trips correctly through `resolveRunConfig`.

We additionally audited every shipping-or-cited run JSON for the presence of `noAbstention=true` in the run's `config` field:

| Run JSON | noAbstention | Status |
|---|---|---|
| LongMemEval-S Tier 1 / 2a / 2b / 3 (Phase B N=500) | unset | safe |
| LOCOMO Tier 1 OOD (Stage F-1 N=1986) | unset | safe |
| Stage A hold-out aggregations | n/a (post-hoc, no runtime config) | safe |
| Stage B `gpt-4o` observer | unset | safe |
| Stage C session-level NDCG (k=3/5/10) | unset | safe |
| Stage F-1 LOCOMO OOD | unset | safe |
| **Stage F-2 LOCOMO tuned (N=1986, T21-17-04-526)** | **set, but silently dropped** | **CORRUPT — replaced by re-run** |
| Stage F-2 smoke (N=15, T21-16-13-539) | set, dropped | corrupt; was wiring-only anyway |
| Stage G LongMemEval-S judge FPR probe | n/a (standalone script, no resolveRunConfig) | safe |
| Stage G-LOCOMO judge FPR probe | n/a (standalone script) | safe |

**Net affected:** Stage F-2 LOCOMO tuned 51.5% only. All other published numbers stand.

## 4. The corrected Stage F-2 result

Re-run with the fix in place at the same N=1986, seed=42, gpt-4o reader, gpt-4o-2024-08-06 judge, rubricVersion 2026-04-18.1.

| Run | Accuracy | 95% CI | Cost | $/correct | Avg latency |
|---|---:|---|---:|---:|---:|
| Stage F-1 baseline (K=10, v9 abstention) | 49.9% | [47.7%, 52.1%] | $12.17 | $0.0123 | 2.58s |
| **Stage F-2 CORRECTED (K=20 + `--no-abstention` truly applied)** | **47.3%** | **[45.2%, 49.5%]** | **$10.02** | **$0.0107** | **1.20s** |
| Δ vs F-1 baseline | **−2.6pp (CIs overlap on the boundary)** | | −$2.15 | −$0.0016 | −1.38s |

Per-category deltas:

| Category | n | Stage F-1 | Stage F-2 corrected | Δ vs F-1 | Stage F-2 corrected CI |
|---|---:|---:|---:|---:|---|
| single-hop | 282 | 20.6% | 22.3% | +1.7pp | [17.4%, 27.3%] |
| multi-hop | 321 | 39.6% | 41.1% | +1.5pp | [35.8%, 46.4%] |
| temporal | 96 | 27.1% | 40.6% | **+13.5pp** | [31.3%, 51.0%] |
| open-domain | 841 | 48.5% | 55.2% | **+6.7pp** | [51.7%, 58.5%] |
| adversarial | 446 | 83.4% | 54.3% | **−29.1pp** | [49.6%, 59.0%] |
| **Aggregate** | **1986** | **49.9%** | **47.3%** | **−2.6pp** | **[45.2%, 49.5%]** |

The headline finding: when `--no-abstention` is actually applied, **adversarial accuracy collapses from 83.4% to 54.3%** because the reader is told to commit on every question regardless of evidence. Temporal (+13.5pp) and open-domain (+6.7pp) gain meaningfully — the prompt directive does help on categories where the answer IS in the excerpts. But adversarial is 22.5% of LOCOMO cases (446 of 1986), so the −29pp adversarial drop more than wipes out the temporal/open-domain gains in the aggregate.

This is the OPPOSITE of what the corrupt Stage F-2 result implied (where adversarial stayed at 83.6% because the flag was silently dropped, masking the true prompt effect).

Stage F-3 ablation results:

| Ablation arm | n | Accuracy | 95% CI | $/correct | Notes |
|---|---:|---:|---|---:|---|
| K=10 baseline (Stage F-1 baseline) | 1986 | 49.9% | [47.7%, 52.1%] | $0.0123 | v9 abstention, default K |
| K=20 alone (v9 abstention) | 1986 | **51.5%** | [49.2%, 53.7%] | $0.0099 | Pareto-best tuned config; the number we previously published as "Stage F-2 tuned" |
| `--no-abstention` alone (K=10 default) | 1986 | **42.1%** | [40.0%, 44.3%] | $0.0082 | Prompt change in isolation: aggregate REGRESSES by −7.8pp vs baseline |
| K=20 + `--no-abstention` (Stage F-2 corrected) | 1986 | **47.3%** | [45.2%, 49.5%] | $0.0107 | Both knobs; K=20 partially mitigates the prompt damage |

Per-category for the prompt-only ablation (`--no-abstention` at K=10) tells the cleanest story:

| Category | n | Stage F-1 (v9 abstention) | Stage F-3 Run B (--no-abstention only) | Δ |
|---|---:|---:|---:|---:|
| single-hop | 282 | 20.6% | 19.5% | −1.1pp |
| multi-hop | 321 | 39.6% | 37.4% | −2.2pp |
| temporal | 96 | 27.1% | 34.4% | **+7.3pp** |
| open-domain | 841 | 48.5% | 44.8% | −3.7pp |
| adversarial | 446 | 83.4% | 56.5% | **−26.9pp** |
| **Aggregate** | **1986** | **49.9%** | **42.1%** | **−7.8pp** |

Decomposition (relative to Stage F-1 baseline):

- K=10 → K=20 (retrieval bump only): **+1.6pp aggregate** (single-hop +2.8pp, open-domain +3.2pp).
- v9 abstention → `--no-abstention` (prompt only at K=10): **−7.8pp aggregate** (adversarial collapse −26.9pp dominates; temporal +7.3pp is the only category that gains).
- v9 abstention → `--no-abstention` (prompt only at K=20): **−4.2pp aggregate** (adversarial collapse −29.3pp; temporal +12.5pp gains more at the wider K).
- Combined (K=20 + `--no-abstention`, the actual published config): **−2.6pp aggregate**.

The two knobs are NOT linearly additive: the prompt-only ablation predicts -7.8pp + the retrieval-only ablation predicts +1.6pp = -6.2pp linear estimate, vs measured -2.6pp combined. The +3.6pp interaction term is K=20 amplifying the benefit of `--no-abstention` on temporal (+5.2pp delta-of-delta) and open-domain (+7.2pp delta-of-delta) while leaving the adversarial damage roughly constant.

**The Pareto-optimal LOCOMO tuning for AGGREGATE accuracy is K=20 alone**, not the combined config. The `--no-abstention` flag is a category-specific tradeoff: it helps temporal and (at K=20) open-domain meaningfully, while devastating adversarial. For workloads dominated by single-category Q types where the answer is guaranteed in evidence (and there are NO adversarial Q's), `--no-abstention` could be net-positive. For LOCOMO-distributed workloads (22.5% adversarial), it is net-negative.

## 5. Why this incident matters

The bug is exactly the failure mode the blog [criticizes other vendors for](../../../apps/agentos-live-docs/blog/2026-04-24-memory-benchmark-transparency-audit.md): a number was published with a configuration that didn't actually run. We caught it ourselves through the next experiment's ablation, fixed it with TDD (failing contract test → minimal fix → green), and re-ran with the corrected pipeline. The git history shows the original buggy commit + the correction commit explicitly. No retraction request from a third party — we found this in our own data within minutes.

The fix is one line of code (`noAbstention: cfg.noAbstention,` added to `resolveRunConfig`). The harder fix is the test that prevents recurrence: `tests/resolveRunConfigContract.spec.ts` is a contract test that asserts every key in `OPTIONAL_RUN_CONFIG_KEYS` round-trips through `resolveRunConfig`. Adding a new flag without updating the explicit copy line now fails CI immediately.

## 6. Methodology improvement

This bug class survived because:

1. The TS type system can prove `OPTIONAL_RUN_CONFIG_KEYS` is a subset of `keyof RunConfig`, but it cannot prove `resolveRunConfig`'s explicit-field copy covers every key.
2. The fingerprint unit tests passed because they bypassed `resolveRunConfig`.

Long-term remediation options considered:

- **(A) Refactor `resolveRunConfig` to spread instead of explicit copy.** `return { ...cfg, concurrency: cfg.concurrency ?? 3, ... }` would make every field on `RunConfig` automatically propagate. Would invalidate ALL prior cache entries (every default-set field would now have a different fingerprint). Rejected for blast radius.
- **(B) Contract test driven by `OPTIONAL_RUN_CONFIG_KEYS`.** Cheap, surgical, no cache invalidation. **Picked. Shipped as `tests/resolveRunConfigContract.spec.ts`.**
- **(C) Codegen `resolveRunConfig` from `OPTIONAL_RUN_CONFIG_KEYS`.** Tooling overhead exceeds the value at this codebase's size. Deferred.

The contract test in option B is the bare minimum that makes this class of bug impossible going forward. If a new optional flag is added without updating `resolveRunConfig`, the test fails with a message naming the missing field. CI catches it before merge.

## 7. Reproduce the corrected run

```bash
set -a && source /Users/johnn/Documents/git/voice-chat-assistant/apps/wilds-ai/.env && set +a
cd /Users/johnn/Documents/git/voice-chat-assistant/packages/agentos-bench
pnpm build
node dist/cli.js run locomo \
  --reader gpt-4o --memory full-cognitive --replay ingest \
  --reader-top-k 20 --no-abstention \
  --hybrid-retrieval --rerank cohere --concurrency 10 --seed 42
```

Cache fingerprint applied (now actually): `topk:20 + stage-f2-no-abstention:v1`. The run misses any pre-fix cache (which used `topk:20` alone) and freshly executes all 1986 cases with the commit-directive prompt.

Run JSONs:
- Stage F-2 corrected: `results/runs/2026-04-24T22-05-01-855--locomo--gpt-4o--full-cognitive--ingest.json`
- Stage F-3 Run A (K=20 alone): `results/runs/2026-04-24T22-10-47-514--locomo--gpt-4o--full-cognitive--ingest.json` (cache-hit JSON; identical answers to the pre-fix corrupt Stage F-2 because that run was actually K=20 alone in disguise)
- Stage F-3 Run B (`--no-abstention` K=10 alone): `results/runs/2026-04-24T22-10-48-759--locomo--gpt-4o--full-cognitive--ingest.json`
- Pre-fix corrupt Stage F-2 (kept in git for transparency): `results/runs/2026-04-24T21-17-04-526--locomo--gpt-4o--full-cognitive--ingest.json`
