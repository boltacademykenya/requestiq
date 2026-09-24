import { assertContext } from '@/lib/api/context'
import { integrationCreateSchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, ok } from '@/lib/api/response'
import { listIntegrations, upsertIntegration } from '@/lib/services/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'integration:read',
  handler: async ({ auth, requestId }) => ok(await listIntegrations(assertContext(auth)), requestId),
})

export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  body: integrationCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await upsertIntegration(assertContext(auth), body, { ipHash }), requestId),
})
