/**
 * @file benchmarks/locomo/index.ts
 * @description Barrel export for the LOCOMO adapter.
 */

export { Locomo, LOCOMO_CATEGORY_LOOKUP } from './Locomo.js';
export type { LocomoAdapterOptions } from './Locomo.js';
export { loadLocomoDataset, LOCOMO_CATEGORY_NAMES, extractSessions } from './dataset.js';
export type { RawLocomoSample } from './dataset.js';
