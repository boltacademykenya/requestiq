'use client'

import { useState } from 'react'
import type { OpportunityDto } from '@/lib/api/dto'
import { apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonPrimary,
  buttonSecondary,
  formatDate,
  formatMoney,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const STATUSES = [
  'UPCOMING',
  'DUE',
  'OVERDUE',
  'HIGH_OPPORTUNITY',
  'AT_RISK',
  'CONTACTED',
  'ORDER_CREATED',
  'CONVERTED',
  'DISMISSED',
] as const

type RecomputeResult = { opportunityCount: number; opportunities: OpportunityDto[] }

export default function OpportunitiesTab({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [minScore, setMinScore] = useState('')
  const [committedMinScore, setCommittedMinScore] = useState('')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () =>
      apiList<OpportunityDto>(
        withQuery('/api/v1/opportunities', {
          limit: 50,
          status: statusFilter,
          minScore: committedMinScore,
        }),
      ),
    [statusFilter, committedMinScore],
  )

  async function recompute() {
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      const result = await apiSend<RecomputeResult>('/api/v1/opportunities/recompute', 'POST')
      setNotice(`Recomputed ${result.opportunityCount} opportunities from current order history.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not recompute opportunities.')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(opportunity: OpportunityDto, status: string) {
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<OpportunityDto>(`/api/v1/opportunities/${opportunity.id}`, 'PATCH', { status })
      setNotice(`${opportunity.customerName} marked as ${status}.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not update that opportunity.')
    }
  }

  const rows = data?.items ?? []

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Reorder opportunities"
        description="Computed from customer purchase intervals — recompute after importing history."
        actions={
          canWrite ? (
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void recompute()}>
              {busy ? 'Recomputing…' : 'Recompute'}
            </button>
          ) : null
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('')}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              statusFilter === ''
                ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-900/20'
                : 'bg-wash text-slate-600 hover:bg-wash-strong hover:text-slate-900'
            }`}
          >
            All
          </button>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                statusFilter === status
                  ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-900/20'
                  : 'bg-wash text-slate-600 hover:bg-wash-strong hover:text-slate-900'
              }`}
            >
              {status.replaceAll('_', ' ')}
            </button>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setCommittedMinScore(minScore)
            }}
            className="ml-auto flex items-center gap-2"
          >
            <input
              type="number"
              min="0"
              max="100"
              value={minScore}
              onChange={(event) => setMinScore(event.target.value)}
              placeholder="Min score"
              aria-label="Minimum reorder score"
              className="field h-10 w-28 px-3 text-sm"
            />
            <button type="submit" className={buttonSecondary}>
              Apply
            </button>
          </form>
        </div>

        {loading ? (
          <Spinner label="Loading opportunities…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No opportunities"
            description="Opportunities appear once customers have order history. Try recomputing, or relax the filters."
          />
        ) : (
          <>
            <DataTable head={['Customer', 'Expected', 'Score', 'Probability', 'Value', 'Status']}>
              {rows.map((opportunity) => (
                <tr key={opportunity.id}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{opportunity.customerName}</td>
                  <td className={tdClass}>{formatDate(opportunity.expectedDate)}</td>
                  <td className={tdClass}>{opportunity.reorderScore}</td>
                  <td className={tdClass}>{opportunity.probability}%</td>
                  <td className={`${tdClass} font-semibold`}>
                    {formatMoney(opportunity.expectedValue, currency)}
                  </td>
                  <td className={tdClass}>
                    {canWrite ? (
                      <select
                        value={opportunity.status}
                        onChange={(event) => void setStatus(opportunity, event.target.value)}
                        aria-label={`Status for ${opportunity.customerName}`}
                        className={`${selectClass} mt-0 h-9 w-44`}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      opportunity.status.replaceAll('_', ' ')
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
            <PaginationNote count={rows.length} total={data?.pagination?.total} />
          </>
        )}
      </Panel>
    </div>
  )
}
