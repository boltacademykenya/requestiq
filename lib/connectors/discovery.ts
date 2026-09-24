import { collectRecords } from './paths'
import {
  CONNECTOR_FIELDS,
  connectorSchema,
  type ConnectorConfig,
  type ConnectorOrdersResourceConfig,
  type ConnectorResourceName,
} from './config'

/**
 * Discovery: reads an API structure and proposes form values.
 *
 * A vendor hands over one of three things, and all three are understood here
 * because "send us the API structure" has to work with what a real counterparty
 * actually has:
 *
 * - a **sample response** (or any JSON payload) — the record list, the field paths
 *   and the likely mapping are read straight out of the data;
 * - an **OpenAPI/Swagger** document — base URL, endpoint paths and field names come
 *   from the schema (`$ref`s resolved, arrays synthesised to a single item);
 * - a **connector export** — this app's own spec, so a configuration can be moved
 *   between tenants or handed over by whoever built it.
 *
 * Everything in this module is pure and synchronous: it runs in the browser and
 * nothing is sent anywhere. Every proposal it makes is a *suggestion* an operator
 * reviews in the form — a wrong mapping imports wrong data, so the alias tables are
 * deliberately conservative and never guess twice when a field is ambiguous.
 */

export type DiscoveryKind = 'connector' | 'openapi' | 'sample'

/** What one resource's mapping should look like, as far as the input reveals. */
export type ResourceDiscovery = {
  /** Endpoint path, when the document names one (OpenAPI, connector export). */
  path: string | null
  /** Where the record list sits; `` is a valid path meaning "the response itself". */
  recordsPath: string | null
  /** Canonical field -> suggested source path. */
  fields: Record<string, string>
  /** Orders only: where line items sit inside one record. */
  itemsRecordsPath: string | null
  itemsFields: Record<string, string>
  /** Leaf paths of one record, for the mapping pick-lists. */
  paths: string[]
  /** Leaf paths of one line item (orders only). */
  itemPaths: string[]
}

export type ApiStructureDiscovery = {
  kind: DiscoveryKind
  /** One line naming what was recognised, for the import panel. */
  title: string
  /** What was found, what was not, and anything the operator must decide. */
  notes: string[]
  baseUrl: string | null
  /** The parsed spec, for a connector export. */
  connector: ConnectorConfig | null
  resources: Partial<Record<ConnectorResourceName, ResourceDiscovery>>
}

/** How a payload looks from the outside, for the response viewer. */
export type StructureSummary = {
  topLevelKeys: string[]
  /** `null` when no list was found; `` means the payload itself is the list. */
  listPath: string | null
  listCount: number | null
  /** Keys of the first record, which is what a mapping has to address. */
  itemKeys: string[]
}

const RESOURCE_KEYS: ConnectorResourceName[] = ['customers', 'products', 'orders']

/** Conventional names for the array of records, best first. */
const RECORD_LIST_NAMES = [
  'data',
  'items',
  'results',
  'records',
  'rows',
  'list',
  'content',
  'entries',
  'values',
  'customers',
  'contacts',
  'products',
  'orders',
  'salesorders',
  'transactions',
  'payments',
]

/** Conventional names for a line-item list inside an order record, best first. */
const ITEM_LIST_NAMES = [
  'line_items',
  'lineitems',
  'items',
  'lines',
  'order_items',
  'orderitems',
  'order_lines',
  'orderlines',
  'cart_items',
  'details',
  'products',
]

/** Keys that make an array of objects look like order lines rather than metadata. */
const LINE_ITEM_HINTS = ['quantity', 'qty', 'price', 'unit_price', 'unitprice', 'rate', 'sku', 'product_id', 'productid', 'item_id', 'itemid']

const MAX_PATHS = 200
const MAX_DEPTH = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rankIn(names: string[], key: string): number {
  const index = names.indexOf(key.toLowerCase())
  return index === -1 ? names.length : index
}

/* -------------------------------------------------------------------------- */
/* Reading a payload                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every leaf path in a value, as mapping expressions.
 *
 * Arrays contribute their **first** element (`items[0].name`), not a wildcard:
 * a field mapping is resolved against one record, so an indexed path is the one
 * that actually resolves for every row. Paths are capped and de-duplicated.
 */
