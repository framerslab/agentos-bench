# Bootstrap CIs + Judge-Adversarial Probe

## What this is

Two small pieces of benchmark infrastructure that together let us say things like `"85.3% [79.7%, 90.6%]" @ judge-FPR 28% [17%, 41%]` instead of an unqualified `85.3%`. The first number is an accuracy point estimate with its 95 percent bootstrap CI; the second is a measurement of how often our judge accepts topically-adjacent wrong answers as correct.

Both are mandatory before any subsequent RAG/memory step can declare a win at smoke-scale samples.

## Why this exists

Two published findings motivate this:

1. **Penfield Labs LoCoMo audit (April 2026)** — [dev.to writeup](https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg) + [audit repo](https://github.com/dial481/locomo-audit). Found 6.4 percent of LoCoMo's answer key is wrong and that the default judge (gpt-4o-mini) accepts 62.81 percent of intentionally-wrong-but-topically-adjacent answers. Our reported accuracy numbers live against this noise floor. An `85% vs 87%` comparison across systems is inside judge noise and not interpretable without probing the judge directly.

2. **Spark-LLM-Eval (arxiv 2603.28769, Jan 2026) + NIST Feb 2026 statistical-evaluation toolbox report** — both push the field toward bootstrap confidence intervals and paired significance tests instead of point estimates. The framework Spark-LLM-Eval ships (`Reporting that 'Model A achieves 73.2% accuracy' tells us little without confidence intervals`) is the ergonomic target we match here.

## The two tools

### `computeBootstrapCI`

Generic percentile-bootstrap CI over any scalar statistic:

```ts
const r = computeBootstrapCI(
  cases.map((c) => (c.passed ? 1 : 0)),
  (s) => s.reduce((a, b) => a + b, 0) / s.length,
  { seed: 42, resamples: 10_000, ci: 0.95 },
);
// => { value: 0.853, ciLo: 0.775, ciHi: 0.922, resamples: 10000, ci: 0.95 }
```

Seedable PRNG (Mulberry32) for determinism. Percentile method over BCa because our accuracy metrics live in [0, 1] and we rarely touch the 0/1 boundaries where BCa correction matters most.

**Cost:** pure CPU. N=200 cases × 10,000 resamples × O(N) statistic ≈ 2M statistic evaluations, under 2 seconds.

### `computeJudgeAdversarialRate`

For each case, synthesize a topically-adjacent wrong answer with a cheap LLM (gpt-5-mini by default), score it with the SAME judge configuration that scored the real answer, and report the fraction accepted as the judge's false-positive rate.

**Cost:** one synth call (~$0.001 at gpt-5-mini) plus one judge call per probed case, capped by `maxProbes` (default 50). Warm cache drops synth cost to zero.

**Separation of concerns:** synth distractors are cached under `data/.judge-adversarial-cache/<sha256>.json` keyed by (caseId, question, goldAnswer, caseType, synthVersion). Judge verdicts are cached via the bench's existing judge cache (namespace `judge`, keyed on rubricVersion). Neither contributes to `computeCaseRunKeyParts` — the probe's outputs do not affect real-answer cache hits.

## When to use

- **Bootstrap CIs: always.** Zero cost, runs on every benchmark aggregate.
- **Judge-adversarial probe: when shipping step-level claims.** The probe is opt-in behind `--judge-adversarial` because it adds real cost (~$0.10 at the default cap). Use it when reporting a new accept gate, when writing findings docs, or when drafting the blog post.

## How results enter `BenchResult`

All four fields are additive optionals so legacy run JSONs keep rendering:

- `accuracyCI: BootstrapResult` — CI over unweighted accuracy.
- `weightedAccuracyCI?: BootstrapResult` — CI over stratified weighted accuracy (when `stratifiedAccuracy` is present).
- `byTypeCI?: Record<string, BootstrapResult>` — CI per case type.
- `judgeAdversarialFPR?: AdversarialRateOutput` — probe result with overall rate + per-type breakdown.

## Retroactive computation

`node packages/agentos-bench/dist/cli.js sweep-report --recompute-ci --results-dir packages/agentos-bench/results` walks every `results/runs/*.json` and layers bootstrap CIs over its stored `cases` array. No API calls; the per-case scores are already in the file.

Useful whenever a new resample count, new seed, or backfill of pre-Step-1 run JSONs is needed. Idempotent: running twice with the same seed produces identical output.

## Integration into the umbrella framework

This infrastructure is Step 1 of the sequenced RAG stack rollout. Every subsequent step (2 through 6) gates its GREEN / YELLOW / RED accept decision against bootstrap CIs: a step's primary-metric improvement must exceed 2pp AND the lower bound of its new-value CI must exceed the upper bound of the baseline's CI. See [`2026-04-19-rag-stack-sequenced-rollout.md`](../../../agentos/docs/superpowers/specs/2026-04-19-rag-stack-sequenced-rollout.md) §3.3 for the full rule.

## References

- Penfield Labs LoCoMo audit: https://dev.to/penfieldlabs/we-audited-locomo-64-of-the-answer-key-is-wrong-and-the-judge-accepts-up-to-63-of-intentionally-33lg
- LoCoMo audit repo: https://github.com/dial481/locomo-audit
- Spark-LLM-Eval (Jan 2026): https://arxiv.org/abs/2603.28769
- NIST Feb 2026 statistical-evaluation-toolbox report: https://www.nist.gov/news-events/news/2026/02/new-report-expanding-ai-evaluation-toolbox-statistical-models
- Label errors in 10 major ML benchmarks (2021): https://arxiv.org/abs/2103.14749
- Bootstrap (Efron and Tibshirani, 1994): canonical text on percentile and BCa methods.

## Related

- `packages/agentos-bench/docs/RESEARCH_FOLLOWUP_2026-04-19.md` — the research sweep that surfaced the Penfield audit, Spark-LLM-Eval, and NIST sources.
- `packages/agentos/docs/superpowers/specs/2026-04-19-rag-stack-sequenced-rollout.md` — umbrella framework specifying the accept rule this infrastructure enables.
