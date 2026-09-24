import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { contactTopics } from '@/lib/contact'
import type { SyncRunCounts } from '@/lib/connectors/canonical'
import type { ConnectorConfig } from '@/lib/connectors/config'
import type { Status } from '@/lib/reorder/types'

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })
const id = () => uuid('id').primaryKey().defaultRandom()

/* -------------------------------------------------------------------------- */
/* Enums (database enforced domains)                                          */
/* -------------------------------------------------------------------------- */

export const memberRoleEnum = pgEnum('member_role', ['OWNER', 'ADMIN', 'ANALYST', 'SALES'])
export const memberStatusEnum = pgEnum('member_status', ['ACTIVE', 'INVITED', 'SUSPENDED'])
export const planEnum = pgEnum('plan', ['SMALL', 'MEDIUM', 'LARGE', 'CUSTOM'])
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
])
export const paymentProviderEnum = pgEnum('payment_provider', ['NONE', 'MPESA', 'PAYSTACK', 'INVOICE'])
export const orderStatusEnum = pgEnum('order_status', ['COMPLETED', 'PENDING', 'CANCELLED'])
export const orderSourceEnum = pgEnum('order_source', ['MANUAL', 'SIMULATED', 'API', 'IMPORT'])
export const opportunityStatusEnum = pgEnum('opportunity_status', [
  'UPCOMING',
  'DUE',
  'OVERDUE',
  'HIGH_OPPORTUNITY',
  'AT_RISK',
  'CONTACTED',
  'ORDER_CREATED',
  'CONVERTED',
  'DISMISSED',
])
export const channelEnum = pgEnum('channel', ['WHATSAPP', 'SMS', 'EMAIL'])
export const campaignTypeEnum = pgEnum('campaign_type', [
  'REORDER_REMINDER',
  'OVERDUE_FOLLOW_UP',
  'WIN_BACK',
  'CUSTOM',
])
export const campaignStatusEnum = pgEnum('campaign_status', [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
])
export const recipientStatusEnum = pgEnum('recipient_status', [
  'QUEUED',
  'SENT',
  'FAILED',
  'SKIPPED',
  'CONVERTED',
])
export const messageDirectionEnum = pgEnum('message_direction', ['OUTBOUND', 'INBOUND'])
export const messageStatusEnum = pgEnum('message_status', [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'RECEIVED',
])
export const messageProviderEnum = pgEnum('message_provider', [
  'DEMO',
  'WHATSAPP_BUSINESS',
  'SMS_GATEWAY',
  'EMAIL',
])
export const integrationProviderEnum = pgEnum('integration_provider', [
  'ZOHO_INVENTORY',
  'SHOPIFY',
  'WOOCOMMERCE',
  'PAYSTACK',
  'MPESA',
  'WHATSAPP_BUSINESS',
  'SMS_GATEWAY',
  'CUSTOM',
])
export const integrationStatusEnum = pgEnum('integration_status', [
  'PENDING',
  'CONNECTED',
  'ERROR',
  'DISCONNECTED',
])
export const contactTopicEnum = pgEnum('contact_topic', contactTopics)
export const contactStatusEnum = pgEnum('contact_status', ['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM'])
export const syncRunStatusEnum = pgEnum('sync_run_status', ['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'])
export const syncTriggerEnum = pgEnum('sync_trigger', ['MANUAL', 'SCHEDULE'])

export type MemberRole = (typeof memberRoleEnum.enumValues)[number]
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number]
export type OrderSource = (typeof orderSourceEnum.enumValues)[number]
export type OpportunityStatus = (typeof opportunityStatusEnum.enumValues)[number]
export type Channel = (typeof channelEnum.enumValues)[number]
export type PlanIdDb = (typeof planEnum.enumValues)[number]
export type IntegrationProvider = (typeof integrationProviderEnum.enumValues)[number]
export type IntegrationStatus = (typeof integrationStatusEnum.enumValues)[number]
export type SyncRunStatus = (typeof syncRunStatusEnum.enumValues)[number]
export type SyncTrigger = (typeof syncTriggerEnum.enumValues)[number]

