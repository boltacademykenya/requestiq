'use client'

import { useState } from 'react'
import type { CustomerDto, CustomerRefreshDto, IntegrationDto } from '@/lib/api/dto'
import { apiDelete, apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const EMPTY_FORM = { name: '', phone: '', email: '', location: '', assignedSalesperson: '' }

type FormState = typeof EMPTY_FORM

/** "ZOHO_INVENTORY" -> "Zoho inventory", for a connection with no display name. */
function providerLabel(provider: string): string {
  const [first, ...rest] = provider.toLowerCase().split('_')
  return [first ? `${first[0]!.toUpperCase()}${first.slice(1)}` : '', ...rest].join(' ').trim()
}

const sourceBadgeClass =
  'inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700'

export default function CustomersTab({
  canWrite,
  canManageSources,
}: {
  canWrite: boolean
  /** Reading a tenant's external systems is `integration:manage`, not `customer:write`. */
  canManageSources: boolean
}) {
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [source, setSource] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [mergeSource, setMergeSource] = useState<CustomerDto | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState('')
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const integrations = useResource(() => apiList<IntegrationDto>('/api/v1/integrations'), [])
  const sources = integrations.data?.items ?? []

  const { data, error, loading, reload } = useResource(
    () =>
      apiList<CustomerDto>(
        withQuery('/api/v1/customers', { limit: 25, sort: 'recent', search: committedSearch, source }),
      ),
    [committedSearch, source],
  )

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<CustomerDto>('/api/v1/customers', 'POST', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.location.trim() ? { location: form.location.trim() } : {}),
        ...(form.assignedSalesperson.trim()
          ? { assignedSalesperson: form.assignedSalesperson.trim() }
          : {}),
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setNotice(`${form.name.trim()} was added to your customers.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not save that customer.')
    } finally {
      setBusy(false)
    }
  }

  async function deactivate(customer: CustomerDto) {
    if (!window.confirm(`Remove ${customer.name} from active customers? Order history is kept.`)) return
    setMutationError(null)
    setNotice(null)
    try {
      await apiDelete(`/api/v1/customers/${customer.id}`)
      setNotice(`${customer.name} was removed from active customers.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not update that customer.')
    }
  }

  async function refreshSources(customer: CustomerDto) {
    setMutationError(null)
    setNotice(null)
    setRefreshingId(customer.id)
    try {
      const result = await apiSend<CustomerRefreshDto>(`/api/v1/customers/${customer.id}/refresh`, 'POST')
      if (!result.connections.length) {
        setNotice(`${customer.name} was added by hand, so there is no source to refresh.`)
      } else {
        const summary = result.connections
          .map((entry) => `${entry.displayName ?? providerLabel(entry.provider)}: ${entry.outcome.toLowerCase()}`)
          .join(', ')
        setNotice(`${customer.name} re-pulled from its sources — ${summary}.`)
      }
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not refresh that customer.')
    } finally {
      setRefreshingId(null)
    }
  }

  async function merge() {
    if (!mergeSource) return
    const target = (data?.items ?? []).find((entry) => entry.id === mergeTargetId)
    if (!target) {
      setMutationError('Choose the customer to keep.')
      return
    }
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<CustomerDto>(`/api/v1/customers/${target.id}/merge`, 'POST', {
        duplicateId: mergeSource.id,
      })
      setNotice(
        `${mergeSource.name} was merged into ${target.name}. Their orders now count as one customer.`,
      )
      setMergeSource(null)
      setMergeTargetId('')
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not merge those customers.')
    } finally {
      setBusy(false)
    }
  }

  const customers = data?.items ?? []
  const showActions = canWrite || canManageSources

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Customers"
        description="Everyone you sell to, with the history that drives reorder predictions."
        actions={
          canWrite ? (
            <button type="button" className={buttonPrimary} onClick={() => setShowForm((open) => !open)}>
              {showForm ? 'Cancel' : 'Add customer'}
            </button>
          ) : null
        }
      >
        {showForm && canWrite && (
          <form onSubmit={create} className="well mb-6 grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Customer name">
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Phone" hint="6–32 characters, digits and + ( ) - only.">
              <input
                required
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className={inputClass}
                placeholder="+254700111222"
              />
            </Field>
            <Field label="Email (optional)">
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Location (optional)">
              <input
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Assigned salesperson (optional)">
              <input
                value={form.assignedSalesperson}
                onChange={(event) => setForm({ ...form, assignedSalesperson: event.target.value })}
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <button type="submit" disabled={busy} className={buttonPrimary}>
                {busy ? 'Saving…' : 'Save customer'}
              </button>
            </div>
          </form>
        )}

        {mergeSource && (
          <div className="well mb-4 grid gap-4 p-4 sm:grid-cols-[2fr_1fr]">
            <Field
              label={`Merge “${mergeSource.name}” into`}
              hint="The customer you keep keeps its id and contact details; this one's orders, aliases and messages move across. Nothing is deleted."
            >
              <select
                value={mergeTargetId}
                onChange={(event) => setMergeTargetId(event.target.value)}
                className={selectClass}
              >
                <option value="">Choose the customer to keep…</option>
                {(data?.items ?? [])
                  .filter((entry) => entry.id !== mergeSource.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.email ? ` · ${entry.email}` : ''}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <button type="button" disabled={busy || !mergeTargetId} className={buttonPrimary} onClick={() => void merge()}>
                {busy ? 'Merging…' : 'Merge customers'}
              </button>
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => {
                  setMergeSource(null)
                  setMergeTargetId('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setCommittedSearch(search.trim())
            }}
            className="flex gap-2"
          >
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers by name…"
              aria-label="Search customers"
              className={inputClass}
            />
            <button type="submit" className={buttonSecondary}>
              Search
            </button>
            {committedSearch && (
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => {
                  setSearch('')
                  setCommittedSearch('')
                }}
              >
                Clear
              </button>
            )}
          </form>

          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            aria-label="Filter customers by source"
            className={`${selectClass} sm:max-w-64`}
          >
            <option value="">All sources</option>
            {sources.map((integration) => (
              <option key={integration.id} value={integration.id}>
                {integration.displayName ?? providerLabel(integration.provider)}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner label="Loading customers…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : customers.length === 0 ? (
          <EmptyState
            title={committedSearch || source ? 'No matching customers' : 'No customers yet'}
            description={
              committedSearch || source
                ? 'Try a different search term or source.'
                : 'Add your first customer or import order history to start predicting reorders.'
            }
          />
        ) : (
          <>
            <DataTable
              head={['Name', 'Source', 'Phone', 'Email', 'Last order', showActions ? 'Actions' : 'Status']}
            >
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{customer.name}</td>
                  <td className={tdClass}>
                    {customer.sources.length === 0 ? (
                      <span className="text-xs text-slate-500">Manual</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {customer.sources.map((entry) => (
                          <span key={entry.integrationId} className="flex flex-col gap-0.5">
                            <span
                              className={sourceBadgeClass}
                              title={`${entry.provider} · id ${entry.externalId}${
                                entry.master ? ' · customer master' : ''
                              }`}
                            >
                              {entry.displayName ?? providerLabel(entry.provider)}
                              {entry.status !== 'CONNECTED' && (
                                <span className="ml-1 text-amber-700">· {entry.status.toLowerCase()}</span>
                              )}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {entry.integrationLastSyncedAt
                                ? `synced ${new Date(entry.integrationLastSyncedAt).toLocaleDateString('en-KE', {
                                    day: '2-digit',
                                    month: 'short',
                                  })}`
                                : 'never synced'}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={tdClass}>{customer.phone}</td>
                  <td className={tdClass}>{customer.email ?? '—'}</td>
                  <td className={tdClass}>
                    {customer.lastOrderAt
                      ? new Date(customer.lastOrderAt).toLocaleDateString('en-KE', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className={tdClass}>
                    {showActions ? (
                      <div className="flex flex-wrap gap-3">
                        {canManageSources && customer.sources.length > 0 && (
                          <button
                            type="button"
                            disabled={refreshingId === customer.id}
                            onClick={() => void refreshSources(customer)}
                            className="text-xs font-semibold text-sky-700 hover:underline disabled:opacity-50"
                            title="Re-run each connection that knows this customer"
                          >
                            {refreshingId === customer.id ? 'Refreshing…' : 'Refresh'}
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => {
                              setMergeSource(customer)
                              setMergeTargetId('')
                            }}
                            className="text-xs font-semibold text-slate-700 hover:underline"
                          >
                            Merge…
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => void deactivate(customer)}
                            className="text-xs font-semibold text-rose-700 hover:underline"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    ) : customer.isActive ? (
                      'Active'
                    ) : (
                      'Inactive'
                    )}
                  </td>
                </tr>
              ))}
            </DataTable>
            <PaginationNote count={customers.length} total={data?.pagination?.total} />
          </>
        )}
      </Panel>
    </div>
  )
}
