'use client'

import { useState } from 'react'
import { ApiClientError, apiSend } from '@/lib/api/client'
import { CONNECTOR_FIELDS, type ConnectorResourceName } from '@/lib/connectors/config'
import {
  discoverApiStructure,
  pathsFromPayload,
  type ApiStructureDiscovery,
  type ResourceDiscovery,
} from '@/lib/connectors/discovery'
import type { ConnectorConnectionTestDto, ConnectorPreviewDto, ConnectorPresetDto, IntegrationDto } from '@/lib/api/dto'
import ConnectorResponsePanel from './connector-response'
import {
  Field,
  Notice,
  Spinner,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  tdClass,
  thClass,
} from './ui'

/**
 * Connector editor.
 *
 * This is what makes a provider "configurable from the UI": the endpoint, the
 * paging style and the field mapping are all entered here, and nothing about a
 * provider is compiled into the app. Four things matter most for usability:
 *
 * - **Test connection** (section 1) reads the base URL with the credential in
 *   front of you, before any resource is mapped, and shows the endpoint's own
 *   answer — including a 401 body;
 * - **Import API structure** (section 2) accepts what a counterparty actually
 *   sends (a sample response, an OpenAPI document, a connector export) and
 *   pre-fills endpoints and mappings from it — on the client, with nothing sent anywhere;
 * - **mapping inputs offer the paths of the last response** as a pick-list, so a
 *   path is chosen from the real payload rather than typed from memory;
 * - **Test & preview** reads one live page and shows the mapped rows *and* the raw
 *   response, so a wrong mapping is visible before it can write anything.
 *
 * A draft is saved as `PENDING`, which is *not* live, so an unfinished connection
 * never syncs by accident. Preview deliberately works on drafts.
 */

type ResourceKey = ConnectorResourceName
type PagingMode = 'none' | 'page' | 'offset' | 'cursor' | 'link-header'
type AuthType = 'none' | 'bearer' | 'header' | 'basic' | 'query'

type ResourceForm = {
  enabled: boolean
  path: string
  recordsPath: string
  queryJson: string
  maxRecords: string
  moneyScale: string
  referencePrefix: string
  updatedSinceParam: string
  fields: Record<string, string>
  itemsRecordsPath: string
  itemsFields: Record<string, string>
  pagingMode: PagingMode
  pagingParam: string
  pagingSizeParam: string
  pagingCursorPath: string
  pageSize: string
  pagingStart: string
  pagingMaxPages: string
}

type FormState = {
  displayName: string
  baseUrl: string
  authType: AuthType
  authHeader: string
  authParam: string
  authUsername: string
  credential: string
  headersJson: string
  queryJson: string
  interval: string
  resources: Record<ResourceKey, ResourceForm>
}

const RESOURCES: Array<{ key: ResourceKey; label: string; blurb: string }> = [
  { key: 'customers', label: 'Customers', blurb: 'Name and phone are required — the phone is what a reorder reaches.' },
  { key: 'products', label: 'Products', blurb: 'Optional. Used to price lines and suggest products.' },
  { key: 'orders', label: 'Orders', blurb: 'The important one: reorder intelligence is built from this history.' },
]

const AUTH_TYPES: Array<{ value: AuthType; label: string }> = [
  { value: 'none', label: 'No credential (public endpoint)' },
  { value: 'bearer', label: 'Bearer token (Authorization: Bearer …)' },
  { value: 'header', label: 'Custom header (e.g. X-Shopify-Access-Token)' },
  { value: 'basic', label: 'HTTP Basic (username + secret)' },
  { value: 'query', label: 'Query parameter' },
]

const PAGING_MODES: Array<{ value: PagingMode; label: string }> = [
  { value: 'none', label: 'Single request' },
  { value: 'page', label: 'Page numbers (?page=1)' },
  { value: 'offset', label: 'Offset / limit (?offset=0)' },
  { value: 'cursor', label: 'Cursor from the response' },
  { value: 'link-header', label: 'Link header (Shopify, GitHub)' },
]

function emptyFields(key: ResourceKey): Record<string, string> {
  return Object.fromEntries(CONNECTOR_FIELDS[key].map((field) => [field.key, '']))
}

function emptyResource(): ResourceForm {
  return {
    enabled: false,
    path: '',
    recordsPath: '',
    queryJson: '{}',
    maxRecords: '1000',
    moneyScale: '1',
    referencePrefix: '',
    updatedSinceParam: '',
    fields: {},
    itemsRecordsPath: '',
    itemsFields: {},
    pagingMode: 'none',
    pagingParam: '',
    pagingSizeParam: '',
    pagingCursorPath: '',
    pageSize: '100',
    pagingStart: '1',
    pagingMaxPages: '20',
  }
}

function emptyForm(): FormState {
  return {
    displayName: '',
    baseUrl: '',
    authType: 'none',
    authHeader: '',
    authParam: '',
    authUsername: '',
    credential: '',
    headersJson: '{}',
    queryJson: '{}',
    interval: '360',
    resources: {
      customers: { ...emptyResource(), fields: emptyFields('customers') },
      products: { ...emptyResource(), fields: emptyFields('products') },
      orders: { ...emptyResource(), fields: emptyFields('orders') },
    },
  }
}

