'use client'

import { useState } from 'react'
import { apiGet, apiList } from '@/lib/api/client'
import type { ConnectorPresetDto, IntegrationDto } from '@/lib/api/dto'
import ConnectorPage from './integrations-connector-page'
import { DataTable, EmptyState, Notice, Panel, SidebarItem, Spinner, formatDate, tdClass } from './ui'
import { useResource } from './use-resource'

/**
 * The Integrations section.
 *
 * The integrations are tabs in a sidebar inside this section: "All connections"
 * plus one entry per provider — Zoho Inventory, Shopify, WooCommerce, Paystack,
 * custom REST. Selecting an entry shows that provider's page
 * (`./integrations-connector-page`) beside it, so reading or updating one
 * integration never requires touching another provider's code path.
 *
 * A provider with more than one connection gets one entry **per connection**:
 * two Shopify stores are two sources with their own credential, schedule and run
 * history, and a single "Shopify" tab could only ever show one of them.
 *
 * Adding a provider:
 *   1. add its template to `lib/connectors/presets.ts` (the backend entity),
 *   2. add an entry to `PROVIDERS` below — nothing else changes.
 */

type ProviderKey = 'ZOHO_INVENTORY' | 'SHOPIFY' | 'WOOCOMMERCE' | 'PAYSTACK' | 'CUSTOM'

type ProviderCard = {
  key: ProviderKey
  name: string
  summary: string
}

/** Presentation metadata only — endpoints and mappings come from the backend. */
const PROVIDERS: ProviderCard[] = [
  { key: 'ZOHO_INVENTORY', name: 'Zoho Inventory', summary: 'Contacts, items and sales orders from Zoho Inventory.' },
  { key: 'SHOPIFY', name: 'Shopify', summary: 'Customers, products and orders from your Shopify store admin.' },
  { key: 'WOOCOMMERCE', name: 'WooCommerce', summary: 'Customers, products and orders from your WooCommerce store.' },
  { key: 'PAYSTACK', name: 'Paystack', summary: 'Customers and payment transactions read as completed orders.' },
  {
    key: 'CUSTOM',
    name: 'Custom / any REST API',
    summary: 'A POS, an ERP, a spreadsheet service — any REST endpoint, mapped by hand.',
  },
]

const STATUS_TONES: Record<string, string> = {
  CONNECTED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  ERROR: 'bg-rose-100 text-rose-800',
  DISCONNECTED: 'bg-slate-100 text-slate-600',
}

/** Sidebar status dot per connection status. */
const STATUS_DOTS: Record<string, string> = {
  CONNECTED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  ERROR: 'bg-rose-500',
  DISCONNECTED: 'bg-slate-300',
}

function providerDisplayName(integration: IntegrationDto) {
  return integration.displayName ?? integration.provider.replaceAll('_', ' ')
}

