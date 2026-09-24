import { and, asc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { integrationCreateSchema, integrationUpdateSchema } from '@/lib/api/contracts'
import type { IntegrationDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { credentialsConfigured, encryptCredential } from '@/lib/connectors/secret'
import { db } from '@/lib/db/client'
import { toIntegrationDto } from '@/lib/db/mappers'
import { integrations, type IntegrationRow } from '@/lib/db/schema'

type CreateInput = z.infer<typeof integrationCreateSchema>
type UpdateInput = z.infer<typeof integrationUpdateSchema>

export async function listIntegrations(context: AuthContext): Promise<IntegrationDto[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.organizationId, context.organization.id))
    .orderBy(asc(integrations.provider))
  return rows.map(toIntegrationDto)
}

/**
 * Connects (or re-connects) a provider.
 *
 * Configuration here is never secret: the connector spec (endpoints, mapping)
 * lives in `connector`, and the credential travels separately through
 * `setIntegrationCredential` so it can be sealed before it reaches the database.
 * A (re)connection is scheduled immediately, so saving is enough to see data.
 *
 * **Identity is the connection, not the provider.** A tenant may run two Shopify
 * stores or two Zoho organizations, so `(organization_id, provider)` is no longer
 * unique — that older rule silently overwrote the first store when the second was
 * added. When the source tells us which account this is, `externalAccountId` is
 * the key; when it does not, the display name stands in, which keeps "save twice"
 * from creating two connections to the same system.
 */
export async function upsertIntegration(
  context: AuthContext,
  input: CreateInput,
  options: { ipHash?: string } = {},
): Promise<IntegrationDto> {
  const connector = input.connector ?? null
  const syncIntervalMinutes = input.syncIntervalMinutes ?? 360
  const displayName = input.displayName ?? input.provider
  const externalAccountId = input.externalAccountId ?? null

  const values = {
    organizationId: context.organization.id,
    provider: input.provider,
    status: input.status,
    displayName,
    config: input.config,
    connector,
    syncIntervalMinutes,
    nextSyncAt: connector ? new Date() : null,
    externalAccountId,
  }
  const patch = {
    status: input.status,
    displayName,
    config: input.config,
    connector,
    syncIntervalMinutes,
    nextSyncAt: connector ? new Date() : null,
    externalAccountId,
    lastError: null,
    updatedAt: new Date(),
  }

  let row: IntegrationRow | undefined
  if (externalAccountId) {
    ;[row] = await db
      .insert(integrations)
      .values(values)
      .onConflictDoUpdate({
        target: [integrations.organizationId, integrations.provider, integrations.externalAccountId],
        // Restates the partial index predicate; Postgres only infers a partial
        // index as a conflict target when the clause matches its `WHERE`.
        targetWhere: sql`${integrations.externalAccountId} is not null`,
        set: patch,
      })
      .returning()
  } else {
    const [existing] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.organizationId, context.organization.id),
          eq(integrations.provider, input.provider),
          // `display_name` is varchar and `provider` is an enum, so the enum has to
          // be cast: Postgres cannot plan `coalesce(varchar, enum)` at all
          // ("COALESCE types character varying and integration_provider cannot be
          // matched"), which failed every create with a 500.
          sql`coalesce(${integrations.displayName}, ${integrations.provider}::text) = ${displayName}`,
        ),
      )
      .limit(1)

    if (existing) {
      ;[row] = await db.update(integrations).set(patch).where(eq(integrations.id, existing.id)).returning()
    } else {
      ;[row] = await db.insert(integrations).values(values).returning()
    }
  }

  if (!row) throw ApiError.internal()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'integration.connected',
    entityType: 'integration',
    entityId: row.id,
    metadata: { provider: row.provider, status: row.status },
    ipHash: options.ipHash ?? null,
  })

  return toIntegrationDto(row)
}

export async function updateIntegration(
  context: AuthContext,
  integrationId: string,
  input: UpdateInput,
  options: { ipHash?: string } = {},
): Promise<IntegrationDto> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.config !== undefined) patch.config = input.config
  if (input.externalAccountId !== undefined) patch.externalAccountId = input.externalAccountId
  if (input.status !== undefined) patch.status = input.status
  if (input.lastError !== undefined) patch.lastError = input.lastError
  if (input.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = input.syncIntervalMinutes
  if (input.connector !== undefined) {
    patch.connector = input.connector
    // A changed mapping should be exercised now, not in six hours.
    patch.nextSyncAt = new Date()
  }

  const [row] = await db
    .update(integrations)
    .set(patch)
    .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, context.organization.id)))
    .returning()

  if (!row) throw ApiError.notFound('That integration does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'integration.updated',
    entityType: 'integration',
    entityId: row.id,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  return toIntegrationDto(row)
}

/**
 * Stores or clears the tenant credential.
 *
 * The value is sealed with AES-256-GCM (`lib/connectors/secret.ts`) and is never
 * returned by any endpoint — `IntegrationDto` only exposes `hasCredential`. An
 * unconfigured `INTEGRATION_SECRET_KEY` fails closed rather than writing the
 * credential in the clear.
 */
export async function setIntegrationCredential(
  context: AuthContext,
  integrationId: string,
  credential: string | null,
  options: { ipHash?: string } = {},
): Promise<IntegrationDto> {
  if (credential !== null && !credentialsConfigured()) {
    throw ApiError.serviceUnavailable(
      'Credential storage is not configured on this deployment. Set INTEGRATION_SECRET_KEY (32+ characters).',
    )
  }

  const [row] = await db
    .update(integrations)
    .set({
      secretCiphertext: credential === null ? null : encryptCredential(credential),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, context.organization.id)))
    .returning()

  if (!row) throw ApiError.notFound('That integration does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    // Only the fact of the change is recorded; the credential itself never is.
    action: credential === null ? 'integration.credential_cleared' : 'integration.credential_set',
    entityType: 'integration',
    entityId: row.id,
    metadata: { provider: row.provider },
    ipHash: options.ipHash ?? null,
  })

  return toIntegrationDto(row)
}

export async function removeIntegration(
  context: AuthContext,
  integrationId: string,
  options: { ipHash?: string } = {},
): Promise<{ id: string; removed: true }> {
  const [row] = await db
    .delete(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, context.organization.id)))
    .returning({ id: integrations.id, provider: integrations.provider })

  if (!row) throw ApiError.notFound('That integration does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'integration.removed',
    entityType: 'integration',
    entityId: row.id,
    metadata: { provider: row.provider },
    ipHash: options.ipHash ?? null,
  })

  return { id: row.id, removed: true }
}
