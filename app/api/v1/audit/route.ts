import { assertContext } from '@/lib/api/context'
import { auditListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { listed } from '@/lib/api/response'
import { listAuditLogs } from '@/lib/services/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'audit:read',
  query: auditListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const result = await listAuditLogs(assertContext(auth), query)
    return listed(result.items, result.pagination, requestId)
  },
})
