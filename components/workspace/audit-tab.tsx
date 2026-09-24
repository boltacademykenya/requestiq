'use client'

import { useState } from 'react'
import type { AuditLogDto } from '@/lib/api/dto'
import { apiList, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonSecondary,
  formatDate,
  inputClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

export default function AuditTab() {
  const [entityType, setEntityType] = useState('')
  const [committed, setCommitted] = useState('')

  const { data, error, loading, reload } = useResource(
    () => apiList<AuditLogDto>(withQuery('/api/v1/audit', { limit: 50, entityType: committed })),
    [committed],
  )

  const rows = data?.items ?? []

  return (
    <Panel
      title="Activity trail"
      description="Append-only record of every change made in this workspace."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setCommitted(entityType.trim())
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <div className="min-w-56 flex-1">
          <Field label="Filter by entity type">
            <input
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              placeholder="customer, order, organization…"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className={buttonSecondary}>
            Filter
          </button>
          {committed && (
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                setEntityType('')
                setCommitted('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : error ? (
        <Notice onRetry={reload}>{error.message}</Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Actions such as creating orders, updating members or dispatching campaigns appear here."
        />
      ) : (
        <>
          <DataTable head={['When', 'Action', 'Entity', 'Entity id', 'Actor']}>
            {rows.map((log) => (
              <tr key={log.id}>
                <td className={tdClass}>{formatDate(log.createdAt)}</td>
                <td className={`${tdClass} font-medium text-slate-900`}>{log.action}</td>
                <td className={tdClass}>{log.entityType}</td>
                <td className={`${tdClass} font-mono text-xs`}>{log.entityId ?? '—'}</td>
                <td className={tdClass}>{log.actorUserId ?? 'system'}</td>
              </tr>
            ))}
          </DataTable>
          <PaginationNote count={rows.length} total={data?.pagination?.total} />
        </>
      )}
    </Panel>
  )
}
