/**
 * Checks for connector discovery (`pnpm discovery:check`).
 *
 * This project has no test framework, so this script is the honest check that the
 * "import an API structure" path reads a payload the way it claims to: the record
 * list, the field paths and the suggested mapping are asserted against payloads
 * shaped like the real provider envelopes (a `{ ok, data, meta }` wrapper, Zoho's
 * `contacts`, a bare Shopify array, a schema with `$ref`s).
 *
 * Discovery only proposes; the operator confirms in the form. But a *wrong*
 * proposal is worse than none, so every case here is a shape a counterparty
 * actually sends.
 */
import {
  collectFieldPaths,
  deriveItemsPath,
  deriveRecordsPath,
  discoverApiStructure,
  pathsFromPayload,
  suggestFieldMappings,
  summariseStructure,
} from '../lib/connectors/discovery'

let failures = 0

/** Objects compare by content, not key order: suggestions are built field by field. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

function check(name: string, actual: unknown, expected: unknown) {
  const left = JSON.stringify(stable(actual))
  const right = JSON.stringify(stable(expected))
  if (left === right) {
    console.log(`✓ ${name}`)
    return
  }
  failures += 1
  console.error(`✗ ${name}\n    expected ${right}\n    actual   ${left}`)
}

function checkIncludes(name: string, haystack: string[], needle: string) {
  if (haystack.includes(needle)) {
    console.log(`✓ ${name}`)
    return
  }
  failures += 1
  console.error(`✗ ${name}: "${needle}" not in ${JSON.stringify(haystack)}`)
}

/* -------------------------------------------------------------------------- */
/* Records path                                                               */
/* -------------------------------------------------------------------------- */

check('a root array is the list', deriveRecordsPath([{ id: 1 }, { id: 2 }]), { path: '', count: 2 })
check('a { ok, data } envelope', deriveRecordsPath({ ok: true, data: [{ id: 1 }], meta: {}, links: {} }), {
  path: 'data',
  count: 1,
})
check('a nested envelope', deriveRecordsPath({ data: { items: [{ id: 1 }] }, meta: {} }), { path: 'data.items', count: 1 })
check('an empty page still names its list', deriveRecordsPath({ ok: true, data: [] }), { path: 'data', count: 0 })
check('an empty errors array does not win over data', deriveRecordsPath({ errors: [], data: [{ id: 1 }] }), {
  path: 'data',
  count: 1,
})
check('an array of scalars is not a record list', deriveRecordsPath({ tags: ['a', 'b'] }), null)
check('a single object has no list', deriveRecordsPath({ id: 1, name: 'x' }), null)
check('the first object array wins over a later one', deriveRecordsPath({ products: [{ sku: 'a' }], orders: [{ id: 1 }] }), {
  path: 'products',
  count: 1,
})

/* -------------------------------------------------------------------------- */
/* Field paths and line items                                                 */
/* -------------------------------------------------------------------------- */

check('arrays contribute their first element', collectFieldPaths({ items: [{ name: 'a', meta: { sku: 'b' } }] }), [
  'items[0].name',
  'items[0].meta.sku',
])
check('scalar arrays keep an index', collectFieldPaths({ tags: ['a'], name: 'x' }), ['tags[0]', 'name'])
check('line items are found by name', deriveItemsPath({ total: 1, line_items: [{ quantity: 2 }] }), {
  path: 'line_items',
  count: 1,
})
check('line items are not invented from unrelated arrays', deriveItemsPath({ fulfillments: [{ tracking_number: 'x' }] }), null)
check('an unnamed array of priced rows is still lines', deriveItemsPath({ rows: [{ qty: 1, unit_price: 20 }] }), {
  path: 'rows',
  count: 1,
})

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

check('phone and mobile are joined, not guessed', suggestFieldMappings('customers', ['phone', 'mobile', 'email']), {
  phone: 'phone || mobile',
  email: 'email',
})
check('a split name becomes one template', suggestFieldMappings('customers', ['first_name', 'last_name', 'email']), {
  name: '{first_name} {last_name}',
  email: 'email',
})
check('only a strong alias is used', suggestFieldMappings('products', ['id', 'title', 'price', 'unrelated']), {
  externalId: 'id',
  name: 'title',
  price: 'price',
})
check('a field without a convincing match stays blank', suggestFieldMappings('customers', ['account_manager', 'notes']), {})

/* -------------------------------------------------------------------------- */
/* Sample responses                                                           */
/* -------------------------------------------------------------------------- */

const testerEnvelope = {
  ok: true,
  data: [
    {
      id: 1,
      external_ref: 'CUST-00001',
      full_name: 'Ruaka Fresh Foods',
      msisdn: '+254 11426 880',
      email: 'ruaka@freshmart.co.ke',
      city: 'Thika',
      type: 'BUSINESS',
      updated_at: '2026-09-23T05:42:23.999Z',
    },
  ],
  meta: { page: 1, per_page: 2, total: 33 },
  links: { next: '/api/v1/customers?page=2' },
}

