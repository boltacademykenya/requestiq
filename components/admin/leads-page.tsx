'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { LeadDto } from '@/lib/api/dto'
import { apiList, apiSend, withQuery } from '@/lib/api/client'
import SignOutButton from '@/components/workspace/sign-out-button'
import {
  DataTable,
  EmptyState,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonSecondary,
  formatDate,
  selectClass,
  tdClass,
} from '@/components/workspace/ui'
import { useResource } from '@/components/workspace/use-resource'

const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM'] as const

/**
 * ReorderIQ staff inbox for inbound contact-form enquiries.
 *
 * These submissions are platform data, not tenant data: the public form is
 * anonymous, so nothing here is scoped to an organization. Access is enforced
 * server-side by the page guard and by `platformAdmin` on the API routes.
 */
export default function AdminLeadsPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () => apiList<LeadDto>(withQuery('/api/v1/platform/leads', { limit: 25, status: statusFilter })),
    [statusFilter],
  )

  async function setStatus(lead: LeadDto, status: string) {
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<LeadDto>(`/api/v1/platform/leads/${lead.id}`, 'PATCH', { status })
      setNotice(`${lead.businessName} marked ${status}.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not update that lead.')
    }
  }

  const rows = data?.items ?? []

  return (
    <main className="min-h-screen bg-canvas text-slate-950">
      <header className="bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">ReorderIQ platform</p>
            <h1 className="text-lg font-semibold tracking-tight">Inbound leads</h1>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/workspace" className="text-sm font-semibold text-slate-600 hover:text-emerald-700">
              Back to workspace
            </Link>
            {/* Staff sign in through the same better-auth session as tenants, so
                this surface needs the same way out. */}
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
        <div className="space-y-5">
          {mutationError && <Notice>{mutationError}</Notice>}
          {notice && <Notice tone="success">{notice}</Notice>}

          <Panel
            title="Contact form submissions"
            description="Enquiries sent through the public site. Visible to the ReorderIQ team only."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {['', ...STATUSES].map((status) => (
                <button
                  key={status || 'ALL'}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    statusFilter === status
                      ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-900/20'
                      : 'bg-wash text-slate-600 hover:bg-wash-strong hover:text-slate-900'
                  }`}
                >
                  {status ? status.replaceAll('_', ' ') : 'All'}
                </button>
              ))}
              <button
                type="button"
                onClick={reload}
                className={`${buttonSecondary} ml-auto h-8 text-xs`}
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <Spinner label="Loading leads…" />
            ) : error ? (
              <Notice onRetry={reload}>{error.message}</Notice>
            ) : rows.length === 0 ? (
              <EmptyState
                title="No leads"
                description="Enquiries submitted through the public contact form land here."
              />
            ) : (
              <>
                <DataTable head={['Business', 'Contact', 'Topic', 'Message', 'Received', 'Status']}>
                  {rows.map((lead) => (
                    <tr key={lead.id}>
                      <td className={`${tdClass} align-top font-medium text-slate-900`}>
                        {lead.businessName}
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">{lead.email}</span>
                        {lead.phone && (
                          <span className="mt-0.5 block text-xs font-normal text-slate-500">{lead.phone}</span>
                        )}
                      </td>
                      <td className={`${tdClass} align-top`}>{lead.name}</td>
                      <td className={`${tdClass} align-top`}>{lead.topic}</td>
                      <td className={`${tdClass} max-w-sm align-top text-xs leading-5`}>{lead.message}</td>
                      <td className={`${tdClass} align-top`}>{formatDate(lead.createdAt)}</td>
                      <td className={`${tdClass} align-top`}>
                        <select
                          value={lead.status}
                          onChange={(event) => void setStatus(lead, event.target.value)}
                          aria-label={`Status for ${lead.businessName}`}
                          className={`${selectClass} mt-0 h-9 w-40`}
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </DataTable>
                <PaginationNote count={rows.length} total={data?.pagination?.total} />
              </>
            )}
          </Panel>
        </div>
      </div>
    </main>
  )
}
