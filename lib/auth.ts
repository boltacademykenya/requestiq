import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/lib/db/client'
import * as schema from '@/lib/db/schema'
import { env, trustedOrigins } from '@/lib/env'

const secureCookies = env.BETTER_AUTH_URL.startsWith('https://')

if (!secureCookies && env.NODE_ENV === 'production') {
  console.warn(
    '[auth] BETTER_AUTH_URL is not HTTPS: session cookies are not marked Secure. Use an https:// base URL in production.',
  )
}

/**
 * better-auth instance.
 *
 * Security decisions:
 * - sessions live in PostgreSQL through the drizzle adapter (single source of truth)
 * - cookies are httpOnly + SameSite=Lax, and Secure whenever the app runs over HTTPS
 *   (browsers reject Secure cookies on http://, so the flag follows the base URL)
 * - passwords are hashed with better-auth's built-in scrypt implementation
 * - only explicitly trusted origins may talk to the auth endpoints
 * - brute force protection is enabled, with tighter rules on credential endpoints
 */
export const auth = betterAuth({
  appName: 'ReorderIQ',
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: trustedOrigins(),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    useSecureCookies: secureCookies,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 300, max: 10 },
      '/sign-up/email': { window: 3600, max: 10 },
    },
  },
})

export type AuthSession = typeof auth.$Infer.Session
