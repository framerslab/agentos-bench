---
title: Stage J Blocked — LongMemEval-M loader can't read 2.7GB file
date: 2026-04-25
spec: 2026-04-25-comprehensive-evaluation-matrix-design.md (Stage J row)
result: BLOCKED at the loader; not an architecture issue
fix_estimate: 1-2h (add streaming JSON parser to dataset.ts)
---

# Stage J Blocked — 2026-04-25

## Summary

Stage J of the comprehensive evaluation matrix was the first published Phase A measurement on LongMemEval-M. We attempted the run with N=18 stratified at our shipping config (`--reader gpt-4o --memory full-cognitive --replay ingest --hybrid-retrieval --rerank cohere --reader-top-k 20 --seed 42`).

**The run failed at dataset loading:**

```
File size (2745274681) is greater than 2 GiB
```

`packages/agentos-bench/src/benchmarks/longmemeval/dataset.ts:89` calls `fs.readFile(filePath, 'utf8')` which loads the entire file into a Node string. V8's max string size is ~1.4 GB; the LongMemEval-M dataset is 2.7 GB and overflows.

This isn't an architecture issue — the bench's pipeline never gets to run because the dataset doesn't load.

## Required fix

Add a streaming JSON parser to `dataset.ts`:

1. Add `stream-json` dependency: `pnpm add stream-json` in `packages/agentos-bench/`
2. Refactor `loadLongMemEvalDataset` to detect file size; for files >1 GB, stream-parse the top-level array element-by-element instead of loading the entire string
3. Type-assert each emitted element matches `RawLongMemEvalCase`
4. Optional: add a similar guard for `LongMemEval-Oracle` (smaller now, but future-proof)

Estimated time: 1-2 hours including a focused regression test that loads a synthetic 2.5GB JSON array and confirms parsing works.

## Why this slipped through earlier

The bench has historically only run LongMemEval-S (115 KB / case × 500 cases ≈ 57 MB) and Oracle (much smaller). LongMemEval-M is 2.7 GB. The download script existed in `src/setup/download.ts` but no Phase A or Phase B run had ever been attempted on M, so the loader's 2 GB ceiling was never tripped.

## Impact on the comprehensive evaluation matrix

The v1 evaluation matrix planned to include LongMemEval-M for all 6 architectures (Tier 1, Tier 2b, Tier 3 min/max, plus Stage L + Stage I treatments). Without the loader fix, those cells are unreachable.

**Recommended path:**

1. Fix the loader (1-2 h, no LLM cost)
2. Re-run Stage J Phase A with shipping config (~$5-10)
3. Then proceed to Phase B sweeps for the surviving architectures on M

## Adjusted v1 cost estimate

The original spec estimated ~$300 for LongMemEval-M Phase B across 6 architectures. That estimate stands; the only addition is ~2 hours of dev time to fix the loader before any of those runs become possible.

## What's not affected

- LongMemEval-S Phase B and Phase A measurements — unaffected, file is 57 MB
- LOCOMO Phase B — separate dataset (~50 MB), unaffected
- BEAM 100K spot-check — separate dataset, unaffected
- Stage L 0.2.12 ship + measurement — unaffected (already complete)
- Stage I 0.2.13 ship — unaffected (in progress; agentos core is shipped, bench wiring still pending)

## Run artifacts

No run JSON was produced (loader failed before any case ran). Cost: $0. The download did happen — `data/longmemeval/longmemeval_m.json` is on disk at 2.7 GB and ready for the streaming parser.
