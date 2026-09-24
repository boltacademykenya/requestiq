import { addDays, differenceInCalendarDays, format, subDays } from 'date-fns'
import type { Customer, CustomerInsight, Order, Status } from './types'

export type { Customer, CustomerInsight, Order, Status } from './types'

/** Days between consecutive orders, oldest first. */
export function calculateOrderIntervals(orders: Order[]) {
  const sorted = [...orders].sort((a, b) => a.date.getTime() - b.date.getTime())
  return sorted.slice(1).map((order, index) => differenceInCalendarDays(order.date, sorted[index].date))
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export function calculatePredictionConfidence(intervals: number[], orders: number) {
  if (!intervals.length) return 28
  const average = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const variance = intervals.reduce((a, b) => a + (b - average) ** 2, 0) / intervals.length
  return Math.max(34, Math.min(98, Math.round(92 - Math.sqrt(variance) * 2.4 + Math.min(orders, 8) * 1.2)))
}

export function calculateReorderScore(customer: Customer): number {
  if (customer.orders.length < 2) return 10
  const sorted = [...customer.orders].sort((a, b) => a.date.getTime() - b.date.getTime())
  const totalSpend = sorted.reduce((total, order) => total + order.total, 0)
  const averageOrder = totalSpend / sorted.length
  const intervals = calculateOrderIntervals(sorted)
  const consistency =
    intervals.length > 1
      ? 100 -
        Math.min(50, Math.sqrt(intervals.reduce((a, b) => a + (b - intervals[0]) ** 2, 0) / intervals.length))
      : 50
  const recency = Math.max(0, 100 - differenceInCalendarDays(new Date(), sorted.at(-1)?.date ?? new Date()) / 2)
  const frequency = Math.min(100, (sorted.length / 12) * 100)
  const value = Math.min(100, (averageOrder / 5000) * 100)
  return Math.round(consistency * 0.3 + recency * 0.35 + frequency * 0.2 + value * 0.15)
}

export function determineCustomerStatus(last: Date, predicted: Date | null, orders: number): Status {
  if (orders < 2) return 'NEW'
  if (!predicted) return 'ACTIVE'
  const delta = differenceInCalendarDays(new Date(), predicted)
  if (differenceInCalendarDays(new Date(), last) >= 60) return 'DORMANT'
  if (delta >= 8) return 'AT_RISK'
  if (delta >= 1) return 'OVERDUE'
  if (delta === 0) return 'DUE_TODAY'
  if (delta >= -3) return 'DUE_SOON'
  return 'ACTIVE'
}

const ACTIONS: Record<Status, string> = {
  DUE_TODAY: 'Send reorder reminder',
  DUE_SOON: 'Schedule reorder reminder',
  OVERDUE: 'Send follow-up reminder',
  AT_RISK: 'Launch win-back campaign',
  NEW: 'Monitor for second purchase',
  ACTIVE: 'Keep customer engaged',
  DORMANT: 'Launch win-back campaign',
}

/** Derives the full reorder insight for a customer from their order history. */
export function getInsight(customer: Customer): CustomerInsight {
  const sorted = [...customer.orders].sort((a, b) => a.date.getTime() - b.date.getTime())
  const intervals = calculateOrderIntervals(sorted)
  const historical = median(intervals)
  const recent = median(intervals.slice(-5))
  const predicted = sorted.length > 1 ? addDays(sorted.at(-1)!.date, Math.round(historical * 0.3 + recent * 0.7)) : null
  const totalSpend = sorted.reduce((total, order) => total + order.total, 0)
  const status = determineCustomerStatus(sorted.at(-1)?.date ?? new Date(), predicted, sorted.length)
  const counts = sorted
    .flatMap((order) => order.products)
    .reduce<Record<string, number>>((acc, product) => ((acc[product.name] = (acc[product.name] || 0) + 1), acc), {})
  const recommendedProducts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)

  return {
    ...customer,
    intervals,
    averageInterval: intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
    medianInterval: historical,
    confidence: calculatePredictionConfidence(intervals, sorted.length),
    predictedNext: predicted,
    status,
    reorderScore: calculateReorderScore(customer),
    totalSpend,
    averageOrderValue: sorted.length ? Math.round(totalSpend / sorted.length) : 0,
    recommendedProducts,
    action: ACTIONS[status],
  }
}