type StoredConnector = {
  baseUrl?: string
  auth?: { type?: AuthType; header?: string; param?: string; username?: string }
  headers?: Record<string, string>
  query?: Record<string, string>
  resources?: Record<string, Record<string, unknown> | undefined>
  timeoutMs?: number
}

/** Loads a stored connector (or a provider template) into the form. */
function toForm(connector: StoredConnector | null | undefined, base: FormState): FormState {
  if (!connector) return base
  const next: FormState = {
    ...base,
    baseUrl: connector.baseUrl ?? base.baseUrl,
    authType: connector.auth?.type ?? 'none',
    authHeader: connector.auth?.header ?? '',
    authParam: connector.auth?.param ?? '',
    authUsername: connector.auth?.username ?? '',
    headersJson: JSON.stringify(connector.headers ?? {}, null, 0),
    queryJson: JSON.stringify(connector.query ?? {}, null, 0),
  }

  for (const { key } of RESOURCES) {
    const stored = connector.resources?.[key] as
      | {
          path?: string
          recordsPath?: string
          query?: Record<string, string>
          maxRecords?: number
          moneyScale?: number
          referencePrefix?: string
          updatedSinceParam?: string
          fields?: Record<string, string>
          pagination?: {
            mode?: PagingMode
            param?: string
            sizeParam?: string
            cursorPath?: string
            pageSize?: number
            startPage?: number
            maxPages?: number
          }
          items?: { recordsPath?: string; fields?: Record<string, string> }
        }
      | undefined

    if (!stored) continue
    next.resources[key] = {
      enabled: true,
      path: stored.path ?? '',
      recordsPath: stored.recordsPath ?? '',
      queryJson: JSON.stringify(stored.query ?? {}),
      maxRecords: String(stored.maxRecords ?? 1000),
      moneyScale: String(stored.moneyScale ?? 1),
      referencePrefix: stored.referencePrefix ?? '',
      updatedSinceParam: stored.updatedSinceParam ?? '',
      fields: { ...emptyFields(key), ...(stored.fields ?? {}) },
      itemsRecordsPath: stored.items?.recordsPath ?? '',
      itemsFields: { ...Object.fromEntries(CONNECTOR_FIELDS.orderItems.map((field) => [field.key, ''])), ...(stored.items?.fields ?? {}) },
      pagingMode: stored.pagination?.mode ?? 'none',
      pagingParam: stored.pagination?.param ?? '',
      pagingSizeParam: stored.pagination?.sizeParam ?? '',
      pagingCursorPath: stored.pagination?.cursorPath ?? '',
      pageSize: String(stored.pagination?.pageSize ?? 100),
      pagingStart: String(stored.pagination?.startPage ?? 1),
      pagingMaxPages: String(stored.pagination?.maxPages ?? 20),
    }
  }

  return next
}

/** Converts the form into the wire format. The server does the final validation. */
function buildConnector(form: FormState): Record<string, unknown> {
  const resources: Record<string, unknown> = {}

  for (const { key } of RESOURCES) {
    const resource = form.resources[key]
    if (!resource.enabled) continue

    const fields = Object.fromEntries(Object.entries(resource.fields).filter(([, value]) => value.trim().length > 0))
    const pagination: Record<string, unknown> = {
      mode: resource.pagingMode,
      pageSize: Number(resource.pageSize) || 100,
      startPage: Number(resource.pagingStart) || 0,
      maxPages: Number(resource.pagingMaxPages) || 20,
    }
    if (resource.pagingParam.trim()) pagination.param = resource.pagingParam.trim()
    if (resource.pagingSizeParam.trim()) pagination.sizeParam = resource.pagingSizeParam.trim()
    if (resource.pagingCursorPath.trim()) pagination.cursorPath = resource.pagingCursorPath.trim()

    const entry: Record<string, unknown> = {
      path: resource.path.trim(),
      recordsPath: resource.recordsPath,
      query: parseJson(resource.queryJson, 'Resource query parameters'),
      fields,
      pagination,
      maxRecords: Number(resource.maxRecords) || 1000,
      moneyScale: Number(resource.moneyScale) || 1,
    }
    if (key === 'orders' && resource.referencePrefix.trim()) entry.referencePrefix = resource.referencePrefix.trim()
    if (resource.updatedSinceParam.trim()) entry.updatedSinceParam = resource.updatedSinceParam.trim()

    if (key === 'orders') {
      const itemFields = Object.fromEntries(
        Object.entries(resource.itemsFields).filter(([, value]) => value.trim().length > 0),
      )
      if (Object.keys(itemFields).length) {
        entry.items = { recordsPath: resource.itemsRecordsPath, fields: itemFields }
      }
    }

    resources[key] = entry
  }

  const auth: Record<string, unknown> = { type: form.authType }
  if (form.authType === 'header' && form.authHeader.trim()) auth.header = form.authHeader.trim()
  if (form.authType === 'query' && form.authParam.trim()) auth.param = form.authParam.trim()
  if (form.authType === 'basic' && form.authUsername.trim()) auth.username = form.authUsername.trim()

  return {
    baseUrl: form.baseUrl.trim(),
    auth,
    headers: parseJson(form.headersJson, 'Extra headers'),
    query: parseJson(form.queryJson, 'Extra query parameters'),
    resources,
    timeoutMs: 15_000,
  }
}

