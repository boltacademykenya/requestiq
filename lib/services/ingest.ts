import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type {
  NormalisedCustomer,
  NormalisedOrder,
  NormalisedProduct,
  ResourceCounts,
} from '@/lib/connectors/canonical'
import { db } from '@/lib/db/client'
import { chunk } from '@/lib/db/query-utils'
import { customerSources, customers, integrations, orderItems, orders, products } from '@/lib/db/schema'

/**
 * Writes canonical connector rows into the tenant tables.
 *
 * Three rules shape everything here:
 *
 * 1. **Idempotent.** Rows are matched on the identity they have in the source
 *    system — the `customer_sources` alias for *this connection*, falling back to
 *    the natural key (email, phone, SKU, name). Running a sync twice updates, it
 *    never duplicates, and a re-run is the normal way to recover from a failure.
 * 2. **Never invent history.** For an order that already arrived, the amounts and
 *    the timestamp come from the source. Re-pricing an old order against today's
 *    catalogue would silently rewrite the interval maths the product is built on.
 * 3. **Never guess an identity.** A row whose natural key resolves to more than
 *    one canonical customer is rejected for review instead of being attached to
 *    one. Merging the wrong order history is invisible and permanent; a queued
 *    rejection is neither.
 *
 * A row that cannot be written is counted as rejected with a reason; it never
 * aborts the run, because one malformed record should not cost the tenant the
 * other 4,999.
 */

export type IngestActor = {
  organizationId: string
  actorUserId: string | null
  /**
   * Namespace for external ids: the **connection**, not the provider enum.
   *
   * Two Shopify stores are two sources whose record ids share no namespace, so
   * keying identity on the provider (`'SHOPIFY'`) let one store's `12345` match
   * the other's. The connection id is also what makes per-source freshness, the
   * "refresh from source" action and the provenance column possible.
   */
  integrationId: string
}

export type IngestOutcome = {
  counts: ResourceCounts
  rejections: Array<{ reason: string }>
}

/** Either the pool or an open transaction; both expose the query builder. */
type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0]

const emptyOutcome = (): IngestOutcome => ({
  counts: { fetched: 0, created: 0, updated: 0, rejected: 0 },
  rejections: [],
})

