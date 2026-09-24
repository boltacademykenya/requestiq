'use client'

import { useState } from 'react'
import { ApiClientError, apiDelete, apiSend } from '@/lib/api/client'
import type { ConnectorPresetDto, IntegrationDto, SyncResultDto, SyncRunDto } from '@/lib/api/dto'
import ConnectorEditor from './connector-editor'
import SyncRuns, { summariseRun } from './sync-runs'
import { Notice, Panel, buttonDanger, buttonSecondary, selectClass } from './ui'

/**
 * One provider's integrations page — rendered beside the integrations sidebar
 * inside the Integrations section.
 *
 * Each provider (Zoho Inventory, Shopify, WooCommerce, Paystack, a custom API)
 * gets its own page built from three panels:
 *
 * - **Connection** — status, schedule, last/next sync, last error, sync now and
 *   the disconnect flow for this provider's integration.
 * - **Configure** — the provider-specific credential, endpoints, paging and
 *   field mapping (ConnectorEditor). A fresh setup starts here; an active
 *   connection can be adjusted and re-activated.
 * - **History** — this connection's run history with per-resource counts.
 *
 * The component stays provider-agnostic: the provider-specific parts arrive as
 * the backend preset (endpoints, mappings, credential hint) and through
 * ConnectorEditor's per-provider fields. Adding or updating a provider never
 * touches this file.
 */

const STATUSES = ['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'] as const

const STATUS_TONES: Record<string, string> = {
  CONNECTED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  ERROR: 'bg-rose-100 text-rose-800',
  DISCONNECTED: 'bg-slate-100 text-slate-600',
}

/** One labelled read-out on the connection panel; `tone` renders as a status badge. */
function StatusTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="well px-3.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {tone ? (
        <span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ' + tone}>{value}</span>
      ) : (
        <p className="mt-1 text-sm text-slate-700">{value}</p>
      )}
    </div>
  )
}

export default function ConnectorPage({
  provider,
  providerName,
  preset,
  integration,
  canManage,
  onChanged,
  onClose,
}: {
  provider: string
  providerName: string
  preset: ConnectorPresetDto | null
  integration: IntegrationDto | null
  canManage: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const [current, setCurrent] = useState<IntegrationDto | null>(integration)
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<SyncRunDto | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function runSync() {
    if (!current) return
    setBusy('sync')
    setFailure(null)
    setResult(null)
    try {
      const outcome = await apiSend<SyncResultDto>('/api/v1/integrations/' + current.id + '/sync', 'POST')
      setResult(outcome.run)
      setCurrent(outcome.integration)
      onChanged()
    } catch (cause) {
      setFailure(cause instanceof ApiClientError ? cause.message : 'The sync could not be started.')
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(status: string) {
    if (!current) return
    setBusy('status')
    setFailure(null)
    try {
      const saved = await apiSend<IntegrationDto>('/api/v1/integrations/' + current.id, 'PATCH', { status })
      setCurrent(saved)
      onChanged()
    } catch (cause) {
      setFailure(cause instanceof ApiClientError ? cause.message : 'We could not update that connection.')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!current) return
    setBusy('disconnect')
    setFailure(null)
    try {
      await apiDelete('/api/v1/integrations/' + current.id)
      setCurrent(null)
      setResult(null)
      setConfirming(false)
      onChanged()
    } catch (cause) {
      setFailure(cause instanceof ApiClientError ? cause.message : 'We could not disconnect that provider.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {failure && <Notice>{failure}</Notice>}

      {result && (
        <Notice tone={result.status === 'FAILED' ? 'error' : result.status === 'PARTIAL' ? 'warning' : 'success'}>
          <span>
            <span className="font-semibold">{providerName}</span> — {result.status.toLowerCase()}: {summariseRun(result.counts)}
            {result.error ? ' · ' + result.error : ''}
          </span>
        </Notice>
      )}

      <Panel
        title={providerName}
        description={
          current
            ? 'This provider is connected. Review its status, adjust the configuration, or disconnect it below.'
            : 'Not connected yet. Set it up below — a draft is saved as PENDING and does not sync until you activate it.'
        }
        actions={
          <button type="button" onClick={onClose} className={buttonSecondary}>
            Back to all connections
          </button>
        }
      >
        {current ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatusTile label="Status" value={current.status} tone={STATUS_TONES[current.status]} />
              <StatusTile label="Last sync" value={current.lastSyncedAt ? new Date(current.lastSyncedAt).toLocaleString('en-KE') : 'never'} />
              <StatusTile label="Next sync" value={current.nextSyncAt ? new Date(current.nextSyncAt).toLocaleString('en-KE') : 'not scheduled'} />
              <StatusTile label="Credential" value={current.hasCredential ? 'Stored' : current.connector ? 'Not needed' : 'Missing'} />
            </div>
            {current.lastError && (
              <Notice tone="warning">
                <span>Last error: {current.lastError}</span>
              </Notice>
            )}

            {canManage && (
              <div className="flex flex-wrap items-center gap-2 pt-5">
                <select
                  value={current.status}
                  onChange={(event) => void changeStatus(event.target.value)}
                  disabled={busy !== null}
                  aria-label={'Status for ' + providerName}
                  className={selectClass + ' h-9 w-36'}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void runSync()} disabled={busy !== null} className={buttonSecondary}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Disconnect ' + providerName + '? Imported customers and orders are kept.')) {
                      void disconnect()
                    }
                  }}
                  disabled={busy !== null}
                  className={buttonDanger}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ) : (
          <Notice tone="info">
            <span>
              {canManage
                ? 'Set it up below. Nothing is live until a connection is activated.'
                : 'Nothing connected yet for this provider. Ask an owner or admin to set it up.'}
            </span>
          </Notice>
        )}
      </Panel>

      {canManage && (
        <Panel
          title={(current ? 'Configure ' : 'Connect ') + providerName}
          description="Nothing here is provider-specific code: the credential, endpoints, paging and field mapping are configuration you can change at any time."
        >
          <ConnectorEditor
            key={(current?.id ?? 'new') + ':' + provider}
            provider={provider}
            providerName={providerName}
            preset={preset}
            integration={current}
            onSaved={(saved) => {
              setCurrent(saved)
              onChanged()
            }}
            onClose={onClose}
          />
        </Panel>
      )}

      {current && (
        <SyncRuns
          integrationId={current.id}
          key={current.id}
        />
      )}
    </div>
  )
}