const tester = discoverApiStructure(testerEnvelope)
check('the tester envelope is a sample', tester.kind, 'sample')
check('its records path is found', tester.resources.customers?.recordsPath, 'data')
check('its customer fields are suggested', tester.resources.customers?.fields, {
  externalId: 'id',
  name: 'full_name',
  phone: 'msisdn',
  email: 'email',
  location: 'city',
  customerType: 'type',
})
check('its pick-list carries the record paths', tester.resources.customers?.paths?.includes('full_name'), true)
check('its summary names the list', summariseStructure(testerEnvelope), {
  topLevelKeys: ['ok', 'data', 'meta', 'links'],
  listPath: 'data',
  listCount: 1,
  itemKeys: ['id', 'external_ref', 'full_name', 'msisdn', 'email', 'city', 'type', 'updated_at'],
})

const zoho = discoverApiStructure({
  code: 0,
  contacts: [
    {
      contact_id: '460000000038080',
      contact_name: 'Bowman Furniture',
      phone: '+254 700 000 001',
      mobile: '+254 711 000 002',
      email: 'info@bowman.test',
      billing_address: { city: 'Nairobi' },
      contact_type: 'customer',
    },
  ],
  page_context: { page: 1, per_page: 200, has_more_page: false },
})
check('Zoho contacts are read', zoho.resources.customers?.recordsPath, 'contacts')
check('Zoho customer fields are suggested', zoho.resources.customers?.fields, {
  externalId: 'contact_id',
  name: 'contact_name',
  phone: 'phone || mobile',
  email: 'email',
  location: 'billing_address.city',
  customerType: 'contact_type',
})

const shopify = discoverApiStructure([
  { id: 207119551, first_name: 'Bob', last_name: 'Norman', email: 'bob@test.example', phone: '+13125550118' },
])
check('a bare array is the list', shopify.resources.customers?.recordsPath, '')
check('a split name is templated', shopify.resources.customers?.fields.name, '{first_name} {last_name}')
check('the array sample keeps a pick-list', shopify.resources.customers?.paths, [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
])

const orders = discoverApiStructure({
  orders: [
    {
      order_number: 'SO-0001',
      customer_id: 'C-1',
      date: '2026-01-15',
      total: 1500,
      currency: 'KES',
      status: 'paid',
      line_items: [{ item_id: 'P-1', name: 'Organic Kale', quantity: 3, rate: 250 }],
    },
  ],
})
check('order fields are suggested', orders.resources.orders?.fields, {
  externalId: 'order_number',
  customerExternalId: 'customer_id',
  orderedAt: 'date',
  status: 'status',
  currency: 'currency',
  total: 'total',
})
check('line items are picked up for orders', orders.resources.orders?.itemsRecordsPath, 'line_items')
check('line item fields are suggested', orders.resources.orders?.itemsFields, {
  productExternalId: 'item_id',
  productName: 'name',
  quantity: 'quantity',
  unitPrice: 'rate',
})

const single = discoverApiStructure({ id: 9, name: 'Ada', phone: '+254700000009' })
check('a single record is readable', single.resources.customers?.fields, {
  externalId: 'id',
  name: 'name',
  phone: 'phone',
})
check('a single record leaves the records path open', single.resources.customers?.recordsPath, null)

/* -------------------------------------------------------------------------- */
/* pathsFromPayload uses the current records path                             */
/* -------------------------------------------------------------------------- */

check('paths come from the mapped record, not the envelope', pathsFromPayload(testerEnvelope, 'data'), {
  paths: ['id', 'external_ref', 'full_name', 'msisdn', 'email', 'city', 'type', 'updated_at'],
  itemPaths: [],
  recordCount: 1,
})
check(
  'line item paths come from one line, not the order',
  pathsFromPayload({ orders: [{ order_number: 'A', line_items: [{ name: 'Kale', quantity: 1 }] }] }, 'orders', 'line_items'),
  {
    paths: ['order_number', 'line_items[0].name', 'line_items[0].quantity'],
    itemPaths: ['name', 'quantity'],
    recordCount: 1,
  },
)

/* -------------------------------------------------------------------------- */
/* OpenAPI                                                                    */
/* -------------------------------------------------------------------------- */

