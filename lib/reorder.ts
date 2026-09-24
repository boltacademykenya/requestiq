/**
 * ReorderIQ domain barrel.
 *
 * Exposes the shared domain types and the isomorphic prediction engine used by
 * both the UI and the API. Everything here is safe to import from client
 * components: server-only code lives in `@/lib/services` and `@/lib/db`.
 */
export * from './reorder/types'
export {
  addDays,
  subDays,
  calculateOrderIntervals,
  calculatePredictionConfidence,
  calculateReorderScore,
  determineCustomerStatus,
  getInsight,
  formatKes,
  formatDate,
  computeStatusCounts,
  computeIntervalBuckets,
  computeRevenueForecast,
  computeRecentOrders,
  computeKpis,
  computeProbability,
} from './reorder/analytics'
export type { InsightKpis, InsightMetrics } from './reorder/analytics'
