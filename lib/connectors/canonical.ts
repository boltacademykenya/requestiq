import type { ConnectorOrdersResourceConfig, ConnectorResourceConfig } from './config'
import { collectRecords, resolveExpression } from './paths'

/**
 * Canonical records and the coercions that produce them.
 *
 * Everything a connector reads is reduced to three shapes — customer, product,
 * order — which is exactly what `customers`, `products` and `orders` store. The
 * prediction engine therefore never learns that a connector exists.
 *
 * Validation here is the gate that keeps bad data out of the intelligence: a row
 * that cannot be represented faithfully is rejected with a reason the operator
 * can act on, rather than being coerced into something plausible. A rejected row
 * is *counted and shown*, never silently dropped.
 */

/** Mirrors `currencySchema` in lib/api/contracts.ts — keep the two in step. */
export const CURRENCIES = ['KES', 'USD', 'UGX', 'TZS', 'NGN', 'ZAR', 'EUR', 'GBP'] as const

export const ORDER_STATUSES = ['COMPLETED', 'PENDING', 'CANCELLED'] as const
export type IngestedOrderStatus = (typeof ORDER_STATUSES)[number]

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE = /^[+()\d\s-]+$/
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

const MAX_NAME = 160
const MIN_NAME = 2
const EARLIEST_ORDER = Date.UTC(2000, 0, 1)
const MAX_ORDER_AHEAD_MS = 86_400_000

export type Mapped<T> = { ok: true; value: T } | { ok: false; reason: string }

const ok = <T>(value: T): Mapped<T> => ({ ok: true, value })
const fail = <T>(reason: string): Mapped<T> => ({ ok: false, reason })

/* -------------------------------------------------------------------------- */
/* Coercions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Unwraps a value to a scalar.
 *
 * A single-element array is unwrapped (many APIs wrap one object), a longer one
 * is a mapping smell and yields `undefined` so the caller reports it.
 */
function toScalar(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined
  return value
}

/** Trimmed text. Length is *not* truncated: the normalisers reject over-long values. */
export function toText(value: unknown, max: number): string | null {
  const scalar = toScalar(value)
  if (scalar === null || scalar === undefined) return null
  if (typeof scalar === 'object') return null
  const text = String(scalar).replace(CONTROL_CHARS, '').trim()
  if (!text.length || text.length > max) return null
  return text
}

/** Parses numbers out of real-world payloads: "KSh 1,200.50" -> 1200.5 */
export function toNumber(value: unknown): number | null {
  const scalar = toScalar(value)
  if (scalar === null || scalar === undefined) return null
  if (typeof scalar === 'number') return Number.isFinite(scalar) ? scalar : null
  if (typeof scalar === 'boolean') return null
  const cleaned = String(scalar).replace(/[^0-9.-]/g, '')
  if (!cleaned.length) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/** Unix seconds, unix milliseconds and ISO strings are all accepted. */
export function toDate(value: unknown): Date | null {
  const scalar = toScalar(value)
  if (scalar === null || scalar === undefined) return null

  if (typeof scalar === 'number') return fromEpoch(scalar)

  const text = String(scalar).trim()
  if (!text.length) return null
  if (/^\d{9,13}$/.test(text)) return fromEpoch(Number(text))
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : new Date(parsed)
}

function fromEpoch(value: number): Date | null {
  if (!Number.isFinite(value)) return null
  if (value > 1e12) return new Date(value)
  if (value > 1e8) return new Date(value * 1000)
  return null
}

/**
 * Normalises an enum through the connector's value map, then by upper-casing.
 * Returns null when the source value cannot be represented, which the caller
 * reports as "unrecognised status — add a value mapping".
 */
export function toEnumValue(
  value: unknown,
  allowed: readonly string[],
  valueMap?: Record<string, string> | undefined,
): string | null {
  const scalar = toScalar(value)
  if (scalar === null || scalar === undefined) return null
  const text = String(scalar).trim()
  if (!text.length) return null
  if (valueMap) {
    const mapped = valueMap[text.toLowerCase()]
    if (mapped && allowed.includes(mapped.toUpperCase())) return mapped.toUpperCase()
  }
  const candidate = text.toUpperCase().replace(/[\s-]+/g, '_')
  return allowed.includes(candidate) ? candidate : null
}

/* -------------------------------------------------------------------------- */
/* Field access                                                               */
/* -------------------------------------------------------------------------- */

type FieldSource = {
  fields: Record<string, string>
  values?: Record<string, Record<string, string>> | undefined
}

/** Resolves one canonical field, applying the value map when the source is an enum. */
function pick(record: unknown, source: FieldSource, field: string): unknown {
  const expression = source.fields[field]
  if (!expression) return undefined
  const raw = resolveExpression(record, expression)
  const valueMap = source.values?.[field]
  if (valueMap && raw !== null && raw !== undefined) {
    const key = String(Array.isArray(raw) ? '' : raw).trim().toLowerCase()
    const mapped = key ? valueMap[key] : undefined
    if (mapped !== undefined) return mapped
  }
  return raw
}

/* -------------------------------------------------------------------------- */
/* Orders: reference building                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turns an external order id into a valid order reference.
 *
 * `orders.reference` is unique per tenant and constrained to
 * `[A-Za-z0-9._-]{3,40}`, so provider ids that contain `/`, `:` or `#` (Shopify
 * gids, for instance) are normalised rather than rejected.
 */
export function buildReference(prefix: string | undefined, externalId: string): string | null {
  const combined = `${prefix ?? ''}${externalId}`
  const cleaned = combined
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 40)
  return /^[A-Za-z0-9._-]{3,40}$/.test(cleaned) ? cleaned : null
}

