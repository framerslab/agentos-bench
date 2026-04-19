/**
 * @file cli.smoke.spec.ts
 * @description Smoke tests for the CLI wiring.
 *
 * Specifically regresses the --dry-run reader path: external benchmarks
 * must accept an {@link IReader} instance (so the CLI can inject a
 * MockReader for dry-runs without constructing an HTTP-backed reader
 * that would require an API key).
 *
 * Also sanity-checks that the run subcommand produces a run file when
 * invoked with --dry-run against a synthetic LongMemEval dataset, end
 * to end, with no network access.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildCli } from '../src/cli.js';

describe('CLI smoke', () => {
  let tmpRoot: string;
  let dataDir: string;
  let resultsDir: string;
  let originalAnthropicKey: string | undefined;
  let originalOpenAiKey: string | undefined;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-cli-'));
    dataDir = path.join(tmpRoot, 'data');
    resultsDir = path.join(tmpRoot, 'results');
    await fs.mkdir(path.join(dataDir, 'longmemeval'), { recursive: true });
    await fs.mkdir(resultsDir, { recursive: true });

    // Scrub any ambient API keys so the test would fail hard if the CLI
    // accidentally reached for createReader under --dry-run.
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await fs.writeFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      JSON.stringify([
        {
          question_id: 'cli-1',
          question_type: 'single-session-user',
          question: 'What is my coffee order?',
          answer: 'oat flat white',
          question_date: '2026-04-18',
          haystack_sessions: [
            [
              { role: 'user', content: 'My order is an oat flat white.' },
              { role: 'assistant', content: 'Noted.' },
            ],
          ],
          haystack_dates: ['2026-04-01'],
          haystack_session_ids: ['s0'],
        },
      ]),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    if (originalAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    if (originalOpenAiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it('list subcommand prints every registered benchmark', async () => {
    const out = await captureStdout(async () => {
      await buildCli().parseAsync(['node', 'agentos-bench', 'list']);
    });
    // Micros
    expect(out).toContain('decay-fidelity');
    expect(out).toContain('signal-ablation');
    // External
    expect(out).toContain('longmemeval-s');
    expect(out).toContain('longmemeval-m');
    expect(out).toContain('locomo');
    // BEAM placeholders
    expect(out).toContain('beam-500k');
    expect(out).toContain('beam-10m');
  });

  it('run --dry-run goes end-to-end without touching any real API key', async () => {
    await buildCli().parseAsync([
      'node',
      'agentos-bench',
      'run',
      'longmemeval-s',
      '--memory',
      'base-memory',
      '--replay',
      'ingest',
      '--data-dir',
      dataDir,
      '--results-dir',
      resultsDir,
      '--dry-run',
    ]);

    const runs = await fs.readdir(path.join(resultsDir, 'runs'));
    expect(runs.length).toBe(1);
    expect(runs[0]).toContain('longmemeval-s');

    const run = JSON.parse(await fs.readFile(path.join(resultsDir, 'runs', runs[0]!), 'utf8'));
    expect(run.totalCases).toBe(1);
    expect(run.cases[0].actualOutput).toContain('dry-run mock answer');
  });

  it('run --dry-run against full-cognitive exercises CognitiveMemoryManager', async () => {
    await buildCli().parseAsync([
      'node',
      'agentos-bench',
      'run',
      'longmemeval-s',
      '--memory',
      'full-cognitive',
      '--replay',
      'observe',
      '--data-dir',
      dataDir,
      '--results-dir',
      resultsDir,
      '--dry-run',
    ]);

    const runs = await fs.readdir(path.join(resultsDir, 'runs'));
    const run = JSON.parse(await fs.readFile(path.join(resultsDir, 'runs', runs[0]!), 'utf8'));
    expect(run.cases[0].metadata.memoryMode).toBe('full-cognitive');
    expect(typeof run.cases[0].metadata.workingMemorySlots).toBe('number');
    expect(typeof run.cases[0].metadata.observationsEmitted).toBe('number');
  });
});

/**
 * Capture `console.log` output during `fn`. Restores the original on
 * completion. The CLI uses `console.log` (not raw `process.stdout.write`)
 * so this covers every registered subcommand's print path.
 */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return chunks.join('\n');
}
