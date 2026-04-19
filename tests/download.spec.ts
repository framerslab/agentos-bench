/**
 * @file download.spec.ts
 * @description Unit tests for the dataset download helper. Uses a
 * local fetch mock so no real HTTP happens in CI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DATASET_SOURCES,
  downloadBenchmark,
  listDownloadableBenchmarks,
} from '../src/setup/index.js';

describe('agentos-bench setup downloader', () => {
  let tmpRoot: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-bench-dl-'));
    dataDir = path.join(tmpRoot, 'data');
    await fs.mkdir(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('lists the expected benchmark IDs', () => {
    const ids = listDownloadableBenchmarks().sort();
    expect(ids).toEqual([
      'locomo',
      'longmemeval-m',
      'longmemeval-oracle',
      'longmemeval-s',
    ]);
  });

  it('downloads a benchmark by fetching each registered file URL', async () => {
    const body = JSON.stringify([{ question_id: 'q1', question: 'x', answer: 'y' }]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain(
          'huggingface.co/datasets/xiaowu0162/longmemeval',
        );
        return new Response(body, { status: 200 });
      });

    const results = await downloadBenchmark('longmemeval-s', dataDir);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]!.skipped).toBe(false);
    expect(results[0]!.bytes).toBeGreaterThan(0);
    expect(results[0]!.filename).toBe('longmemeval_s.json');

    const written = await fs.readFile(
      path.join(dataDir, 'longmemeval', 'longmemeval_s.json'),
      'utf8',
    );
    expect(written).toBe(body);
  });

  it('skips the download when the file already exists unless force=true', async () => {
    const target = path.join(dataDir, 'longmemeval', 'longmemeval_s.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'cached');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const cacheHit = await downloadBenchmark('longmemeval-s', dataDir);
    expect(cacheHit[0]!.skipped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockImplementation(async () => new Response('fresh', { status: 200 }));
    const forced = await downloadBenchmark('longmemeval-s', dataDir, { force: true });
    expect(forced[0]!.skipped).toBe(false);
    expect(await fs.readFile(target, 'utf8')).toBe('fresh');
  });

  it('throws a useful error for unknown benchmark IDs', async () => {
    await expect(() =>
      downloadBenchmark('not-a-benchmark', dataDir),
    ).rejects.toThrow(/No dataset sources/);
  });

  it('propagates HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    await expect(() => downloadBenchmark('locomo', dataDir)).rejects.toThrow(/download failed 404/);
  });

  it('all configured URLs use well-known public hosts', () => {
    for (const files of Object.values(DATASET_SOURCES)) {
      for (const f of files) {
        expect(f.url).toMatch(/^https:\/\/(huggingface\.co|raw\.githubusercontent\.com)\//);
      }
    }
  });
});
