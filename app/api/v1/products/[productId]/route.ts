import { assertContext } from '@/lib/api/context'
import { productUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { noContent, ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { deactivateProduct, getProduct, updateProduct } from '@/lib/services/products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = uuidParam('productId')

export const GET = createRoute({
  auth: 'required',
  capability: 'product:read',
  handler: async ({ auth, params, requestId }) => {
    const { productId } = readParams(params, paramsSchema)
    return ok(await getProduct(assertContext(auth), productId), requestId)
  },
})

export const PATCH = createRoute({
  auth: 'required',
  capability: 'product:write',
  body: productUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { productId } = readParams(params, paramsSchema)
    return ok(await updateProduct(assertContext(auth), productId, body, { ipHash }), requestId)
  },
})

export const DELETE = createRoute({
  auth: 'required',
  capability: 'product:write',
  handler: async ({ auth, params, requestId, ipHash }) => {
    const { productId } = readParams(params, paramsSchema)
    await deactivateProduct(assertContext(auth), productId, { ipHash })
    return noContent(requestId)
  },
})
