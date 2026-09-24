import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Liveness + database readiness probe used by deployments and smoke tests. */
export const GET = createRoute({
  auth: 'public',
  handler: async ({ requestId }) => {
    const started = Date.now()
    const [row] = await db.execute<{ version: string; now: Date }>(
      sql`select version() as version, now() as now`,
    ).then((result) => result.rows)
    return ok(
      {
        status: 'ok',
        database: 'reachable',
        latencyMs: Date.now() - started,
        serverTime: row?.now instanceof Date ? row.now.toISOString() : new Date().toISOString(),
        postgres: row?.version?.split(' ').slice(0, 2).join(' ') ?? 'unknown',
      },
      requestId,
    )
  },
})