export function collectFieldPaths(value: unknown, options: { maxDepth?: number; maxPaths?: number } = {}): string[] {
  const maxDepth = options.maxDepth ?? MAX_DEPTH
  const maxPaths = options.maxPaths ?? MAX_PATHS
  const paths: string[] = []

  const push = (path: string) => {
    if (!path || paths.includes(path) || paths.length >= maxPaths) return
    paths.push(path)
  }

  const walk = (current: unknown, prefix: string, depth: number) => {
    if (paths.length >= maxPaths || depth > maxDepth) return
    if (Array.isArray(current)) {
      const first = current[0]
      if (isRecord(first)) walk(first, prefix ? `${prefix}[0]` : '[0]', depth + 1)
      else if (first !== undefined && !Array.isArray(first)) push(`${prefix}[0]`)
      return
    }
    if (isRecord(current)) {
      for (const [key, entry] of Object.entries(current)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (isRecord(entry) || Array.isArray(entry)) walk(entry, path, depth + 1)
        else push(path)
      }
      return
    }
    push(prefix)
  }

  walk(value, '', 1)
  return paths
}

/**
 * Finds the record list in a payload.
 *
 * The shallowest non-empty array of objects wins; at the same depth, keys are
 * visited with conventional container names first, because that is what paginated
 * envelopes look like in practice. `path: ''` means the payload itself is the list.
 * A single empty array is accepted as a last resort so an empty page still
 * suggests `data`; an array of scalars is never a record list.
 */
export function deriveRecordsPath(payload: unknown): { path: string; count: number } | null {
  if (Array.isArray(payload)) {
    return payload.some(isRecord) ? { path: '', count: payload.length } : null
  }
  if (!isRecord(payload)) return null

  const queue: Array<{ path: string; value: Record<string, unknown> }> = [{ path: '', value: payload }]
  const empty: Array<{ path: string; count: number }> = []

  while (queue.length) {
    const node = queue.shift()!
    const keys = Object.keys(node.value).sort((a, b) => rankIn(RECORD_LIST_NAMES, a) - rankIn(RECORD_LIST_NAMES, b))

    for (const key of keys) {
      const entry = node.value[key]
      const path = node.path ? `${node.path}.${key}` : key
      if (Array.isArray(entry)) {
        if (entry.some(isRecord)) return { path, count: entry.length }
        if (entry.length === 0) empty.push({ path, count: 0 })
        continue
      }
      if (isRecord(entry)) queue.push({ path, value: entry })
    }
  }

  return empty.length === 1 ? empty[0]! : null
}

/**
 * Finds the line-item list inside one order record.
 *
 * A conventional name wins outright. Without one, an array is only accepted when
 * its objects carry a quantity/price-ish key — otherwise `fulfillments` or a
 * status history would be imported as order lines.
 */
export function deriveItemsPath(record: unknown): { path: string; count: number } | null {
  if (!isRecord(record)) return null
  const byName: Array<{ path: string; count: number; rank: number; depth: number }> = []
  const byShape: Array<{ path: string; count: number; depth: number }> = []

  const walk = (value: Record<string, unknown>, prefix: string, depth: number) => {
    if (depth > 2) return
    for (const [key, entry] of Object.entries(value)) {
      if (!Array.isArray(entry)) {
        if (isRecord(entry)) walk(entry, `${prefix}${key}.`, depth + 1)
        continue
      }
      const first = entry.find(isRecord)
      if (!first) continue
      const rank = rankIn(ITEM_LIST_NAMES, key)
      if (rank < ITEM_LIST_NAMES.length) byName.push({ path: prefix + key, count: entry.length, rank, depth })
      else if (Object.keys(first).some((field) => LINE_ITEM_HINTS.includes(field.toLowerCase()))) {
        byShape.push({ path: prefix + key, count: entry.length, depth })
      }
    }
  }

  walk(record, '', 1)
  if (byName.length) {
    byName.sort((a, b) => a.rank - b.rank || a.depth - b.depth || a.path.localeCompare(b.path))
    const best = byName[0]!
    return { path: best.path, count: best.count }
  }
  if (byShape.length) {
    byShape.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    const best = byShape[0]!
    return { path: best.path, count: best.count }
  }
  return null
}

/**
 * The pick-list paths for a resource, read from a real response using the
 * *current* records path — so the suggestions always match what the mapper will
 * see, not what some other endpoint looked like.
 */
export function pathsFromPayload(
  payload: unknown,
  recordsPath: string,
  itemsRecordsPath = '',
): { paths: string[]; itemPaths: string[]; recordCount: number } {
  const records = collectRecords(payload, recordsPath)
  const record = records.find(isRecord)
  if (!record) return { paths: [], itemPaths: [], recordCount: records.length }

  const item = itemsRecordsPath ? collectRecords(record, itemsRecordsPath).find(isRecord) : undefined
  return {
    paths: collectFieldPaths(record),
    itemPaths: item ? collectFieldPaths(item) : [],
    recordCount: records.length,
  }
}

