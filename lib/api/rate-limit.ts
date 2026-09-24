import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { rateLimitCounters } from '@/lib/db/schema'
import { ApiError } from './errors'

/**
 * Durable fixed-window rate limiting.
 *
 * Counters live in PostgreSQL so limits hold across processes and deploys,
 * and the window increment is a single atomic upsert (safe under concurrency).
 */
export type RateLimitPolicy = {
  name: string
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  /** Public contact form submissions. */
  contact: { name: 'contact', limit: 5, windowSeconds: 600 },
  /** Authenticated API traffic per user. */
  api: { name: 'api', limit: 300, windowSeconds: 60 },
  /** Mutations per user. */
  mutation: { name: 'mutation', limit: 60, windowSeconds: 60 },
  /** Failed/sensitive endpoints such as onboarding. */
  onboarding: { name: 'onboarding', limit: 10, windowSeconds: 3600 },
  /** Connector sync runs. A run reads the whole source, so it is expensive. */
  integrationSync: { name: 'integration_sync', limit: 6, windowSeconds: 300 },
  /** Connector mapping dry-runs; each one makes a single outbound request. */
  integrationPreview: { name: 'integration_preview', limit: 30, windowSeconds: 300 },
  /** Connection probes ("Test connection"); each one makes a single outbound request. */
  integrationTest: { name: 'integration_test', limit: 30, windowSeconds: 300 },
} satisfies Record<string, RateLimitPolicy>

export type RateLimitResult = { limit: number; remaining: number; resetAt: Date }

function windowStart(policy: RateLimitPolicy, now: Date) {
  const windowMs = policy.windowSeconds * 1000
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs)
}

export async function enforceRateLimit(policy: RateLimitPolicy, identifier: string): Promise<RateLimitResult> {
  const now = new Date()
  const start = windowStart(policy, now)
  const resetAt = new Date(start.getTime() + policy.windowSeconds * 1000)
  const bucket = `${policy.name}:${identifier}`

  const [row] = await db
    .insert(rateLimitCounters)
    .values({ bucket, windowStart: start, hits: 1, expiresAt: resetAt })
    .onConflictDoUpdate({
      target: [rateLimitCounters.bucket, rateLimitCounters.windowStart],
      set: { hits: sql`${rateLimitCounters.hits} + 1` },
    })
    .returning({ hits: rateLimitCounters.hits })

  const hits = row?.hits ?? 1

  // Opportunistic cleanup keeps the table small without a scheduled job.
  if (Math.random() < 0.01) {
    await db
      .delete(rateLimitCounters)
      .where(and(lt(rateLimitCounters.expiresAt, new Date(now.getTime() - 86_400_000))))
      .catch(() => undefined)
  }

  if (hits > policy.limit) {
    throw ApiError.tooManyRequests(
      'Too many requests. Please wait a moment and try again.',
      (resetAt.getTime() - now.getTime()) / 1000,
    )
  }

  return { limit: policy.limit, remaining: Math.max(0, policy.limit - hits), resetAt }
}

export async function resetRateLimit(policy: Pick<RateLimitPolicy, 'name'>, identifier: string) {
  await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucket, `${policy.name}:${identifier}`))
}
