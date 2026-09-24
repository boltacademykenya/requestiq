import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { subscriptionUpdateSchema } from '@/lib/api/contracts'
import type { SubscriptionDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { toSubscriptionDto } from '@/lib/db/mappers'
import { subscriptions, type SubscriptionRow } from '@/lib/db/schema'
import { planFor } from './plans'
import { eq } from 'drizzle-orm'

type UpdateInput = z.infer<typeof subscriptionUpdateSchema>

/**
 * Returns the organization subscription, creating a trial when it is missing so
 * the billing screen always renders a consistent state.
 */
export async function ensureSubscription(organizationId: string): Promise<SubscriptionRow> {
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1)
  if (existing) return existing

  const plan = planFor('SMALL')
  const start = new Date()
  const [row] = await db
    .insert(subscriptions)
    .values({
      organizationId,
      plan: 'SMALL',
      status: 'TRIALING',
      paymentProvider: plan.paymentProvider,
      seats: 1,
      amount: plan.price,
      currentPeriodStart: start,
      currentPeriodEnd: new Date(start.getTime() + 30 * 86_400_000),
    })
    .onConflictDoNothing({ target: subscriptions.organizationId })
    .returning()

  if (row) return row

  const [created] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1)
  if (!created) throw ApiError.internal('Could not initialise billing for this organization.')
  return created
}

export async function getSubscription(context: AuthContext): Promise<SubscriptionDto> {
  return toSubscriptionDto(await ensureSubscription(context.organization.id))
}

/**
 * Plan changes are applied server-side: the price always comes from the plan
 * catalogue, never from the request body.
 */
export async function updateSubscription(
  context: AuthContext,
  input: UpdateInput,
  options: { ipHash?: string } = {},
): Promise<SubscriptionDto> {
  const current = await ensureSubscription(context.organization.id)
  const plan = input.plan ? planFor(input.plan) : null
  const now = new Date()

  const [row] = await db
    .update(subscriptions)
    .set({
      ...(plan ? { plan: plan.id, amount: plan.price, paymentProvider: plan.paymentProvider } : {}),
      ...(input.seats !== undefined ? { seats: input.seats } : {}),
      ...(input.paymentProvider !== undefined ? { paymentProvider: input.paymentProvider } : {}),
      ...(input.cancelAtPeriodEnd !== undefined
        ? {
            cancelAtPeriodEnd: input.cancelAtPeriodEnd,
            status: input.cancelAtPeriodEnd ? ('CANCELLED' as const) : ('ACTIVE' as const),
            cancelledAt: input.cancelAtPeriodEnd ? now : null,
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(subscriptions.id, current.id))
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: plan ? 'billing.plan_changed' : 'billing.updated',
    entityType: 'subscription',
    entityId: row.id,
    metadata: {
      plan: row.plan,
      status: row.status,
      seats: row.seats,
      amount: Number(row.amount),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    },
    ipHash: options.ipHash ?? null,
  })

  return toSubscriptionDto(row)
}
