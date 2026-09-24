import { z } from 'zod'
import { contactTopics } from '@/lib/contact'
import { CURRENCIES } from '@/lib/connectors/canonical'
import { connectorConnectionSchema, connectorSchema } from '@/lib/connectors/config'

/**
 * Request contracts.
 *
 * Every schema is strict (unknown keys are rejected), trims input and bounds
 * lengths, so handlers can trust the values they receive.
 */
const safeText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, 'Control characters are not allowed.')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, 'Control characters are not allowed.')
    .optional()

export const uuidParam = (name: string) => z.strictObject({ [name]: z.uuid() })

export const paginationShape = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(600).optional(),
}

export const orderStatusSchema = z.enum(['COMPLETED', 'PENDING', 'CANCELLED'])
export const orderSourceSchema = z.enum(['MANUAL', 'SIMULATED', 'API', 'IMPORT'])
export const channelSchema = z.enum(['WHATSAPP', 'SMS', 'EMAIL'])
export const opportunityStatusSchema = z.enum([
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
export const customerStatusSchema = z.enum(['NEW', 'ACTIVE', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'AT_RISK', 'DORMANT'])
export const planSchema = z.enum(['SMALL', 'MEDIUM', 'LARGE', 'CUSTOM'])
export const roleSchema = z.enum(['OWNER', 'ADMIN', 'ANALYST', 'SALES'])
export const assignableRoleSchema = z.enum(['ADMIN', 'ANALYST', 'SALES'])
export const memberStatusSchema = z.enum(['ACTIVE', 'INVITED', 'SUSPENDED'])
export const integrationProviderSchema = z.enum([
  'ZOHO_INVENTORY',
  'SHOPIFY',
  'WOOCOMMERCE',
  'PAYSTACK',
  'MPESA',
  'WHATSAPP_BUSINESS',
  'SMS_GATEWAY',
  'CUSTOM',
])
export const integrationStatusSchema = z.enum(['PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED'])
export const campaignTypeSchema = z.enum(['REORDER_REMINDER', 'OVERDUE_FOLLOW_UP', 'WIN_BACK', 'CUSTOM'])
export const campaignStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'])
export const contactTopicSchema = z.enum(contactTopics)
export const currencySchema = z.enum(CURRENCIES)

export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[+()\d\s-]+$/, 'Enter a valid phone number.')
export const emailSchema = z.email().max(200).toLowerCase()
export const optionalEmailSchema = z.union([emailSchema, z.literal('')]).optional()
export const moneySchema = z.coerce.number().finite().min(0).max(1_000_000_000)
/** Accepts ISO-8601 timestamps with or without an offset (`2026-01-02T03:04:05Z`). */
export const isoDateTimeSchema = z.union([z.iso.datetime({ offset: true }), z.iso.datetime()])
export const isoDateSchema = z.iso.date()

export const orderLineSchema = z.strictObject({
  productId: z.uuid().optional(),
  productName: safeText(160, 1),
  quantity: z.coerce.number().int().min(1).max(100_000),
  /** Optional: the server always prefers the catalogue price when it can match a product. */
  unitPrice: moneySchema.optional(),
})

export const orderLinesSchema = z.array(orderLineSchema).min(1).max(100)

export const organizationPatchSchema = z.strictObject({
  name: safeText(160, 2).optional(),
  industry: safeText(120, 2).optional(),
  country: safeText(80, 2).optional(),
  currency: currencySchema.optional(),
  timezone: safeText(64, 2).optional(),
})

export const customerCreateSchema = z.strictObject({
  name: safeText(160, 2),
  phone: phoneSchema,
  email: optionalEmailSchema,
  location: optionalText(120),
  customerType: optionalText(40),
  assignedSalesperson: optionalText(160),
  marketingOptIn: z.boolean().default(true),
  notes: optionalText(2000),
})

export const customerUpdateSchema = z.strictObject({
  name: safeText(160, 2).optional(),
  phone: phoneSchema.optional(),
  email: optionalEmailSchema,
  location: optionalText(120),
  customerType: optionalText(40),
  assignedSalesperson: optionalText(160),
  marketingOptIn: z.boolean().optional(),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
})

export const customerListQuerySchema = z.strictObject({
  ...paginationShape,
  search: z.string().trim().max(120).optional(),
  status: customerStatusSchema.optional(),
  /** Only customers known to this connection (the "platform" filter). */
  source: z.uuid().optional(),
  sort: z.enum(['name', 'recent', 'score', 'spend']).default('name'),
})

/**
 * Merges one customer into another: the duplicate's orders, aliases and messages
 * are repointed at the survivor, which is then soft-deleted.
 */
export const customerMergeSchema = z.strictObject({
  duplicateId: z.uuid(),
})

export const productCreateSchema = z.strictObject({
  name: safeText(160, 2),
  sku: optionalText(64),
  category: optionalText(120),
  unit: optionalText(32),
  price: moneySchema,
  isActive: z.boolean().default(true),
})

export const productUpdateSchema = z.strictObject({
  name: safeText(160, 2).optional(),
  sku: optionalText(64),
  category: optionalText(120),
  unit: optionalText(32),
  price: moneySchema.optional(),
  isActive: z.boolean().optional(),
})

export const productListQuerySchema = z.strictObject({
  ...paginationShape,
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  activeOnly: z.enum(['true', 'false']).default('true'),
})

export const orderCreateSchema = z.strictObject({
  customerId: z.uuid(),
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,40}$/)
    .optional(),
  status: orderStatusSchema.default('COMPLETED'),
  source: orderSourceSchema.default('MANUAL'),
  paymentMethod: optionalText(60),
  orderedAt: isoDateTimeSchema.optional(),
  notes: optionalText(2000),
  currency: currencySchema.default('KES'),
  items: orderLinesSchema,
})

