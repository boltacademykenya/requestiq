import { assertContext } from '@/lib/api/context'
import { integrationCredentialSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { setIntegrationCredential } from '@/lib/services/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Stores (or clears) the credential for a connection.
 *
 * Write-only by design: the value is sealed with AES-256-GCM before it reaches
 * the database, and no endpoint ever returns it — responses carry
 * `hasCredential` instead. Sending `credential: null` removes it.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  body: integrationCredentialSchema,
  maxBytes: 16 * 1024,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const context = assertContext(auth)
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    return ok(await setIntegrationCredential(context, integrationId, body.credential, { ipHash }), requestId)
  },
})