/** Names the shape of a payload: top-level keys, the list, and the record's keys. */
export function summariseStructure(payload: unknown): StructureSummary {
  const topLevelKeys = isRecord(payload)
    ? Object.keys(payload).slice(0, 12)
    : Array.isArray(payload)
      ? ['(array)']
      : []

  const list = deriveRecordsPath(payload)
  if (!list) return { topLevelKeys, listPath: null, listCount: null, itemKeys: [] }

  const records = collectRecords(payload, list.path)
  const first = records.find(isRecord)
  return {
    topLevelKeys,
    listPath: list.path,
    listCount: records.length,
    itemKeys: first ? Object.keys(first).slice(0, 12) : [],
  }
}

/* -------------------------------------------------------------------------- */
/* Suggesting a mapping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Aliases per canonical field, best first.
 *
 * `primary` decides; `secondary` is only consulted when nothing primary matched.
 * An alias that is merely plausible (`code` for an order's external id) sits late,
 * and a field with no convincing match is left blank rather than guessed: a blank
 * input is visibly unfinished, a wrong mapping is invisibly wrong.
 */
type AliasSpec = {
  primary: string[]
  secondary?: string[]
  /** Join two same-level matches with `||` — the mapper's own alternative syntax. */
  joinAlternatives?: boolean
}

type AliasTable = Record<string, AliasSpec>

const CUSTOMER_ALIASES: AliasTable = {
  externalId: {
    primary: [
      'id',
      'customer_id',
      'customerid',
      'contact_id',
      'contactid',
      'client_id',
      'clientid',
      'customer_code',
      'customercode',
      'client_code',
      'clientcode',
      'account_code',
      'accountcode',
      'external_id',
      'externalid',
      'external_ref',
      'externalref',
      'code',
      'uuid',
    ],
  },
  name: {
    primary: [
      'full_name',
      'fullname',
      'name',
      'display_name',
      'displayname',
      'customer_name',
      'customername',
      'contact_name',
      'contactname',
      'client_name',
      'clientname',
      'business_name',
      'businessname',
    ],
    secondary: ['company_name', 'companyname', 'account_name', 'accountname', 'organisation', 'organization'],
  },
  phone: {
    primary: ['phone', 'phone_number', 'phonenumber', 'mobile', 'mobile_number', 'mobilenumber', 'msisdn', 'telephone', 'tel', 'contact_number', 'contactnumber'],
    joinAlternatives: true,
  },
  email: { primary: ['email', 'email_address', 'emailaddress', 'mail', 'contact_email', 'customer_email'] },
  location: {
    primary: ['city', 'town', 'location', 'region', 'county', 'area', 'billing_city', 'shipping_city'],
    secondary: ['address', 'billing_address', 'address_line1', 'street'],
  },
  customerType: { primary: ['customer_type', 'customertype', 'contact_type', 'contacttype', 'account_type', 'accounttype', 'type'] },
}

const PRODUCT_ALIASES: AliasTable = {
  externalId: { primary: ['id', 'product_id', 'productid', 'item_id', 'itemid', 'external_id', 'externalid', 'code', 'uuid'] },
  name: { primary: ['name', 'product_name', 'productname', 'item_name', 'itemname', 'title', 'display_name', 'displayname'], secondary: ['description'] },
  sku: { primary: ['sku', 'item_code', 'itemcode', 'product_code', 'productcode', 'code', 'barcode', 'reference'] },
  category: { primary: ['category_name', 'categoryname', 'category', 'product_type', 'producttype', 'collection', 'group', 'department'] },
  unit: { primary: ['unit', 'uom', 'unit_of_measure', 'unitofmeasure', 'measure', 'unit_name'] },
  price: { primary: ['price', 'unit_price', 'unitprice', 'rate', 'selling_price', 'sellingprice', 'list_price', 'listprice'], secondary: ['amount', 'cost'] },
}

const ORDER_ALIASES: AliasTable = {
  externalId: { primary: ['order_number', 'ordernumber', 'number', 'reference', 'order_id', 'orderid', 'invoice_number', 'invoicenumber', 'id', 'ref', 'code'] },
  customerExternalId: {
    primary: ['customer_id', 'customerid', 'customer_code', 'customercode', 'contact_id', 'contactid', 'customer_number', 'buyer_id', 'user_id', 'userid'],
  },
  customerEmail: { primary: ['customer_email', 'customeremail', 'email', 'contact_email'] },
  customerPhone: { primary: ['customer_phone', 'customerphone', 'customer_mobile', 'phone', 'mobile', 'msisdn', 'contact_number'] },
  orderedAt: {
    primary: ['ordered_at', 'orderedat', 'order_date', 'orderdate', 'date', 'created_at', 'createdat', 'placed_at', 'paid_at', 'paidat', 'transaction_date', 'transactiondate', 'purchase_date', 'timestamp'],
  },
  status: { primary: ['status', 'order_status', 'orderstatus', 'state', 'payment_status', 'paymentstatus'] },
  currency: { primary: ['currency', 'currency_code', 'currencycode', 'ccy'] },
  total: { primary: ['total', 'grand_total', 'grandtotal', 'total_amount', 'totalamount', 'order_total', 'ordertotal', 'amount'], secondary: ['value', 'sum', 'price'] },
  paymentMethod: { primary: ['payment_method', 'paymentmethod', 'payment_type', 'paymenttype', 'channel', 'gateway', 'method'] },
}

