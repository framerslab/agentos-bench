/**
 * @file setup/index.ts
 * @description Barrel export for bench setup (dataset download) utilities.
 */

export {
  DATASET_SOURCES,
  downloadBenchmark,
  listDownloadableBenchmarks,
} from './download.js';
export type { DatasetFile, DownloadResult } from './download.js';
