import { assertContext } from '@/lib/api/context'
import { orderCreateSchema, orderListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, listed } from '@/lib/api/response'
import { createOrder, listOrders } from '@/lib/services/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'order:read',
  query: orderListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const context = assertContext(auth)
    const result = await listOrders(context.organization.id, query)
    return listed(result.items, result.pagination, requestId)
  },
})

export const POST = createRoute({
  auth: 'required',
  capability: 'order:write',
  body: orderCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) => {
    const context = assertContext(auth)
    const order = await createOrder(
      { organizationId: context.organization.id, actorUserId: context.user.id },
      {
        customerId: body.customerId,
        reference: body.reference,
        status: body.status,
        source: body.source,
        paymentMethod: body.paymentMethod ?? null,
        orderedAt: body.orderedAt ? new Date(body.orderedAt) : new Date(),
        notes: body.notes ?? null,
        currency: body.currency,
        items: body.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
      { ipHash },
    )
    return created(order, requestId)
  },
})
