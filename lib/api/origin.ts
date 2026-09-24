import type { NextRequest } from 'next/server'
import { normaliseOrigin, trustedOrigins } from '@/lib/env'
import { ApiError } from './errors'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * CSRF / cross-site request protection for cookie authenticated traffic.
 *
 * Session cookies are `SameSite=Lax`, so browsers do not attach them to
 * cross-site POSTs. This check adds defence in depth and blocks requests whose
 * `Origin` is not explicitly trusted.
 *
 * - `required` is true for cookie-authenticated mutations: a request without a
 *   trustworthy origin signal is rejected.
 * - for public endpoints only an explicitly untrusted `Origin` is rejected, so
 *   server-to-server callers (curl, webhooks) keep working.
 */
export function assertTrustedOrigin(request: NextRequest, options: { required: boolean }) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return

  const origin = request.headers.get('origin')
  const allowed = new Set(trustedOrigins())

  if (origin) {
    if (!allowed.has(normaliseOrigin(origin))) {
      throw ApiError.forbidden('This request was blocked because it came from an untrusted origin.')
    }
    return
  }

  if (!options.required) return

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite === 'same-origin' || fetchSite === 'none') return

  throw ApiError.forbidden('A trusted Origin header is required for this request.')
}
