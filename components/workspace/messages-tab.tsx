'use client'

import { useState } from 'react'
import type { CustomerDto, MessageDto } from '@/lib/api/dto'
import { apiList, apiSend, withQuery } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  PaginationNote,
  Panel,
  SidebarItem,
  Spinner,
  buttonPrimary,
  formatDate,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

/**
 * The Messages section.
 *
 * The channels are tabs in a sidebar inside this section: "All messages" plus
 * one entry per channel — WhatsApp, SMS, Email — each with a count of the
 * messages loaded so far. Selecting an entry shows that channel's message list
 * beside it, with its own compose form, so reading or updating one channel's
 * flow never touches the others.
 */

type ChannelKey = 'WHATSAPP' | 'SMS' | 'EMAIL'

const CHANNELS: Array<{ key: ChannelKey; name: string; description: string }> = [
  { key: 'WHATSAPP', name: 'WhatsApp', description: 'Outbound and inbound messages over WhatsApp Business.' },
  { key: 'SMS', name: 'SMS', description: 'Outbound and inbound messages over the SMS gateway.' },
  { key: 'EMAIL', name: 'Email', description: 'Outbound and inbound messages over email.' },
]

const CHANNEL_COUNT_CLASS = 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500'
const CHANNEL_COUNT_ACTIVE_CLASS = 'rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white'

export default function MessagesTab({ canWrite }: { canWrite: boolean }) {
  // Which sidebar entry is open. 'ALL' shows every channel together.
  const [selected, setSelected] = useState<'ALL' | ChannelKey>('ALL')
  const [showForm, setShowForm] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [channel, setChannel] = useState<string>('WHATSAPP')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const messages = useResource(() => apiList<MessageDto>(withQuery('/api/v1/messages', { limit: 25 })), [])
  const customers = useResource(() => apiList<CustomerDto>('/api/v1/customers?limit=100'), [])

  const loaded = messages.data?.items ?? []
  // Per-channel counts over the messages loaded so far (the list endpoint caps at 25).
  const counts = new Map<string, number>()
  for (const message of loaded) counts.set(message.channel, (counts.get(message.channel) ?? 0) + 1)

  const selectedChannel = CHANNELS.find((entry) => entry.key === selected) ?? null
  const rows = loaded.filter((message) => selectedChannel === null || message.channel === selectedChannel.key)
  const pickableCustomers = customers.data?.items ?? []

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<MessageDto>('/api/v1/messages', 'POST', {
        customerId,
        channel: selectedChannel?.key ?? channel,
        direction: 'OUTBOUND',
        body: body.trim(),
      })
      setBody('')
      setShowForm(false)
      setNotice('Message queued through the demo provider.')
      messages.reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not queue that message.')
    } finally {
      setBusy(false)
    }
  }

  const countClass = (active: boolean) => (active ? CHANNEL_COUNT_ACTIVE_CLASS : CHANNEL_COUNT_CLASS)

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* The messages sidebar — one entry per channel. */}
        <nav aria-label="Messages" className="lg:w-60 lg:shrink-0">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:surface lg:flex-col lg:gap-1 lg:p-2">
            <li className="shrink-0">
              <SidebarItem
                label="All messages"
                active={selected === 'ALL'}
                onClick={() => setSelected('ALL')}
                trailing={loaded.length > 0 ? <span className={countClass(selected === 'ALL')}>{loaded.length}</span> : undefined}
              />
            </li>
            {CHANNELS.map((entry) => (
              <li key={entry.key} className="shrink-0 lg:shrink">
                <SidebarItem
                  label={entry.name}
                  active={selected === entry.key}
                  onClick={() => setSelected(entry.key)}
                  trailing={
                    counts.get(entry.key) ? (
                      <span className={countClass(selected === entry.key)}>{counts.get(entry.key)}</span>
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 hidden px-3 text-[11px] leading-5 text-slate-400 lg:block">
            Pick a channel to see the messages sent over it, or to compose one.
          </p>
        </nav>

        <div className="min-w-0 flex-1">
          <Panel
            title={selectedChannel ? selectedChannel.name + ' messages' : 'All messages'}
            description={
              selectedChannel
                ? selectedChannel.description
                : 'Every outbound and inbound message, across campaigns and one-off sends.'
            }
            actions={
              canWrite && pickableCustomers.length > 0 ? (
                <button type="button" className={buttonPrimary} onClick={() => setShowForm((open) => !open)}>
                  {showForm ? 'Cancel' : 'Compose'}
                </button>
              ) : null
            }
          >
            {showForm && canWrite && (
              <form onSubmit={send} className="well mb-6 grid gap-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Customer">
                    <select
                      required
                      value={customerId}
                      onChange={(event) => setCustomerId(event.target.value)}
                      className={selectClass}
                    >
                      <option value="">Select a customer</option>
                      {pickableCustomers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Channel">
                    {selectedChannel ? (
                      <input value={selectedChannel.name} readOnly disabled className={selectClass + ' text-slate-500'} />
                    ) : (
                      <select
                        value={channel}
                        onChange={(event) => setChannel(event.target.value)}
                        className={selectClass}
                      >
                        {CHANNELS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <Field label="Message">
                  <textarea
                    required
                    rows={3}
                    maxLength={4000}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="field mt-1 w-full px-3.5 py-2.5 text-sm"
                  />
                </Field>
                <div>
                  <button type="submit" disabled={busy} className={buttonPrimary}>
                    {busy ? 'Queueing…' : 'Queue message'}
                  </button>
                </div>
              </form>
            )}

            {messages.loading ? (
              <Spinner label="Loading messages…" />
            ) : messages.error ? (
              <Notice onRetry={messages.reload}>{messages.error.message}</Notice>
            ) : rows.length === 0 ? (
              <EmptyState
                title={selectedChannel ? 'No messages on ' + selectedChannel.name + ' yet' : 'No messages'}
                description="Messages appear once a campaign is dispatched or you compose one."
              />
            ) : (
              <>
                <DataTable
                  head={
                    selectedChannel
                      ? ['Customer', 'Direction', 'Status', 'Provider', 'Sent', 'Preview']
                      : ['Customer', 'Channel', 'Direction', 'Status', 'Provider', 'Sent', 'Preview']
                  }
                >
                  {rows.map((message) => (
                    <tr key={message.id}>
                      <td className={`${tdClass} font-medium text-slate-900`}>{message.customerName}</td>
                      {selectedChannel === null && <td className={tdClass}>{message.channel}</td>}
                      <td className={tdClass}>{message.direction}</td>
                      <td className={tdClass}>{message.status}</td>
                      <td className={tdClass}>{message.provider}</td>
                      <td className={tdClass}>{formatDate(message.sentAt)}</td>
                      <td className={`${tdClass} max-w-xs truncate`} title={message.body}>
                        {message.body}
                      </td>
                    </tr>
                  ))}
                </DataTable>
                <PaginationNote count={rows.length} total={messages.data?.pagination?.total} />
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
