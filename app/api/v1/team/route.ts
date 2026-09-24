import { assertContext } from '@/lib/api/context'
import { memberCreateSchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, ok } from '@/lib/api/response'
import { addMember, listMembers } from '@/lib/services/organizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'member:read',
  handler: async ({ auth, requestId }) => ok(await listMembers(assertContext(auth)), requestId),
})

export const POST = createRoute({
  auth: 'required',
  capability: 'member:manage',
  body: memberCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await addMember(assertContext(auth), body, { ipHash }), requestId),
})