export const formatKes = (amount: number) => `KSh ${amount.toLocaleString('en-KE')}`
export const formatDate = (date: Date | null) => (date ? format(date, 'dd MMM yyyy') : '—')

/* -------------------------------------------------------------------------- */
/* Aggregations                                                               */
/* -------------------------------------------------------------------------- */

/** Recent orders across the dataset, newest first (dashboard widgets). */
export function computeRecentOrders(insights: CustomerInsight[], limit = 6) {
  return insights
    .flatMap((insight) => insight.orders.map((order) => ({ ...order, customer: insight.name })))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, limit)
}

/**
 * Minimal shape the aggregate helpers need.
 *
 * Both the domain `CustomerInsight` and the transport `CustomerInsightDto`
 * satisfy it, so the same maths runs on the client and on the server.
 */
export type InsightMetrics = {
  status: Status
  averageInterval: number
  confidence: number
  averageOrderValue: number
  totalSpend: number
  predictedNext: Date | string | null
  orders?: readonly unknown[]
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null
  return value instanceof Date ? value : new Date(value)
}

/** Customer status distribution used by the dashboard pie chart. */
export function computeStatusCounts(insights: InsightMetrics[]): Partial<Record<Status, number>> {
  return insights.reduce<Partial<Record<Status, number>>>(
    (acc, insight) => ((acc[insight.status] = (acc[insight.status] || 0) + 1), acc),
    {},
  )
}

const INTERVAL_LABELS = ['0–7 days', '8–14 days', '15–21 days', '22–30 days', '31–60 days', '60+ days']

export function computeIntervalBuckets(insights: InsightMetrics[]) {
  return INTERVAL_LABELS.map((label, index) => ({
    label,
    value: insights.filter((insight) => {
      const days = insight.averageInterval
      return index === 0
        ? days <= 7
        : index === 1
          ? days <= 14
          : index === 2
            ? days <= 21
            : index === 3
              ? days <= 30
              : index === 4
                ? days <= 60
                : days > 60
    }).length,
  }))
}

/** Confidence-weighted revenue expected over the next `days` days. */
export function computeRevenueForecast(insights: InsightMetrics[], days = 14) {
  const start = new Date()
  return Array.from({ length: days }, (_, index) => {
    const day = addDays(start, index)
    const revenue = insights.reduce((total, insight) => {
      const predicted = asDate(insight.predictedNext)
      if (!predicted) return total
      return differenceInCalendarDays(predicted, day) === 0
        ? total + Math.round(insight.averageOrderValue * (insight.confidence / 100))
        : total
    }, 0)
    return { date: format(day, 'dd MMM'), revenue }
  })
}

export type InsightKpis = {
  totalCustomers: number
  activeCustomers: number
  dueToday: number
  dueSoon: number
  overdue: number
  atRisk: number
  predictedRevenue: number
  averageOrderValue: number
}

export function computeKpis(insights: InsightMetrics[]): InsightKpis {
  const predictedRevenue = insights.reduce(
    (total, insight) => total + Math.round(insight.averageOrderValue * (insight.confidence / 100)),
    0,
  )
  const totalSpend = insights.reduce((total, insight) => total + insight.totalSpend, 0)
  const totalOrders = insights.reduce((total, insight) => total + (insight.orders?.length ?? 0), 0)
  return {
    totalCustomers: insights.length,
    activeCustomers: insights.filter((insight) => insight.status === 'ACTIVE').length,
    dueToday: insights.filter((insight) => insight.status === 'DUE_TODAY').length,
    dueSoon: insights.filter((insight) => insight.status === 'DUE_SOON').length,
    overdue: insights.filter((insight) => insight.status === 'OVERDUE').length,
    atRisk: insights.filter((insight) => insight.status === 'AT_RISK').length,
    predictedRevenue,
    averageOrderValue: totalOrders ? Math.round(totalSpend / totalOrders) : 0,
  }
}

/** Probability that a reorder lands, derived from the score and confidence. */
export function computeProbability(insight: { reorderScore: number; confidence: number }) {
  return Math.max(5, Math.min(95, Math.round(insight.reorderScore * 0.6 + insight.confidence * 0.4)))
}

export { addDays, subDays }
