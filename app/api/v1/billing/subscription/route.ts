import { assertContext } from '@/lib/api/context'
import { subscriptionUpdateSchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { getSubscription, updateSubscription } from '@/lib/services/billing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'billing:read',
  handler: async ({ auth, requestId }) => ok(await getSubscription(assertContext(auth)), requestId),
})

export const PATCH = createRoute({
  auth: 'required',
  capability: 'billing:manage',
  body: subscriptionUpdateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    ok(await updateSubscription(assertContext(auth), body, { ipHash }), requestId),
})
