import { assertContext } from '@/lib/api/context'
import { customerCreateSchema, customerListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, listed } from '@/lib/api/response'
import { createCustomer, listCustomers } from '@/lib/services/customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'customer:read',
  query: customerListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const result = await listCustomers(assertContext(auth), query)
    return listed(result.items, result.pagination, requestId)
  },
})

export const POST = createRoute({
  auth: 'required',
  capability: 'customer:write',
  body: customerCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await createCustomer(assertContext(auth), body, { ipHash }), requestId),
})