export const orderUpdateSchema = z.strictObject({
  status: orderStatusSchema.optional(),
  paymentMethod: optionalText(60),
  notes: optionalText(2000),
  orderedAt: isoDateTimeSchema.optional(),
})

export const orderListQuerySchema = z.strictObject({
  ...paginationShape,
  customerId: z.uuid().optional(),
  status: orderStatusSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

export const opportunityListQuerySchema = z.strictObject({
  ...paginationShape,
  status: opportunityStatusSchema.optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
})

export const opportunityUpdateSchema = z.strictObject({
  status: opportunityStatusSchema,
  expectedValue: moneySchema.optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
})

export const campaignAudienceSchema = z.strictObject({
  statuses: z.array(customerStatusSchema).max(7).optional(),
  minReorderScore: z.coerce.number().int().min(0).max(100).optional(),
  dueWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  marketingOptInOnly: z.boolean().optional(),
})

export const campaignCreateSchema = z.strictObject({
  name: safeText(160, 2),
  type: campaignTypeSchema.default('REORDER_REMINDER'),
  channel: channelSchema.default('WHATSAPP'),
  messageTemplate: optionalText(4000),
  scheduledAt: isoDateTimeSchema.optional(),
  audienceFilter: campaignAudienceSchema.default({}),
})

export const campaignUpdateSchema = z.strictObject({
  name: safeText(160, 2).optional(),
  status: campaignStatusSchema.optional(),
  channel: channelSchema.optional(),
  messageTemplate: optionalText(4000),
  scheduledAt: isoDateTimeSchema.optional(),
  audienceFilter: campaignAudienceSchema.optional(),
})

export const campaignListQuerySchema = z.strictObject({
  ...paginationShape,
  status: campaignStatusSchema.optional(),
})

export const campaignDispatchSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const messageCreateSchema = z.strictObject({
  customerId: z.uuid(),
  campaignId: z.uuid().optional(),
  channel: channelSchema.default('WHATSAPP'),
  direction: z.enum(['OUTBOUND', 'INBOUND']).default('OUTBOUND'),
  body: safeText(4000, 1),
})

export const messageListQuerySchema = z.strictObject({
  ...paginationShape,
  customerId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
})

/** Keys that look like credentials are rejected: secrets never belong in the DB. */
const SECRET_LIKE_KEY = /(secret|token|password|passwd|api[-_]?key|credential|private)/i

export const integrationConfigSchema = z
  .record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.boolean()]))
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (SECRET_LIKE_KEY.test(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${key}" looks like a credential. Keep secrets in a secret manager and store a reference instead.`,
        })
      }
    }
  })

