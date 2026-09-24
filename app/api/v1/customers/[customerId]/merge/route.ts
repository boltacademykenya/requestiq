import { customerMergeSchema, uuidParam } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { mergeCustomers } from '@/lib/services/customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Merges a duplicate into the customer being kept.
 *
 * Deliberately a POST on the survivor rather than a DELETE on the duplicate: the
 * duplicate is not removed, it is absorbed — its orders and aliases move, and its
 * id stays in the audit trail.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'customer:write',
  body: customerMergeSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { customerId } = readParams(params, uuidParam('customerId'))
    return ok(await mergeCustomers(assertContext(auth), customerId, body.duplicateId, { ipHash }), requestId)
  },
})
