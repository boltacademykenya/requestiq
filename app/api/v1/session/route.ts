import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { buildSessionDto } from '@/lib/services/organizations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bootstrap payload for the client: who is signed in, which organization they
 * are acting on and what they are allowed to do.
 *
 * `user` comes from the resolved session, not from the organization context:
 * a signed-in account that has not been onboarded yet still gets its identity
 * back (with `organization: null`), which is what the workspace onboarding
 * panel needs. Only an anonymous caller gets `user: null`.
 */
export const GET = createRoute({
  auth: 'optional',
  handler: async ({ auth, user, requestId }) => {
    if (!user) {
      return ok({ user: null, organization: null, role: null, capabilities: [] }, requestId)
    }
    return ok(buildSessionDto(auth, user), requestId)
  },
})