const ORDER_ITEM_ALIASES: AliasTable = {
  productExternalId: { primary: ['product_id', 'productid', 'item_id', 'itemid', 'product_code', 'sku', 'id', 'code'] },
  productName: { primary: ['product_name', 'productname', 'item_name', 'itemname', 'name', 'title'], secondary: ['description'] },
  quantity: { primary: ['quantity', 'qty', 'count', 'units', 'unit_count', 'ordered_quantity'] },
  unitPrice: { primary: ['unit_price', 'unitprice', 'price', 'rate', 'line_price'], secondary: ['amount', 'list_price'] },
}

const FIELD_ALIASES: Record<ConnectorResourceName | 'orderItems', AliasTable> = {
  customers: CUSTOMER_ALIASES,
  products: PRODUCT_ALIASES,
  orders: ORDER_ALIASES,
  orderItems: ORDER_ITEM_ALIASES,
}

const FIRST_NAME_ALIASES = ['first_name', 'firstname', 'given_name', 'givenname']
const LAST_NAME_ALIASES = ['last_name', 'lastname', 'surname', 'family_name', 'familyname']

/** `Contact Id` -> `contactid`, so spelling differences do not defeat a match. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

type Candidate = {
  path: string
  /** Last path segment, normalized — the key a mapping usually names. */
  key: string
  /** Parent path, so `phone`/`mobile` can be joined only when they share a level. */
  parent: string
  depth: number
}

function candidatesFrom(paths: string[]): Candidate[] {
  return paths
    .map((path, index) => {
      const segments = path.split('.')
      const last = segments[segments.length - 1] ?? path
      const key = normalizeKey(last.replace(/\[0\]$/, ''))
      const parent = segments.slice(0, -1).join('.')
      return { path, key, parent, depth: segments.length, index }
    })
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
}

/** All matches of the *best* matching alias, so a join can consider siblings. */
function matchAliases(candidates: Candidate[], aliases: string[], limit = 4): Candidate[] {
  for (const alias of aliases) {
    const wanted = normalizeKey(alias)
    if (!wanted) continue
    const hits = candidates.filter((candidate) => candidate.key === wanted)
    if (hits.length) return hits.slice(0, limit)
  }
  return []
}

/**
 * Matches every alias, not just the best one.
 *
 * Used by the fields that accept alternatives: a payload with both `phone` and
 * `mobile` should produce `phone || mobile`, which is only visible if every alias
 * is considered.
 */
function matchAllAliases(candidates: Candidate[], aliases: string[], limit = 6): Candidate[] {
  const seen = new Set<string>()
  const hits: Candidate[] = []
  for (const alias of aliases) {
    const wanted = normalizeKey(alias)
    if (!wanted) continue
    for (const candidate of candidates) {
      if (candidate.key !== wanted || seen.has(candidate.path)) continue
      seen.add(candidate.path)
      hits.push(candidate)
      if (hits.length >= limit) return hits
    }
  }
  return hits
}

/** The first two matches that live at the same level, for an `a || b` mapping. */
function firstSameLevelPair(hits: Candidate[]): [Candidate, Candidate] | null {
  for (const candidate of hits) {
    const sibling = hits.find((other) => other !== candidate && other.parent === candidate.parent)
    if (sibling) return [candidate, sibling]
  }
  return null
}

/**
 * A person's name is very often two fields. Mapping only `first_name` would import
 * half a name, so when both halves are present they are proposed as one template:
 * `{first_name} {last_name}` — the mapper's own syntax, not a guess at the data.
 */
function addNameTemplate(keyName: ConnectorResourceName | 'orderItems', candidates: Candidate[], suggestions: Record<string, string>) {
  if (keyName !== 'customers' || suggestions.name) return
  const first = matchAliases(candidates, FIRST_NAME_ALIASES, 1)[0]
  const last = matchAliases(candidates, LAST_NAME_ALIASES, 1)[0]
  if (first && last) suggestions.name = `{${first.path}} {${last.path}}`
  else if (first ?? last) suggestions.name = (first ?? last)!.path
}

