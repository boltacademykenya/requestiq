import { z } from 'zod'

/**
 * Connector specification.
 *
 * A *connector* is the declarative description of how to read customers,
 * products and orders out of somebody else's HTTP API. Nothing here is
 * executable: it is data (endpoints, source paths, value maps) that the mapper
 * in `./canonical.ts` interprets, so a tenant can teach ReorderIQ about their
 * own system from the UI without us shipping provider-specific sync code.
 *
 * Secrets are deliberately **not** part of this shape. `config` on the
 * integration row already rejects credential-looking keys, and the credential
 * itself travels through `POST …/credential` into an encrypted column. A
 * connector can therefore be exported, logged or shown in the UI safely.
 */

/** Anchored negated class: "contains no control characters" (mirrors contracts.ts). */
const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/

const safeText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(NO_CONTROL_CHARS, { message: 'Control characters are not allowed.' })

/** Header/query names that must never carry a value, because the value is a secret. */
const CREDENTIAL_HEADERS = /^(authorization|cookie|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token)$/i

/** Keys that look like credentials; the same rule `integrationConfigSchema` applies. */
const SECRET_LIKE_KEY = /(secret|token|password|passwd|api[-_]?key|credential|private|passphrase)/i

/* -------------------------------------------------------------------------- */
/* Field specifications (shared with the UI so both sides agree)              */
/* -------------------------------------------------------------------------- */

export type FieldSpec = {
  /** Canonical field name as consumed by the mapper. */
  key: string
  label: string
  /** Rows missing a required field are rejected with a readable reason. */
  required: boolean
  hint: string
}

const CUSTOMER_FIELDS: FieldSpec[] = [
  { key: 'externalId', label: 'External id', required: false, hint: 'Contact/Customer id — the key re-syncs match on.' },
  { key: 'name', label: 'Name', required: true, hint: 'e.g. contact_name, name, first_name' },
  { key: 'phone', label: 'Phone', required: true, hint: 'Required: it is the outreach channel.' },
  { key: 'email', label: 'Email', required: false, hint: 'e.g. email, billing.email' },
  { key: 'location', label: 'Location', required: false, hint: 'e.g. billing_address.city' },
  { key: 'customerType', label: 'Customer type', required: false, hint: 'BUSINESS / INDIVIDUAL' },
]

const PRODUCT_FIELDS: FieldSpec[] = [
  { key: 'externalId', label: 'External id', required: false, hint: 'Item/Product id.' },
  { key: 'name', label: 'Name', required: true, hint: 'e.g. name, title, product_name' },
  { key: 'sku', label: 'SKU', required: false, hint: 'Second matching key after the external id.' },
  { key: 'category', label: 'Category', required: false, hint: 'e.g. category_name' },
  { key: 'unit', label: 'Unit', required: false, hint: 'Defaults to "unit".' },
  { key: 'price', label: 'Unit price', required: false, hint: 'Defaults to 0 when absent.' },
]

const ORDER_FIELDS: FieldSpec[] = [
  { key: 'externalId', label: 'External id', required: true, hint: 'Order number — becomes the order reference.' },
  { key: 'customerExternalId', label: 'Customer external id', required: false, hint: 'Best match; falls back to email/phone.' },
  { key: 'customerEmail', label: 'Customer email', required: false, hint: 'Used when the customer id is not available.' },
  { key: 'customerPhone', label: 'Customer phone', required: false, hint: 'Used when the customer id is not available.' },
  { key: 'orderedAt', label: 'Ordered at', required: true, hint: 'Drives the interval maths — must be the real purchase date.' },
  { key: 'status', label: 'Status', required: false, hint: 'Mapped to COMPLETED / PENDING / CANCELLED.' },
  { key: 'currency', label: 'Currency', required: false, hint: 'Defaults to the workspace currency.' },
  { key: 'total', label: 'Total', required: false, hint: 'Falls back to the sum of the line items.' },
  { key: 'paymentMethod', label: 'Payment method', required: false, hint: 'e.g. gateway, payment_method' },
]

const ORDER_ITEM_FIELDS: FieldSpec[] = [
  { key: 'productExternalId', label: 'Product external id', required: false, hint: 'Links the line to the catalogue.' },
  { key: 'productName', label: 'Product name', required: true, hint: 'Falls back to the product external id.' },
  { key: 'quantity', label: 'Quantity', required: true, hint: 'Integer between 1 and 100,000.' },
  { key: 'unitPrice', label: 'Unit price', required: false, hint: 'Historical price; kept as-is for old orders.' },
]

