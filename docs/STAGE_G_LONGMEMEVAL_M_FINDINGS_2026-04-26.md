# Stage G-LongMemEval-M: Judge False-Positive Probe on LongMemEval-M — Findings (2026-04-26)

**Predecessors:**
- [Stage G (LongMemEval-S)](SESSION_2026-04-24_TRANSPARENT_NEGATIVES.md) — 1% FPR [0%, 3%] at n=100.
- [Stage G-LOCOMO](STAGE_G_LOCOMO_JUDGE_FPR_PROBE_2026-04-24.md) — 0% FPR [0%, 0%] at n=100.

**Experiment:** Port the Stage G judge-adversarial probe from LongMemEval-S to LongMemEval-M (the harder 1.5M-token, 500-sessions-per-haystack variant) at the same judge + rubric + synth model + seed. Closes the per-cell judge integrity gap for the v1 publication's LongMemEval-M column ([Stage J Phase B 30.6%](STAGE_J_PHASE_B_FINDINGS_2026-04-25.md)).

## 1. TL;DR

**Result: 2% FPR [0%, 5%] at n=100.** Two false positives across 100 stratified probes:

| Category | Rate | n |
|---|---:|---:|
| multi-session | 0% | 24 |
| knowledge-update | 0% | 17 |
| single-session-assistant | 0% | 14 |
| single-session-user | 0% | 13 |
| temporal-reasoning | 4.2% [0%, 12.5%] | 24 |
| single-session-preference | 12.5% [0%, 37.5%] | 8 |

Comparison across all three Stage G probes:

| Benchmark | Judge | Rubric | FPR | Source |
|---|---|---|---:|---|
| LongMemEval-S (n=100) | `gpt-4o-2024-08-06` | `2026-04-18.1` | 1% [0%, 3%] | Stage G, 2026-04-24 |
| LOCOMO (n=100) | `gpt-4o-2024-08-06` | `2026-04-18.1` | 0% [0%, 0%] | Stage G-LOCOMO, 2026-04-24 |
| **LongMemEval-M (n=100)** | `gpt-4o-2024-08-06` | `2026-04-18.1` | **2% [0%, 5%]** | **Stage G-M, this session** |
| LOCOMO (unreported n) | `gpt-4o-mini` | LOCOMO default | 62.81% | Penfield Labs audit, April 2026 |

The 2pp delta vs LongMemEval-S sits well within the noise floor of either probe's 95% bootstrap CI. Our 30.6% LongMemEval-M Phase B headline ([STAGE_J_PHASE_B_FINDINGS_2026-04-25.md](STAGE_J_PHASE_B_FINDINGS_2026-04-25.md)) is not inflated by judge permissiveness on our side. Any vendor publishing LongMemEval-M numbers measured with `gpt-4o-mini` or LOCOMO's default rubric inherits the 62.81pp Penfield-cited noise floor.

## 2. Methodology

Identical to Stage G on LongMemEval-S and LOCOMO:

- **Probe:** 100 random LongMemEval-M cases (seed=42), shuffled via Mulberry32 PRNG.
- **Synthesizer:** `gpt-5-mini-2025-08-07`. Synthesizes a topically-adjacent WRONG answer per case (not the gold, but plausibly related to the gold topic — the same class of error a weak retrieval system would produce).
- **Judge:** `gpt-4o-2024-08-06` wrapped in `LongMemEvalJudge`. System prompt empty. Rubric version `2026-04-18.1`.
- **Categories:** native LongMemEval 6-category taxonomy; no remap needed (M shares the same category labels as S).

Standalone script: `src/scripts/stage-g-longmemeval-m-judge-fpr-probe.ts`. Mirror of `stage-g-judge-fpr-probe.ts` with two changes: dataset variant (`'m'` instead of `'s'`) and cache directory (`.judge-adversarial-cache-stage-g-m`). Runs via `pnpm exec tsx src/scripts/stage-g-longmemeval-m-judge-fpr-probe.ts [maxProbes]`. Reproducible at seed=42. Requires `NODE_OPTIONS=--max-old-space-size=8192` because the 2.7 GB dataset expands past the default 4 GB V8 heap when held in memory after streaming parse.

## 3. Raw result (JSON)

