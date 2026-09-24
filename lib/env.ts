import { z } from 'zod'

/**
 * Server-only environment contract.
 *
 * Every server module (database, auth, API routes, scripts) reads configuration
 * through this module so that misconfiguration fails fast with a readable error
 * instead of producing undefined behaviour at request time.
 *
 * Never import this module from a `'use client'` component.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * TLS for the pool comes from the `sslmode` parameter in this URL, not from a
   * separate setting: node-postgres merges the parsed connection string over the
   * pool options, so an `ssl` object sourced from the environment would be
   * silently ignored. Use `sslmode=verify-full` for managed Postgres.
   */
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
  /** Signing secret for session cookies. Must be high entropy (32+ bytes). */
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().min(1).default('http://localhost:3000'),
  /** Comma separated extra origins allowed to call the auth + API routes. */
  AUTH_TRUSTED_ORIGINS: z.string().default(''),
  /** Pepper used when hashing request IPs for rate limiting and abuse forensics. */
  IP_HASH_SECRET: z.string().min(16).optional(),
  /**
   * Comma separated emails allowed to use the platform (staff) surface, e.g.
   * inbound contact-form leads. Deliberately unset by default: platform routes
   * then fail closed and nobody can reach them.
   */
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
  /**
   * Root key used to seal tenant connector credentials with AES-256-GCM
   * (see lib/connectors/secret.ts). 32+ characters. Unset means connectors
   * cannot store a credential and any sync that needs one fails closed —
   * nothing is ever written in plaintext.
   */
  INTEGRATION_SECRET_KEY: z.string().default(''),
  /**
   * Opt-in for connectors that must reach a system on a private network, such as
   * an on-premise ERP or a Zoho instance on the office LAN. Off by default so a
   * tenant cannot point this server at its own network (SSRF).
   */
  INTEGRATION_ALLOW_PRIVATE_NETWORKS: z.enum(['true', 'false']).default('false'),
  /**
   * Shared secret for the scheduled-sync entrypoint (`x-cron-secret`). Empty
   * disables that endpoint entirely, so a deployment that never sets it exposes
   * no machine-triggerable surface.
   */
  SYNC_CRON_SECRET: z.string().default(''),
})

export type Env = z.infer<typeof envSchema>

/** Matches `sslmode=` in a connection string's query string. */
const HAS_SSLMODE = /[?&]sslmode=/

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid server environment configuration:\n${issues}`)
  }
  const value = parsed.data
  if (value.NODE_ENV === 'production' && !HAS_SSLMODE.test(value.DATABASE_URL)) {
    // Not fatal for a self-hosted server on a private network, but loud enough to
    // catch a managed database being reached without TLS.
    console.warn(
      '[env] DATABASE_URL has no sslmode in production. Use sslmode=verify-full for managed Postgres.',
    )
  }
  return value
}

export const env: Env = loadEnv()

/** Origins that may call authenticated endpoints (used for CSRF/origin checks). */
export function trustedOrigins(): string[] {
  const configured = [env.BETTER_AUTH_URL, ...env.AUTH_TRUSTED_ORIGINS.split(',')]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  const origins = new Set(configured.map((origin) => normaliseOrigin(origin)))
  if (env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:3000')
  }
  return [...origins]
}

/** Reduces an origin/URL to `scheme://host[:port]` so comparisons are stable. */
export function normaliseOrigin(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return value.replace(/\/+$/, '')
  }
}

export function ipHashSecret(): string {
  return env.IP_HASH_SECRET ?? env.BETTER_AUTH_SECRET
}

/**
 * Emails allowed to reach the platform (staff) surface.
 *
 * This is an environment allowlist rather than a database role so that nobody
 * can self-serve into it through the product, and so that an unset value fails
 * closed instead of silently granting access.
 */
export function platformAdminEmails(): Set<string> {
  return new Set(
    env.PLATFORM_ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  )
}

/** True when the address belongs to the ReorderIQ platform team. */
export function isPlatformAdmin(email: string): boolean {
  return platformAdminEmails().has(email.trim().toLowerCase())
}

/**
 * Shared secret for the scheduled-sync endpoint. Empty means "not configured",
 * which the route turns into a refusal rather than an open door.
 */
export function syncCronSecret(): string {
  return env.SYNC_CRON_SECRET.trim()
}