const openapi = discoverApiStructure({
  openapi: '3.0.3',
  info: { title: 'Store API', version: '1' },
  servers: [{ url: 'https://store.example.com/api/v1' }],
  paths: {
    '/customers': {
      get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerPage' } } } } } },
    },
    '/customers/{customerId}': {
      get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } } } },
    },
    '/orders': {
      get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderPage' } } } } } },
    },
    '/products.json': {
      get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductPage' } } } } } },
    },
  },
  components: {
    schemas: {
      Customer: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          contact_name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
        },
      },
      CustomerPage: {
        type: 'object',
        properties: { contacts: { type: 'array', items: { $ref: '#/components/schemas/Customer' } } },
      },
      ProductPage: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { item_id: { type: 'string' }, name: { type: 'string' }, rate: { type: 'number' } },
            },
          },
        },
      },
      OrderPage: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                order_number: { type: 'string' },
                customer_id: { type: 'string' },
                ordered_at: { type: 'string', format: 'date-time' },
                total: { type: 'number' },
                line_items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      item_id: { type: 'string' },
                      name: { type: 'string' },
                      quantity: { type: 'integer' },
                      unit_price: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
})

check('an OpenAPI document is recognised', openapi.kind, 'openapi')
check('the server URL becomes the base URL', openapi.baseUrl, 'https://store.example.com/api/v1')
check('the plain collection path beats the templated one', openapi.resources.customers?.path, '/customers')
check('the customer records path comes from the schema', openapi.resources.customers?.recordsPath, 'contacts')
check('customer fields come through the $ref', openapi.resources.customers?.fields, {
  externalId: 'contact_id',
  name: 'contact_name',
  phone: 'phone',
  email: 'email',
})
check('a .json suffix still matches a resource', openapi.resources.products?.path, '/products.json')
check('product fields come from an inline schema', openapi.resources.products?.fields, {
  externalId: 'item_id',
  name: 'name',
  price: 'rate',
})
check('the orders path is found', openapi.resources.orders?.path, '/orders')
check('order fields come from a deep $ref', openapi.resources.orders?.fields, {
  externalId: 'order_number',
  customerExternalId: 'customer_id',
  orderedAt: 'ordered_at',
  total: 'total',
})
check('order line items are found in the schema', openapi.resources.orders?.itemsRecordsPath, 'line_items')
check('line item fields are found in the schema', openapi.resources.orders?.itemsFields, {
  productExternalId: 'item_id',
  productName: 'name',
  quantity: 'quantity',
  unitPrice: 'unit_price',
})

const swagger2 = discoverApiStructure({
  swagger: '2.0',
  host: 'legacy.example.com',
  basePath: '/v2',
  schemes: ['https'],
  paths: {
    '/clients': {
      get: {
        responses: {
          200: {
            schema: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { client_code: { type: 'string' }, client_name: { type: 'string' }, msisdn: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
})
check('Swagger 2 host and basePath build the base URL', swagger2.baseUrl, 'https://legacy.example.com/v2')
check('Swagger 2 body schemas are read', swagger2.resources.customers?.recordsPath, 'results')
check('Swagger 2 fields are suggested', swagger2.resources.customers?.fields, {
  externalId: 'client_code',
  name: 'client_name',
  phone: 'msisdn',
})

/* -------------------------------------------------------------------------- */
/* Connector exports                                                          */
/* -------------------------------------------------------------------------- */

const exported = {
  connector: {
    baseUrl: 'https://api.example.com/v1',
    auth: { type: 'bearer' },
    headers: {},
    query: {},
    timeoutMs: 10_000,
    resources: {
      customers: {
        path: '/customers',
        recordsPath: 'data',
        query: {},
        fields: { name: 'full_name', phone: 'msisdn' },
        pagination: { mode: 'page', pageSize: 100, startPage: 1, maxPages: 20 },
        maxRecords: 1000,
        moneyScale: 1,
      },
    },
    // A vendor export routinely carries keys this app does not model.
    version: '2.1',
    provider: 'CUSTOM',
  },
}

const exportDiscovery = discoverApiStructure(exported)
check('a wrapped connector export is recognised', exportDiscovery.kind, 'connector')
check('it parses despite unknown keys', exportDiscovery.connector !== null, true)
check('the exported mapping survives', exportDiscovery.resources.customers?.fields, { name: 'full_name', phone: 'msisdn' })
checkIncludes('unknown keys are reported', exportDiscovery.notes, 'Ignored unknown key(s): version, provider.')

const bareExport = discoverApiStructure(exported.connector)
check('a bare connector export is recognised too', bareExport.kind, 'connector')
check('the bare export carries its base URL', bareExport.baseUrl, 'https://api.example.com/v1')

const invalidExport = discoverApiStructure({
  baseUrl: 'https://api.example.com/v1',
  resources: { customers: { path: '/customers', recordsPath: 'data', fields: { nope: 'x' } } },
})
check('an invalid connector export is not misread as a sample', invalidExport.kind, 'connector')
check('the invalid export is not applied', invalidExport.connector, null)
checkIncludes(
  'the invalid export reports why',
  invalidExport.notes,
  'resources.customers.fields.nope: "nope" is not a customer field. Valid fields: externalId, name, phone, email, location, customerType.',
)

if (failures > 0) {
  console.error(`\n${failures} discovery check(s) failed.`)
  process.exit(1)
}
console.log('\nAll discovery checks passed.')




