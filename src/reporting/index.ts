/**
 * @file reporting/index.ts
 * @description Barrel export for bench reporting utilities.
 */

export { renderLeaderboard, renderExternalSectionForTest } from './MarkdownLeaderboard.js';
export type { LeaderboardOptions } from './MarkdownLeaderboard.js';
export { COMPETITOR_NUMBERS, bestPublished } from './competitor-numbers.js';
export type { CompetitorScore } from './competitor-numbers.js';
export {
  exportRunToCsv,
  renderCasesCsv,
  renderEvidenceCsv,
  renderRetrievalCsv,
  renderLatencyOpsCsv,
} from './exportCsv.js';
export { renderSweepReport, renderHeadline } from './sweepReport.js';
export type { SweepReportOptions } from './sweepReport.js';
