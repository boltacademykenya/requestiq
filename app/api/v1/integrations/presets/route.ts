import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { listPresets } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Starting-point templates (Zoho, Shopify, WooCommerce, Paystack, custom).
 *
 * They describe endpoints and mappings only — never credentials — so a tenant can
 * prefill a connection and then adjust whatever their account differs on.
 */
export const GET = createRoute({
  auth: 'required',
  capability: 'integration:read',
  handler: async ({ requestId }) => ok(listPresets(), requestId),
})
