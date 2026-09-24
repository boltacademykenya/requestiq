import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { ipHashSecret } from '@/lib/env'

/**
 * Request identity helpers used by rate limiting and the audit trail.
 *
 * NOTE: `x-forwarded-for` is only trustworthy when a reverse proxy overwrites
 * it. Deployments behind Vercel/nginx-style proxies should also strip inbound
 * values for these headers, otherwise an attacker could rotate identities.
 */
export function clientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

/** Stable, non-reversible IP fingerprint (never store raw client IPs). */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${ip}::${ipHashSecret()}`).digest('hex')
}

export function userAgentOf(request: NextRequest): string | null {
  const value = request.headers.get('user-agent')
  return value ? value.slice(0, 300) : null
}
