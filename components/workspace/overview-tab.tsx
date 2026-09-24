'use client'

import type { InsightOverviewDto } from '@/lib/api/dto'
import { apiGet } from '@/lib/api/client'
import { formatKes } from '@/lib/pricing'
import { DataTable, EmptyState, Notice, PaginationNote, Panel, Spinner, Stat, tdClass } from './ui'
import { useResource } from './use-resource'

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  ACTIVE: 'Active',
  DUE_SOON: 'Due soon',
  DUE_TODAY: 'Due today',
  OVERDUE: 'Overdue',
  AT_RISK: 'At risk',
  DORMANT: 'Dormant',
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Dashboard and Analytics both read `GET /api/v1/insights/overview`; the dashboard
 * leads with the KPI row, Analytics adds the forecast and interval mix detail.
 */
export default function OverviewTab({ variant }: { variant: 'dashboard' | 'analytics' }) {
  const { data, error, loading, reload } = useResource<InsightOverviewDto>(
    () => apiGet<InsightOverviewDto>('/api/v1/insights/overview'),
    [],
  )

  if (loading) return <Spinner label="Loading insights…" />
  if (error) return <Notice onRetry={reload}>{error.message}</Notice>
  if (!data) return null

  const { kpis, statusCounts, revenueForecast, intervalBuckets, topOpportunities } = data
  const statusEntries = Object.entries(statusCounts).filter(([, count]) => (count ?? 0) > 0)

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Customers"
          value={kpis.totalCustomers}
          hint={`${kpis.activeCustomers} on a healthy reorder rhythm`}
        />
        <Stat label="Due today" value={kpis.dueToday} hint={`${kpis.dueSoon} due soon`} />
        <Stat label="Overdue" value={kpis.overdue} hint={`${kpis.atRisk} at risk`} />
        <Stat
          label="Predicted revenue"
          value={formatKes(kpis.predictedRevenue)}
          hint={`Avg order ${formatKes(kpis.averageOrderValue)}`}
        />
      </div>

      {statusEntries.length > 0 && (
        <Panel title="Customer mix" description="How the book is distributed across reorder statuses.">
          <div className="flex flex-wrap gap-2">
            {statusEntries.map(([status, count]) => (
              <span
                key={status}
                className="rounded-full bg-wash px-3.5 py-1.5 text-xs font-semibold text-slate-700"
              >
                {STATUS_LABELS[status] ?? status} <span className="text-slate-400">{count}</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {variant === 'analytics' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Revenue forecast" description="Predicted reorder revenue by date.">
            {revenueForecast.length === 0 ? (
              <EmptyState
                title="No forecast yet"
                description="Add customers and order history, then recompute opportunities to build a forecast."
              />
            ) : (
              <ul className="space-y-2">
                {revenueForecast.map((point) => (
                  <li key={point.date} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{formatDate(point.date)}</span>
                    <span className="font-semibold text-slate-900">{formatKes(point.revenue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Reorder intervals" description="How often your customers come back.">
            {intervalBuckets.length === 0 ? (
              <EmptyState
                title="Not enough history"
                description="Interval buckets appear once customers have at least two completed orders."
              />
            ) : (
              <ul className="space-y-2">
                {intervalBuckets.map((bucket) => (
                  <li key={bucket.label} className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{bucket.label}</span>
                    <span className="font-semibold text-slate-900">{bucket.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      <Panel
        title="Top opportunities"
        description="Highest scoring reorder opportunities in this workspace."
      >
        {topOpportunities.length === 0 ? (
          <EmptyState
            title="No opportunities yet"
            description="Reorder opportunities are computed from customer order history."
          />
        ) : (
          <DataTable head={['Customer', 'Expected date', 'Score', 'Probability', 'Expected value', 'Status']}>
            {topOpportunities.map((opportunity) => (
              <tr key={opportunity.id}>
                <td className={`${tdClass} font-medium text-slate-900`}>{opportunity.customerName}</td>
                <td className={tdClass}>{formatDate(opportunity.expectedDate)}</td>
                <td className={tdClass}>{opportunity.reorderScore}</td>
                <td className={tdClass}>{opportunity.probability}%</td>
                <td className={`${tdClass} font-semibold`}>{formatKes(opportunity.expectedValue)}</td>
                <td className={tdClass}>{opportunity.status}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <PaginationNote count={topOpportunities.length} />
      </Panel>
    </div>
  )
}