/**
 * Suggestions for one resource, from the leaf paths of one record.
 *
 * Only canonical fields are touched (the schema decides those), only paths that
 * exist in the observed record are proposed, and a field with no match stays
 * blank.
 */
export function suggestFieldMappings(
  keyName: ConnectorResourceName | 'orderItems',
  paths: string[],
): Record<string, string> {
  const aliases = FIELD_ALIASES[keyName]
  const candidates = candidatesFrom(paths)
  const suggestions: Record<string, string> = {}

  for (const field of CONNECTOR_FIELDS[keyName]) {
    const spec = aliases[field.key]
    if (!spec) continue

    if (spec.joinAlternatives) {
      const all = matchAllAliases(candidates, spec.primary)
      const pair = firstSameLevelPair(all)
      const best = pair ? null : (all[0] ?? matchAliases(candidates, spec.primary)[0])
      if (pair) suggestions[field.key] = `${pair[0].path} || ${pair[1].path}`
      else if (best) suggestions[field.key] = best.path
      if (pair || best) continue
    } else {
      const primary = matchAliases(candidates, spec.primary)
      if (primary.length) {
        suggestions[field.key] = primary[0]!.path
        continue
      }
    }

    if (spec.secondary) {
      const secondary = matchAliases(candidates, spec.secondary)
      if (secondary.length) suggestions[field.key] = secondary[0]!.path
    }
  }

  addNameTemplate(keyName, candidates, suggestions)
  return suggestions
}

/* -------------------------------------------------------------------------- */
/* OpenAPI / Swagger                                                          */
/* -------------------------------------------------------------------------- */

/** Ends-with nouns that identify a collection endpoint for each resource. */
const RESOURCE_PATH_WORDS: Record<ConnectorResourceName, RegExp> = {
  customers: /(customer|contact|client|buyer|account|subscriber)s?$/i,
  products: /(product|item|article|catalogue|catalog|inventory|variant|service)s?$/i,
  orders: /(order|invoice|transaction|sale|payment|receipt|checkout|ticket)s?$/i,
}

/** Segments that look like a resource but are a sub-resource of an order. */
const NON_COLLECTION_SEGMENTS = /^(line|refund|cancel|status)/i

function isOpenApiDocument(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (typeof value.openapi === 'string' || typeof value.swagger === 'string') &&
    isRecord(value.paths)
  )
}

/** `#/components/schemas/Customer` -> that node, or null when it is not there. */
function resolveRef(ref: string, doc: Record<string, unknown>): unknown {
  let current: unknown = doc
  for (const rawPart of ref.replace(/^#\//, '').split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isRecord(current)) return null
    current = current[part]
  }
  return current ?? null
}

/**
 * Resolves `$ref`, `allOf`, `oneOf`/`anyOf` enough to read a response shape.
 *
 * This is not a schema validator — the preview is what proves a mapping. It only
 * has to get property names and array positions right, and it refuses to loop on a
 * recursive schema.
 */
function resolveSchema(schema: unknown, doc: Record<string, unknown>, depth = 0, seen: string[] = []): Record<string, unknown> | null {
  if (!isRecord(schema) || depth > 8) return null

  const ref = schema.$ref
  if (typeof ref === 'string') {
    if (seen.includes(ref)) return null
    const target = resolveRef(ref, doc)
    const resolved = resolveSchema(target, doc, depth + 1, [...seen, ref])
    if (!resolved) return null
    const { $ref: _ignored, ...rest } = schema
    return { ...resolved, ...rest }
  }

  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {}
    for (const part of schema.allOf) {
      const entry = resolveSchema(part, doc, depth + 1, seen)
      if (entry) Object.assign(merged, entry)
    }
    const { allOf: _ignored, ...rest } = schema
    return { ...merged, ...rest }
  }

  for (const key of ['oneOf', 'anyOf']) {
    const list = schema[key]
    if (Array.isArray(list) && list.length) {
      const entry = resolveSchema(list[0], doc, depth + 1, seen)
      const { [key]: _ignored, ...rest } = schema
      if (entry) return { ...entry, ...rest }
    }
  }

  return schema
}

/**
 * Builds one representative value from a schema.
 *
 * Arrays become a single-element list, which is exactly what the record-path and
 * field-path readers need to see: the same code then handles a sample payload and
 * an OpenAPI document.
 */