/** "ZOHO_INVENTORY" -> "Zoho Inventory". */
function providerLabel(provider: string) {
  return provider
    .toLowerCase()
    .split('_')
    .map((part) => (part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(' ')
}

/** One sidebar entry: a provider, or one specific connection of it. */
type SidebarEntry = {
  key: string
  label: string
  provider: ProviderKey
  integration: IntegrationDto | null
}

function buildEntries(providers: ProviderCard[], rows: IntegrationDto[]): SidebarEntry[] {
  const byProvider = new Map<string, IntegrationDto[]>()
  for (const row of rows) {
    const bucket = byProvider.get(row.provider) ?? []
    bucket.push(row)
    byProvider.set(row.provider, bucket)
  }

  return providers.flatMap((provider) => {
    const connections = byProvider.get(provider.key) ?? []
    if (connections.length <= 1) {
      return [
        { key: provider.key, label: provider.name, provider: provider.key, integration: connections[0] ?? null },
      ]
    }
    return connections.map((connection) => ({
      key: connection.id,
      label: `${provider.name} · ${providerDisplayName(connection)}`,
      provider: provider.key,
      integration: connection,
    }))
  })
}

export default function IntegrationsTab({ canManage }: { canManage: boolean }) {
  const integrations = useResource(() => apiList<IntegrationDto>('/api/v1/integrations'), [])
  // A provider without a template is still connectable as a custom source.
  const presets = useResource(() => apiGet<ConnectorPresetDto[]>('/api/v1/integrations/presets'), [])

  // Which sidebar entry is open (a provider key or a connection id). null shows
  // the connections overview.
  const [selected, setSelected] = useState<string | null>(null)

  const rows = integrations.data?.items ?? []
  const templates = presets.data ?? []

  const entries = buildEntries(PROVIDERS, rows)
  const selectedEntry = entries.find((entry) => entry.key === selected) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-5 lg:flex-row">
        {/* The integrations sidebar — one entry per integration. */}
        <nav aria-label="Integrations" className="lg:w-60 lg:shrink-0">
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:surface lg:flex-col lg:gap-1 lg:p-2">
            <li className="shrink-0">
              <SidebarItem label="All connections" active={selected === null} onClick={() => setSelected(null)} />
            </li>
            {entries.map((entry) => {
              const existing = entry.integration
              return (
                <li key={entry.key} className="shrink-0 lg:shrink">
                  <SidebarItem
                    label={entry.label}
                    active={selected === entry.key}
                    onClick={() => setSelected(entry.key)}
                    trailing={
                      existing ? (
                        <span
                          aria-label={existing.status === 'ERROR' ? 'needs attention' : existing.status.toLowerCase()}
                          className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOTS[existing.status] ?? 'bg-slate-300'}`}
                        />
                      ) : undefined
                    }
                  />
                </li>
              )
            })}
          </ul>
          <p className="mt-3 hidden px-3 text-[11px] leading-5 text-slate-400 lg:block">
            {presets.loading
              ? 'Loading providers…'
              : 'Pick a provider to set it up, or to manage its connection, schedule and run history.'}
          </p>
        </nav>

        <div className="min-w-0 flex-1">
          {selectedEntry === null ? (
            <Panel
              title="All connections"
              description="Where ReorderIQ reads customers, products and orders from. Credentials are stored encrypted and never shown again."
            >
              {integrations.loading ? (
                <Spinner label="Loading connections…" />
              ) : integrations.error ? (
                <Notice onRetry={integrations.reload}>{integrations.error.message}</Notice>
              ) : rows.length === 0 ? (
                <EmptyState
                  title="No sources connected"
                  description="Connect Zoho, Shopify, WooCommerce, a payment provider or your own API and ReorderIQ will start building reorder intelligence from your real order history."
                />
              ) : (
                <DataTable head={['Provider', 'Connection', 'Status', 'Last sync', 'Next sync', 'Credential']}>
                  {rows.map((integration) => (
                    <tr key={integration.id}>
                      <td className={`${tdClass} font-medium text-slate-900`}>{providerLabel(integration.provider)}</td>
                      <td className={tdClass}>{integration.displayName ?? '—'}</td>
                      <td className={tdClass}>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONES[integration.status] ?? ''}`}
                        >
                          {integration.status}
                        </span>
                      </td>
                      <td className={tdClass}>{formatDate(integration.lastSyncedAt)}</td>
                      <td className={tdClass}>{formatDate(integration.nextSyncAt)}</td>
                      <td className={tdClass}>{integration.hasCredential ? 'Stored' : integration.connector ? 'Not needed' : '—'}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Panel>
          ) : (
            <ConnectorPage
              key={selectedEntry.key}
              provider={selectedEntry.provider}
              providerName={selectedEntry.label}
              preset={templates.find((item) => item.provider === selectedEntry.provider) ?? null}
              integration={selectedEntry.integration}
              canManage={canManage}
              onChanged={integrations.reload}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      {!canManage && (
        <Notice tone="info">
          <span>Your role can see connections but not change them. Ask an owner or admin to configure a source.</span>
        </Notice>
      )}

      {canManage && (
        <p className="text-xs text-slate-400">
          Tip: a sync reads the whole source, so run one after configuring a connection, then check the run history for
          what it wrote and what it rejected.
        </p>
      )}
    </div>
  )
}