/* -------------------------------------------------------------------------- */
/* Canonical shapes                                                           */
/* -------------------------------------------------------------------------- */

export type NormalisedCustomer = {
  externalId: string | null
  name: string
  phone: string
  email: string | null
  location: string | null
  customerType: string
}

export type NormalisedProduct = {
  externalId: string | null
  name: string
  sku: string | null
  category: string | null
  unit: string
  price: number
}

export type NormalisedOrderItem = {
  productExternalId: string | null
  productName: string
  quantity: number
  unitPrice: number | null
}

export type NormalisedOrder = {
  externalId: string
  reference: string
  customerExternalId: string | null
  customerEmail: string | null
  customerPhone: string | null
  orderedAt: Date
  status: IngestedOrderStatus
  currency: string | null
  total: number | null
  paymentMethod: string | null
  items: NormalisedOrderItem[]
}

/* -------------------------------------------------------------------------- */
/* Normalisers                                                                */
/* -------------------------------------------------------------------------- */

export function normaliseCustomer(record: unknown, resource: ConnectorResourceConfig): Mapped<NormalisedCustomer> {
  const name = toText(pick(record, resource, 'name'), MAX_NAME)
  if (!name) return fail('name is missing, empty or longer than 160 characters')
  if (name.length < MIN_NAME) return fail(`name "${name}" is shorter than ${MIN_NAME} characters`)

  // Phone is required: it is the channel any reorder action reaches the customer on.
  const phone = toText(pick(record, resource, 'phone'), 32)
  if (!phone) return fail('phone is missing — ReorderIQ cannot act on a customer without one')
  if (!PHONE.test(phone) || phone.replace(/\D/g, '').length < 6) {
    return fail(`phone "${phone}" is not a usable number`)
  }

  const email = toText(pick(record, resource, 'email'), 200)
  if (email && !EMAIL.test(email)) return fail(`email "${email}" is not a valid address`)

  return ok({
    externalId: toText(pick(record, resource, 'externalId'), 200),
    name,
    phone,
    email,
    location: toText(pick(record, resource, 'location'), 120),
    customerType: (toText(pick(record, resource, 'customerType'), 40) ?? 'BUSINESS').toUpperCase(),
  })
}

export function normaliseProduct(record: unknown, resource: ConnectorResourceConfig): Mapped<NormalisedProduct> {
  const name = toText(pick(record, resource, 'name'), MAX_NAME)
  if (!name) return fail('name is missing, empty or longer than 160 characters')
  if (name.length < MIN_NAME) return fail(`name "${name}" is shorter than ${MIN_NAME} characters`)

  const rawPrice = pick(record, resource, 'price')
  const parsedPrice = rawPrice === undefined ? 0 : toNumber(rawPrice) ?? Number.NaN
  if (Number.isNaN(parsedPrice)) return fail(`price "${String(rawPrice)}" is not a number`)

  const price = parsedPrice * resource.moneyScale
  if (price < 0) return fail('price cannot be negative')
  if (price > 1_000_000_000) return fail('price is larger than the maximum supported amount')

  return ok({
    externalId: toText(pick(record, resource, 'externalId'), 200),
    name,
    sku: toText(pick(record, resource, 'sku'), 64),
    category: toText(pick(record, resource, 'category'), 120),
    unit: toText(pick(record, resource, 'unit'), 32) ?? 'unit',
    price: round2(price),
  })
}