function schemaToSample(schema: unknown, doc: Record<string, unknown>, depth = 0): unknown {
  if (depth > 5) return '…'
  const resolved = resolveSchema(schema, doc, depth)
  if (!resolved) return '…'

  if (Array.isArray(resolved.enum) && resolved.enum.length) return resolved.enum[0]

  const type = typeof resolved.type === 'string' ? resolved.type : undefined
  if (type === 'array' || Array.isArray(resolved.items)) {
    const items = Array.isArray(resolved.items) ? resolved.items[0] : resolved.items
    return items === undefined ? [] : [schemaToSample(items, doc, depth + 1)]
  }
  if (type === 'object' || isRecord(resolved.properties)) {
    const properties = isRecord(resolved.properties) ? resolved.properties : {}
    const sample: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(properties)) sample[key] = schemaToSample(entry, doc, depth + 1)
    return sample
  }
  return '…'
}

/** The last path segment that names a thing rather than an id or a version. */
function lastMeaningfulSegment(path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/\.[a-z0-9]+$/i, ''))
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!
    if (/^\{.*\}$/.test(part) || /^v\d+$/i.test(part)) continue
    return part
  }
  return ''
}

/** Chooses one GET collection endpoint per resource, preferring non-templated paths. */
function pickResourcePaths(doc: Record<string, unknown>): Partial<Record<ConnectorResourceName, string>> {
  const paths = isRecord(doc.paths) ? doc.paths : {}
  const chosen: Partial<Record<ConnectorResourceName, string>> = {}

  for (const resource of RESOURCE_KEYS) {
    const candidates: Array<{ path: string; parameterized: boolean; segments: number }> = []
    for (const [path, operations] of Object.entries(paths)) {
      if (!isRecord(operations) || !isRecord(operations.get)) continue
      const segment = lastMeaningfulSegment(path)
      if (!segment || NON_COLLECTION_SEGMENTS.test(segment)) continue
      if (!RESOURCE_PATH_WORDS[resource].test(segment)) continue
      candidates.push({ path, parameterized: path.includes('{'), segments: path.split('/').filter(Boolean).length })
    }
    candidates.sort(
      (a, b) => Number(a.parameterized) - Number(b.parameterized) || a.segments - b.segments || a.path.localeCompare(b.path),
    )
    if (candidates[0]) chosen[resource] = candidates[0].path
  }

  return chosen
}