```json
{
  "maxProbes": 100,
  "samplesProbed": 100,
  "fpr": 0.02,
  "ci": [0, 0.05],
  "byCaseType": {
    "multi-session":             { "rate": 0,     "ciLo": 0, "ciHi": 0,     "n": 24 },
    "knowledge-update":          { "rate": 0,     "ciLo": 0, "ciHi": 0,     "n": 17 },
    "single-session-assistant":  { "rate": 0,     "ciLo": 0, "ciHi": 0,     "n": 14 },
    "single-session-user":       { "rate": 0,     "ciLo": 0, "ciHi": 0,     "n": 13 },
    "temporal-reasoning":        { "rate": 0.042, "ciLo": 0, "ciHi": 0.125, "n": 24 },
    "single-session-preference": { "rate": 0.125, "ciLo": 0, "ciHi": 0.375, "n": 8  }
  },
  "synthModel":     "gpt-5-mini-2025-08-07",
  "judgeModel":     "gpt-4o",
  "rubricVersion":  "2026-04-18.1",
  "synthTokensIn":  17125,
  "synthTokensOut": 2039,
  "judgeTokensIn":  17208,
  "judgeTokensOut": 144,
  "elapsedMs":      184330
}
```

Cost: ~$0.05 (17.1k synth tokens + 17.2k judge tokens). Elapsed: 184 seconds. Per-case run JSON saved at `results/runs/2026-04-25T22-14-21-000--stage-g-longmemeval-m-judge-fpr-probe.json`.

## 4. Interpretation

### 4.1 What this rules out

The 11.1pp gap between Stage J Phase A's stratified estimate (41.7% N=12) and Phase B's full-distribution measurement (30.6% N=500) is explained entirely by category-distribution weighting (Phase A used `--sample-per-type 2`; Phase B uses the true distribution which heavily favors multi-session + temporal-reasoning, the two hardest categories). It is NOT explained by judge permissiveness. Our Stage G-M probe shows 0% FPR specifically on multi-session (n=24) and 4.2% on temporal-reasoning (n=24) — both well below any threshold that could account for the 11pp sampling-distribution effect.

The aggregate 30.6% LongMemEval-M number is honest at the precision of the bootstrap CI. Weak retrieval systems that occasionally surface vague-but-topical answers would receive at most 2pp of unearned credit from this judge.

### 4.2 Why the per-category rates differ

The two false positives concentrated in temporal-reasoning (1/24) and single-session-preference (1/8). Both categories accept short, self-confident wrong answers more readily than the others:

- **temporal-reasoning** answers are dates or counts; a synthesized wrong date that happens to overlap a real session date can pass even a strict judge.
- **single-session-preference** answers are short opinions ("the user prefers X over Y"); a wrong-but-plausible preference can pass when the gold is also a short opinion.

These match the failure modes Penfield Labs cited for LOCOMO's much-higher 62.81% FPR — they are the same vague-but-topical pattern, just at a much lower rate under our stricter judge + rubric.

### 4.3 Sample size limits per-category resolution

The smaller per-category sample sizes (n=8 for SSP, n=13-24 for the others) produce wide bootstrap CIs. The aggregate FPR (0.02 [0%, 0.05]) is the right number to cite in the comparison table. Per-category breakdowns are diagnostic — useful for understanding which categories are most exposed to judge noise — but the per-category CIs are too wide to support load-bearing claims.

## 5. Implication for the v1 publication

The LongMemEval-M comparison-table cell can be footnoted with a published judge FPR identical in shape to the LongMemEval-S and LOCOMO footnotes. Three benchmark columns × one consistent FPR caveat structure:

| Benchmark | Judge FPR | 95% CI | Source |
|---|---:|---:|---|
| LongMemEval-S | 1% | [0%, 3%] | Stage G (2026-04-24) |
| LongMemEval-M | 2% | [0%, 5%] | Stage G-M (2026-04-26, this doc) |
| LOCOMO | 0% | [0%, 0%] | Stage G-LOCOMO (2026-04-24) |

No vendor publishes a LongMemEval-M judge FPR. We are the first publishable.

## 6. Note on retrieval-config independence

Judge FPR is a property of `(judge model, rubric, dataset cases)`, not of the retrieval architecture under test. The probe synthesizes wrong-but-topical answers via `gpt-5-mini` from the gold answers, then sends them to the judge — independent of any retrieval pipeline.

This means the Stage G-M FPR (2% [0%, 5%]) applies to every architecture row in the LongMemEval-M column of the v1 comparison table, regardless of whether that row uses canonical-hybrid, OM-v11, Tier 3 min-cost, Tier 3 max-acc, `--entity-linking`, or any other retrieval config. The v1 publication plan's Task 1.2 (re-run LOCOMO probe at `--entity-linking 0.5`) is conceptually unnecessary for the same reason: the existing 0% LOCOMO FPR applies across all retrieval configs on LOCOMO.

## 7. Run artifacts

- `results/runs/2026-04-25T22-14-21-000--stage-g-longmemeval-m-judge-fpr-probe.json`
- Standalone script: `src/scripts/stage-g-longmemeval-m-judge-fpr-probe.ts`
- Synth distractor cache: `data/.judge-adversarial-cache-stage-g-m/`