export const integrationCreateSchema = z.strictObject({
  provider: integrationProviderSchema,
  displayName: optionalText(120),
  config: integrationConfigSchema.default({}),
  externalAccountId: optionalText(120),
  status: integrationStatusSchema.default('PENDING'),
  /** Declarative connector spec; no credentials, see connectorSchema. */
  connector: connectorSchema.optional(),
  syncIntervalMinutes: z.coerce.number().int().min(15).max(20_160).optional(),
})

export const integrationUpdateSchema = z.strictObject({
  displayName: optionalText(120),
  config: integrationConfigSchema.optional(),
  externalAccountId: optionalText(120),
  status: integrationStatusSchema.optional(),
  lastError: optionalText(500),
  connector: connectorSchema.optional(),
  syncIntervalMinutes: z.coerce.number().int().min(15).max(20_160).optional(),
})

/**
 * Sets or clears the tenant credential. The value is sealed before it reaches
 * the database and is never echoed back, so this is write-only by design.
 */
export const integrationCredentialSchema = z.strictObject({
  credential: z.string().trim().min(1).max(4000).nullable(),
})

/**
 * Dry-run of a mapping.
 *
 * `connector` lets the UI test an unsaved configuration and `credential` an
 * unsaved credential (an empty string means "send no credential at all"; omit it
 * to use the stored one). Nothing is written, so a wrong mapping cannot poison
 * the intelligence engine.
 */
export const connectorPreviewSchema = z.strictObject({
  resource: z.enum(['customers', 'products', 'orders']),
  connector: connectorSchema.optional(),
  credential: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(5),
})

/**
 * "Test connection" — one GET with the connection's own settings.
 *
 * The connector is the **connection half** of the spec, so an operator can check a
 * base URL and a credential before mapping a single resource; that is the whole
 * point of testing the first section of the form. `integrationId` is optional and
 * only lets a blank credential fall back to the stored one, so re-testing an
 * existing connection does not require pasting the secret again.
 */
export const connectorProbeSchema = z.strictObject({
  connector: connectorConnectionSchema,
  credential: z.string().max(4000).optional(),
  integrationId: z.uuid().optional(),
  /** Relative to the base URL; blank probes the base URL itself. */
  path: optionalText(500),
})

export const syncRunListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export const syncDueSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(25).default(5),
})

export const subscriptionUpdateSchema = z.strictObject({
  plan: planSchema.optional(),
  seats: z.coerce.number().int().min(1).max(5000).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  paymentProvider: z.enum(['NONE', 'MPESA', 'PAYSTACK', 'INVOICE']).optional(),
})

export const memberCreateSchema = z.strictObject({
  email: emailSchema,
  role: assignableRoleSchema.default('SALES'),
})

export const memberUpdateSchema = z.strictObject({
  role: roleSchema.optional(),
  status: memberStatusSchema.optional(),
})

export const auditListQuerySchema = z.strictObject({
  ...paginationShape,
  entityType: z.string().trim().max(60).optional(),
})

export const leadListQuerySchema = z.strictObject({
  ...paginationShape,
  status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM']).optional(),
})

export const contactSchema = z.strictObject({
  name: safeText(160, 2),
  business: safeText(160, 2),
  email: emailSchema,
  phone: z.union([phoneSchema, z.literal('')]).optional(),
  topic: contactTopicSchema,
  message: safeText(4000, 20),
  /** Honeypot: real users never fill this field. */
  website: z.string().max(0).optional(),
})

export const insightListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: customerStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
})

export const onboardingSchema = z.strictObject({
  organizationName: safeText(160, 2),
  industry: optionalText(120),
  country: optionalText(80),
  currency: currencySchema.optional(),
  plan: planSchema.default('SMALL'),
})