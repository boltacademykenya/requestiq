import { assertContext } from '@/lib/api/context'
import { messageCreateSchema, messageListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, listed } from '@/lib/api/response'
import { createMessage, listMessages } from '@/lib/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'message:read',
  query: messageListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const result = await listMessages(assertContext(auth), query)
    return listed(result.items, result.pagination, requestId)
  },
})

export const POST = createRoute({
  auth: 'required',
  capability: 'message:write',
  body: messageCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await createMessage(assertContext(auth), body, { ipHash }), requestId),
})
