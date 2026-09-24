import { and, asc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { members, organizations, type MemberRow, type OrganizationRow } from '@/lib/db/schema'
import { capabilitiesFor, hasCapability, type Capability, type RoleName } from './capabilities'
import { ApiError } from './errors'

export const ORGANIZATION_HEADER = 'x-organization-id'

export type AuthContext = {
  user: { id: string; name: string; email: string }
  organization: OrganizationRow
  membership: MemberRow
  role: RoleName
  capabilities: Capability[]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requestedOrganizationId(request: NextRequest): string | null {
  const candidate =
    request.headers.get(ORGANIZATION_HEADER) ?? request.nextUrl.searchParams.get('organizationId') ?? null
  if (!candidate) return null
  if (!UUID_PATTERN.test(candidate)) {
    throw ApiError.badRequest('The requested organization identifier is not valid.')
  }
  return candidate
}

async function activeMemberships(userId: string) {
  return db
    .select({ membership: members, organization: organizations })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(and(eq(members.userId, userId), eq(members.status, 'ACTIVE')))
    .orderBy(asc(organizations.createdAt))
}

type AuthResult = { user: { id: string; name: string; email: string }; context: AuthContext | null }

/**
 * Resolves the caller from the session cookie.
 *
 * Returns `user` even when the account has no organization yet, which is what
 * onboarding needs (organizations are created after sign-up).
 */
export async function resolveSession(request: NextRequest): Promise<AuthResult | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return null

  const user = { id: session.user.id, name: session.user.name, email: session.user.email }
  const requested = requestedOrganizationId(request)
  const rows = await activeMemberships(user.id)

  const selected = requested ? rows.find((row) => row.organization.id === requested) : rows[0]

  if (requested && !selected) {
    throw ApiError.forbidden('You are not an active member of that organization.')
  }
  if (!selected) return { user, context: null }

  const role = selected.membership.role as RoleName
  return {
    user,
    context: {
      user,
      organization: selected.organization,
      membership: selected.membership,
      role,
      capabilities: capabilitiesFor(role),
    },
  }
}

/** Resolves the caller, returning `null` when there is no session. */
export async function optionalAuthContext(request: NextRequest): Promise<AuthResult | null> {
  return resolveSession(request)
}

/**
 * Resolves the caller and guarantees they belong to an organization with the
 * required capability. Throws 401/403 otherwise.
 */
export async function requireAuthContext(
  request: NextRequest,
  options: { capability?: Capability } = {},
): Promise<AuthContext> {
  const result = await resolveSession(request)
  if (!result) throw ApiError.unauthorized()

  if (!result.context) {
    throw new ApiError(403, 'forbidden', 'Your account is not linked to an organization yet.', {
      reason: 'organization_required',
    })
  }

  const context = result.context
  if (options.capability && !hasCapability(context.role, options.capability)) {
    throw ApiError.forbidden(`Your role (${context.role}) cannot perform this action.`)
  }

  return context
}

/** Narrows the optional context returned by `createRoute` for required-auth routes. */
export function assertContext(auth: AuthContext | null): AuthContext {
  if (!auth) throw ApiError.unauthorized()
  return auth
}

/** Narrows the optional session user returned by `createRoute` for `session` routes. */
export function assertUser(user: { id: string; name: string; email: string } | null) {
  if (!user) throw ApiError.unauthorized()
  return user
}