export const CONNECTOR_FIELDS = {
  customers: CUSTOMER_FIELDS,
  products: PRODUCT_FIELDS,
  orders: ORDER_FIELDS,
  orderItems: ORDER_ITEM_FIELDS,
} as const

export type ConnectorResourceName = 'customers' | 'products' | 'orders'

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */

// Record *keys* must be a plain string schema in zod, so key names are bounded
// and validated in the superRefine below instead.
const fieldMapSchema = z.record(z.string(), safeText(300))

const valueMapSchema = z.record(z.string(), z.record(z.string(), safeText(60)))

export const connectorPaginationSchema = z.strictObject({
  /**
   * `none`      — one request (or as many as `maxRecords` needs, using `limit`).
   * `page`      — `?page=0&per_page=100`
   * `offset`    — `?offset=0&limit=100`
   * `cursor`    — `?cursor=<value from cursorPath>`
   * `link-header` — follows the RFC 5988 `rel="next"` URL (Shopify, GitHub).
   */
  mode: z.enum(['none', 'page', 'offset', 'cursor', 'link-header']).default('none'),
  /** Name of the paging parameter (defaults per mode: page, offset, cursor). */
  param: safeText(60).optional(),
  /** Name of the page-size parameter when the provider expects one. */
  sizeParam: safeText(60).optional(),
  /** Response path holding the next cursor value (cursor mode only). */
  cursorPath: safeText(300).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  startPage: z.coerce.number().int().min(0).max(100_000).default(0),
  /** Hard stop so a broken cursor cannot loop forever. */
  maxPages: z.coerce.number().int().min(1).max(200).default(20),
})

export const connectorResourceSchema = z.strictObject({
  /** Endpoint path, relative to `baseUrl`, or an absolute https URL. */
  path: safeText(500),
  /** Where the array of records lives in the response. '' means the root is the array. */
  recordsPath: safeText(300, 0).default(''),
  /** Parameters that apply only to this resource (for example `status=any` on orders). */
  query: z.record(z.string(), z.string().max(300)).default({}),
  /** Canonical field -> source path (see CONNECTOR_FIELDS for the canonical names). */
  fields: fieldMapSchema,
  /** Optional canonical field -> { source value: canonical value } translation. */
  values: valueMapSchema.optional(),
  pagination: connectorPaginationSchema.default({
    mode: 'none',
    pageSize: 100,
    startPage: 0,
    maxPages: 20,
  }),
  /**
   * Multiplier applied to money fields (price, total, line unit price).
   * Some APIs quote minor units only: Paystack returns kobo/cents, so 0.01.
   */
  moneyScale: z.coerce.number().min(0.000001).max(1_000_000).default(1),
  /** Upper bound on rows read per resource per run (bounded reads). */
  maxRecords: z.coerce.number().int().min(1).max(10_000).default(1000),
  /** Prepended to the external order id so references stay unique and readable. */
  referencePrefix: safeText(20).optional(),
  /** Query parameter carrying an ISO timestamp, for incremental pulls. */
  updatedSinceParam: safeText(60).optional(),
})

export const connectorOrdersResourceSchema = connectorResourceSchema.extend({
  /** Where a line item list lives inside each order record, and how to read it. */
  items: z
    .strictObject({
      recordsPath: safeText(300, 0).default(''),
      fields: fieldMapSchema,
      values: valueMapSchema.optional(),
    })
    .optional(),
})

export const connectorAuthSchema = z.strictObject({
  /** How the stored credential is attached to every request. */
  type: z.enum(['none', 'bearer', 'header', 'basic', 'query']).default('none'),
  /** Header name for `header` auth (e.g. `X-Shopify-Access-Token`). */
  header: safeText(60).optional(),
  /** Query parameter name for `query` auth. */
  param: safeText(60).optional(),
  /** Non-secret username for `basic` auth; the password is the stored credential. */
  username: safeText(160).optional(),
})

/** The structural shape shared by a full connector and its connection half. */
type ConnectionShape = {
  baseUrl: string
  auth: {
    type: 'none' | 'bearer' | 'header' | 'basic' | 'query'
    header?: string | undefined
    param?: string | undefined
    username?: string | undefined
  }
  headers: Record<string, string>
  query: Record<string, string>
}

/**
 * The checks that apply to a connection on its own.
 *
 * Shared by `connectorSchema` and `connectorConnectionSchema` so a "Test
 * connection" probe cannot accept a credential smuggled into a header that a real
 * connector would reject, or the other way round.
 */
