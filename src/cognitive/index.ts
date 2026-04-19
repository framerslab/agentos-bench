/**
 * @file cognitive/index.ts
 * @description Barrel export for the full-cognitive scaffolding.
 */

export { CharHashEmbedder, CHAR_HASH_DIM, embed } from './charHashEmbedder.js';
export {
  createCognitiveManager,
  NEUTRAL_MOOD,
  NEUTRAL_TRAITS,
} from './createCognitiveManager.js';
export type {
  BenchCognitiveHandle,
  CreateCognitiveManagerOptions,
} from './createCognitiveManager.js';
