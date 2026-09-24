'use client'

import { useCallback, useState } from 'react'
import { authClient } from '@/lib/auth-client'

/**
 * Sign-out shared by the account menu (workspace header) and the compact button
 * on the staff surface.
 *
 * What "signed out" means here, in order:
 *  1. `POST /api/auth/sign-out` deletes the session row in PostgreSQL, so the
 *     session is revoked at the source rather than only hidden in the browser.
 *  2. better-auth expires `session_token` *and* the `session_data` cookie cache,
 *     so this browser cannot present a stale cached session either.
 *  3. The browser replaces the current history entry with the sign-in page. That
 *     last step is a full navigation on purpose: it discards every client-side
 *     cache (router payloads, React state, in-memory session copies) and `replace`
 *     keeps the authenticated route out of the back/forward stack.
 *
 * Scope of revocation: the database row is gone, but better-auth's signed session
 * cookie cache (`session.cookieCache` in `lib/auth.ts`) answers `getSession`
 * without a database read for up to five minutes. This browser is unaffected —
 * both cookies are cleared — yet a cookie pair *copied* before sign-out stays
 * accepted until that cache expires. Turning the cache off
 * (`session: { cookieCache: { enabled: false } }`) closes that window at the cost
 * of a session read per request.
 *
 * `?signedOut=1` lets the sign-in page confirm the action — landing on a bare
 * login form after clicking "Sign out" otherwise looks like a failure.
 */
const SIGNED_OUT_PATH = '/sign-in?signedOut=1'

/** Maps better-auth failures to something the user can act on. */
function describeSignOutError(error: { code?: string; message?: string }) {
  switch (error.code) {
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'SESSION_EXPIRED':
    case 'INVALID_SESSION_TOKEN':
      // The session is already unusable, so the local cookies are the only thing
      // left behind: clearing them is a reload away.
      return 'Your session had already expired. Reload the page to finish signing out.'
    default:
      return 'We could not sign you out. Check your connection and try again.'
  }
}

export function useSignOut() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOut = useCallback(async () => {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      const result = await authClient.signOut()
      if (result.error) {
        setError(describeSignOutError(result.error))
        setPending(false)
        return
      }

      // Success: the page is about to unload, so `pending` stays true and every
      // control that could fire a second request stays disabled.
      window.location.replace(SIGNED_OUT_PATH)
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }, [pending])

  return { signOut, pending, error }
}
