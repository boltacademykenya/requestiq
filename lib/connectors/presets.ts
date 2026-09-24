import { connectorSchema, type ConnectorConfig } from './config'
import type { z } from 'zod'

/**
 * Provider templates.
 *
 * These are starting points, not hard-coded integrations: choosing a provider
 * prefills the endpoint, the field mapping and the paging style, and the tenant
 * then adjusts whatever their account differs on. That is what makes a provider
 * like Zoho configurable from the UI instead of requiring a new deployment.
 *
 * Every template is parsed through `connectorSchema` when it is read, so a
 * template that drifts out of spec fails loudly instead of shipping a broken
 * mapping to a customer.
 */

export type ConnectorPreset = {
  provider: string
  name: string
  summary: string
  docsUrl: string | null
  /** Credential field shown in the UI; the value is stored encrypted. */
  credential: { label: string; hint: string; required: boolean }
  setupNotes: string[]
  connector: ConnectorConfig
}

type PresetInput = Omit<ConnectorPreset, 'connector'> & { connector: z.input<typeof connectorSchema> }

const PAGE_1 = { mode: 'page', param: 'page', sizeParam: 'per_page', pageSize: 200, startPage: 1, maxPages: 50 } as const
const MAX_HISTORY_ROWS = 10_000

const PRESETS: Record<string, PresetInput> = {
  ZOHO_INVENTORY: {
    provider: 'ZOHO_INVENTORY',
    name: 'Zoho Inventory',
    summary: 'Contacts, items and sales orders from Zoho Inventory.',
    docsUrl: 'https://www.zoho.com/inventory/api/v1/introduction/',
    credential: {
      label: 'OAuth access token',
      hint: 'Paste the full header value, including the scheme: "Zoho-oauthtoken 1000.xxxx".',
      required: true,
    },
    setupNotes: [
      'Set organization_id below to the Zoho organisation you want to read.',
      'Contacts need a phone or mobile number to be imported — ReorderIQ rejects rows without one.',
      'Tokens expire hourly; rotate the credential here when syncs start failing with 401.',
    ],
    connector: {
      baseUrl: 'https://www.zohoapis.com/inventory/v1',
      auth: { type: 'header', header: 'Authorization' },
      query: { organization_id: '' },
      resources: {
        customers: {
          path: '/contacts',
          recordsPath: 'contacts',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          fields: {
            externalId: 'contact_id',
            name: 'contact_name',
            phone: 'phone || mobile',
            email: 'email',
            location: 'billing_address.city',
            customerType: 'contact_type',
          },
        },
        products: {
          path: '/items',
          recordsPath: 'items',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          fields: {
            externalId: 'item_id',
            name: 'name',
            sku: 'sku',
            category: 'category_name',
            unit: 'unit',
            price: 'rate',
          },
        },
        orders: {
          path: '/salesorders',
          recordsPath: 'salesorders',
          referencePrefix: 'ZI-',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          fields: {
            externalId: 'salesorder_number',
            customerExternalId: 'customer_id',
            orderedAt: 'date',
            total: 'total',
            currency: 'currency_code',
            status: 'status',
          },
          values: {
            status: {
              draft: 'PENDING',
              open: 'PENDING',
              confirmed: 'COMPLETED',
              shipped: 'COMPLETED',
              partially_shipped: 'COMPLETED',
              fulfilled: 'COMPLETED',
              partially_invoiced: 'COMPLETED',
              invoiced: 'COMPLETED',
              closed: 'COMPLETED',
              void: 'CANCELLED',
              cancelled: 'CANCELLED',
            },
          },
        },
      },
    },
  },

  SHOPIFY: {
    provider: 'SHOPIFY',
    name: 'Shopify',
    summary: 'Customers, products and orders from a Shopify store (Admin REST API).',
    docsUrl: 'https://shopify.dev/docs/api/admin-rest',
    credential: { label: 'Admin API access token', hint: 'The shpat_… token from a custom app.', required: true },
    setupNotes: [
      'Replace YOUR-STORE in the base URL with your shop handle and use an Admin API token with customer, product and order read scopes.',
      'Paging follows the Link header, so no page parameter is needed.',
      'Shopify Admin REST is a legacy API. This template uses the current version; use GraphQL for new custom Shopify integrations when you need new platform features.',
      'Order history older than 60 days needs Shopify’s read_all_orders approval.',
      'Customers with no phone number are skipped: ReorderIQ needs a phone to act on a reorder.',
    ],
    connector: {
      baseUrl: 'https://YOUR-STORE.myshopify.com/admin/api/2026-07',
      auth: { type: 'header', header: 'X-Shopify-Access-Token' },
      resources: {
        customers: {
          path: '/customers.json',
          recordsPath: 'customers',
          pagination: { mode: 'link-header', sizeParam: 'limit', pageSize: 250, startPage: 0, maxPages: 40 },
          maxRecords: MAX_HISTORY_ROWS,
          fields: {
            externalId: 'id',
            name: '{first_name} {last_name}',
            phone: 'phone || default_address.phone',
            email: 'email',
            location: 'default_address.city',
          },
        },
        products: {
          path: '/products.json',
          recordsPath: 'products',
          pagination: { mode: 'link-header', sizeParam: 'limit', pageSize: 250, startPage: 0, maxPages: 40 },
          maxRecords: MAX_HISTORY_ROWS,
          fields: {
            externalId: 'id',
            name: 'title',
            sku: 'variants[0].sku',
            price: 'variants[0].price',
            category: 'product_type',
          },
        },
        orders: {
          path: '/orders.json',
          recordsPath: 'orders',
          query: { status: 'any' },
          referencePrefix: 'SH-',
          pagination: { mode: 'link-header', sizeParam: 'limit', pageSize: 250, startPage: 0, maxPages: 40 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'updated_at_min',
          fields: {
            externalId: 'name',
            customerExternalId: 'customer.id',
            customerEmail: 'email',
            customerPhone: 'phone || customer.phone || billing_address.phone',
            orderedAt: 'created_at',
            total: 'total_price',
            currency: 'currency',
            status: 'financial_status',
          },
          values: {
            status: {
              paid: 'COMPLETED',
              partially_paid: 'PENDING',
              pending: 'PENDING',
              authorized: 'PENDING',
              partially_refunded: 'CANCELLED',
              refunded: 'CANCELLED',
              voided: 'CANCELLED',
            },
          },
          items: {
            recordsPath: 'line_items',
            fields: {
              productExternalId: 'product_id',
              productName: 'title',
              quantity: 'quantity',
              unitPrice: 'price',
            },
          },
        },
      },
    },
  },

  WOOCOMMERCE: {
    provider: 'WOOCOMMERCE',
    name: 'WooCommerce',
    summary: 'Customers, products and orders from a WooCommerce store.',
    docsUrl: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
    credential: { label: 'Consumer secret', hint: 'The ck_/cs_ pair: put the consumer key in "username".', required: true },
    setupNotes: [
      'Generate a read-only key under WooCommerce → Settings → Advanced → REST API.',
      'Replace YOUR-STORE in the base URL with your shop domain.',
      'Guests check out without an account, so orders also map the billing email and phone.',
    ],
    connector: {
      baseUrl: 'https://YOUR-STORE.com/wp-json/wc/v3',
      auth: { type: 'basic', username: 'ck_consumer_key' },
      resources: {
        customers: {
          path: '/customers',
          recordsPath: '',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'modified_after',
          fields: {
            externalId: 'id',
            name: '{first_name} {last_name}',
            email: 'email',
            phone: 'billing.phone',
            location: 'billing.city',
          },
        },
        products: {
          path: '/products',
          recordsPath: '',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'modified_after',
          fields: {
            externalId: 'id',
            name: 'name',
            sku: 'sku',
            price: 'price',
            category: 'categories[0].name',
          },
        },
        orders: {
          path: '/orders',
          recordsPath: '',
          referencePrefix: 'WC-',
          pagination: { ...PAGE_1 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'modified_after',
          fields: {
            externalId: 'number',
            customerExternalId: 'customer_id',
            customerEmail: 'billing.email',
            customerPhone: 'billing.phone',
            orderedAt: 'date_created',
            total: 'total',
            currency: 'currency',
            status: 'status',
            paymentMethod: 'payment_method_title',
          },
          values: {
            status: {
              completed: 'COMPLETED',
              processing: 'COMPLETED',
              pending: 'PENDING',
              'on-hold': 'PENDING',
              cancelled: 'CANCELLED',
              failed: 'CANCELLED',
              refunded: 'CANCELLED',
            },
          },
          items: {
            recordsPath: 'line_items',
            fields: {
              productExternalId: 'product_id',
              productName: 'name',
              quantity: 'quantity',
              unitPrice: 'price',
            },
          },
        },
      },
    },
  },

  PAYSTACK: {
    provider: 'PAYSTACK',
    name: 'Paystack',
    summary: 'Successful transactions as orders — real payment timestamps for the interval maths.',
    docsUrl: 'https://paystack.com/docs/api/transaction/',
    credential: { label: 'Secret key', hint: 'sk_live_… or sk_test_…', required: true },
    setupNotes: [
      'Paystack amounts are in the minor unit (kobo), so money scale is set to 0.01.',
      'The customer resource imports records with a phone number; its customer code connects payments to those records.',
      'Payments are treated as completed orders only when Paystack reports status=success.',
    ],
    connector: {
      baseUrl: 'https://api.paystack.co',
      auth: { type: 'bearer' },
      resources: {
        customers: {
          path: '/customer',
          recordsPath: 'data',
          pagination: { mode: 'page', param: 'page', sizeParam: 'perPage', pageSize: 100, startPage: 1, maxPages: 100 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'from',
          fields: {
            externalId: 'customer_code',
            name: '@Customer {email}',
            phone: 'phone',
            email: 'email',
          },
        },
        orders: {
          path: '/transaction',
          recordsPath: 'data',
          referencePrefix: 'PS-',
          moneyScale: 0.01,
          pagination: { mode: 'page', param: 'page', sizeParam: 'perPage', pageSize: 100, startPage: 1, maxPages: 100 },
          maxRecords: MAX_HISTORY_ROWS,
          updatedSinceParam: 'from',
          fields: {
            externalId: 'reference',
            customerExternalId: 'customer.customer_code',
            customerEmail: 'customer.email',
            customerPhone: 'customer.phone',
            orderedAt: 'paid_at',
            total: 'amount',
            currency: 'currency',
            status: 'status',
            paymentMethod: 'channel',
          },
          values: {
            status: { success: 'COMPLETED', failed: 'CANCELLED', abandoned: 'PENDING', reversed: 'CANCELLED' },
          },
        },
      },
    },
  },

  CUSTOM: {
    provider: 'CUSTOM',
    name: 'Custom / any REST API',
    summary: 'Point ReorderIQ at your own endpoint (or a POS, ERP or spreadsheet export service) and map the fields.',
    docsUrl: null,
    credential: { label: 'API key / token', hint: 'Leave empty for a public endpoint.', required: false },
    setupNotes: [
      'Set the base URL, then the path of each list endpoint (e.g. /api/v1/orders).',
      'Fill in source paths such as data.items — dot for keys, [0] for an index, [*] to flatten.',
      'Use "Test & preview" before saving: it shows the mapped rows and why any were rejected.',
    ],
    connector: {
      baseUrl: 'https://api.example.com',
      auth: { type: 'bearer' },
      resources: {
        customers: {
          path: '/customers',
          recordsPath: 'data',
          pagination: { mode: 'page', param: 'page', sizeParam: 'per_page', pageSize: 100, startPage: 1, maxPages: 20 },
          fields: { externalId: 'id', name: 'name', phone: 'phone', email: 'email' },
        },
      },
    },
  },
}

const cache = new Map<string, ConnectorPreset>()

/** Returns a parsed template, or null when the provider has no data template yet. */
export function connectorPreset(provider: string): ConnectorPreset | null {
  const cached = cache.get(provider)
  if (cached) return cached
  const raw = PRESETS[provider]
  if (!raw) return null
  const preset: ConnectorPreset = { ...raw, connector: connectorSchema.parse(raw.connector) }
  cache.set(provider, preset)
  return preset
}

export function listConnectorPresets(): ConnectorPreset[] {
  return Object.keys(PRESETS)
    .map((provider) => connectorPreset(provider))
    .filter((preset): preset is ConnectorPreset => preset !== null)
}
