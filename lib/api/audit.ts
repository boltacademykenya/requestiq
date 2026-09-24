import { db } from '@/lib/db/client'
import { auditLogs } from '@/lib/db/schema'

/**
 * Append-only audit trail for tenant mutations.
 *
 * Audit writes never break a request: failures are logged and swallowed.
 */
export type AuditEvent = {
  organizationId: string | null
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
  ipHash?: string | null
}

export async function writeAuditLog(event: AuditEvent) {
  try {
    await db.insert(auditLogs).values({
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: event.metadata ?? {},
      ipHash: event.ipHash ?? null,
    })
  } catch (error) {
    console.error('[audit] failed to record event', event.action, error instanceof Error ? error.message : error)
  }
}