/** The base URL a document declares: OpenAPI 3 `servers`, or Swagger 2 `host`. */
function openApiBaseUrl(doc: Record<string, unknown>): string | null {
  const servers = Array.isArray(doc.servers) ? doc.servers : []
  for (const server of servers) {
    if (!isRecord(server) || typeof server.url !== 'string') continue
    if (/^https?:\/\//i.test(server.url)) return server.url.replace(/\/+$/, '')
  }

  if (typeof doc.host === 'string' && doc.host) {
    const scheme = Array.isArray(doc.schemes) && typeof doc.schemes[0] === 'string' ? doc.schemes[0] : 'https'
    const basePath = typeof doc.basePath === 'string' ? doc.basePath : ''
    return `${scheme}://${doc.host}${basePath}`.replace(/\/+$/, '')
  }
  return null
}

/** The 2xx JSON response schema of a GET operation (OpenAPI 3 or Swagger 2). */
function responseSchema(operation: Record<string, unknown> | undefined, doc: Record<string, unknown>): unknown {
  if (!operation || !isRecord(operation.responses)) return null
  const responses = operation.responses
  const code =
    Object.keys(responses).find((key) => /^2\d\d$/.test(key)) ??
    Object.keys(responses).find((key) => key.toUpperCase() === '2XX')
  const entry = code ? responses[code] : undefined
  if (!isRecord(entry)) return null

  if (isRecord(entry.content)) {
    const json = isRecord(entry.content['application/json'])
      ? entry.content['application/json']
      : Object.values(entry.content).find(isRecord)
    if (isRecord(json) && json.schema !== undefined) return json.schema
  }
  return entry.schema ?? null
}

/**
 * Turns a synthetic record (from a sample or a schema) into per-resource form
 * values. Shared by the sample and OpenAPI readers so both propose identical
 * field paths for identical shapes.
 */
function resourcesFromRecord(record: Record<string, unknown> | undefined): {
  resources: Partial<Record<ConnectorResourceName, ResourceDiscovery>>
  itemPaths: string[]
} {
  const paths = record ? collectFieldPaths(record) : []
  const items = record ? deriveItemsPath(record) : null
  const item = record && items ? collectRecords(record, items.path).find(isRecord) : undefined
  const itemPaths = item ? collectFieldPaths(item) : []
  const itemsFields = itemPaths.length ? suggestFieldMappings('orderItems', itemPaths) : {}

  const resources: Partial<Record<ConnectorResourceName, ResourceDiscovery>> = {}
  for (const key of RESOURCE_KEYS) {
    resources[key] = {
      path: null,
      recordsPath: null,
      fields: suggestFieldMappings(key, paths),
      itemsRecordsPath: key === 'orders' ? (items?.path ?? null) : null,
      itemsFields: key === 'orders' ? itemsFields : {},
      paths,
      itemPaths: key === 'orders' ? itemPaths : [],
    }
  }
  return { resources, itemPaths }
}

/** Reads base URL, endpoints and field names out of an OpenAPI/Swagger document. */
function discoverFromOpenApi(doc: Record<string, unknown>): ApiStructureDiscovery {
  const notes: string[] = []
  const baseUrl = openApiBaseUrl(doc)
  const chosen = pickResourcePaths(doc)
  const resources: Partial<Record<ConnectorResourceName, ResourceDiscovery>> = {}
  const docPaths = isRecord(doc.paths) ? doc.paths : {}

  if (!baseUrl) notes.push('The document has no absolute server URL — enter the base URL by hand.')
  else if (/^https?:\/\//i.test(baseUrl) && !/^https?:\/\/[^/]+$/i.test(baseUrl)) {
    notes.push(`Base URL taken from the document: ${baseUrl}`)
  }

  for (const resource of RESOURCE_KEYS) {
    const path = chosen[resource]
    if (!path) {
      notes.push(`No GET endpoint for ${resource} was recognised.`)
      continue
    }

    const operations = docPaths[path]
    const operation = isRecord(operations) && isRecord(operations.get) ? operations.get : undefined
    const schema = responseSchema(operation, doc)
    if (schema === null) notes.push(`${path} has no 2xx JSON response schema — map ${resource} by hand.`)

    const sample = schema === null ? undefined : schemaToSample(schema, doc)
    const list = sample === undefined ? null : deriveRecordsPath(sample)
    const records = list ? collectRecords(sample, list.path) : []
    const record = records.find(isRecord)
    const { resources: byResource } = resourcesFromRecord(record)

    resources[resource] = {
      ...byResource[resource]!,
      path,
      recordsPath: list ? list.path : null,
    }
  }

  if (!Object.keys(resources).length) notes.push('No collection endpoint was found: is this a list API?')

  return {
    kind: 'openapi',
    title: `OpenAPI document (${Object.keys(docPaths).length} paths)`,
    notes,
    baseUrl,
    connector: null,
    resources,
  }
}

/* -------------------------------------------------------------------------- */
/* Connector export                                                           */
/* -------------------------------------------------------------------------- */

type UnrecognizedIssue = { path: PropertyKey[]; keys: string[] }

/**
 * Zod reports unknown keys as issues rather than refusing the whole document.
 *
 * A vendor's export routinely carries a `version`, a `provider` or a UI-only
 * annotation that the connector schema does not model; dropping exactly those keys
 * and re-validating is friendlier than rejecting an otherwise perfect spec, and it
 * still refuses a document whose *known* keys are wrong.
 */
function unrecognizedIssues(issues: unknown[]): UnrecognizedIssue[] {
  const result: UnrecognizedIssue[] = []
  for (const issue of issues) {
    if (!isRecord(issue) || issue.code !== 'unrecognized_keys' || !Array.isArray(issue.keys)) continue
    const path = Array.isArray(issue.path) ? (issue.path as PropertyKey[]) : []
    result.push({ path, keys: issue.keys.filter((key): key is string => typeof key === 'string') })
  }
  return result
}

function deleteAtPath(root: unknown, path: PropertyKey[], keys: string[]) {
  let current: unknown = root
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)]
      continue
    }
    if (!isRecord(current)) return
    current = current[String(segment)]
  }
  if (isRecord(current)) for (const key of keys) delete current[key]
}

/** True for an object shaped like a connector: a base URL and at least one resource. */
function looksLikeConnector(value: Record<string, unknown>): boolean {
  if (typeof value.baseUrl !== 'string' || !isRecord(value.resources)) return false
  const resources = value.resources
  return RESOURCE_KEYS.some((key) => isRecord(resources[key]))
}

/** The connector itself, when the export wraps it (`{ connector: … }`). */
function connectorCandidate(input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null
  for (const key of ['connector', 'spec']) {
    const nested = input[key]
    if (isRecord(nested) && looksLikeConnector(nested)) return nested
  }
  return looksLikeConnector(input) ? input : null
}

