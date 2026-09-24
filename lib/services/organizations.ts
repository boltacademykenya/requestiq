import { and, asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import { capabilitiesFor, type Capability, type RoleName } from '@/lib/api/capabilities'
import type { AuthContext } from '@/lib/api/context'
import type { memberCreateSchema, memberUpdateSchema, onboardingSchema, organizationPatchSchema } from '@/lib/api/contracts'
import type { MemberDto, OrganizationDto, SessionDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { toMemberDto, toOrganizationDto } from '@/lib/db/mappers'
import { members, organizations, subscriptions, user } from '@/lib/db/schema'
import { PLANS } from './plans'

type OnboardingInput = z.infer<typeof onboardingSchema>
type OrganizationPatch = z.infer<typeof organizationPatchSchema>
type MemberCreate = z.infer<typeof memberCreateSchema>
type MemberUpdate = z.infer<typeof memberUpdateSchema>

const STAFF_ROLES: RoleName[] = ['OWNER', 'ADMIN', 'ANALYST', 'SALES']

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

/** Slugs are unique per platform; collisions get a short random suffix. */
async function uniqueSlug(name: string) {
  const base = slugify(name) || 'workspace'
  const candidates = [base, `${base}-${Math.random().toString(36).slice(2, 6)}`, `${base}-${Date.now().toString(36)}`]
  for (const candidate of candidates) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1)
    if (!existing) return candidate
  }
  throw ApiError.conflict('Could not allocate a unique workspace identifier.')
}

/**
 * Creates the tenant for a freshly registered user.
 *
 * Idempotent: calling it again returns the existing organization instead of
 * creating duplicates, so a double submit cannot fork a workspace.
 */
export async function onboardOrganization(
  actor: { id: string; name: string; email: string },
  input: OnboardingInput,
  options: { ipHash?: string } = {},
): Promise<{ organization: OrganizationDto; role: RoleName; created: boolean; subscriptionPlan: string }> {
  const [existing] = await db
    .select({ organization: organizations, role: members.role })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(eq(members.userId, actor.id))
    .orderBy(asc(organizations.createdAt))
    .limit(1)

  if (existing) {
    return {
      organization: toOrganizationDto(existing.organization),
      role: existing.role as RoleName,
      created: false,
      subscriptionPlan: input.plan,
    }
  }

  const plan = PLANS[input.plan]
  const slug = await uniqueSlug(input.organizationName)
  const periodStart = new Date()
  const periodEnd = new Date(periodStart.getTime() + 30 * 86_400_000)

  const organization = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({
        name: input.organizationName,
        slug,
        industry: input.industry ?? 'General',
        country: input.country ?? 'Kenya',
        currency: input.currency ?? 'KES',
        ownerUserId: actor.id,
      })
      .returning()

    await tx.insert(members).values({ organizationId: row.id, userId: actor.id, role: 'OWNER', status: 'ACTIVE' })
    await tx.insert(subscriptions).values({
      organizationId: row.id,
      plan: input.plan,
      status: 'TRIALING',
      paymentProvider: plan.paymentProvider,
      seats: 1,
      amount: plan.price,
      currency: input.currency ?? 'KES',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })

    return row
  })

  await writeAuditLog({
    organizationId: organization.id,
    actorUserId: actor.id,
    action: 'organization.created',
    entityType: 'organization',
    entityId: organization.id,
    metadata: { name: organization.name, slug: organization.slug, plan: input.plan },
    ipHash: options.ipHash ?? null,
  })

  return {
    organization: toOrganizationDto(organization),
    role: 'OWNER',
    created: true,
    subscriptionPlan: input.plan,
  }
}

export async function loadOrganization(context: AuthContext): Promise<OrganizationDto> {
  return toOrganizationDto(context.organization)
}