function reject(outcome: IngestOutcome, reason: string) {
  outcome.counts.rejected += 1
  if (outcome.rejections.length < 25 && !outcome.rejections.some((entry) => entry.reason === reason)) {
    outcome.rejections.push({ reason })
  }
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

const digits = (value: string) => value.replace(/\D/g, '')

/** Turns a Postgres driver error into a short, operator-facing sentence. */
function describeWriteError(error: unknown): string {
  const code = (error as { code?: string }).code
  if (code === '23505') return 'conflicts with an existing record that has the same external id, email, SKU or name'
  if (code === '23514') return 'violates a data rule (check the lengths and amounts in the mapping)'
  if (code === '23503') return 'references a record that no longer exists'
  return error instanceof Error ? `could not be saved (${error.message})` : 'could not be saved'
}

/** Digits-only comparison so "+254 712 000 111" matches "0712000111". */
const normalisedPhone = sql`regexp_replace(${customers.phone}, '[^0-9]', '', 'g')`

/** Canonical customer key, used to spot duplicates inside one response. */
const customerKey = (row: NormalisedCustomer): string =>
  row.externalId ? `x:${row.externalId}` : row.email ? `e:${row.email.toLowerCase()}` : `p:${digits(row.phone)}`

/** One canonical customer a source key resolves to. */
type CustomerMatch = { id: string; email: string | null; phone: string }

function pushMatch(map: Map<string, CustomerMatch[]>, key: string, match: CustomerMatch) {
  const bucket = map.get(key)
  if (!bucket) map.set(key, [match])
  else if (!bucket.some((entry) => entry.id === match.id)) bucket.push(match)
}

const distinctIds = (matches: CustomerMatch[] | undefined): string[] => [
  ...new Set((matches ?? []).map((entry) => entry.id)),
]

/** Records (or refreshes) this connection's claim on a canonical customer. */
async function upsertAlias(
  executor: DbExecutor,
  actor: IngestActor,
  customerId: string,
  externalId: string,
): Promise<void> {
  const now = new Date()
  await executor
    .insert(customerSources)
    .values({
      organizationId: actor.organizationId,
      customerId,
      integrationId: actor.integrationId,
      externalId,
      firstSeenAt: now,
      lastSyncedAt: now,
    })
    // The alias is inserted once and only touched afterwards: overwriting the
    // customer it points at is how a re-sync would quietly re-home history.
    .onConflictDoUpdate({
      target: [customerSources.organizationId, customerSources.integrationId, customerSources.externalId],
      set: { lastSyncedAt: now },
    })
}

/** Whether this connection has been nominated as the tenant's customer master. */
async function isMasterConnection(actor: IngestActor): Promise<boolean> {
  const [row] = await db
    .select({ config: integrations.config })
    .from(integrations)
    .where(and(eq(integrations.id, actor.integrationId), eq(integrations.organizationId, actor.organizationId)))
    .limit(1)
  return row?.config?.masterCustomer === true
}

/**
 * Customers whose contact fields are owned by a *different*, master connection.
 *
 * Written by the operator as `config.masterCustomer: true` on one connection: the
 * system of record for names and phone numbers. Every other source still
 * contributes its orders and its alias, but cannot overwrite those fields — so
 * "who wins" is a stated policy rather than whichever sync ran last.
 */
async function masteredByOtherConnections(actor: IngestActor, customerIds: string[]): Promise<Set<string>> {
  const mastered = new Set<string>()
  for (const group of chunk([...new Set(customerIds)])) {
    const found = await db
      .select({ customerId: customerSources.customerId })
      .from(customerSources)
      .innerJoin(integrations, eq(integrations.id, customerSources.integrationId))
      .where(
        and(
          eq(customerSources.organizationId, actor.organizationId),
          inArray(customerSources.customerId, group),
          ne(customerSources.integrationId, actor.integrationId),
          sql`${integrations.config} ->> 'masterCustomer' = 'true'`,
        ),
      )
    for (const row of found) mastered.add(row.customerId)
  }
  return mastered
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export async function upsertCustomers(actor: IngestActor, rows: NormalisedCustomer[]): Promise<IngestOutcome> {
  const outcome = emptyOutcome()
  outcome.counts.fetched = rows.length
  if (!rows.length) return outcome

  // Matches are found in three queries rather than three per row. The alias
  // lookup is scoped to *this connection*: another source's record id lives in
  // another namespace and must never match here.
  const byAlias = new Map<string, string>()
  const byEmail = new Map<string, CustomerMatch[]>()
  const byPhone = new Map<string, CustomerMatch[]>()

  const externalIds = [...new Set(rows.map((row) => row.externalId).filter((value): value is string => Boolean(value)))]
  const emails = [
    ...new Set(rows.map((row) => row.email?.toLowerCase()).filter((value): value is string => Boolean(value))),
  ]
  const phones = [...new Set(rows.map((row) => digits(row.phone)))].filter((value) => value.length >= 6)

  for (const group of chunk(externalIds)) {
    const found = await db
      .select({ customerId: customerSources.customerId, externalId: customerSources.externalId })
      .from(customerSources)
      .where(
        and(
          eq(customerSources.organizationId, actor.organizationId),
          eq(customerSources.integrationId, actor.integrationId),
          inArray(customerSources.externalId, group),
        ),
      )
    for (const row of found) byAlias.set(row.externalId, row.customerId)
  }

  for (const group of chunk(emails)) {
    const found = await db
      .select({ id: customers.id, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.organizationId, actor.organizationId), inArray(sql`lower(${customers.email})`, group)))
    for (const row of found) if (row.email) pushMatch(byEmail, row.email.toLowerCase(), row)
  }

  for (const group of chunk(phones)) {
    const found = await db
      .select({ id: customers.id, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.organizationId, actor.organizationId), inArray(normalisedPhone, group)))
    for (const row of found) pushMatch(byPhone, digits(row.phone), row)
  }

  const isMaster = await isMasterConnection(actor)

  const seen = new Set<string>()
  const staged = new Set<string>()
  const pending: NormalisedCustomer[] = []
  const updates: Array<{ row: NormalisedCustomer; customerId: string }> = []

  for (const [index, row] of rows.entries()) {
    const key = customerKey(row)
    if (seen.has(key)) {
      reject(outcome, `duplicate of an earlier row in the same response on ${key.slice(0, 2)} (row ${index + 1})`)
      continue
    }
    seen.add(key)

    const aliasCustomerId = row.externalId ? byAlias.get(row.externalId) : undefined
    const emailMatches = distinctIds(row.email ? byEmail.get(row.email.toLowerCase()) : undefined)
    const phoneMatches = distinctIds(byPhone.get(digits(row.phone)))

    // No guessing. An alias is authoritative — it is literally this connection's
    // own record id. A natural key is not: it may be shared by two customers that
    // were entered twice, and picking one would merge their histories silently.
    if (!aliasCustomerId) {
      const ambiguous = Math.max(emailMatches.length, phoneMatches.length)
      if (ambiguous > 1) {
        reject(
          outcome,
          `"${row.name}" matches ${ambiguous} existing customers on email or phone (needs review: merge the duplicates first)`,
        )
        continue
      }
      const [byEmailId] = emailMatches
      const [byPhoneId] = phoneMatches
      if (byEmailId && byPhoneId && byEmailId !== byPhoneId) {
        reject(
          outcome,
          `"${row.name}" matches one customer by email and a different one by phone (needs review: merge the duplicates first)`,
        )
        continue
      }
    }

    const customerId = aliasCustomerId ?? emailMatches[0] ?? phoneMatches[0]

    if (!customerId) {
      if (staged.has(key)) {
        reject(outcome, `duplicate of an earlier row in the same response on ${key.slice(0, 2)} (row ${index + 1})`)
        continue
      }
      staged.add(key)
      pending.push(row)
      continue
    }

    updates.push({ row, customerId })
    // Later rows in this response must resolve to the same customer.
    if (row.email) pushMatch(byEmail, row.email.toLowerCase(), { id: customerId, email: row.email, phone: row.phone })
    pushMatch(byPhone, digits(row.phone), { id: customerId, email: row.email ?? null, phone: row.phone })
    if (row.externalId) byAlias.set(row.externalId, customerId)
  }

  const masteredByOther = await masteredByOtherConnections(
    actor,
    updates.map((update) => update.customerId),
  )

  for (const { row, customerId } of updates) {
    // A master connection owns the contact fields; everyone else only adds
    // orders and an alias. Without a master, the newest sync still wins.
    const ownsContactFields = isMaster || !masteredByOther.has(customerId)
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(customers)
          .set({
            ...(ownsContactFields
              ? {
                  name: row.name,
                  initials: initialsOf(row.name),
                  phone: row.phone,
                  email: row.email,
                  location: row.location,
                  customerType: row.customerType,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(customers.id, customerId), eq(customers.organizationId, actor.organizationId)))
        if (row.externalId) await upsertAlias(tx, actor, customerId, row.externalId)
      })
      outcome.counts.updated += 1
    } catch (error) {
      reject(outcome, `"${row.name}" ${describeWriteError(error)}`)
    }
  }

  // New customers go in as batches; a batch that trips a constraint is retried
  // row by row so one bad record does not reject its neighbours.
  for (const group of chunk(pending)) {
    const values = group.map((row) => ({
      organizationId: actor.organizationId,
      name: row.name,
      initials: initialsOf(row.name),
      phone: row.phone,
      email: row.email,
      location: row.location,
      customerType: row.customerType,
    }))

    const createdIds: Array<string | null> = group.map(() => null)

    try {
      const inserted = await db.insert(customers).values(values).returning({ id: customers.id })
      inserted.forEach((row, index) => {
        createdIds[index] = row.id
      })
      outcome.counts.created += group.length
    } catch {
      for (const [index, row] of group.entries()) {
        try {
          const [inserted] = await db.insert(customers).values(values[index]!).returning({ id: customers.id })
          createdIds[index] = inserted?.id ?? null
          outcome.counts.created += 1
        } catch (error) {
          reject(outcome, `"${row.name}" ${describeWriteError(error)}`)
        }
      }
    }

    // Aliases for the new customers, in one statement rather than one per row.
    const aliasRows = group.flatMap((row, index) => {
      const customerId = createdIds[index]
      if (!customerId || !row.externalId) return []
      return [{ name: row.name, externalId: row.externalId, customerId }]
    })

    if (aliasRows.length) {
      const write = (entries: typeof aliasRows) =>
        db
          .insert(customerSources)
          .values(
            entries.map((entry) => ({
              organizationId: actor.organizationId,
              customerId: entry.customerId,
              integrationId: actor.integrationId,
              externalId: entry.externalId,
            })),
          )
          .onConflictDoUpdate({
            target: [customerSources.organizationId, customerSources.integrationId, customerSources.externalId],
            set: { lastSyncedAt: new Date() },
          })

      try {
        await write(aliasRows)
      } catch {
        for (const entry of aliasRows) {
          try {
            await write([entry])
          } catch (error) {
            reject(outcome, `"${entry.name}" ${describeWriteError(error)}`)
          }
        }
      }
    }
  }

  return outcome
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

