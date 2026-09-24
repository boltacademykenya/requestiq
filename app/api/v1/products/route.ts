import { assertContext } from '@/lib/api/context'
import { productCreateSchema, productListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, listed } from '@/lib/api/response'
import { createProduct, listProducts } from '@/lib/services/products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'product:read',
  query: productListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const result = await listProducts(assertContext(auth), query)
    return listed(result.items, result.pagination, requestId)
  },
})

export const POST = createRoute({
  auth: 'required',
  capability: 'product:write',
  body: productCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await createProduct(assertContext(auth), body, { ipHash }), requestId),
})