function parseJson(text: string, label: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object, such as {"page_size":"100"}.`)
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') throw new Error(`${label} values must be strings.`)
      if (!key.trim()) throw new Error(`${label} cannot contain an empty key.`)
    }
    return parsed as Record<string, string>
  } catch {
    throw new Error(`${label} must be a valid JSON object.`)
  }
}

function authHint(form: FormState): string {
  switch (form.authType) {
    case 'bearer':
      return 'Sent as "Authorization: Bearer <credential>".'
    case 'header':
      return `Sent in the "${form.authHeader || '…'}" header, exactly as you type it.`
    case 'basic':
      return `HTTP Basic with username "${form.authUsername || '…'}"; the credential is the password.`
    case 'query':
      return `Sent as the "${form.authParam || '…'}" query parameter.`
    default:
      return 'No credential is sent. Only use this for a public endpoint.'
  }
}

export default function ConnectorEditor({
  provider,
  providerName,
  preset,
  integration,
  onSaved,
  onClose,
}: {
  provider: string
  providerName: string
  preset: ConnectorPresetDto | null
  integration: IntegrationDto | null
  onSaved: (integration: IntegrationDto) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => {
    const base: FormState = {
      ...emptyForm(),
      displayName: integration?.displayName ?? providerName,
      interval: String(integration?.syncIntervalMinutes ?? 360),
    }
    return toForm((integration?.connector as StoredConnector | null) ?? (preset?.connector as StoredConnector | null), base)
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([])
  const [preview, setPreview] = useState<ConnectorPreviewDto | null>(null)
  const [previewResource, setPreviewResource] = useState<ResourceKey>('customers')
  const [saved, setSaved] = useState<IntegrationDto | null>(integration)

  /** Last connection test, shown in section 1 next to its own button. */
  const [probe, setProbe] = useState<ConnectorConnectionTestDto | null>(null)
  const [probePath, setProbePath] = useState('')

  /** Import panel (client-side only: the pasted structure never leaves the browser). */
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importTarget, setImportTarget] = useState<ResourceKey>('customers')
  const [importReplace, setImportReplace] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)

  /**
   * Pick-lists per resource, from the last thing we actually read: a preview page,
   * a connection test, or an imported structure. They are what turn "type a path
   * from memory" into "choose a path from the payload".
   */
  const [sources, setSources] = useState<Partial<Record<ResourceKey, { paths: string[]; itemPaths: string[]; label: string }>>>({})

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }))
  const patchResource = (key: ResourceKey, changes: Partial<ResourceForm>) =>
    setForm((current) => ({ ...current, resources: { ...current.resources, [key]: { ...current.resources[key], ...changes } } }))

  function captureFailure(cause: unknown, fallback: string) {
    if (cause instanceof ApiClientError) {
      setError(cause.message)
      setIssues(cause.fieldIssues)
      return
    }
    setError(cause instanceof Error ? cause.message : fallback)
    setIssues([])
  }

  /** The connection half of the form: everything a probe needs, and no resource. */
  function buildProbe(): Record<string, unknown> {
    const auth: Record<string, unknown> = { type: form.authType }
    if (form.authType === 'header' && form.authHeader.trim()) auth.header = form.authHeader.trim()
    if (form.authType === 'query' && form.authParam.trim()) auth.param = form.authParam.trim()
    if (form.authType === 'basic' && form.authUsername.trim()) auth.username = form.authUsername.trim()

    return {
      baseUrl: form.baseUrl.trim(),
      auth,
      headers: parseJson(form.headersJson, 'Extra headers'),
      query: parseJson(form.queryJson, 'Extra query parameters'),
      timeoutMs: 15_000,
    }
  }

  /** The first enabled endpoint, used as the default thing to probe. */
  function firstEnabledPath(): string {
    for (const { key } of RESOURCES) {
      const resource = form.resources[key]
      if (resource.enabled && resource.path.trim()) return resource.path.trim()
    }
    return ''
  }

  /**
   * Tests the connection itself: one GET with the settings in section 1.
   *
   * Nothing is saved first — the endpoint and the credential are sent as they are
   * on screen, so this works on a half-filled form. A stored credential is reused
   * only when one exists and the credential field is blank.
   */
  async function testConnection() {
    setBusy('probe')
    setError(null)
    setIssues([])
    setProbe(null)
    try {
      const result = await apiSend<ConnectorConnectionTestDto>('/api/v1/integrations/test', 'POST', {
        connector: buildProbe(),
        path: probePath.trim() || firstEnabledPath(),
        ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
        ...(!form.credential.trim() && saved ? { integrationId: saved.id } : {}),
      })
      setProbe(result)
    } catch (cause) {
      captureFailure(cause, 'The connection could not be tested.')
    } finally {
      setBusy(null)
    }
  }

  /** Applies one resource's discovery to the form; existing mappings win unless asked. */
  function applyDiscovery(target: ResourceKey, discovered: ResourceDiscovery, replace: boolean, label: string) {
    const current = form.resources[target]
    const nextFields: Record<string, string> = { ...current.fields }
    for (const [key, value] of Object.entries(discovered.fields)) {
      if (replace || !(nextFields[key] ?? '').trim()) nextFields[key] = value
    }

    const nextItemFields: Record<string, string> = { ...current.itemsFields }
    for (const [key, value] of Object.entries(discovered.itemsFields)) {
      if (replace || !(nextItemFields[key] ?? '').trim()) nextItemFields[key] = value
    }

    patchResource(target, {
      enabled: true,
      ...(discovered.path ? { path: discovered.path } : {}),
      ...(discovered.recordsPath !== null ? { recordsPath: discovered.recordsPath } : {}),
      ...(target === 'orders' && discovered.itemsRecordsPath ? { itemsRecordsPath: discovered.itemsRecordsPath } : {}),
      fields: nextFields,
      itemsFields: target === 'orders' ? nextItemFields : current.itemsFields,
    })
    setSources((existing) => ({ ...existing, [target]: { paths: discovered.paths, itemPaths: discovered.itemPaths, label } }))
  }

  /** Parses the pasted structure and applies it, or reports why it could not be read. */
  function useImportedStructure() {
    setImportError(null)
    setImportNote(null)
    const text = importText.trim()
    if (!text) {
      setImportError('Paste the API structure (or choose a file) first.')
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      setImportError('That is not valid JSON. Paste the document exactly as it was sent, or pick the .json file.')
      return
    }

    const discovery = discoverApiStructure(parsed)
    const summary = (extra: string) => `${discovery.title} · ${extra}. ${discovery.notes.join(' ')}`.trim()

    // A connector export replaces the whole connection, so it is applied wholesale.
    if (discovery.kind === 'connector') {
      if (!discovery.connector) {
        setImportError(['That looks like a connector export, but it did not validate.', ...discovery.notes].join(' '))
        return
      }
      const base = { ...emptyForm(), displayName: form.displayName, interval: form.interval }
      setForm(toForm(discovery.connector as StoredConnector, base))
      setProbe(null)
      setImportNote(summary('applied to the whole form'))
      return
    }

    const discovered = discovery.resources[importTarget]
    if (!discovered) {
      setImportError(`Nothing usable was found for ${importTarget}. ${discovery.notes.join(' ')}`)
      return
    }

    // The base URL is only auto-filled from a document that declares one, and only
    // while the field is empty — never silently replaced.
    if (discovery.baseUrl && !form.baseUrl.trim()) patch({ baseUrl: discovery.baseUrl })

    const mapped = Object.keys(discovered.fields).length + Object.keys(discovered.itemsFields).length
    applyDiscovery(importTarget, discovered, importReplace, discovery.title)
    setImportNote(summary(`${mapped} field${mapped === 1 ? '' : 's'} proposed for ${importTarget}`))
  }

  /** Sends the body of a response to the import panel, so it can be mapped from. */
  function sendResponseToImport(body: string) {
    setImportText(body)
    setImportOpen(true)
    setImportError(null)
    setImportNote('Response copied into the import panel — choose a resource there and apply it.')
  }

  /** Reads a .json file the operator picked, without uploading it anywhere. */
  async function loadImportFile(file: File) {
    try {
      const text = await file.text()
      setImportText(text)
      setImportError(null)
      setImportNote(`Loaded ${file.name} — choose a resource and apply it.`)
    } catch {
      setImportError('That file could not be read.')
    }
  }

  /** Persists the credential separately: it is write-only and never echoed back. */
  async function persistCredential(id: string) {
    if (!form.credential.trim()) return
    await apiSend<IntegrationDto>(`/api/v1/integrations/${id}/credential`, 'POST', { credential: form.credential.trim() })
    patch({ credential: '' })
  }

  async function save(): Promise<IntegrationDto | null> {
    setBusy('save')
    setError(null)
    setIssues([])
    try {
      const connector = buildConnector(form)
      const interval = Number(form.interval) || 360
      let result: IntegrationDto

      if (saved) {
        result = await apiSend<IntegrationDto>(`/api/v1/integrations/${saved.id}`, 'PATCH', {
          connector,
          displayName: form.displayName.trim() || providerName,
          syncIntervalMinutes: interval,
        })
      } else {
        result = await apiSend<IntegrationDto>('/api/v1/integrations', 'POST', {
          provider,
          displayName: form.displayName.trim() || providerName,
          // A draft is not live: it cannot sync until it is explicitly activated.
          status: 'PENDING',
          connector,
          syncIntervalMinutes: interval,
        })
      }

      await persistCredential(result.id)
      const refreshed = await apiSend<IntegrationDto>(`/api/v1/integrations/${result.id}`, 'PATCH', {}).catch(() => result)
      setSaved(refreshed)
      onSaved(refreshed)
      return refreshed
    } catch (cause) {
      captureFailure(cause, 'We could not save this connection.')
      return null
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    setBusy('test')
    setError(null)
    setIssues([])
    setPreview(null)
    try {
      // Save first (as a draft) so there is something to test against.
      const target = saved ?? (await save())
      if (!target) return

      const result = await apiSend<ConnectorPreviewDto>(`/api/v1/integrations/${target.id}/preview`, 'POST', {
        resource: previewResource,
        connector: buildConnector(form),
        // An empty string means "send no credential"; omit it to use the stored one.
        ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
        limit: 5,
      })
      setPreview(result)

      // The paths of the page we just read become the mapping pick-lists, so the
      // next edit is a choice rather than a guess. Read with the *current* records
      // path and line-item path, exactly as the mapper would.
      if (result.response && !result.error && result.response.json && !result.response.truncated) {
        try {
          const payload = JSON.parse(result.response.body) as unknown
          const { paths, itemPaths } = pathsFromPayload(
            payload,
            form.resources[previewResource].recordsPath,
            previewResource === 'orders' ? form.resources.orders.itemsRecordsPath : '',
          )
          if (paths.length) {
            setSources((existing) => ({
              ...existing,
              [previewResource]: { paths, itemPaths, label: 'the preview response' },
            }))
          }
        } catch {
          // The body parsed on the server, so this is not worth reporting.
        }
      }
    } catch (cause) {
      captureFailure(cause, 'The preview could not be read.')
    } finally {
      setBusy(null)
    }
  }

  async function activate() {
    if (!saved) return
    setBusy('activate')
    setError(null)
    setIssues([])
    try {
      const result = await apiSend<IntegrationDto>(`/api/v1/integrations/${saved.id}`, 'PATCH', { status: 'CONNECTED' })
      setSaved(result)
      onSaved(result)
    } catch (cause) {
      captureFailure(cause, 'We could not activate this connection.')
    } finally {
      setBusy(null)
    }
  }

  async function clearCredential() {
    if (!saved) return
    setBusy('clear')
    try {
      const result = await apiSend<IntegrationDto>(`/api/v1/integrations/${saved.id}/credential`, 'POST', { credential: null })
      setSaved(result)
      onSaved(result)
    } catch (cause) {
      captureFailure(cause, 'We could not clear the credential.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {saved ? 'Edit' : 'Connect'} {providerName}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {saved
              ? 'Changes take effect on the next sync. Use Test & preview first.'
              : 'A new connection is saved as a draft so it cannot sync before you test it.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && saved.status !== 'CONNECTED' && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              Draft — not syncing
            </span>
          )}
          {saved?.hasCredential && (
            <button type="button" onClick={() => void clearCredential()} className="text-xs font-semibold text-rose-700 hover:underline">
              Clear credential
            </button>
          )}
          <button type="button" onClick={onClose} className={buttonSecondary}>
            Close
          </button>
        </div>
      </div>

      {error && (
        <Notice>
          <span>
            {error}
            {issues.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
                {issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    <span className="font-mono">{issue.path}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </span>
        </Notice>
      )}

      {preset && preset.setupNotes.length > 0 && !saved && (
        <Notice tone="info">
          <span>
            <span className="font-semibold">{preset.name}</span> — {preset.summary}
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
              {preset.setupNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {preset.docsUrl && (
              <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold underline">
                Provider documentation
              </a>
            )}
          </span>
        </Notice>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Connection                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="well p-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Connection</h4>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <input value={form.displayName} onChange={(event) => patch({ displayName: event.target.value })} className={inputClass} placeholder="Production Zoho org" />
          </Field>
          <Field label="Base URL" hint="A leading slash on a resource path is relative to this URL.">
            <input value={form.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} className={inputClass} placeholder="https://api.example.com/v1" />
          </Field>
          <Field label="Authentication">
            <select value={form.authType} onChange={(event) => patch({ authType: event.target.value as AuthType })} className={selectClass}>
              {AUTH_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          {form.authType === 'header' && (
            <Field label="Header name">
              <input value={form.authHeader} onChange={(event) => patch({ authHeader: event.target.value })} className={inputClass} placeholder="X-Shopify-Access-Token" />
            </Field>
          )}
          {form.authType === 'query' && (
            <Field label="Parameter name">
              <input value={form.authParam} onChange={(event) => patch({ authParam: event.target.value })} className={inputClass} placeholder="api_key" />
            </Field>
          )}
          {form.authType === 'basic' && (
            <Field label="Username">
              <input value={form.authUsername} onChange={(event) => patch({ authUsername: event.target.value })} className={inputClass} placeholder="ck_consumer_key" />
            </Field>
          )}
          {form.authType !== 'none' && (
            <Field
              label={
                saved?.hasCredential
                  ? 'Replace credential (optional)'
                  : preset?.credential.label ?? 'Credential'
              }
              hint={preset?.credential.hint ? `${authHint(form)} ${preset.credential.hint}` : authHint(form)}
            >
              <input
                type="password"
                autoComplete="off"
                value={form.credential}
                onChange={(event) => patch({ credential: event.target.value })}
                className={inputClass}
                placeholder={
                  saved?.hasCredential
                    ? '•••••• stored — leave blank to keep it'
                    : preset?.credential.required === false
                      ? 'Optional for a public endpoint'
                      : 'Paste the token or secret'
                }
              />
            </Field>
          )}
          <Field label="Extra headers (JSON)" hint="Never put a credential here — use the credential field.">
            <input value={form.headersJson} onChange={(event) => patch({ headersJson: event.target.value })} className={inputClass} placeholder='{"Accept-Language":"en"}' />
          </Field>
          <Field label="Extra query parameters (JSON)" hint="e.g. Zoho's organization_id">
            <input value={form.queryJson} onChange={(event) => patch({ queryJson: event.target.value })} className={inputClass} placeholder='{"organization_id":"123456"}' />
          </Field>
          <Field label="Sync every (minutes)" hint="15 to 20160. Failed runs retry after 15 minutes.">
            <input value={form.interval} onChange={(event) => patch({ interval: event.target.value })} className={inputClass} inputMode="numeric" />
          </Field>
        </div>

        {/* The connection test is deliberately independent of saving: it sends the
            settings on screen (a stored credential is reused only when the field is
            blank), so a half-filled form can be checked before anything is written. */}
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-900/5 pt-4">
          <button type="button" onClick={() => void testConnection()} disabled={busy !== null} className={buttonSecondary}>
            {busy === 'probe' ? 'Testing…' : 'Test connection'}
          </button>
          <div className="w-full sm:w-72">
            <Field label="Path to test (optional)" hint="Defaults to the first enabled endpoint, or the base URL itself.">
              <input
                value={probePath}
                onChange={(event) => setProbePath(event.target.value)}
                className={inputClass}
                placeholder={firstEnabledPath() || '/'}
              />
            </Field>
          </div>
          <p className="pb-1 text-xs text-slate-500">One GET with the settings above. Nothing is saved.</p>
        </div>

        {probe && (
          <div className="mt-4 space-y-3">
            {probe.response ? (
              <ConnectorResponsePanel response={probe.response} error={probe.ok ? null : probe.error} title="Connection test" />
            ) : (
              <Notice tone="warning">
                <span>{probe.error ?? 'The endpoint did not answer.'}</span>
              </Notice>
            )}
            {probe.ok && (
              <Notice tone="success">
                <span>
                  {form.authType === 'none'
                    ? `The endpoint answered ${probe.status}. No credential was sent.`
                    : `The endpoint answered ${probe.status} — the URL and the credential work.`}
                </span>
              </Notice>
            )}
            {probe.response?.json && !probe.response.truncated && (
              <button type="button" onClick={() => sendResponseToImport(probe.response!.body)} className={buttonSecondary}>
                Use this response in the mapping
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Resources                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section className="well p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">2. Resources &amp; field mapping</h4>
            <p className="mt-1 text-xs text-slate-500">
              Each resource is one endpoint with its own records path and field mapping.
            </p>
          </div>
          <button type="button" onClick={() => setImportOpen((open) => !open)} className={buttonSecondary}>
            {importOpen ? 'Hide import' : 'Import API structure'}
          </button>
        </div>

        {/* Import runs entirely in the browser: the document a counterparty sent is
            parsed here, and the proposals land in the form below for review. */}
        {importOpen && (
          <div className="well mt-4 space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h5 className="text-xs font-semibold text-slate-900">Import an API structure</h5>
              <span className="text-[11px] text-slate-400">Parsed in your browser — nothing is sent anywhere.</span>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Paste what the other side sent you. A <span className="font-semibold">sample response</span>, an{' '}
              <span className="font-semibold">OpenAPI/Swagger document</span> and a{' '}
              <span className="font-semibold">connector export</span> are all understood: the endpoint, the records path
              and the field mapping are proposed from it, then you review them below.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-medium text-slate-700">
                JSON file
                <input
                  type="file"
                  accept=".json,.txt,application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void loadImportFile(file)
                    event.target.value = ''
                  }}
                  className="mt-1 block text-xs text-slate-600"
                />
              </label>
              <div className="w-40">
                <Field label="Apply to">
                  <select value={importTarget} onChange={(event) => setImportTarget(event.target.value as ResourceKey)} className={selectClass}>
                    {RESOURCES.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={importReplace}
                  onChange={(event) => setImportReplace(event.target.checked)}
                  className="h-4 w-4 accent-emerald-700"
                />
                Replace existing mappings
              </label>
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={6}
              spellCheck={false}
              className="field w-full px-3.5 py-2.5 font-mono text-[11px] leading-5"
              placeholder='{"ok":true,"data":[{"id":1,"full_name":"…","msisdn":"…"}]}'
            />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={useImportedStructure} className={buttonPrimary}>
                Use this structure
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportText('')
                  setImportError(null)
                  setImportNote(null)
                }}
                className="text-xs font-semibold text-slate-500 hover:underline"
              >
                Clear
              </button>
              <span className="text-[11px] text-slate-400">
                A connector export replaces the whole form; a sample only fills the resource you chose.
              </span>
            </div>
            {importError && (
              <Notice>
                <span>{importError}</span>
              </Notice>
            )}
            {importNote && (
              <Notice tone="success">
                <span>{importNote}</span>
              </Notice>
            )}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {RESOURCES.map(({ key, label, blurb }) => {
            const resource = form.resources[key]
            const source = sources[key]
            return (
              <div key={key} className="well overflow-hidden">
                <label className="flex cursor-pointer items-start gap-3 p-4">
                  <input
                    type="checkbox"
                    checked={resource.enabled}
                    onChange={(event) => patchResource(key, { enabled: event.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-emerald-700"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{label}</span>
                    <span className="block text-xs text-slate-500">{blurb}</span>
                  </span>
                </label>

                {resource.enabled && (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Endpoint path">
                        <input value={resource.path} onChange={(event) => patchResource(key, { path: event.target.value })} className={inputClass} placeholder="/contacts" />
                      </Field>
                      <Field label="Records path" hint="Where the row list is. Blank = the response is the list.">
                        <input value={resource.recordsPath} onChange={(event) => patchResource(key, { recordsPath: event.target.value })} className={inputClass} placeholder="data.items" />
                      </Field>
                      <Field label="Resource query parameters (JSON)" hint="Only sent to this resource, e.g. {&quot;status&quot;:&quot;any&quot;} for Shopify orders.">
                        <input value={resource.queryJson} onChange={(event) => patchResource(key, { queryJson: event.target.value })} className={inputClass} placeholder='{"status":"any"}' />
                      </Field>
                      <Field label="Max rows per run">
                        <input value={resource.maxRecords} onChange={(event) => patchResource(key, { maxRecords: event.target.value })} className={inputClass} inputMode="numeric" />
                      </Field>
                      <Field label="Incremental-sync parameter" hint="Optional. The last successful sync timestamp is sent here, with a small overlap.">
                        <input value={resource.updatedSinceParam} onChange={(event) => patchResource(key, { updatedSinceParam: event.target.value })} className={inputClass} placeholder="updated_at_min" />
                      </Field>
                      <Field label="Paging">
                        <select value={resource.pagingMode} onChange={(event) => patchResource(key, { pagingMode: event.target.value as PagingMode })} className={selectClass}>
                          {PAGING_MODES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {resource.pagingMode !== 'none' && resource.pagingMode !== 'link-header' && (
                        <>
                          <Field label="Paging parameter">
                            <input value={resource.pagingParam} onChange={(event) => patchResource(key, { pagingParam: event.target.value })} className={inputClass} placeholder={resource.pagingMode === 'cursor' ? 'cursor' : 'page'} />
                          </Field>
                          <Field label="Rows per page">
                            <input value={resource.pageSize} onChange={(event) => patchResource(key, { pageSize: event.target.value })} className={inputClass} inputMode="numeric" />
                          </Field>
                          <Field label="First page / offset">
                            <input value={resource.pagingStart} onChange={(event) => patchResource(key, { pagingStart: event.target.value })} className={inputClass} inputMode="numeric" />
                          </Field>
                          <Field label="Maximum pages" hint="A safety cap for this run.">
                            <input value={resource.pagingMaxPages} onChange={(event) => patchResource(key, { pagingMaxPages: event.target.value })} className={inputClass} inputMode="numeric" />
                          </Field>
                          {resource.pagingMode === 'page' && (
                            <Field label="Page-size parameter (optional)">
                              <input value={resource.pagingSizeParam} onChange={(event) => patchResource(key, { pagingSizeParam: event.target.value })} className={inputClass} placeholder="per_page" />
                            </Field>
                          )}
                          {resource.pagingMode === 'offset' && (
                            <Field label="Limit parameter (optional)">
                              <input value={resource.pagingSizeParam} onChange={(event) => patchResource(key, { pagingSizeParam: event.target.value })} className={inputClass} placeholder="limit" />
                            </Field>
                          )}
                          {resource.pagingMode === 'cursor' && (
                            <>
                              <Field label="Cursor path" hint="Where the next cursor appears in the response.">
                                <input value={resource.pagingCursorPath} onChange={(event) => patchResource(key, { pagingCursorPath: event.target.value })} className={inputClass} placeholder="meta.next_cursor" />
                              </Field>
                              <Field label="Rows parameter (optional)">
                                <input value={resource.pagingSizeParam} onChange={(event) => patchResource(key, { pagingSizeParam: event.target.value })} className={inputClass} placeholder="per_page" />
                              </Field>
                            </>
                          )}
                        </>
                      )}
                      {resource.pagingMode === 'link-header' && (
                        <>
                          <Field label="Rows parameter (optional)" hint="Sent on the first request; following links preserve it.">
                            <input value={resource.pagingSizeParam} onChange={(event) => patchResource(key, { pagingSizeParam: event.target.value })} className={inputClass} placeholder="limit" />
                          </Field>
                          <Field label="Rows per page">
                            <input value={resource.pageSize} onChange={(event) => patchResource(key, { pageSize: event.target.value })} className={inputClass} inputMode="numeric" />
                          </Field>
                          <Field label="Maximum pages" hint="A safety cap for this run.">
                            <input value={resource.pagingMaxPages} onChange={(event) => patchResource(key, { pagingMaxPages: event.target.value })} className={inputClass} inputMode="numeric" />
                          </Field>
                        </>
                      )}
                      {key === 'orders' && (
                        <>
                          <Field label="Order reference prefix" hint="Keeps references unique and readable.">
                            <input value={resource.referencePrefix} onChange={(event) => patchResource(key, { referencePrefix: event.target.value })} className={inputClass} placeholder="ZI-" />
                          </Field>
                          <Field label="Money scale" hint="Paystack quotes kobo, so 0.01.">
                            <input value={resource.moneyScale} onChange={(event) => patchResource(key, { moneyScale: event.target.value })} className={inputClass} inputMode="decimal" />
                          </Field>
                        </>
                      )}
                    </div>

                    {source && source.paths.length > 0 && (
                      <p className="text-[11px] text-slate-400">
                        {source.paths.length} source path{source.paths.length === 1 ? '' : 's'} read from {source.label} — the
                        mapping boxes below offer them as you type.
                      </p>
                    )}

                    <MappingGrid
                      keyName={key}
                      fields={resource.fields}
                      onChange={(field, value) => patchResource(key, { fields: { ...resource.fields, [field]: value } })}
                      paths={source?.paths ?? []}
                    />

                    {key === 'orders' && (
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-700">Line items (optional)</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Leave blank to import orders without lines — totals and dates still drive the intelligence.
                        </p>
                        <div className="mt-3">
                          <Field label="Line items path" hint="Where each order's lines live. Blank = the order itself is one line.">
                            <input value={resource.itemsRecordsPath} onChange={(event) => patchResource(key, { itemsRecordsPath: event.target.value })} className={inputClass} placeholder="line_items" />
                          </Field>
                        </div>
                        <div className="mt-3">
                          <MappingGrid
                            keyName="orderItems"
                            fields={resource.itemsFields}
                            onChange={(field, value) => patchResource(key, { itemsFields: { ...resource.itemsFields, [field]: value } })}
                            paths={source?.itemPaths ?? []}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Test                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="well p-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">3. Test &amp; preview</h4>
        <p className="mt-1 text-xs text-slate-500">
          Reads one page and maps it, without writing anything. Rejected rows are listed with the reason.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label="Resource">
              <select value={previewResource} onChange={(event) => setPreviewResource(event.target.value as ResourceKey)} className={selectClass}>
                {RESOURCES.filter(({ key }) => form.resources[key].enabled).map(({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button type="button" onClick={() => void test()} disabled={busy !== null} className={buttonSecondary}>
            {busy === 'test' ? 'Reading…' : 'Test & preview'}
          </button>
        </div>

        {busy === 'test' && <Spinner label="Reading one page from the endpoint…" />}

        {preview && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-slate-600">
              <span className="font-semibold">{preview.fetched}</span> rows read from{' '}
              <span className="font-mono">{preview.endpoint || 'the endpoint'}</span> ·{' '}
              <span className="font-semibold text-emerald-700">{preview.accepted}</span> mapped
            </p>
            {preview.error && (
              <Notice>
                <span>{preview.error}</span>
              </Notice>
            )}
            {preview.rejections.length > 0 && (
              <Notice tone="warning">
                <span>
                  Rows were rejected — fix the mapping or the source data:
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
                    {preview.rejections.map((entry) => (
                      <li key={entry.reason}>
                        {entry.reason} <span className="font-semibold">({entry.count})</span>
                      </li>
                    ))}
                  </ul>
                </span>
              </Notice>
            )}
            {preview.rows.length > 0 ? (
              <PreviewTable rows={preview.rows} />
            ) : (
              !preview.error && (
                <Notice tone="warning">
                  <span>
                    Nothing mapped. Check the records path and that the required fields are filled in — a wrong path reads as
                    &ldquo;no data&rdquo; even when the endpoint returned rows.
                  </span>
                </Notice>
              )
            )}
            {preview.response && (
              <>
                <ConnectorResponsePanel response={preview.response} title="Preview response" />
                {preview.response.json && !preview.response.truncated && (
                  <button
                    type="button"
                    onClick={() => sendResponseToImport(preview.response!.body)}
                    className={buttonSecondary}
                  >
                    Use this response in the mapping
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Actions                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy !== null} className={buttonPrimary}>
          {busy === 'save' ? 'Saving…' : saved ? 'Save changes' : 'Save draft'}
        </button>
        {saved && saved.status !== 'CONNECTED' && (
          <button type="button" onClick={() => void activate()} disabled={busy !== null} className={buttonSecondary}>
            {busy === 'activate' ? 'Activating…' : 'Activate connection'}
          </button>
        )}
        {saved && (
          <span className="text-xs text-slate-500">
            {saved.status === 'CONNECTED'
              ? `Scheduled to sync every ${saved.syncIntervalMinutes} minutes.`
              : 'A draft does not sync. Test it, then activate.'}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Canonical field -> source path, generated from the server's field spec.
 *
 * `paths` are leaf paths read from a real response (a preview page, a connection
 * test or an imported structure). They become the input's pick-list: the mapper's
 * syntax is exact, so choosing a path that is known to exist beats typing one that
 * looks right.
 */
function MappingGrid({
  keyName,
  fields,
  onChange,
  paths = [],
}: {
  keyName: ConnectorResourceName | 'orderItems'
  fields: Record<string, string>
  onChange: (field: string, value: string) => void
  paths?: string[]
}) {
  const listId = `mapping-paths-${keyName}`
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {paths.length > 0 && (
        <datalist id={listId}>
          {paths.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      )}
      {CONNECTOR_FIELDS[keyName].map((spec) => (
        <Field key={spec.key} label={`${spec.label}${spec.required ? ' *' : ''}`} hint={spec.hint}>
          <input
            value={fields[spec.key] ?? ''}
            onChange={(event) => onChange(spec.key, event.target.value)}
            className={inputClass}
            placeholder={spec.key === 'name' ? 'contact_name' : spec.key}
            list={paths.length > 0 ? listId : undefined}
          />
        </Field>
      ))}
    </div>
  )
}

function PreviewTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 7)
  return (
    <div className="surface overflow-hidden">
      <table className="w-full min-w-[560px] border-separate border-spacing-0">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className={thClass}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:transition-colors [&>tr:nth-child(even)]:bg-slate-900/[0.015] [&>tr:hover]:bg-wash">
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className={`${tdClass} max-w-[220px] truncate`}>
                  {row[column] === null || row[column] === undefined
                    ? '—'
                    : Array.isArray(row[column])
                      ? `${(row[column] as unknown[]).length} line(s)`
                      : String(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
