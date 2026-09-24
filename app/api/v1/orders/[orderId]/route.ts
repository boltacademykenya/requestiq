import { assertContext } from '@/lib/api/context'
import { orderUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { getOrder, updateOrder } from '@/lib/services/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = uuidParam('orderId')

export const GET = createRoute({
  auth: 'required',
  capability: 'order:read',
  handler: async ({ auth, params, requestId }) => {
    const { orderId } = readParams(params, paramsSchema)
    return ok(await getOrder(assertContext(auth).organization.id, orderId), requestId)
  },
})

export const PATCH = createRoute({
  auth: 'required',
  capability: 'order:write',
  body: orderUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const context = assertContext(auth)
    const { orderId } = readParams(params, paramsSchema)
    const order = await updateOrder(
      { organizationId: context.organization.id, actorUserId: context.user.id },
      orderId,
      {
        status: body.status,
        paymentMethod: body.paymentMethod ?? undefined,
        notes: body.notes ?? undefined,
        orderedAt: body.orderedAt ? new Date(body.orderedAt) : undefined,
      },
      { ipHash },
    )
    return ok(order, requestId)
  },
})