export function normaliseOrder(
  record: unknown,
  resource: ConnectorOrdersResourceConfig,
  options: { fallbackCurrency: string; now?: Date },
): Mapped<NormalisedOrder> {
  const externalId = toText(pick(record, resource, 'externalId'), 200)
  if (!externalId) return fail('order id is missing — it becomes the order reference')

  const reference = buildReference(resource.referencePrefix, externalId)
  if (!reference) return fail(`order id "${externalId}" cannot be turned into a reference (needs 3+ usable characters)`)

  const orderedAt = toDate(pick(record, resource, 'orderedAt'))
  if (!orderedAt) return fail('orderedAt is missing or not a recognisable date')
  const now = options.now ?? new Date()
  if (orderedAt.getTime() < EARLIEST_ORDER) return fail(`orderedAt ${orderedAt.toISOString()} predates 2000`)
  if (orderedAt.getTime() > now.getTime() + MAX_ORDER_AHEAD_MS) {
    return fail(`orderedAt ${orderedAt.toISOString()} is in the future`)
  }

  const rawStatus = pick(record, resource, 'status')
  let status: IngestedOrderStatus = 'COMPLETED'
  if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim().length) {
    const resolved = toEnumValue(rawStatus, ORDER_STATUSES, resource.values?.status)
    if (!resolved) {
      return fail(`status "${String(rawStatus)}" is not recognised — add a value mapping for it`)
    }
    status = resolved as IngestedOrderStatus
  }

  const rawCurrency = pick(record, resource, 'currency')
  let currency: string | null = null
  if (rawCurrency !== undefined && rawCurrency !== null && String(rawCurrency).trim().length) {
    currency = toEnumValue(rawCurrency, CURRENCIES)
    if (!currency) return fail(`currency "${String(rawCurrency)}" is not supported`)
  } else {
    currency = CURRENCIES.includes(options.fallbackCurrency as (typeof CURRENCIES)[number])
      ? options.fallbackCurrency
      : 'KES'
  }

  const rawTotal = pick(record, resource, 'total')
  let total: number | null = null
  if (rawTotal !== undefined) {
    const parsed = toNumber(rawTotal)
    if (parsed === null) return fail(`total "${String(rawTotal)}" is not a number`)
    const scaled = parsed * resource.moneyScale
    if (scaled < 0) return fail('total cannot be negative')
    total = round2(scaled)
  }

  const itemsResult = normaliseItems(record, resource)
  if (!itemsResult.ok) return itemsResult

  return ok({
    externalId,
    reference,
    customerExternalId: toText(pick(record, resource, 'customerExternalId'), 200),
    customerEmail: toText(pick(record, resource, 'customerEmail'), 200),
    customerPhone: toText(pick(record, resource, 'customerPhone'), 32),
    orderedAt,
    status,
    currency,
    total,
    paymentMethod: toText(pick(record, resource, 'paymentMethod'), 60),
    items: itemsResult.value,
  })
}

function normaliseItems(
  record: unknown,
  resource: ConnectorOrdersResourceConfig,
): Mapped<NormalisedOrderItem[]> {
  const items = resource.items
  if (!items) return ok([])

  // An empty recordsPath means the order record *is* the single line item.
  const raw = items.recordsPath.trim() ? collectRecords(record, items.recordsPath) : [record]
  const normalised: NormalisedOrderItem[] = []
  let lastReason = ''

  raw.forEach((entry, index) => {
    const productExternalId = toText(pick(entry, items, 'productExternalId'), 200)
    const productName = toText(pick(entry, items, 'productName'), MAX_NAME) ?? productExternalId
    if (!productName) {
      lastReason = `line ${index + 1}: product name is missing`
      return
    }

    const quantity = toNumber(pick(entry, items, 'quantity'))
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      lastReason = `line ${index + 1} ("${productName}"): quantity must be a whole number between 1 and 100000`
      return
    }

    const rawPrice = pick(entry, items, 'unitPrice')
    const unitPrice = rawPrice === undefined ? null : toNumber(rawPrice)
    if (unitPrice !== null && unitPrice < 0) {
      lastReason = `line ${index + 1} ("${productName}"): unit price cannot be negative`
      return
    }

    normalised.push({
      productExternalId,
      productName,
      quantity,
      unitPrice: unitPrice === null ? null : round2(unitPrice * resource.moneyScale),
    })
  })

  // An order with no usable lines still carries history, so it is kept; only a
  // mapping that matched lines and read none of them is a configuration fault.
  if (raw.length > 0 && normalised.length === 0) {
    return fail(lastReason || 'no line item could be read')
  }

  return ok(normalised)
}

const round2 = (value: number) => Math.round(value * 100) / 100

/* -------------------------------------------------------------------------- */
/* Run accounting                                                             */
/* -------------------------------------------------------------------------- */

export type ResourceCounts = { fetched: number; created: number; updated: number; rejected: number }

export type SyncRunCounts = {
  customers: ResourceCounts
  products: ResourceCounts
  orders: ResourceCounts
  /** A bounded sample of why rows were rejected, for the run report. */
  rejections: Array<{ resource: string; reason: string; count: number }>
}

export function emptyRunCounts(): SyncRunCounts {
  const zero = (): ResourceCounts => ({ fetched: 0, created: 0, updated: 0, rejected: 0 })
  return { customers: zero(), products: zero(), orders: zero(), rejections: [] }
}

/** Folds a repeated rejection reason into the sample so one bad field reads as one line. */
export function recordRejection(counts: SyncRunCounts, resource: string, reason: string) {
  const existing = counts.rejections.find((entry) => entry.resource === resource && entry.reason === reason)
  if (existing) {
    existing.count += 1
    return
  }
  if (counts.rejections.length >= 25) return
  counts.rejections.push({ resource, reason, count: 1 })
}
