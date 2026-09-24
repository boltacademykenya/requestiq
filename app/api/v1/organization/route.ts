import { assertContext } from '@/lib/api/context'
import { organizationPatchSchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { loadOrganization, updateOrganization } from '@/lib/services/organizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'org:read',
  handler: async ({ auth, requestId }) => ok(await loadOrganization(assertContext(auth)), requestId),
})

export const PATCH = createRoute({
  auth: 'required',
  capability: 'org:update',
  body: organizationPatchSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    ok(await updateOrganization(assertContext(auth), body, { ipHash }), requestId),
})
