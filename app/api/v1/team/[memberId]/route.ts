import { assertContext } from '@/lib/api/context'
import { memberUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { readParams } from '@/lib/api/validation'
import { createRoute } from '@/lib/api/route'
import { noContent, ok } from '@/lib/api/response'
import { removeMember, updateMember } from '@/lib/services/organizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = uuidParam('memberId')

export const PATCH = createRoute({
  auth: 'required',
  capability: 'member:manage',
  body: memberUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { memberId } = readParams(params, paramsSchema)
    return ok(await updateMember(assertContext(auth), memberId, body, { ipHash }), requestId)
  },
})

export const DELETE = createRoute({
  auth: 'required',
  capability: 'member:manage',
  handler: async ({ auth, params, requestId, ipHash }) => {
    const { memberId } = readParams(params, paramsSchema)
    await removeMember(assertContext(auth), memberId, { ipHash })
    return noContent(requestId)
  },
})
