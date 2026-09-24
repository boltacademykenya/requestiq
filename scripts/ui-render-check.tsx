/**
 * Render smoke check for the workspace UI (`pnpm ui:check`).
 *
 * This project has no test framework, so this is the cheapest honest check that
 * a component renders at all: it server-renders each screen and asserts on the
 * markup. It catches the class of failure that a type check cannot — a bad
 * import, a broken field spec list, a component that throws on first render —
 * without needing a browser.
 *
 * Client-side data loading is deliberately not exercised; the API itself is
 * covered by `scripts/smoke.sh` and `scripts/connector-check.sh`.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import ConnectorEditor from '../components/workspace/connector-editor'
import ConnectorResponsePanel from '../components/workspace/connector-response'
import CustomersTab from '../components/workspace/customers-tab'
import ConnectorPage from '../components/workspace/integrations-connector-page'
import IntegrationsTab from '../components/workspace/integrations-tab'
import MessagesTab from '../components/workspace/messages-tab'
import SignOutButton from '../components/workspace/sign-out-button'
import SyncRuns from '../components/workspace/sync-runs'
import UserMenu from '../components/workspace/user-menu'
import type { ConnectorHttpDto, ConnectorPresetDto, IntegrationDto } from '../lib/api/dto'

let failures = 0

function check(name: string, render: () => string, expected: string[]) {
  try {
    const html = render()
    const missing = expected.filter((text) => !html.includes(text))
    if (missing.length) {
      failures += 1
      console.error(`✗ ${name}: markup is missing ${missing.map((text) => `"${text}"`).join(', ')}`)
      return
    }
    console.log(`✓ ${name} (${html.length} chars)`)
  } catch (error) {
    failures += 1
    console.error(`✗ ${name}: threw during render — ${error instanceof Error ? error.message : String(error)}`)
  }
}

const preset: ConnectorPresetDto = {
  provider: 'ZOHO_INVENTORY',
  name: 'Zoho Inventory',
  summary: 'Contacts, items and sales orders from Zoho Inventory.',
  docsUrl: 'https://www.zoho.com/inventory/api/v1/introduction/',
  credential: { label: 'OAuth access token', hint: 'Paste the full header value.', required: true },
  setupNotes: ['Set organization_id below.', 'Contacts need a phone number.'],
  connector: {
    baseUrl: 'https://www.zohoapis.com/inventory/v1',
    auth: { type: 'header', header: 'Authorization' },
    headers: {},
    query: { organization_id: '' },
    timeoutMs: 15_000,
    resources: {
      customers: {
        path: '/contacts',
        recordsPath: 'contacts',
        query: {},
        fields: { externalId: 'contact_id', name: 'contact_name', phone: 'phone', email: 'email' },
        pagination: { mode: 'page', param: 'page', sizeParam: 'per_page', pageSize: 200, startPage: 1, maxPages: 20 },
        maxRecords: 1000,
        moneyScale: 1,
      },
      orders: {
        path: '/salesorders',
        recordsPath: 'salesorders',
        query: {},
        referencePrefix: 'ZI-',
        fields: { externalId: 'salesorder_number', customerExternalId: 'customer_id', orderedAt: 'date', total: 'total' },
        pagination: { mode: 'page', param: 'page', sizeParam: 'per_page', pageSize: 200, startPage: 1, maxPages: 20 },
        maxRecords: 1000,
        moneyScale: 1,
        items: { recordsPath: 'line_items', fields: { productName: 'name', quantity: 'quantity', unitPrice: 'rate' } },
      },
    },
  },
}

const integration: IntegrationDto = {
  id: '11111111-2222-4333-8444-555555555555',
  provider: 'ZOHO_INVENTORY',
  status: 'CONNECTED',
  displayName: 'Production Zoho',
  config: {},
  connector: preset.connector,
  syncIntervalMinutes: 360,
  nextSyncAt: '2026-09-21T12:00:00.000Z',
  hasCredential: true,
  externalAccountId: null,
  lastSyncedAt: '2026-09-21T09:00:00.000Z',
  lastError: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-21T09:00:00.000Z',
}

// Provider templates and connections arrive from the API, which does not run
// during a server render — so this asserts the shell that is always present.
check('IntegrationsTab (manager)', () => renderToStaticMarkup(<IntegrationsTab canManage />), [
  'Integrations',
  'All connections',
  'Zoho Inventory',
  'Shopify',
  'WooCommerce',
  'Paystack',
  'Loading connections',
])

check('IntegrationsTab (read-only role)', () => renderToStaticMarkup(<IntegrationsTab canManage={false} />), [
  'Your role can see connections but not change them',
])

// The messages tab renders its sidebar shell before its data loads.
check('MessagesTab (writer)', () => renderToStaticMarkup(<MessagesTab canWrite />), [
  'Messages',
  'All messages',
  'WhatsApp',
  'SMS',
  'Email',
  'Loading messages',
  'Every outbound and inbound message',
])

check(
  'ConnectorPage (fresh setup)',
  () =>
    renderToStaticMarkup(
      <ConnectorPage
        provider="ZOHO_INVENTORY"
        providerName="Zoho Inventory"
        preset={preset}
        integration={null}
        canManage
        onChanged={() => {}}
        onClose={() => {}}
      />,
    ),
  ['Zoho Inventory', 'Back to all connections', 'Connect Zoho Inventory', 'Save draft', 'OAuth access token'],
)

check(
  'ConnectorPage (active connection)',
  () =>
    renderToStaticMarkup(
      <ConnectorPage
        provider="ZOHO_INVENTORY"
        providerName="Zoho Inventory"
        preset={preset}
        integration={integration}
        canManage
        onChanged={() => {}}
        onClose={() => {}}
      />,
    ),
  ['Connection', 'Configure Zoho Inventory', 'Sync now', 'Disconnect', 'Recent syncs', 'Stored'],
)

check(
  'ConnectorEditor (new connection from a template)',
  () => renderToStaticMarkup(<ConnectorEditor provider="ZOHO_INVENTORY" providerName="Zoho Inventory" preset={preset} integration={null} onSaved={() => {}} onClose={() => {}} />),
  [
    '1. Connection',
    'Test connection',
    '2. Resources',
    'Import API structure',
    '3. Test',
    'Save draft',
    'Zoho Inventory',
    'Header name',
    'OAuth access token',
    'Paste the full header value',
  ],
)

check(
  'ConnectorEditor (existing connection)',
  () => renderToStaticMarkup(<ConnectorEditor provider="ZOHO_INVENTORY" providerName="Zoho Inventory" preset={preset} integration={integration} onSaved={() => {}} onClose={() => {}} />),
  ['Save changes', 'Clear credential', 'Header name', 'sync every 360 minutes', 'salesorder_number', 'Test connection'],
)

// The response a test showed the operator: status, timing, structure and the raw
// body, with the provider's own error text when the call failed.
const rawResponse: ConnectorHttpDto = {
  endpoint: 'https://api.example.com/v1/customers?page=1',
  status: 401,
  statusText: 'Unauthorized',
  contentType: 'application/json; charset=utf-8',
  durationMs: 128,
  bytes: 96,
  headers: [
    { name: 'content-type', value: 'application/json; charset=utf-8' },
    { name: 'x-ratelimit-remaining', value: '57' },
  ],
  body: '{\n  "ok": false,\n  "error": {\n    "code": "unauthorized",\n    "message": "Missing or invalid API key."\n  }\n}',
  truncated: false,
  json: true,
}

check(
  'ConnectorResponsePanel (failed call)',
  () => renderToStaticMarkup(<ConnectorResponsePanel response={rawResponse} error="The endpoint rejected our credentials (401)." />),
  [
    'Endpoint response',
    '401',
    'Unauthorized',
    '128 ms',
    'application/json',
    'x-ratelimit-remaining',
    'Missing or invalid API key',
    'The endpoint rejected our credentials',
  ],
)

check(
  'ConnectorResponsePanel (structured success)',
  () =>
    renderToStaticMarkup(
      <ConnectorResponsePanel
        title="Connection test"
        response={{
          ...rawResponse,
          status: 200,
          statusText: 'OK',
          body: '{\n  "ok": true,\n  "data": [\n    {\n      "id": 1,\n      "full_name": "Ruaka Fresh Foods"\n    }\n  ]\n}',
        }}
      />,
    ),
  ['Connection test', '200 OK', 'List at', 'data', 'record keys', 'full_name'],
)

check('SyncRuns', () => renderToStaticMarkup(<SyncRuns integrationId={integration.id} />), ['Recent syncs', 'Loading'])

// The customers page is where provenance has to be visible: the source filter
// and the "which platform is this from" column are the point of this screen.
// Rows load on the client, so the static render asserts the shell and the filter.
check(
  'CustomersTab (owner)',
  () => renderToStaticMarkup(<CustomersTab canWrite canManageSources />),
  ['Customers', 'Search customers', 'All sources', 'Add customer'],
)
check(
  'CustomersTab (read-only analyst)',
  () => renderToStaticMarkup(<CustomersTab canWrite={false} canManageSources={false} />),
  ['Customers', 'All sources'],
)

// Sign-out surfaces. The menu is closed during a static render, so what can be
// asserted is the affordance a user has to notice to sign out at all: the
// account trigger (avatar + name + accessible label) and the staff button.
check('UserMenu (account trigger)', () => renderToStaticMarkup(<UserMenu name="Jane Doe" email="jane@acme.test" onOpenSettings={() => {}} />), [
  'Account menu',
  'Jane Doe',
])

check('SignOutButton', () => renderToStaticMarkup(<SignOutButton />), ['Sign out'])

check('ConnectorEditor (missing template still renders)', () => renderToStaticMarkup(<ConnectorEditor provider="CUSTOM" providerName="Custom API" preset={null} integration={null} onSaved={() => {}} onClose={() => {}} />), ['1. Connection', 'Save draft'])

if (failures > 0) {
  console.error(`\n${failures} UI check(s) failed.`)
  process.exit(1)
}
console.log('\nAll UI render checks passed.')
