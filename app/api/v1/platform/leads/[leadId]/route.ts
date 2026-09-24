import { z } from 'zod'
import { assertUser } from '@/lib/api/context'
import { uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { updateLeadStatus } from '@/lib/services/leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.strictObject({ status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'SPAM']) })

/** Updates the handling state of a platform lead. Staff only — see the list route. */
export const PATCH = createRoute({
  auth: 'session',
  platformAdmin: true,
  body: bodySchema,
  handler: async ({ user, body, params, requestId, ipHash }) => {
    const { leadId } = readParams(params, uuidParam('leadId'))
    const lead = await updateLeadStatus(assertUser(user), leadId, body.status, { ipHash })
    return ok(lead, requestId)
  },
})
