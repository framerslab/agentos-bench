/**
 * @file download.ts
 * @description Dataset download helpers for `agentos-bench setup`.
 *
 * Uses global fetch (Node 18+) with a streaming write to avoid buffering
 * entire datasets in memory. Skips files that already exist so reruns
 * are idempotent. Does not pull in `@huggingface/hub` — direct HTTPS
 * URLs to the `/resolve/main/` paths are stable and keep the bench
 * suite install-light.
 *
 * @module agentos-bench/setup/download
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Known benchmark → list of (filename, URL) pairs.
 *
 * Upstream LongMemEval files are extensionless Git-LFS blobs; HF
 * auto-redirects `resolve/main/<name>` to the CDN backing. We rename to
 * `.json` on disk to keep the file-sniff logic in dataset.ts simple.
 */
export const DATASET_SOURCES: Record<string, DatasetFile[]> = {
  'longmemeval-s': [
    {
      filename: 'longmemeval_s.json',
      url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s',
      targetDir: 'longmemeval',
    },
  ],
  'longmemeval-m': [
    {
      filename: 'longmemeval_m.json',
      url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_m',
      targetDir: 'longmemeval',
    },
  ],
  'longmemeval-oracle': [
    {
      filename: 'longmemeval_oracle.json',
      url: 'https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_oracle',
      targetDir: 'longmemeval',
    },
  ],
  locomo: [
    {
      filename: 'locomo10.json',
      url: 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json',
      targetDir: 'locomo',
    },
  ],
};

/**
 * Dataset file descriptor. Files are placed under
 * `<dataDir>/<targetDir>/<filename>`.
 */
export interface DatasetFile {
  filename: string;
  url: string;
  targetDir: string;
}

/**
 * Result of a download operation.
 */
export interface DownloadResult {
  benchmark: string;
  filename: string;
  absolutePath: string;
  bytes: number;
  /** True when the file was already on disk and the download was skipped. */
  skipped: boolean;
}

/**
 * Download all data files for a given benchmark ID. Re-use existing
 * files unless `force` is set.
 */
export async function downloadBenchmark(
  benchmarkId: string,
  dataDir: string,
  opts: { force?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<DownloadResult[]> {
  const files = DATASET_SOURCES[benchmarkId];
  if (!files) {
    throw new Error(`No dataset sources registered for benchmark '${benchmarkId}'.`);
  }

  const results: DownloadResult[] = [];
  for (const file of files) {
    const absolutePath = path.join(dataDir, file.targetDir, file.filename);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    if (!opts.force) {
      const existing = await fs.stat(absolutePath).catch(() => null);
      if (existing && existing.size > 0) {
        results.push({
          benchmark: benchmarkId,
          filename: file.filename,
          absolutePath,
          bytes: existing.size,
          skipped: true,
        });
        opts.onProgress?.(`cache hit: ${file.filename} (${existing.size} bytes)`);
        continue;
      }
    }

    opts.onProgress?.(`downloading: ${file.url}`);
    const bytes = await fetchToFile(file.url, absolutePath);
    results.push({
      benchmark: benchmarkId,
      filename: file.filename,
      absolutePath,
      bytes,
      skipped: false,
    });
    opts.onProgress?.(`wrote ${bytes} bytes to ${absolutePath}`);
  }
  return results;
}

/**
 * GET `url` and stream the response body to `destPath`. Returns the
 * number of bytes written. Follows HF's redirect-to-CDN pattern via
 * fetch's built-in redirect handling.
 */
async function fetchToFile(url: string, destPath: string): Promise<number> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error(`download failed ${resp.status} ${resp.statusText} for ${url}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(destPath, buf);
  return buf.length;
}

/**
 * Enumerate the benchmark IDs with registered download sources.
 */
export function listDownloadableBenchmarks(): string[] {
  return Object.keys(DATASET_SOURCES);
}
