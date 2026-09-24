import { contactSchema } from '@/lib/api/contracts'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { clientIp, userAgentOf } from '@/lib/api/request-identity'
import { createRoute } from '@/lib/api/route'
import { created } from '@/lib/api/response'
import { submitContact } from '@/lib/services/leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public contact form endpoint.
 *
 * Protections: strict schema (honeypot field, length bounds, control character
 * rejection), per-IP rate limiting, duplicate suppression and IP hashing.
 */
export const POST = createRoute({
  auth: 'public',
  body: contactSchema,
  rateLimit: RATE_LIMITS.contact,
  handler: async ({ body, requestId, request }) => {
    const result = await submitContact(body, { ip: clientIp(request), userAgent: userAgentOf(request) })
    return created(
      {
        id: result.id,
        receivedAt: result.createdAt.toISOString(),
        message: result.duplicate
          ? 'We already have your message and our team is on it.'
          : 'Thanks. Your message reached the ReorderIQ team and we will reply within one business day.',
      },
      requestId,
    )
  },
})
