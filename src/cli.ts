#!/usr/bin/env node
/**
 * @file cli.ts
 * @description Command-line interface for `@framers/agentos-bench`.
 *
 * Subcommands:
 *   - `run <benchmark-id> [--reader <model>] [--memory <mode>] [--replay <mode>] [--sample N]`
 *   - `list`    — enumerate built-in benchmarks
 *   - `setup`   — prepare dataset caches (placeholder — downloads via HF hub in v2)
 *   - `leaderboard` — regenerate results/LEADERBOARD.md (stub until leaderboard generator ships)
 *
 * Environment variables:
 *   - `AGENTOS_BENCH_DATA_DIR`    (default: ./data)
 *   - `AGENTOS_BENCH_RESULTS_DIR` (default: ./results)
 *   - `AGENTOS_BENCH_TIER`        micro | s | m | full  (informational for now)
 *   - `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
 *
 * @module agentos-bench/cli
 */

import path from 'node:path';
import { Command } from 'commander';

import {
  Beam,
  BenchmarkRunner,
  ConsolidationSignalPreservation,
  DecayFidelity,
  HexacoEncodingBias,
  Locomo,
  LongMemEvalJudge,
  LongMemEvalM,
  LongMemEvalOracle,
  LongMemEvalS,
  MockReader,
  ScalingProfile,
  SignalAblation,
  SpreadingActivationPrecision,
  WorkingMemoryCapacity,
  createReader,
  type IBenchmark,
  type IReader,
  type MemoryMode,
  type ReaderModel,
  type ReplayMode,
  type RunConfig,
} from './index.js';

interface BenchEntry {
  id: string;
  family: 'external' | 'micro';
  description: string;
  /**
   * Build the benchmark instance. `reader` is an already-constructed
   * {@link IReader} — real (OpenAI / Anthropic HTTP client) in
   * production runs, {@link MockReader} under `--dry-run`.
   */
  build: (ctx: { reader: IReader }) => IBenchmark;
}

const BENCHMARKS: BenchEntry[] = [
  {
    id: 'decay-fidelity',
    family: 'micro',
    description: 'Ebbinghaus decay curve conformance at 1d/5d/10d/30d/60d probes',
    build: () => new DecayFidelity(),
  },
  {
    id: 'hexaco-encoding-bias',
    family: 'micro',
    description: 'HEXACO traits bias encoding in the documented direction',
    build: () => new HexacoEncodingBias(),
  },
  {
    id: 'working-memory-capacity',
    family: 'micro',
    description: 'Baddeley 5-9 slot capacity + LRU-by-activation eviction',
    build: () => new WorkingMemoryCapacity(),
  },
  {
    id: 'spreading-activation-precision',
    family: 'micro',
    description: 'Anderson spreading activation contains ≥80% of seed cluster',
    build: () => new SpreadingActivationPrecision(),
  },
  {
    id: 'consolidation-signal-preservation',
    family: 'micro',
    description: 'Flashbulb-immunity invariant across reconsolidation, RIF, emotion regulation',
    build: () => new ConsolidationSignalPreservation(),
  },
  {
    id: 'scaling-profile',
    family: 'micro',
    description: 'Retrieval scoring P50/P95 at 1k/10k (100k with AGENTOS_BENCH_SCALING_FULL)',
    build: () => new ScalingProfile(),
  },
  {
    id: 'signal-ablation',
    family: 'micro',
    description: 'Prove each of the 6 retrieval signals is load-bearing (NDCG delta per ablation)',
    build: () => new SignalAblation(),
  },
  {
    id: 'longmemeval-s',
    family: 'external',
    description: 'LongMemEval-S (500 cases, ~115k-token haystacks)',
    build: ({ reader }) => new LongMemEvalS({ reader, variant: 's' }),
  },
  {
    id: 'longmemeval-m',
    family: 'external',
    description: 'LongMemEval-M (~500 sessions per haystack) — medium-difficulty variant',
    build: ({ reader }) => new LongMemEvalM({ reader }),
  },
  {
    id: 'longmemeval-oracle',
    family: 'external',
    description: 'LongMemEval-Oracle (evidence-only) — isolates reader quality from retrieval',
    build: ({ reader }) => new LongMemEvalOracle({ reader }),
  },
  {
    id: 'locomo',
    family: 'external',
    description: 'LOCOMO (Maharana et al. 2024, 10 convos × ~300 turns, QA task only in v1)',
    build: ({ reader }) => new Locomo({ reader }),
  },
  {
    id: 'beam-500k',
    family: 'external',
    description: 'BEAM 500k tier (placeholder — upstream schema not yet public)',
    build: ({ reader }) => new Beam({ reader, tier: '500k' }),
  },
  {
    id: 'beam-1m',
    family: 'external',
    description: 'BEAM 1M tier (placeholder — upstream schema not yet public)',
    build: ({ reader }) => new Beam({ reader, tier: '1m' }),
  },
  {
    id: 'beam-10m',
    family: 'external',
    description: 'BEAM 10M tier — frontier, Hindsight SOTA (placeholder until schema is published)',
    build: ({ reader }) => new Beam({ reader, tier: '10m' }),
  },
];

