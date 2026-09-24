'use client'

import type { SyncRunDto } from '@/lib/api/dto'
import { apiList, withQuery } from '@/lib/api/client'
import { DataTable, EmptyState, Notice, Spinner, tdClass } from './ui'
import { useResource } from './use-resource'

/**
 * Sync run history.
 *
 * `last_synced_at` alone cannot tell an operator whether a connector is healthy:
 * this shows what each run read, wrote and rejected, so "it synced" and "it
 * actually imported anything" are visibly different things.
 */

const RUN_TONES: Record<SyncRunDto['status'], string> = {
  RUNNING: 'bg-slate-100 text-slate-700',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800',
  PARTIAL: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-rose-100 text-rose-800',
}

/** One-line summary of what a run imported, shared with the tab's result notice. */
export function summariseRun(counts: SyncRunDto['counts']) {
  const parts: string[] = []
  const resources: Array<[string, SyncRunDto['counts']['customers']]> = [
    ['customers', counts.customers],
    ['products', counts.products],
    ['orders', counts.orders],
  ]
  for (const [name, countsFor] of resources) {
    if (countsFor.fetched === 0 && countsFor.created === 0 && countsFor.updated === 0 && countsFor.rejected === 0) continue
    parts.push(
      `${name}: ${countsFor.created} new, ${countsFor.updated} updated${countsFor.rejected ? `, ${countsFor.rejected} rejected` : ''}`,
    )
  }
  return parts.join(' · ') || 'nothing to read'
}

function duration(run: SyncRunDto) {
  if (run.durationMs === null) return '—'
  return run.durationMs < 1000 ? `${run.durationMs} ms` : `${(run.durationMs / 1000).toFixed(1)} s`
}

export default function SyncRuns({ integrationId }: { integrationId: string }) {
  const { data, error, loading, reload } = useResource(
    () => apiList<SyncRunDto>(withQuery(`/api/v1/integrations/${integrationId}/runs`, { limit: 10 })),
    [integrationId],
  )

  const runs = data?.items ?? []

  return (
    <div className="well mt-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent syncs</h4>
        <button type="button" onClick={reload} className="text-xs font-semibold text-emerald-800 hover:underline">
          Refresh
        </button>
      </div>

      <div className="mt-3">
        {loading ? (
          <Spinner label="Loading run history…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : runs.length === 0 ? (
          <EmptyState title="No syncs yet" description="Run a sync (or wait for the schedule) and the outcome appears here." />
        ) : (
          <DataTable head={['Started', 'Trigger', 'Status', 'Result', 'Took', 'Error']}>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className={tdClass}>{new Date(run.startedAt).toLocaleString('en-KE')}</td>
                <td className={tdClass}>{run.trigger === 'SCHEDULE' ? 'Schedule' : 'Manual'}</td>
                <td className={tdClass}>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RUN_TONES[run.status]}`}>{run.status}</span>
                </td>
                <td className={`${tdClass} max-w-[320px]`}>{summariseRun(run.counts)}</td>
                <td className={tdClass}>{duration(run)}</td>
                <td className={`${tdClass} max-w-[280px]`}>{run.error ?? '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {runs.length > 0 && runs[0]!.counts.rejections.length > 0 && (
        <div className="mt-3">
          <Notice tone="warning">
            <span>
              Most recent rejections:
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                {runs[0]!.counts.rejections.slice(0, 5).map((entry) => (
                  <li key={`${entry.resource}-${entry.reason}`}>
                    <span className="font-semibold">{entry.resource}</span>: {entry.reason} ({entry.count})
                  </li>
                ))}
              </ul>
            </span>
          </Notice>
        </div>
      )}
    </div>
  )
}
