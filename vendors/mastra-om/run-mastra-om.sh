#!/usr/bin/env bash
# Wrapper around the Mastra OM vendor reproduction adapter.
# Installs deps on first run, dispatches the bench script, writes
# run JSON to results/runs/.
#
# Usage:
#   ./run-mastra-om.sh                              # full Phase B (N=500)
#   ./run-mastra-om.sh --sample-per-type 9          # Phase A (54 stratified)
#   ./run-mastra-om.sh --sample 5                   # smoke test (5 cases)
#   ./run-mastra-om.sh --reader gpt-5-mini          # gpt-5-mini reader
#
# Required env: OPENAI_API_KEY

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BENCH_ROOT="$(cd "$HERE/../.." && pwd)"

cd "$HERE"

if [[ ! -d node_modules ]]; then
  echo "First-run install of Mastra deps via npm (~30-60s; pnpm conflicts with the parent workspace, so this vendor uses npm)."
  npm install --no-package-lock
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY env var is required."
  exit 1
fi

DATASET="$BENCH_ROOT/data/longmemeval/longmemeval_s.json"
if [[ ! -f "$DATASET" ]]; then
  echo "ERROR: LongMemEval-S dataset not found at $DATASET"
  echo "Download from https://github.com/xiaowu0162/LongMemEval per agentos-bench docs."
  exit 1
fi

OUTPUT_DIR="$BENCH_ROOT/results/runs"
mkdir -p "$OUTPUT_DIR"

NODE_OPTIONS="--max-old-space-size=8192" \
  ./node_modules/.bin/tsx bench-mastra-om.ts \
  --dataset "$DATASET" \
  --output-dir "$OUTPUT_DIR" \
  "$@"