function checkConnection(value: ConnectionShape, ctx: z.RefinementCtx) {
  for (const [name, entry] of Object.entries(value.headers)) {
    if (name.trim().length === 0 || name.length > 60) {
      ctx.addIssue({ code: 'custom', path: ['headers', name], message: 'Header names must be 1-60 characters.' })
    }
    if (entry.length > 300) {
      ctx.addIssue({ code: 'custom', path: ['headers', name], message: 'Header values are limited to 300 characters.' })
    }
  }
  for (const [name, entry] of Object.entries(value.query)) {
    if (name.trim().length === 0 || name.length > 60) {
      ctx.addIssue({ code: 'custom', path: ['query', name], message: 'Parameter names must be 1-60 characters.' })
    }
    if (entry.length > 300) {
      ctx.addIssue({ code: 'custom', path: ['query', name], message: 'Parameter values are limited to 300 characters.' })
    }
  }

  for (const header of Object.keys(value.headers)) {
    if (CREDENTIAL_HEADERS.test(header.trim())) {
      ctx.addIssue({
        code: 'custom',
        path: ['headers', header],
        message:
          `"${header}" carries a credential. Enter it in the credential field instead — it is stored encrypted and never returned.`,
      })
    } else if (SECRET_LIKE_KEY.test(header)) {
      ctx.addIssue({
        code: 'custom',
        path: ['headers', header],
        message: `"${header}" looks like a credential. Use the credential field so it is stored encrypted.`,
      })
    }
  }
  for (const [key, entry] of Object.entries(value.query)) {
    if ((CREDENTIAL_HEADERS.test(key.trim()) || SECRET_LIKE_KEY.test(key)) && entry.trim().length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['query', key],
        message: `"${key}" looks like a credential. Use the credential field instead.`,
      })
    }
  }
  if (value.auth.type === 'header' && !value.auth.header) {
    ctx.addIssue({ code: 'custom', path: ['auth', 'header'], message: 'Name the header that carries the credential.' })
  }
  if (value.auth.type === 'query' && !value.auth.param) {
    ctx.addIssue({ code: 'custom', path: ['auth', 'param'], message: 'Name the query parameter that carries the credential.' })
  }
  if (value.auth.type === 'basic' && !value.auth.username) {
    ctx.addIssue({ code: 'custom', path: ['auth', 'username'], message: 'Basic auth needs the username.' })
  }
  if (value.baseUrl && !/^https?:\/\/[^\s]+$/i.test(value.baseUrl)) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Enter an http(s) URL, e.g. https://api.example.com/v1' })
  }
}

/**
 * The connection half of a connector — base URL, credential handling and the
 * static headers/query parameters — and nothing else.
 *
 * It exists so an operator can test a URL and a token on a half-filled form,
 * before any resource mapping exists: "Test connection" probes this shape, and the
 * full `connectorSchema` reuses its checks, so the two can never drift apart.
 */
export const connectorConnectionSchema = z
  .strictObject({
    /** Root of the API, e.g. https://www.zohoapis.com/inventory/v1 */
    baseUrl: safeText(500),
    auth: connectorAuthSchema.default({ type: 'none' }),
    /** Extra static headers. No credential-looking names allowed. */
    headers: z.record(z.string(), z.string().max(300)).default({}),
    /** Extra static query parameters (e.g. `organization_id`). */
    query: z.record(z.string(), z.string().max(300)).default({}),
    /** Per-request timeout for the outbound call. */
    timeoutMs: z.coerce.number().int().min(1000).max(30_000).default(10_000),
  })
  .superRefine((value, ctx) => checkConnection(value, ctx))