function coerceConnectorExport(input: unknown): { connector: ConnectorConfig | null; ignored: string[] } {
  const candidate = connectorCandidate(input)
  if (!candidate) return { connector: null, ignored: [] }

  let current: unknown = candidate
  const ignored: string[] = []

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parsed = connectorSchema.safeParse(current)
    if (parsed.success) return { connector: parsed.data, ignored }

    const unknownIssues = unrecognizedIssues(parsed.error.issues)
    if (!unknownIssues.length) return { connector: null, ignored }
    for (const issue of unknownIssues) {
      deleteAtPath(current, issue.path, issue.keys)
      ignored.push(...issue.keys)
    }
  }
  return { connector: null, ignored }
}

/** A connector export is applied whole: it *is* the mapping, not a hint for one. */
function discoveryFromConnector(connector: ConnectorConfig, ignored: string[]): ApiStructureDiscovery {
  const resources: Partial<Record<ConnectorResourceName, ResourceDiscovery>> = {}

  for (const key of RESOURCE_KEYS) {
    const mapping = connector.resources[key]
    if (!mapping) continue
    const items = key === 'orders' ? (mapping as ConnectorOrdersResourceConfig).items : undefined
    resources[key] = {
      path: mapping.path,
      recordsPath: mapping.recordsPath,
      fields: { ...mapping.fields },
      itemsRecordsPath: items?.recordsPath ?? null,
      itemsFields: { ...(items?.fields ?? {}) },
      paths: Object.values(mapping.fields).filter((path) => typeof path === 'string' && path.length > 0),
      itemPaths: Object.values(items?.fields ?? {}).filter((path) => typeof path === 'string' && path.length > 0),
    }
  }

  const names = Object.keys(resources)
  return {
    kind: 'connector',
    title: 'Connector export',
    notes: [
      `Read ${names.length} resource${names.length === 1 ? '' : 's'} (${names.join(', ')}) — apply it to load the whole configuration.`,
      ...(ignored.length ? [`Ignored unknown key(s): ${[...new Set(ignored)].join(', ')}.`] : []),
    ],
    baseUrl: connector.baseUrl,
    connector,
    resources,
  }
}

/* -------------------------------------------------------------------------- */
/* Sample response                                                            */
/* -------------------------------------------------------------------------- */

/** Reads a payload as a sample response: record list, record shape, suggestions. */
function discoverFromSample(payload: unknown): ApiStructureDiscovery {
  const notes: string[] = []
  const list = deriveRecordsPath(payload)
  const records = list ? collectRecords(payload, list.path) : []
  const record = records.find(isRecord)
  // A single-object payload (one order, one customer) is still usable: its own keys
  // are the record shape. The records path is then left for the operator to decide.
  const single = list || !isRecord(payload) ? undefined : payload

  const { resources } = resourcesFromRecord(record ?? single)

  if (list && record) {
    for (const key of RESOURCE_KEYS) resources[key] = { ...resources[key]!, recordsPath: list.path }
    notes.push(
      `Records sit at ${list.path === '' ? 'the response itself' : `"${list.path}"`} — ${list.count} row${list.count === 1 ? '' : 's'} in this sample.`,
    )
  } else if (list) {
    notes.push('The list is empty in this sample — check the records path against a real response.')
  } else if (single) {
    notes.push('No array of records was found: this looks like a single record. Set the endpoint path and records path by hand.')
  } else {
    notes.push('This payload has no object to read field paths from.')
  }

  const keys = record ? Object.keys(record) : []
  return {
    kind: 'sample',
    title: record ? `Sample response (${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''})` : 'Sample response',
    notes,
    baseUrl: null,
    connector: null,
    resources,
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Recognises what the operator pasted and proposes form values for it.
 *
 * The three shapes are tried in order of how specific they are: an OpenAPI document
 * declares itself, a connector export has a base URL and resources, and everything
 * else is treated as a sample payload. A document that looks like a connector but
 * does not validate reports its validation issues rather than being misread as a
 * sample — a wrong guess would fill the form with plausible nonsense.
 */
export function discoverApiStructure(input: unknown): ApiStructureDiscovery {
  if (isOpenApiDocument(input)) return discoverFromOpenApi(input)

  const candidate = connectorCandidate(input)
  if (candidate) {
    const { connector, ignored } = coerceConnectorExport(candidate)
    if (connector) return discoveryFromConnector(connector, ignored)

    const issues = connectorSchema.safeParse(candidate).error?.issues ?? []
    return {
      kind: 'connector',
      title: 'Connector export (invalid)',
      notes: [
        'This looks like a connector export, but it does not validate:',
        ...issues.slice(0, 6).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      ],
      baseUrl: null,
      connector: null,
      resources: {},
    }
  }

  return discoverFromSample(input)
}








