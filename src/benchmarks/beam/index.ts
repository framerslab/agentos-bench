/**
 * @file benchmarks/beam/index.ts
 * @description Barrel export for the BEAM benchmark adapter.
 */

export { Beam, remapBeamCategoryToRubric } from './Beam.js';
export type { BeamAdapterOptions } from './Beam.js';
export {
  loadBeamDataset,
  BEAM_QUESTION_CATEGORIES,
} from './dataset.js';
export type { BeamTier, BeamQuestionCategory } from './dataset.js';