export async function updateOrganization(
  context: AuthContext,
  patch: OrganizationPatch,
  options: { ipHash?: string } = {},
): Promise<OrganizationDto> {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.name !== undefined) update.name = patch.name
  if (patch.industry !== undefined) update.industry = patch.industry
  if (patch.country !== undefined) update.country = patch.country
  if (patch.currency !== undefined) update.currency = patch.currency
  if (patch.timezone !== undefined) update.timezone = patch.timezone

  const [row] = await db
    .update(organizations)
    .set(update)
    .where(eq(organizations.id, context.organization.id))
    .returning()

  if (!row) throw ApiError.notFound('That organization does not exist.')

  await writeAuditLog({
    organizationId: row.id,
    actorUserId: context.user.id,
    action: 'organization.updated',
    entityType: 'organization',
    entityId: row.id,
    metadata: { fields: Object.keys(update).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  return toOrganizationDto(row)
}

export function buildSessionDto(
  context: AuthContext | null,
  user: { id: string; name: string; email: string },
): SessionDto {
  return {
    user,
    organization: context ? toOrganizationDto(context.organization) : null,
    role: context?.role ?? null,
    capabilities: context ? capabilitiesFor(context.role) : ([] as Capability[]),
  }
}

/* -------------------------------------------------------------------------- */
/* Team members                                                               */
/* -------------------------------------------------------------------------- */

export async function listMembers(context: AuthContext): Promise<MemberDto[]> {
  const rows = await db
    .select({ membership: members, account: { id: user.id, name: user.name, email: user.email } })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(eq(members.organizationId, context.organization.id))
    .orderBy(asc(members.createdAt))

  return rows.map((row) => toMemberDto(row.membership, row.account))
}

/**
 * Adds an existing ReorderIQ user to the organization.
 * Email invitations require an email provider, so unknown emails are rejected
 * with an actionable message instead of creating orphan records.
 */
export async function addMember(
  context: AuthContext,
  input: MemberCreate,
  options: { ipHash?: string } = {},
): Promise<MemberDto> {
  const [account] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(sql`lower(${user.email}) = ${input.email}`)
    .limit(1)

  if (!account) {
    throw ApiError.notFound('That person does not have a ReorderIQ account yet. Ask them to sign up first.')
  }

  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.organizationId, context.organization.id), eq(members.userId, account.id)))
    .limit(1)

  if (existing) throw ApiError.conflict('That person is already a member of this organization.')

  const [row] = await db
    .insert(members)
    .values({
      organizationId: context.organization.id,
      userId: account.id,
      role: input.role,
      status: 'ACTIVE',
    })
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'member.added',
    entityType: 'member',
    entityId: row.id,
    metadata: { email: account.email, role: row.role },
    ipHash: options.ipHash ?? null,
  })

  return toMemberDto(row, account)
}

async function countOwners(organizationId: string) {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(members)
    .where(and(eq(members.organizationId, organizationId), eq(members.role, 'OWNER')))
  return row?.value ?? 0
}

export async function updateMember(
  context: AuthContext,
  memberId: string,
  input: MemberUpdate,
  options: { ipHash?: string } = {},
): Promise<MemberDto> {
  const [target] = await db
    .select({ membership: members, account: { id: user.id, name: user.name, email: user.email } })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(and(eq(members.id, memberId), eq(members.organizationId, context.organization.id)))
    .limit(1)

  if (!target) throw ApiError.notFound('That team member does not exist in this organization.')

  const nextRole = input.role ?? target.membership.role
  if (nextRole === 'OWNER' && context.role !== 'OWNER') {
    throw ApiError.forbidden('Only an owner can grant ownership.')
  }
  if (
    target.membership.role === 'OWNER' &&
    nextRole !== 'OWNER' &&
    (await countOwners(context.organization.id)) <= 1
  ) {
    throw ApiError.unprocessable('An organization must keep at least one owner.')
  }
  if (!STAFF_ROLES.includes(nextRole)) throw ApiError.unprocessable('Unknown role.')

  const [row] = await db
    .update(members)
    .set({
      role: nextRole,
      status: input.status ?? target.membership.status,
      updatedAt: new Date(),
    })
    .where(and(eq(members.id, memberId), eq(members.organizationId, context.organization.id)))
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'member.updated',
    entityType: 'member',
    entityId: row.id,
    metadata: { role: row.role, status: row.status },
    ipHash: options.ipHash ?? null,
  })

  return toMemberDto(row, target.account)
}

export async function removeMember(
  context: AuthContext,
  memberId: string,
  options: { ipHash?: string } = {},
): Promise<{ id: string; removed: true }> {
  const [target] = await db
    .select({ membership: members, email: user.email })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(and(eq(members.id, memberId), eq(members.organizationId, context.organization.id)))
    .limit(1)

  if (!target) throw ApiError.notFound('That team member does not exist in this organization.')
  if (target.membership.userId === context.user.id) {
    throw ApiError.unprocessable('You cannot remove your own membership.')
  }
  if (target.membership.role === 'OWNER' && (await countOwners(context.organization.id)) <= 1) {
    throw ApiError.unprocessable('An organization must keep at least one owner.')
  }

  await db.delete(members).where(and(eq(members.id, memberId), eq(members.organizationId, context.organization.id)))

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'member.removed',
    entityType: 'member',
    entityId: memberId,
    metadata: { email: target.email },
    ipHash: options.ipHash ?? null,
  })

  return { id: memberId, removed: true }
}