/* -------------------------------------------------------------------------- */
/* Auth tables (better-auth contract - TypeScript field names must match)      */
/* -------------------------------------------------------------------------- */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('user_email_unique').on(sql`lower(${table.email})`),
    check('user_email_format', sql`${table.email} ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`),
  ],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_idx').on(table.userId),
    index('session_expires_idx').on(table.expiresAt),
  ],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
    index('account_user_idx').on(table.userId),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    industry: varchar('industry', { length: 120 }).notNull().default('General'),
    country: varchar('country', { length: 80 }).notNull().default('Kenya'),
    currency: varchar('currency', { length: 8 }).notNull().default('KES'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Africa/Nairobi'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('organizations_slug_unique').on(table.slug),
    index('organizations_owner_idx').on(table.ownerUserId),
    check('organizations_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('organizations_name_length', sql`char_length(${table.name}) between 2 and 160`),
  ],
)

export const members = pgTable(
  'members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('SALES'),
    status: memberStatusEnum('status').notNull().default('ACTIVE'),
    invitedEmail: varchar('invited_email', { length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('members_org_user_unique').on(table.organizationId, table.userId),
    index('members_user_idx').on(table.userId),
    index('members_org_idx').on(table.organizationId),
  ],
)

/* -------------------------------------------------------------------------- */
/* Catalogue and customers                                                    */
/* -------------------------------------------------------------------------- */

export const products = pgTable(
  'products',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    sku: varchar('sku', { length: 64 }),
    category: varchar('category', { length: 120 }),
    unit: varchar('unit', { length: 32 }).notNull().default('unit'),
    price: money('price').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Identity in the source system, so a re-sync updates instead of duplicating.
     * `external_source` is the **connection id**, not the provider: two stores on
     * the same provider would otherwise share one id namespace and overwrite each
     * other's catalogue rows.
     */
    externalId: varchar('external_id', { length: 200 }),
    externalSource: varchar('external_source', { length: 40 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('products_org_name_unique').on(table.organizationId, sql`lower(${table.name})`),
    uniqueIndex('products_org_sku_unique')
      .on(table.organizationId, table.sku)
      .where(sql`${table.sku} is not null`),
    uniqueIndex('products_org_external_unique')
      .on(table.organizationId, table.externalSource, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index('products_org_idx').on(table.organizationId, table.isActive),
    check('products_price_non_negative', sql`${table.price} >= 0`),
  ],
)

export const customers = pgTable(
  'customers',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    initials: varchar('initials', { length: 8 }),
    phone: varchar('phone', { length: 32 }).notNull(),
    email: varchar('email', { length: 200 }),
    location: varchar('location', { length: 120 }),
    customerType: varchar('customer_type', { length: 40 }).notNull().default('BUSINESS'),
    assignedSalesperson: varchar('assigned_salesperson', { length: 160 }),
    assignedToUserId: text('assigned_to_user_id').references(() => user.id, { onDelete: 'set null' }),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    lastOrderAt: timestamp('last_order_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('customers_org_email_unique')
      .on(table.organizationId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    index('customers_org_name_idx').on(table.organizationId, table.name),
    index('customers_org_last_order_idx').on(table.organizationId, table.lastOrderAt),
    check('customers_name_length', sql`char_length(${table.name}) between 2 and 160`),
    check('customers_phone_length', sql`char_length(${table.phone}) between 6 and 32`),
  ],
)

/**
 * Where a canonical customer is known, one row per source system.
 *
 * A customer is one identity with many aliases: the same buyer may exist in an
 * ERP, a storefront and a payment provider, each under its own id. Provenance is
 * therefore a list, not a column, and it hangs off the **connection**
 * (`integration_id`) rather than the provider enum — two Shopify stores are two
 * sources, and their record ids share no namespace.
 *
 * The alias is the identity a re-sync matches on, so it is inserted once and
 * never overwritten (a single `external_id` column made the last sync win and the
 * first sync stop matching).
 */
export const customerSources = pgTable(
  'customer_sources',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    /** This connection's id for the customer. */
    externalId: varchar('external_id', { length: 200 }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_sources_integration_external_unique').on(
      table.organizationId,
      table.integrationId,
      table.externalId,
    ),
    index('customer_sources_customer_idx').on(table.organizationId, table.customerId),
    index('customer_sources_integration_idx').on(table.organizationId, table.integrationId),
    check('customer_sources_external_id_length', sql`char_length(${table.externalId}) between 1 and 200`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Orders and reorder opportunities                                           */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 40 }).notNull(),
    status: orderStatusEnum('status').notNull().default('COMPLETED'),
    source: orderSourceEnum('source').notNull().default('MANUAL'),
    paymentMethod: varchar('payment_method', { length: 60 }),
    currency: varchar('currency', { length: 8 }).notNull().default('KES'),
    subtotal: money('subtotal').notNull().default(0),
    total: money('total').notNull().default(0),
    orderedAt: timestamp('ordered_at', { withTimezone: true, mode: 'date' }).notNull(),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Identity in the source system; `external_source` is the connection id. */
    externalId: varchar('external_id', { length: 200 }),
    externalSource: varchar('external_source', { length: 40 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('orders_org_reference_unique').on(table.organizationId, table.reference),
    uniqueIndex('orders_org_external_unique')
      .on(table.organizationId, table.externalSource, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index('orders_org_ordered_at_idx').on(table.organizationId, table.orderedAt),
    index('orders_customer_ordered_at_idx').on(table.customerId, table.orderedAt),
    index('orders_org_status_idx').on(table.organizationId, table.status),
    check('orders_total_non_negative', sql`${table.total} >= 0 and ${table.subtotal} >= 0`),
    check('orders_reference_format', sql`${table.reference} ~ '^[A-Za-z0-9._-]{3,40}$'`),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    productName: varchar('product_name', { length: 160 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    lineTotal: money('line_total').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    index('order_items_org_product_idx').on(table.organizationId, table.productName),
    check('order_items_quantity_range', sql`${table.quantity} between 1 and 100000`),
    check('order_items_price_non_negative', sql`${table.unitPrice} >= 0 and ${table.lineTotal} >= 0`),
  ],
)

export const opportunities = pgTable(
  'opportunities',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    expectedDate: date('expected_date', { mode: 'date' }).notNull(),
    reorderScore: smallint('reorder_score').notNull(),
    expectedValue: money('expected_value').notNull(),
    probability: smallint('probability').notNull(),
    status: opportunityStatusEnum('status').notNull().default('UPCOMING'),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true, mode: 'date' }),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('opportunities_org_customer_date_unique').on(
      table.organizationId,
      table.customerId,
      table.expectedDate,
    ),
    index('opportunities_org_status_idx').on(table.organizationId, table.status),
    index('opportunities_org_expected_idx').on(table.organizationId, table.expectedDate),
    check('opportunities_score_range', sql`${table.reorderScore} between 0 and 100`),
    check('opportunities_probability_range', sql`${table.probability} between 0 and 100`),
    check('opportunities_value_non_negative', sql`${table.expectedValue} >= 0`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Campaigns and messaging                                                    */
/* -------------------------------------------------------------------------- */

export type CampaignAudience = {
  /** Customer statuses the campaign targets, mirrors CustomerInsight statuses. */
  statuses?: Status[]
  /** Minimum reorder score, 0-100. */
  minReorderScore?: number
  /** Only customers due within this many days. */
  dueWithinDays?: number
  /** Only customers who opted into marketing. */
  marketingOptInOnly?: boolean
}

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    type: campaignTypeEnum('type').notNull().default('REORDER_REMINDER'),
    channel: channelEnum('channel').notNull().default('WHATSAPP'),
    status: campaignStatusEnum('status').notNull().default('DRAFT'),
    audienceFilter: jsonb('audience_filter').$type<CampaignAudience>().notNull().default({}),
    messageTemplate: text('message_template'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('campaigns_org_status_idx').on(table.organizationId, table.status),
    index('campaigns_org_created_idx').on(table.organizationId, table.createdAt),
    check('campaigns_name_length', sql`char_length(${table.name}) between 2 and 160`),
  ],
)

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    status: recipientStatusEnum('status').notNull().default('QUEUED'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    revenueAttributed: money('revenue_attributed').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('campaign_recipients_unique').on(table.campaignId, table.customerId),
    index('campaign_recipients_org_status_idx').on(table.organizationId, table.status),
    check('campaign_recipients_revenue_non_negative', sql`${table.revenueAttributed} >= 0`),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    channel: channelEnum('channel').notNull().default('WHATSAPP'),
    direction: messageDirectionEnum('direction').notNull().default('OUTBOUND'),
    status: messageStatusEnum('status').notNull().default('QUEUED'),
    provider: messageProviderEnum('provider').notNull().default('DEMO'),
    body: text('body').notNull(),
    providerMessageId: varchar('provider_message_id', { length: 120 }),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('messages_org_created_idx').on(table.organizationId, table.createdAt),
    index('messages_customer_created_idx').on(table.customerId, table.createdAt),
    index('messages_campaign_idx').on(table.campaignId),
    check('messages_body_length', sql`char_length(${table.body}) between 1 and 4000`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Integrations, billing, inbound leads, audit and abuse control              */
/* -------------------------------------------------------------------------- */

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: integrationProviderEnum('provider').notNull(),
    status: integrationStatusEnum('status').notNull().default('PENDING'),
    displayName: varchar('display_name', { length: 120 }),
    /** Non-secret provider settings only; credentials live in a secret manager. */
    config: jsonb('config').$type<Record<string, string | number | boolean>>().notNull().default({}),
    /**
     * Declarative connector spec: endpoints, field mapping, paging. Interpreted as
     * data by lib/connectors/**, never as code, and carries no secrets.
     */
    connector: jsonb('connector').$type<ConnectorConfig>(),
    secretRef: varchar('secret_ref', { length: 200 }),
    /** AES-256-GCM sealed tenant credential (see lib/connectors/secret.ts). */
    secretCiphertext: text('secret_ciphertext'),
    externalAccountId: varchar('external_account_id', { length: 120 }),
    /** How often the scheduler re-runs this connector. */
    syncIntervalMinutes: smallint('sync_interval_minutes').notNull().default(360),
    /** When the scheduler should next pick this connector up. */
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true, mode: 'date' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * A tenant may connect the same provider twice (two Shopify stores, two Zoho
     * organizations). Identity is the connection's own account id when it has
     * one; a connection without an account id is matched on its display name by
     * `createIntegration`, which is why this index is partial rather than a plain
     * `(organization_id, provider)` — that older rule made the second store
     * impossible to add.
     */
    uniqueIndex('integrations_org_provider_account_unique')
      .on(table.organizationId, table.provider, table.externalAccountId)
      .where(sql`${table.externalAccountId} is not null`),
    index('integrations_org_status_idx').on(table.organizationId, table.status),
    index('integrations_due_idx').on(table.status, table.nextSyncAt),
  ],
)

/**
 * One row per sync attempt, so an operator can see what a connector actually did
 * (rows read, created, updated, rejected and why) instead of guessing from
 * `last_synced_at`.
 */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    trigger: syncTriggerEnum('trigger').notNull().default('MANUAL'),
    status: syncRunStatusEnum('status').notNull().default('RUNNING'),
    /** Per-resource counters plus a bounded sample of rejection reasons. */
    counts: jsonb('counts')
      .$type<SyncRunCounts>()
      .notNull()
      .default({ customers: { fetched: 0, created: 0, updated: 0, rejected: 0 }, products: { fetched: 0, created: 0, updated: 0, rejected: 0 }, orders: { fetched: 0, created: 0, updated: 0, rejected: 0 }, rejections: [] }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sync_runs_integration_started_idx').on(table.integrationId, table.startedAt),
    index('sync_runs_org_started_idx').on(table.organizationId, table.startedAt),
    /**
     * One live run per connection, enforced by the database rather than by a
     * check-then-write in application code (which loses races). Two concurrent
     * runs would each delete and re-insert an order's line items, and under
     * READ COMMITTED that interleaving can leave duplicated lines — inflating
     * quantities and corrupting the reorder history the engine reads.
     */
    uniqueIndex('sync_runs_one_running_per_integration')
      .on(table.integrationId)
      .where(sql`${table.status} = 'RUNNING'`),
  ],
)

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan: planEnum('plan').notNull().default('SMALL'),
    status: subscriptionStatusEnum('status').notNull().default('TRIALING'),
    paymentProvider: paymentProviderEnum('payment_provider').notNull().default('NONE'),
    seats: integer('seats').notNull().default(1),
    amount: money('amount').notNull().default(0),
    currency: varchar('currency', { length: 8 }).notNull().default('KES'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'date' }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    externalReference: varchar('external_reference', { length: 120 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('subscriptions_org_unique').on(table.organizationId),
    check('subscriptions_seats_range', sql`${table.seats} between 1 and 5000`),
    check('subscriptions_amount_non_negative', sql`${table.amount} >= 0`),
  ],
)

export const contactSubmissions = pgTable(
  'contact_submissions',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    businessName: varchar('business_name', { length: 160 }).notNull(),
    email: varchar('email', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    topic: contactTopicEnum('topic').notNull(),
    message: text('message').notNull(),
    status: contactStatusEnum('status').notNull().default('NEW'),
    sourceIpHash: varchar('source_ip_hash', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('contact_submissions_created_idx').on(table.createdAt),
    index('contact_submissions_email_idx').on(sql`lower(${table.email})`),
    check('contact_submissions_message_length', sql`char_length(${table.message}) between 20 and 4000`),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }).notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_org_created_idx').on(table.organizationId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId),
  ],
)

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    bucket: varchar('bucket', { length: 160 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    hits: integer('hits').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucket, table.windowStart], name: 'rate_limit_counters_pk' }),
    index('rate_limit_counters_expires_idx').on(table.expiresAt),
    check('rate_limit_counters_hits_non_negative', sql`${table.hits} >= 0`),
  ],
)

/* -------------------------------------------------------------------------- */
/* Inferred row types (single source of truth for the whole backend)          */
/* -------------------------------------------------------------------------- */

export type UserRow = typeof user.$inferSelect
export type SessionRow = typeof session.$inferSelect
export type OrganizationRow = typeof organizations.$inferSelect
export type MemberRow = typeof members.$inferSelect
export type ProductRow = typeof products.$inferSelect
export type CustomerRow = typeof customers.$inferSelect
export type CustomerSourceRow = typeof customerSources.$inferSelect
export type OrderRow = typeof orders.$inferSelect
export type OrderItemRow = typeof orderItems.$inferSelect
export type OpportunityRow = typeof opportunities.$inferSelect
export type CampaignRow = typeof campaigns.$inferSelect
export type CampaignRecipientRow = typeof campaignRecipients.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type IntegrationRow = typeof integrations.$inferSelect
export type SyncRunRow = typeof syncRuns.$inferSelect
export type SubscriptionRow = typeof subscriptions.$inferSelect
export type ContactSubmissionRow = typeof contactSubmissions.$inferSelect
export type AuditLogRow = typeof auditLogs.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type NewCustomerSource = typeof customerSources.$inferInsert
export type NewOrder = typeof orders.$inferInsert
export type NewOrderItem = typeof orderItems.$inferInsert
export type NewProduct = typeof products.$inferInsert
