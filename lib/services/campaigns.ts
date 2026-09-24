import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type {
  campaignCreateSchema,
  campaignDispatchSchema,
  campaignListQuerySchema,
  campaignUpdateSchema,
  messageCreateSchema,
  messageListQuerySchema,
} from '@/lib/api/contracts'
import type { CampaignDto, MessageDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { toCampaignDto, toMessageDto } from '@/lib/db/mappers'
import { chunk } from '@/lib/db/query-utils'
import { campaignRecipients, campaigns, customers, messages } from '@/lib/db/schema'
import type { Paginated } from './customers'
import { resolveAudience } from './insights'

type CreateInput = z.infer<typeof campaignCreateSchema>
type UpdateInput = z.infer<typeof campaignUpdateSchema>
type ListQuery = z.infer<typeof campaignListQuerySchema>
type DispatchInput = z.infer<typeof campaignDispatchSchema>
type MessageCreate = z.infer<typeof messageCreateSchema>
type MessageListQuery = z.infer<typeof messageListQuerySchema>

const DEFAULT_TEMPLATE =
  'Hi {{first_name}}, it looks like you may be ready to reorder {{product_name}}. Would you like us to prepare your usual order?'

async function recipientCounts(campaignIds: string[]) {
  const counts = new Map<string, { recipients: number; sent: number }>()
  if (!campaignIds.length) return counts
  for (const group of chunk(campaignIds)) {
    const rows = await db
      .select({
        campaignId: campaignRecipients.campaignId,
        recipients: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${campaignRecipients.status} in ('SENT','CONVERTED'))::int`,
      })
      .from(campaignRecipients)
      .where(inArray(campaignRecipients.campaignId, group))
      .groupBy(campaignRecipients.campaignId)
    for (const row of rows) counts.set(row.campaignId, { recipients: row.recipients, sent: row.sent })
  }
  return counts
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => values[key] ?? match).slice(0, 4000)
}

export async function listCampaigns(context: AuthContext, query: ListQuery): Promise<Paginated<CampaignDto>> {
  const conditions = [eq(campaigns.organizationId, context.organization.id)]
  if (query.status) conditions.push(eq(campaigns.status, query.status))

  const rows = await db
    .select()
    .from(campaigns)
    .where(and(...conditions))
    .orderBy(desc(campaigns.createdAt))
    .limit(query.limit)

  const counts = await recipientCounts(rows.map((row) => row.id))

  return {
    items: rows.map((row) => toCampaignDto(row, counts.get(row.id) ?? { recipients: 0, sent: 0 })),
    pagination: { limit: query.limit, cursor: null, nextCursor: null, total: rows.length },
  }
}

export async function createCampaign(
  context: AuthContext,
  input: CreateInput,
  options: { ipHash?: string } = {},
): Promise<CampaignDto> {
  const [row] = await db
    .insert(campaigns)
    .values({
      organizationId: context.organization.id,
      name: input.name,
      type: input.type,
      channel: input.channel,
      messageTemplate: input.messageTemplate ?? DEFAULT_TEMPLATE,
      audienceFilter: input.audienceFilter,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
      createdByUserId: context.user.id,
    })
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'campaign.created',
    entityType: 'campaign',
    entityId: row.id,
    metadata: { name: row.name, channel: row.channel },
    ipHash: options.ipHash ?? null,
  })

  return toCampaignDto(row, { recipients: 0, sent: 0 })
}

export async function updateCampaign(
  context: AuthContext,
  campaignId: string,
  input: UpdateInput,
  options: { ipHash?: string } = {},
): Promise<CampaignDto> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) patch.name = input.name
  if (input.status !== undefined) patch.status = input.status
  if (input.channel !== undefined) patch.channel = input.channel
  if (input.messageTemplate !== undefined) patch.messageTemplate = input.messageTemplate
  if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
  if (input.audienceFilter !== undefined) patch.audienceFilter = input.audienceFilter

  const [row] = await db
    .update(campaigns)
    .set(patch)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organizationId, context.organization.id)))
    .returning()

  if (!row) throw ApiError.notFound('That campaign does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'campaign.updated',
    entityType: 'campaign',
    entityId: row.id,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  const counts = await recipientCounts([row.id])
  return toCampaignDto(row, counts.get(row.id) ?? { recipients: 0, sent: 0 })
}

/**
 * Queues the campaign for its audience.
 *
 * Messages are stored with the DEMO provider: no external gateway is called, so
 * nothing can reach a real customer from this environment. Swapping in a real
 * provider is a single adapter change.
 */
export async function dispatchCampaign(
  context: AuthContext,
  campaignId: string,
  input: DispatchInput,
  options: { ipHash?: string } = {},
): Promise<{ campaign: CampaignDto; queued: number; skipped: number }> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organizationId, context.organization.id)))
    .limit(1)

  if (!campaign) throw ApiError.notFound('That campaign does not exist in this organization.')
  if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
    throw ApiError.unprocessable('This campaign has already finished.')
  }

  const audience = (await resolveAudience(context.organization.id, campaign.audienceFilter)).slice(0, input.limit)
  const now = new Date()
  let queued = 0
  let skipped = 0

  for (const group of chunk(audience, 100)) {
    const inserted = await db
      .insert(campaignRecipients)
      .values(
        group.map((insight) => ({
          organizationId: context.organization.id,
          campaignId: campaign.id,
          customerId: insight.id,
          status: 'SENT' as const,
          sentAt: now,
        })),
      )
      .onConflictDoNothing({ target: [campaignRecipients.campaignId, campaignRecipients.customerId] })
      .returning({ id: campaignRecipients.id, customerId: campaignRecipients.customerId })

    skipped += group.length - inserted.length
    queued += inserted.length

    if (inserted.length) {
      await db.insert(messages).values(
        inserted.map((recipient) => {
          const insight = group.find((item) => item.id === recipient.customerId)
          return {
            organizationId: context.organization.id,
            customerId: recipient.customerId,
            campaignId: campaign.id,
            channel: campaign.channel,
            direction: 'OUTBOUND' as const,
            status: 'SENT' as const,
            provider: 'DEMO' as const,
            body: renderTemplate(campaign.messageTemplate ?? DEFAULT_TEMPLATE, {
              first_name: insight?.name.split(' ')[0] ?? 'there',
              product_name: insight?.recommendedProducts[0] ?? 'your usual order',
            }),
            sentAt: now,
          }
        }),
      )
    }
  }

  const [updated] = await db
    .update(campaigns)
    .set({ status: 'COMPLETED', startedAt: campaign.startedAt ?? now, completedAt: now, updatedAt: now })
    .where(eq(campaigns.id, campaign.id))
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'campaign.dispatched',
    entityType: 'campaign',
    entityId: campaign.id,
    metadata: { queued, skipped, channel: campaign.channel },
    ipHash: options.ipHash ?? null,
  })

  const counts = await recipientCounts([campaign.id])
  return {
    campaign: toCampaignDto(updated, counts.get(campaign.id) ?? { recipients: 0, sent: 0 }),
    queued,
    skipped,
  }
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export async function listMessages(context: AuthContext, query: MessageListQuery): Promise<Paginated<MessageDto>> {
  const conditions = [eq(messages.organizationId, context.organization.id)]
  if (query.customerId) conditions.push(eq(messages.customerId, query.customerId))
  if (query.campaignId) conditions.push(eq(messages.campaignId, query.campaignId))

  const rows = await db
    .select({ message: messages, customerName: customers.name })
    .from(messages)
    .innerJoin(customers, eq(customers.id, messages.customerId))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(query.limit)

  return {
    items: rows.map((row) => toMessageDto(row.message, row.customerName)),
    pagination: { limit: query.limit, cursor: null, nextCursor: null, total: rows.length },
  }
}

/**
 * Records a manual message.
 *
 * Outbound messages are stored as QUEUED with the DEMO provider: the delivery
 * worker (not this request) is responsible for talking to WhatsApp or an SMS
 * gateway, which keeps request latency predictable and provider failures
 * retryable.
 */
export async function createMessage(
  context: AuthContext,
  input: MessageCreate,
  options: { ipHash?: string } = {},
): Promise<MessageDto> {
  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, context.organization.id)))
    .limit(1)

  if (!customer) throw ApiError.unprocessable('That customer does not exist in this organization.')

  if (input.campaignId) {
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.organizationId, context.organization.id)))
      .limit(1)
    if (!campaign) throw ApiError.unprocessable('That campaign does not exist in this organization.')
  }

  const isOutbound = input.direction === 'OUTBOUND'
  const [row] = await db
    .insert(messages)
    .values({
      organizationId: context.organization.id,
      customerId: input.customerId,
      campaignId: input.campaignId ?? null,
      channel: input.channel,
      direction: input.direction,
      status: isOutbound ? 'QUEUED' : 'RECEIVED',
      provider: 'DEMO',
      body: input.body,
      sentAt: isOutbound ? null : new Date(),
    })
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'message.created',
    entityType: 'message',
    entityId: row.id,
    metadata: { channel: row.channel, direction: row.direction },
    ipHash: options.ipHash ?? null,
  })

  return toMessageDto(row, customer.name)
}