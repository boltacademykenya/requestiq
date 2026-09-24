import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { ZodType } from 'zod'
import { hasCapability, type Capability } from './capabilities'
import { resolveSession, type AuthContext } from './context'
import { isPlatformAdmin, syncCronSecret } from '@/lib/env'
import { ApiError, fromPgError, isPgError } from './errors'
import { assertTrustedOrigin } from './origin'
import { RATE_LIMITS, enforceRateLimit, type RateLimitPolicy } from './rate-limit'
import { clientIp, hashIp } from './request-identity'
import { errorResponse } from './response'
import { readJsonBody, readQuery } from './validation'

/**
 * - `required`: a session **and** an organization membership are needed
 * - `session`: a session is needed, an organization is optional (onboarding)
 * - `optional`: anonymous callers are allowed; `auth` is filled when possible
 * - `public`: no session handling at all
 */
export type RouteAuthMode = 'required' | 'session' | 'optional' | 'public'

export type AuthUser = { id: string; name: string; email: string }

export type HandlerArgs<TBody, TQuery> = {
  request: NextRequest
  params: Record<string, string>
  body: TBody
  query: TQuery
  /** Organization context; present whenever the caller belongs to one. */
  auth: AuthContext | null
  /** Session user; present for every authenticated mode. */
  user: AuthUser | null
  requestId: string
  ipHash: string
}

export type RouteConfig<TBody, TQuery> = {
  auth?: RouteAuthMode
  capability?: Capability
  /**
   * Restricts the route to ReorderIQ staff (see `PLATFORM_ADMIN_EMAILS`).
   *
   * Platform data is not tenant data: these routes must not declare a
   * `capability`, because a tenant role must never be able to reach them. Pair
   * this with `auth: 'session'` so an anonymous caller is rejected as 401.
   */
  platformAdmin?: true
  /**
   * Machine-triggered endpoint: the scheduled-sync entrypoint.
   *
   * Requires `x-cron-secret` to match `SYNC_CRON_SECRET`, compared in constant
   * time, and fails closed when that variable is unset so a deployment that never
   * configures a scheduler exposes nothing. Pair it with `auth: 'public'` — a
   * scheduler has no session, and public routes skip the cookie-origin guard, so
   * a plain cron request is allowed through.
   */
  cronSecret?: true
  body?: ZodType<TBody>
  query?: ZodType<TQuery>
  rateLimit?: RateLimitPolicy
  maxBytes?: number
  handler: (args: HandlerArgs<TBody, TQuery>) => Promise<Response>
}

type NextRouteContext = { params: Promise<Record<string, string>> } | undefined

/**
 * Validates the shared secret a scheduler presents.
 *
 * Constant-time comparison, and "not configured" is a refusal rather than an
 * open door.
 */
function assertCronSecret(request: NextRequest) {
  const configured = syncCronSecret()
  if (!configured) {
    throw ApiError.forbidden('Scheduled syncs are not configured on this deployment.')
  }
  const provided = Buffer.from(request.headers.get('x-cron-secret') ?? '', 'utf8')
  const expected = Buffer.from(configured, 'utf8')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw ApiError.unauthorized('A valid x-cron-secret header is required.')
  }
}

function logServerError(requestId: string, request: NextRequest, error: unknown) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.error(`[api] ${requestId} ${request.method} ${request.nextUrl.pathname} -> ${detail}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
}

function handleError(error: unknown, requestId: string, request: NextRequest): Response {
  if (error instanceof ApiError) {
    if (error.status >= 500) logServerError(requestId, request, error)
    return errorResponse(error, requestId)
  }
  if (isPgError(error)) {
    logServerError(requestId, request, error)
    return errorResponse(fromPgError(error, 'That record already exists.'), requestId)
  }
  logServerError(requestId, request, error)
  return errorResponse(ApiError.internal(), requestId)
}

/**
 * Builds a Next.js route handler with the cross-cutting concerns applied in a
 * fixed order: origin check -> authentication -> authorization -> rate limit ->
 * input validation -> handler -> error normalisation.
 */
export function createRoute<TBody = undefined, TQuery = undefined>(config: RouteConfig<TBody, TQuery>) {
  return async function routeHandler(request: NextRequest, context?: NextRouteContext): Promise<Response> {
    const requestId = crypto.randomUUID()

    try {
      const method = request.method.toUpperCase()
      const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
      const authMode: RouteAuthMode = config.auth ?? 'required'

      assertTrustedOrigin(request, { required: authMode === 'required' || authMode === 'session' })

      // Checked first: a machine caller must be authenticated before any session
      // work, capability lookup or handler runs.
      if (config.cronSecret) assertCronSecret(request)

      let auth: AuthContext | null = null
      let user: AuthUser | null = null

      if (authMode !== 'public') {
        const resolved = await resolveSession(request)
        user = resolved?.user ?? null
        auth = resolved?.context ?? null

        if ((authMode === 'required' || authMode === 'session') && !user) {
          throw ApiError.unauthorized()
        }
        if (authMode === 'required' && !auth) {
          throw new ApiError(403, 'forbidden', 'Your account is not linked to an organization yet.', {
            reason: 'organization_required',
          })
        }
        if (config.capability) {
          if (!auth) throw ApiError.forbidden('Your account is not linked to an organization yet.')
          if (!hasCapability(auth.role, config.capability)) {
            throw ApiError.forbidden(`Your role (${auth.role}) cannot perform this action.`)
          }
        }
        // Staff-only surface. Fails closed when the allowlist is empty, and is
        // checked before any handler runs so no platform query is ever reached
        // by a tenant account.
        if (config.platformAdmin) {
          if (!user) throw ApiError.unauthorized()
          if (!isPlatformAdmin(user.email)) {
            throw ApiError.forbidden('This area is restricted to the ReorderIQ platform team.')
          }
        }
      }

      const ip = clientIp(request)
      const ipHash = hashIp(ip)

      const policy: RateLimitPolicy | null =
        config.rateLimit ??
        (authMode === 'required' || authMode === 'session'
          ? isMutation
            ? RATE_LIMITS.mutation
            : RATE_LIMITS.api
          : null)
      if (policy) {
        await enforceRateLimit(policy, user ? `user:${user.id}` : `ip:${ipHash}`)
      }

      const params = context?.params ? await context.params : {}
      const query = config.query ? readQuery(request, config.query) : (undefined as TQuery)
      const body = config.body ? await readJsonBody(request, config.body, config.maxBytes) : (undefined as TBody)

      const response = await config.handler({ request, params, body, query, auth, user, requestId, ipHash })
      if (!response.headers.get('X-Request-Id')) {
        response.headers.set('X-Request-Id', requestId)
      }
      return response
    } catch (error) {
      return handleError(error, requestId, request)
    }
  }
}