function resolveDataDir(override?: string): string {
  return path.resolve(override ?? process.env.AGENTOS_BENCH_DATA_DIR ?? path.join(process.cwd(), 'data'));
}

function resolveResultsDir(override?: string): string {
  return path.resolve(
    override ?? process.env.AGENTOS_BENCH_RESULTS_DIR ?? path.join(process.cwd(), 'results'),
  );
}

function parseInteger(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Expected non-negative integer, got ${v}`);
  return n;
}

function parseFloatArg(v: string): number {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Expected non-negative number, got ${v}`);
  return n;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('agentos-bench')
    .description('Benchmark AgentOS memory against LongMemEval, LOCOMO, BEAM, and micro-benchmarks.')
    .version('0.1.0');

  program
    .command('list')
    .description('List built-in benchmarks with their families.')
    .action(() => {
      const pad = Math.max(...BENCHMARKS.map((b) => b.id.length));
      for (const b of BENCHMARKS) {
        // eslint-disable-next-line no-console
        console.log(`${b.id.padEnd(pad)}  [${b.family}]  ${b.description}`);
      }
    });

  program
    .command('run <benchmarkId>')
    .description('Run a benchmark and persist results.')
    .option('-r, --reader <model>', 'Reader model (e.g. claude-sonnet-4-6, gpt-4o)', 'claude-sonnet-4-6')
    .option('-m, --memory <mode>', "Memory mode: full-cognitive | base-memory | none", 'none')
    .option('-p, --replay <mode>', 'Replay mode: observe | ingest', 'ingest')
    .option('-n, --sample <n>', 'Run only the first N cases', parseInteger)
    .option('-c, --concurrency <n>', 'Parallel case execution', parseInteger, 3)
    .option('--max-usd <amount>', 'Abort if projected USD exceeds this cap', parseFloatArg)
    .option('--data-dir <path>', 'Dataset cache directory')
    .option('--results-dir <path>', 'Results directory')
    .option('--judge-model <model>', 'Judge LLM (external benchmarks only)', 'gpt-4o')
    .option('--dry-run', 'Use MockReader / mock judge (no API calls)')
    .action(async (benchmarkId: string, opts) => {
      const entry = BENCHMARKS.find((b) => b.id === benchmarkId);
      if (!entry) {
        // eslint-disable-next-line no-console
        console.error(`Unknown benchmark '${benchmarkId}'. Run 'agentos-bench list' to see options.`);
        process.exitCode = 1;
        return;
      }

      const runConfig: RunConfig = {
        reader: opts.reader as ReaderModel,
        memoryMode: opts.memory as MemoryMode,
        replayMode: opts.replay as ReplayMode,
        sampleN: opts.sample,
        concurrency: opts.concurrency,
        maxUsd: opts.maxUsd,
      };

      const judge = opts.dryRun
        ? new LongMemEvalJudge({
            reader: new MockReader(opts.judgeModel).on(
              () => true,
              () => ({
                text: 'yes',
                tokensIn: 0,
                tokensOut: 1,
                model: opts.judgeModel,
                latencyMs: 0,
              }),
            ),
          })
        : entry.family === 'external'
          ? new LongMemEvalJudge({ reader: createReader(opts.judgeModel as ReaderModel) })
          : ({
              model: 'noop',
              rubricVersion: '0',
              async judge() {
                throw new Error('judge invoked on a micro-benchmark');
              },
            } as const);

      // Reader construction: real HTTP client for production runs,
      // scripted MockReader for --dry-run so offline smoke tests do not
      // require API keys. Micro-benchmarks ignore the reader (they do
      // synthetic assertions), so the mock default is harmless.
      const reader = opts.dryRun
        ? new MockReader(opts.reader as string).on(
            () => true,
            () => ({
              text: '[dry-run mock answer]',
              tokensIn: 0,
              tokensOut: 1,
              model: opts.reader as string,
              latencyMs: 0,
            }),
          )
        : entry.family === 'micro'
          ? new MockReader(opts.reader as string)
          : createReader(opts.reader as ReaderModel);

      const runner = new BenchmarkRunner({
        dataDir: resolveDataDir(opts.dataDir),
        resultsDir: resolveResultsDir(opts.resultsDir),
        judge,
      });

      // eslint-disable-next-line no-console
      console.log(
        `Running ${entry.id} reader=${runConfig.reader} memory=${runConfig.memoryMode} replay=${runConfig.replayMode}${opts.dryRun ? ' (dry-run)' : ''}${runConfig.sampleN ? ` sample=${runConfig.sampleN}` : ''}`,
      );

      const benchmark = entry.build({ reader });
      const result = await runner.run(benchmark, runConfig);

      // eslint-disable-next-line no-console
      console.log(
        `Done. accuracy=${(result.accuracy * 100).toFixed(1)}% passed=${result.passedCases}/${result.totalCases} avgLatency=${result.avgLatencyMs.toFixed(0)}ms totalUsd=$${result.totalUsd.toFixed(4)} costPerCorrect=$${Number.isFinite(result.costPerCorrect) ? result.costPerCorrect.toFixed(4) : '∞'}`,
      );
    });

  program
    .command('setup')
    .description('Download benchmark datasets into the data cache.')
    .option('-b, --benchmark <id>', 'Download data for a single benchmark (default: all known)', 'all')
    .option('--data-dir <path>', 'Dataset cache directory')
    .option('--force', 'Re-download even if files already exist')
    .action(async (opts) => {
      const { downloadBenchmark, listDownloadableBenchmarks } = await import('./setup/download.js');
      const dataDir = resolveDataDir(opts.dataDir);
      const targets: string[] =
        opts.benchmark === 'all' ? listDownloadableBenchmarks() : [opts.benchmark as string];

      let failures = 0;
      for (const id of targets) {
        try {
          const results = await downloadBenchmark(id, dataDir, {
            force: Boolean(opts.force),
            onProgress: (msg) => {
              // eslint-disable-next-line no-console
              console.log(`[${id}] ${msg}`);
            },
          });
          for (const r of results) {
            // eslint-disable-next-line no-console
            console.log(
              `[${id}] ${r.skipped ? 'skipped' : 'downloaded'} ${r.filename} (${r.bytes} bytes) → ${r.absolutePath}`,
            );
          }
        } catch (err: unknown) {
          failures += 1;
          // eslint-disable-next-line no-console
          console.error(`[${id}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures > 0) process.exitCode = 1;
    });

  program
    .command('leaderboard')
    .description('Regenerate LEADERBOARD.md from results/summary.json + competitor-numbers.')
    .option('--results-dir <path>', 'Results directory')
    .option('--filename <name>', 'Output filename', 'LEADERBOARD.md')
    .option('--note <text>', 'Optional header note appended under the title')
    .action(async (opts) => {
      const { renderLeaderboard } = await import('./reporting/MarkdownLeaderboard.js');
      const outPath = await renderLeaderboard({
        resultsDir: resolveResultsDir(opts.resultsDir),
        filename: opts.filename,
        headerNote: opts.note,
      });
      // eslint-disable-next-line no-console
      console.log(`Wrote ${outPath}`);
    });

  return program;
}

// Invoke only when executed as a script.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  buildCli()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
