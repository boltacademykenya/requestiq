'use client'

import { useState } from 'react'
import type { CampaignDto } from '@/lib/api/dto'
import { apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  Spinner,
  buttonPrimary,
  formatDate,
  inputClass,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'] as const
const TYPES = ['REORDER_REMINDER', 'OVERDUE_FOLLOW_UP', 'WIN_BACK', 'CUSTOM'] as const
const STATUSES = ['', 'DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'] as const

const EMPTY_FORM = { name: '', channel: 'WHATSAPP', type: 'REORDER_REMINDER', messageTemplate: '', minReorderScore: '' }

type FormState = typeof EMPTY_FORM
type DispatchResult = { campaign: CampaignDto; queued: number; skipped: number }

export default function CampaignsTab({ canWrite }: { canWrite: boolean }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(
    () => apiList<CampaignDto>(withQuery('/api/v1/campaigns', { limit: 25, status: statusFilter })),
    [statusFilter],
  )

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<CampaignDto>('/api/v1/campaigns', 'POST', {
        name: form.name.trim(),
        channel: form.channel,
        type: form.type,
        ...(form.messageTemplate.trim() ? { messageTemplate: form.messageTemplate.trim() } : {}),
        audienceFilter: form.minReorderScore
          ? { minReorderScore: Number(form.minReorderScore) }
          : {},
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setNotice(`${form.name.trim()} was created as a draft.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not create that campaign.')
    } finally {
      setSaving(false)
    }
  }

  async function dispatch(campaign: CampaignDto) {
    if (!window.confirm(`Queue ${campaign.name} for its audience now?`)) return
    setBusyId(campaign.id)
    setMutationError(null)
    setNotice(null)
    try {
      const result = await apiSend<DispatchResult>(
        `/api/v1/campaigns/${campaign.id}/dispatch`,
        'POST',
        { limit: 100 },
      )
      setNotice(
        `${campaign.name}: queued ${result.queued} recipient${result.queued === 1 ? '' : 's'}, skipped ${result.skipped}.`,
      )
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not dispatch that campaign.')
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Campaigns"
        description="Reach customers when a reorder is due. Messages are queued through the demo provider."
        actions={
          canWrite ? (
            <button type="button" className={buttonPrimary} onClick={() => setShowForm((open) => !open)}>
              {showForm ? 'Cancel' : 'New campaign'}
            </button>
          ) : null
        }
      >
        {showForm && canWrite && (
          <form onSubmit={create} className="well mb-6 grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Campaign name">
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Channel">
              <select
                value={form.channel}
                onChange={(event) => setForm({ ...form, channel: event.target.value })}
                className={selectClass}
              >
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                className={selectClass}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Minimum reorder score (optional)" hint="0–100. Blank targets all customers.">
              <input
                type="number"
                min="0"
                max="100"
                value={form.minReorderScore}
                onChange={(event) => setForm({ ...form, minReorderScore: event.target.value })}
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Message template (optional)">
                <textarea
                  rows={3}
                  value={form.messageTemplate}
                  onChange={(event) => setForm({ ...form, messageTemplate: event.target.value })}
                  className="field mt-1 w-full px-3.5 py-2.5 text-sm"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className={buttonPrimary}>
                {saving ? 'Saving…' : 'Create campaign'}
              </button>
            </div>
          </form>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {STATUSES.map((status) => (
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
              {status || 'All'}
            </button>
          ))}
        </div>

        {loading ? (
          <Spinner label="Loading campaigns…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            description="Create a campaign to remind customers whose reorders are due."
          />
        ) : (
          <>
            <DataTable head={['Name', 'Channel', 'Type', 'Status', 'Recipients', 'Sent', 'Scheduled', canWrite ? '' : 'Created']}>
              {rows.map((campaign) => (
                <tr key={campaign.id}>
                  <td className={`${tdClass} font-medium text-slate-900`}>{campaign.name}</td>
                  <td className={tdClass}>{campaign.channel}</td>
                  <td className={tdClass}>{campaign.type.replaceAll('_', ' ')}</td>
                  <td className={tdClass}>{campaign.status}</td>
                  <td className={tdClass}>{campaign.recipientCount}</td>
                  <td className={tdClass}>{campaign.sentCount}</td>
                  <td className={tdClass}>{formatDate(campaign.scheduledAt)}</td>
                  <td className={tdClass}>
                    {canWrite && campaign.status !== 'COMPLETED' && campaign.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        disabled={busyId === campaign.id}
                        onClick={() => void dispatch(campaign)}
                        className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-60"
                      >
                        {busyId === campaign.id ? 'Dispatching…' : 'Dispatch'}
                      </button>
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
