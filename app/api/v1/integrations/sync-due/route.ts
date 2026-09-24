import { syncDueSchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { runDueIntegrations } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** A batch of syncs is slower than a normal request; keep well inside the platform limit. */
export const maxDuration = 300

/**
 * Scheduled-sync entrypoint.
 *
 * Point any scheduler at this endpoint (Inngest, a cron container, cron-job.org):
 *
 *   curl -X POST https://…/api/v1/integrations/sync-due \
 *        -H 'x-cron-secret: …' -H 'content-type: application/json' -d '{}'
 *
 * Runs on demand rather than on a timer inside the app, so the same code path
 * serves a single VPS and a serverless deployment, and the scheduler is the only
 * thing that has to be reliable. `x-cron-secret` is compared in constant time and
 * an unset `SYNC_CRON_SECRET` disables the route entirely.
 */
export const POST = createRoute({
  auth: 'public',
  cronSecret: true,
  body: syncDueSchema,
  handler: async ({ body, requestId }) => {
    const outcome = await runDueIntegrations(body.limit)
    return ok(outcome, requestId)
  },
})