export async function upsertProducts(actor: IngestActor, rows: NormalisedProduct[]): Promise<IngestOutcome> {
  const outcome = emptyOutcome()
  outcome.counts.fetched = rows.length
  if (!rows.length) return outcome

  const byExternalId = new Map<string, string>()
  const bySku = new Map<string, string>()
  const byName = new Map<string, string>()

  const externalIds = [...new Set(rows.map((row) => row.externalId).filter((value): value is string => Boolean(value)))]
  const skus = [...new Set(rows.map((row) => row.sku).filter((value): value is string => Boolean(value)))]
  const names = [...new Set(rows.map((row) => row.name.toLowerCase()))]

  for (const group of chunk(externalIds)) {
    const found = await db
      .select({ id: products.id, externalId: products.externalId })
      .from(products)
      .where(
        and(
          eq(products.organizationId, actor.organizationId),
          // Connection-scoped: another source's product id is another namespace.
          eq(products.externalSource, actor.integrationId),
          inArray(products.externalId, group),
        ),
      )
    for (const row of found) if (row.externalId) byExternalId.set(row.externalId, row.id)
  }

  if (skus.length) {
    for (const group of chunk(skus)) {
      const found = await db
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(and(eq(products.organizationId, actor.organizationId), inArray(products.sku, group)))
      for (const row of found) if (row.sku) bySku.set(row.sku, row.id)
    }
  }

  for (const group of chunk(names)) {
    const found = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.organizationId, actor.organizationId), inArray(sql`lower(${products.name})`, group)))
    for (const row of found) byName.set(row.name.toLowerCase(), row.id)
  }

  const seen = new Set<string>()
  const staged = new Set<string>()
  const pending: NormalisedProduct[] = []

  for (const [index, row] of rows.entries()) {
    const key = row.externalId ? `x:${row.externalId}` : row.sku ? `s:${row.sku}` : `n:${row.name.toLowerCase()}`
    if (seen.has(key)) {
      reject(outcome, `duplicate of an earlier row in the same response on ${key.slice(0, 2)} (row ${index + 1})`)
      continue
    }
    seen.add(key)

    const id =
      (row.externalId ? byExternalId.get(row.externalId) : undefined) ??
      (row.sku ? bySku.get(row.sku) : undefined) ??
      byName.get(row.name.toLowerCase())

    if (id === undefined) {
      if (staged.has(key)) {
        reject(outcome, `duplicate of an earlier row in the same response on ${key.slice(0, 2)} (row ${index + 1})`)
        continue
      }
      staged.add(key)
      pending.push(row)
      continue
    }

    try {
      await db
        .update(products)
        .set({
          name: row.name,
          price: row.price,
          unit: row.unit,
          ...(row.sku ? { sku: row.sku } : {}),
          ...(row.category ? { category: row.category } : {}),
          ...(row.externalId ? { externalId: row.externalId, externalSource: actor.integrationId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, id), eq(products.organizationId, actor.organizationId)))
      outcome.counts.updated += 1
    } catch (error) {
      reject(outcome, `"${row.name}" ${describeWriteError(error)}`)
    }
  }

  for (const group of chunk(pending)) {
    const values = group.map((row) => ({
      organizationId: actor.organizationId,
      name: row.name,
      sku: row.sku,
      category: row.category,
      unit: row.unit,
      price: row.price,
      externalId: row.externalId,
      externalSource: row.externalId ? actor.integrationId : null,
    }))

    try {
      await db.insert(products).values(values)
      outcome.counts.created += group.length
    } catch {
      for (const [index, row] of group.entries()) {
        try {
          await db.insert(products).values(values[index]!)
          outcome.counts.created += 1
        } catch (error) {
          reject(outcome, `"${row.name}" ${describeWriteError(error)}`)
        }
      }
    }
  }

  return outcome
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

type CustomerResolution = {
  /** Canonical customer per source key, for the rows that resolved cleanly. */
  resolved: Map<string, string>
  /** Keys that resolved to more than one customer, so an order can say why. */
  ambiguous: Set<string>
}

/**
 * Resolves an order's customer through this connection's alias, then email, then
 * phone.
 *
 * A key that matches several customers resolves to *nothing* and is reported as
 * ambiguous: attaching an order to the wrong buyer changes that buyer's reorder
 * intervals, which is exactly the intelligence the tenant is paying for.
 */
async function resolveCustomerIds(actor: IngestActor, rows: NormalisedOrder[]): Promise<CustomerResolution> {
  const resolved = new Map<string, string>()
  const ambiguous = new Set<string>()

  const externalIds = [
    ...new Set(rows.map((row) => row.customerExternalId).filter((value): value is string => Boolean(value))),
  ]
  const emails = [...new Set(rows.map((row) => row.customerEmail).filter((value): value is string => Boolean(value)))]
  const phones = [...new Set(rows.map((row) => row.customerPhone).filter((value): value is string => Boolean(value)))]

  for (const group of chunk(externalIds)) {
    const found = await db
      .select({ customerId: customerSources.customerId, externalId: customerSources.externalId })
      .from(customerSources)
      .where(
        and(
          eq(customerSources.organizationId, actor.organizationId),
          eq(customerSources.integrationId, actor.integrationId),
          inArray(customerSources.externalId, group),
        ),
      )
    for (const row of found) resolved.set(`x:${row.externalId}`, row.customerId)
  }

  for (const group of chunk(emails.map((value) => value.toLowerCase()))) {
    const found = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(and(eq(customers.organizationId, actor.organizationId), inArray(sql`lower(${customers.email})`, group)))
    const byEmail = new Map<string, string[]>()
    for (const row of found) {
      if (!row.email) continue
      const key = row.email.toLowerCase()
      const bucket = byEmail.get(key)
      if (bucket) bucket.push(row.id)
      else byEmail.set(key, [row.id])
    }
    for (const [key, ids] of byEmail) {
      if (ids.length > 1) ambiguous.add(`e:${key}`)
      else resolved.set(`e:${key}`, ids[0]!)
    }
  }

  for (const group of chunk([...new Set(phones.map(digits))].filter((value) => value.length >= 6))) {
    const found = await db
      .select({ id: customers.id, phone: customers.phone })
      .from(customers)
      .where(and(eq(customers.organizationId, actor.organizationId), inArray(normalisedPhone, group)))
    const byPhone = new Map<string, string[]>()
    for (const row of found) {
      const key = digits(row.phone)
      const bucket = byPhone.get(key)
      if (bucket) bucket.push(row.id)
      else byPhone.set(key, [row.id])
    }
    for (const [key, ids] of byPhone) {
      if (ids.length > 1) ambiguous.add(`p:${key}`)
      else resolved.set(`p:${key}`, ids[0]!)
    }
  }

  // An email and a phone that point at different customers is just as ambiguous
  // as either key matching twice.
  for (const row of rows) {
    const byEmailId = row.customerEmail ? resolved.get(`e:${row.customerEmail.toLowerCase()}`) : undefined
    const byPhoneId = row.customerPhone ? resolved.get(`p:${digits(row.customerPhone)}`) : undefined
    if (byEmailId && byPhoneId && byEmailId !== byPhoneId) {
      if (row.customerEmail) ambiguous.add(`e:${row.customerEmail.toLowerCase()}`)
      if (row.customerPhone) ambiguous.add(`p:${digits(row.customerPhone)}`)
      if (row.customerEmail) resolved.delete(`e:${row.customerEmail.toLowerCase()}`)
      if (row.customerPhone) resolved.delete(`p:${digits(row.customerPhone)}`)
    }
  }

  return { resolved, ambiguous }
}

export type OrderIngestOutcome = IngestOutcome & {
  /** Customers whose history changed, for the post-run opportunity refresh. */
  affectedCustomerIds: string[]
}

export async function upsertOrders(actor: IngestActor, rows: NormalisedOrder[]): Promise<OrderIngestOutcome> {
  const outcome: OrderIngestOutcome = { ...emptyOutcome(), affectedCustomerIds: [] }
  outcome.counts.fetched = rows.length
  if (!rows.length) return outcome

  const { resolved: customerByKey, ambiguous } = await resolveCustomerIds(actor, rows)

  const existing = new Map<string, { id: string; customerId: string }>()
  for (const group of chunk([...new Set(rows.map((row) => row.reference))])) {
    const found = await db
      .select({ id: orders.id, reference: orders.reference, customerId: orders.customerId })
      .from(orders)
      .where(and(eq(orders.organizationId, actor.organizationId), inArray(orders.reference, group)))
    for (const row of found) existing.set(row.reference, { id: row.id, customerId: row.customerId })
  }

  // Catalogue lookup so line items link to a product when we can. Prices still
  // come from the source, never from the catalogue: history keeps its amounts.
  const productByExternalId = new Map<string, string>()
  const productByName = new Map<string, { id: string; price: number }>()
  const catalogue = await db
    .select({ id: products.id, name: products.name, price: products.price, externalId: products.externalId })
    .from(products)
    .where(
      and(
        eq(products.organizationId, actor.organizationId),
        // Product ids are namespaced per connection; names are not, so a shared
        // catalogue row can still be linked by name.
        or(isNull(products.externalSource), eq(products.externalSource, actor.integrationId)),
      ),
    )
  for (const row of catalogue) {
    productByName.set(row.name.toLowerCase(), { id: row.id, price: Number(row.price) })
    if (row.externalId) productByExternalId.set(row.externalId, row.id)
  }

  const seen = new Set<string>()
  const staged = new Set<string>()
  const affected = new Set<string>()

  for (const row of rows) {
    if (seen.has(row.reference) || staged.has(row.reference)) {
      reject(outcome, `duplicate reference ${row.reference} in the same response`)
      continue
    }
    seen.add(row.reference)

    const customerKeys = [
      row.customerExternalId ? `x:${row.customerExternalId}` : null,
      row.customerEmail ? `e:${row.customerEmail.toLowerCase()}` : null,
      row.customerPhone ? `p:${digits(row.customerPhone)}` : null,
    ].filter((key): key is string => key !== null)

    const customerId = customerKeys.map((key) => customerByKey.get(key)).find((value) => value !== undefined)

    if (!customerId) {
      if (customerKeys.some((key) => ambiguous.has(key))) {
        reject(
          outcome,
          `order ${row.reference}: matches more than one customer (needs review: merge the duplicate customers first)`,
        )
      } else {
        reject(
          outcome,
          `order ${row.reference}: no matching customer (map customerExternalId, customerEmail or customerPhone — and import customers first)`,
        )
      }
      continue
    }

    const lines = row.items.map((item) => {
      const matched = item.productExternalId
        ? productByExternalId.get(item.productExternalId)
        : productByName.get(item.productName.toLowerCase())?.id
      const fallbackPrice = productByName.get(item.productName.toLowerCase())?.price ?? 0
      const unitPrice = item.unitPrice ?? fallbackPrice
      return {
        productId: matched ?? null,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice,
        lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
      }
    })

    const subtotal = Math.round(lines.reduce((total, line) => total + line.lineTotal, 0) * 100) / 100
    const total = row.total ?? subtotal
    const match = existing.get(row.reference)

    try {
      await db.transaction(async (tx) => {
        const values = {
          customerId,
          status: row.status,
          source: 'API' as const,
          currency: row.currency ?? 'KES',
          subtotal,
          total,
          orderedAt: row.orderedAt,
          paymentMethod: row.paymentMethod,
          externalId: row.externalId,
          externalSource: actor.integrationId,
        }

        let orderId = match?.id
        if (orderId) {
          await tx
            .update(orders)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.organizationId, actor.organizationId)))
          // Line items have no natural key, so a changed order replaces its lines.
          await tx.delete(orderItems).where(eq(orderItems.orderId, orderId))
        } else {
          const [inserted] = await tx
            .insert(orders)
            .values({
              organizationId: actor.organizationId,
              reference: row.reference,
              createdByUserId: actor.actorUserId,
              ...values,
            })
            .returning({ id: orders.id })
          orderId = inserted!.id
        }

        if (lines.length) {
          await tx.insert(orderItems).values(
            lines.map((line) => ({
              organizationId: actor.organizationId,
              orderId: orderId!,
              productId: line.productId,
              productName: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          )
        }
      })

      if (match) outcome.counts.updated += 1
      else outcome.counts.created += 1

      // Include status changes too: an order that later becomes cancelled must
      // be removed from the customer's actual purchase history.
      affected.add(customerId)
    } catch (error) {
      reject(outcome, `order ${row.reference}: ${describeWriteError(error)}`)
    }
  }

  outcome.affectedCustomerIds = [...affected]
  return outcome
}

/** Rebuilds `lastOrderAt` from settled orders after an import. */
export async function applyLastOrderAt(organizationId: string, customerIds: Iterable<string>) {
  for (const customerId of customerIds) {
    const [latest] = await db
      .select({ orderedAt: sql<Date | null>`max(${orders.orderedAt})` })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.customerId, customerId),
          eq(orders.status, 'COMPLETED'),
        ),
      )

    // `max()` is an untyped SQL expression, so the driver hands back a string.
    // The timestamp column mapper needs a Date on write — parse before setting.
    const lastOrderAt = latest?.orderedAt ? new Date(latest.orderedAt) : null

    await db
      .update(customers)
      .set({
        lastOrderAt,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
  }
}