export const connectorSchema = z
  .strictObject({
    /** Root of the API, e.g. https://www.zohoapis.com/inventory/v1 */
    baseUrl: safeText(500),
    auth: connectorAuthSchema.default({ type: 'none' }),
    /** Extra static headers. No credential-looking names allowed. */
    headers: z.record(z.string(), z.string().max(300)).default({}),
    /** Extra static query parameters (e.g. `organization_id`). */
    query: z.record(z.string(), z.string().max(300)).default({}),
    resources: z.strictObject({
      customers: connectorResourceSchema.optional(),
      products: connectorResourceSchema.optional(),
      orders: connectorOrdersResourceSchema.optional(),
    }),
    /** Per-request timeout for the outbound call. */
    timeoutMs: z.coerce.number().int().min(1000).max(30_000).default(10_000),
  })
  .superRefine((value, ctx) => {
    checkConnection(value, ctx)

    // Every key of `fields` must be a real canonical field, and every required
    // field must be mapped — otherwise the connector can never write a row, and
    // finding that out from a rejection report is far worse than finding it here.
    for (const resource of ['customers', 'products', 'orders'] as const) {
      const mapping = value.resources[resource]
      if (!mapping) continue
      const spec = CONNECTOR_FIELDS[resource]
      const valid = new Map(spec.map((field) => [field.key, field]))

      for (const key of Object.keys(mapping.fields)) {
        if (!valid.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['resources', resource, 'fields', key],
            message: `"${key}" is not a ${resource.slice(0, -1)} field. Valid fields: ${[...valid.keys()].join(', ')}.`,
          })
        }
      }
      for (const field of spec) {
        if (field.required && !mapping.fields[field.key]) {
          ctx.addIssue({
            code: 'custom',
            path: ['resources', resource, 'fields', field.key],
            message: `Map the ${field.label.toLowerCase()}: every ${resource.slice(0, -1)} row needs it.`,
          })
        }
      }

      const itemMapping = resource === 'orders' ? value.resources.orders?.items : undefined
      if (itemMapping) {
        const itemValid = new Set(CONNECTOR_FIELDS.orderItems.map((field) => field.key))
        for (const key of Object.keys(itemMapping.fields)) {
          if (!itemValid.has(key)) {
            ctx.addIssue({
              code: 'custom',
              path: ['resources', resource, 'items', 'fields', key],
              message: `"${key}" is not a line item field. Valid fields: ${[...itemValid].join(', ')}.`,
            })
          }
        }
        for (const field of CONNECTOR_FIELDS.orderItems) {
          if (field.required && !itemMapping.fields[field.key]) {
            ctx.addIssue({
              code: 'custom',
              path: ['resources', resource, 'items', 'fields', field.key],
              message: `Map the line ${field.label.toLowerCase()}: every line item needs it.`,
            })
          }
        }
      }

      for (const [key, entry] of Object.entries(mapping.query)) {
        if (key.trim().length === 0 || key.length > 60) {
          ctx.addIssue({
            code: 'custom',
            path: ['resources', resource, 'query', key],
            message: 'Parameter names must be 1-60 characters.',
          })
        }
        if ((CREDENTIAL_HEADERS.test(key.trim()) || SECRET_LIKE_KEY.test(key)) && entry.trim().length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['resources', resource, 'query', key],
            message: `"${key}" looks like a credential. Use the credential field instead.`,
          })
        }
      }
    }

    for (const header of Object.keys(value.headers)) {
      if (CREDENTIAL_HEADERS.test(header.trim())) {
        ctx.addIssue({
          code: 'custom',
          path: ['headers', header],
          message:
            `"${header}" carries a credential. Enter it in the credential field instead — it is stored encrypted and never returned.`,
        })
      } else if (SECRET_LIKE_KEY.test(header)) {
        ctx.addIssue({
          code: 'custom',
          path: ['headers', header],
          message: `"${header}" looks like a credential. Use the credential field so it is stored encrypted.`,
        })
      }
    }
    const enabled = Object.values(value.resources).filter(Boolean).length
    if (enabled === 0) {
      ctx.addIssue({ code: 'custom', path: ['resources'], message: 'Enable at least one of customers, products or orders.' })
    }
  })

export type ConnectorConfig = z.infer<typeof connectorSchema>
export type ConnectorConnectionConfig = z.infer<typeof connectorConnectionSchema>
export type ConnectorResourceConfig = z.infer<typeof connectorResourceSchema>
export type ConnectorOrdersResourceConfig = z.infer<typeof connectorOrdersResourceSchema>
export type ConnectorPagination = z.infer<typeof connectorPaginationSchema>

/** Providers a connector can be built for. `CUSTOM` covers everything else. */
export const CONNECTOR_PROVIDERS = [
  'ZOHO_INVENTORY',
  'SHOPIFY',
  'WOOCOMMERCE',
  'PAYSTACK',
  'MPESA',
  'WHATSAPP_BUSINESS',
  'SMS_GATEWAY',
  'CUSTOM',
] as const

/** Providers that can move customers/products/orders today. */
export const DATA_PROVIDERS: ReadonlySet<string> = new Set(['ZOHO_INVENTORY', 'SHOPIFY', 'WOOCOMMERCE', 'CUSTOM'])
