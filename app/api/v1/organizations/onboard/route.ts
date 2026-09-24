import { assertUser } from '@/lib/api/context'
import { onboardingSchema } from '@/lib/api/contracts'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { created, ok } from '@/lib/api/response'
import { onboardOrganization } from '@/lib/services/organizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Creates the tenant for the signed-in user (idempotent).
 *
 * Must be called after `authClient.signUp.email` succeeds: better-auth owns the
 * identities, this endpoint owns the workspace. It therefore only needs a
 * session, not an existing organization.
 */
export const POST = createRoute({
  auth: 'session',
  body: onboardingSchema,
  rateLimit: RATE_LIMITS.onboarding,
  handler: async ({ user, body, requestId, ipHash }) => {
    const result = await onboardOrganization(assertUser(user), body, { ipHash })
    const payload = { organization: result.organization, role: result.role, created: result.created }
    return result.created ? created(payload, requestId) : ok(payload, requestId)
  },
})
