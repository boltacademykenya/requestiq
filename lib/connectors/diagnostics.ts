import type { ConnectorHttpDto } from '@/lib/api/dto'
import type { HttpResponseCapture } from './fetch'

/**
 * Presents one outbound response to an operator.
 *
 * The point of a mapping test is to see what the endpoint answered — a 401 with
 * the provider's own error body, a 200 whose envelope is nested differently than
 * assumed, an HTML error page from a proxy. That is also why this module redacts
 * before anything crosses the wire:
 *
 * - header names that carry credentials (and `set-cookie`) are dropped entirely;
 * - JSON values under credential-looking keys are replaced, however they are spelt;
 * - the exact credential the request used is removed from the text wherever it is
 *   echoed back, which is the one value a provider is most likely to repeat;
 * - the body is capped, and `truncated` says so, because a diagnostic view must
 *   never become an export channel for a tenant's whole dataset.
 */

/** Enough body to read an envelope and its error message. */
const MAX_BODY_CHARS = 16_000
const MAX_HEADER_VALUE = 300
const MAX_HEADERS = 16
const MAX_REDACT_DEPTH = 12

/** Headers whose value is a credential, a session, or a mirror of one. */
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i

/** Keys that look like credentials; the same rule the connector schema applies. */
const SECRET_LIKE_KEY = /(secret|token|password|passwd|api[-_]?key|credential|private|passphrase)/i

/** Replaces credential-looking values with a marker, keeping the JSON readable. */
export function redactJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return '…'
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry, depth + 1))
  if (value === null || typeof value !== 'object') return value

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SECRET_LIKE_KEY.test(key) ? '[redacted]' : redactJson(entry, depth + 1)
  }
  return result
}

/** Removes the exact secrets this request sent, wherever the body repeats them. */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let result = text
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue
    result = result.split(secret).join('[redacted]')
  }
  return result
}

/** Drops credential-bearing headers and bounds the rest, so a header cannot smuggle a secret out. */
function presentHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = []
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER.test(name)) continue
    entries.push({ name, value: value.slice(0, MAX_HEADER_VALUE) })
    if (entries.length >= MAX_HEADERS) break
  }
  return entries
}

/**
 * Builds the wire shape. `secrets` are the credential values used for the request
 * (never the whole credential store), so an echoed token is redacted even when the
 * provider files it under an innocent key.
 */
export function presentHttpResponse(
  capture: HttpResponseCapture,
  options: { secrets?: Array<string | null | undefined> } = {},
): ConnectorHttpDto {
  const secrets = options.secrets ?? []
  let parsed: unknown = null
  let json = false

  if (!capture.truncated) {
    try {
      parsed = JSON.parse(capture.text) as unknown
      json = true
    } catch {
      json = false
    }
  }

  let body = json ? JSON.stringify(redactJson(parsed), null, 2) : capture.text
  body = redactSecrets(body, secrets)

  const truncated = capture.truncated || body.length > MAX_BODY_CHARS
  if (body.length > MAX_BODY_CHARS) body = body.slice(0, MAX_BODY_CHARS)

  return {
    endpoint: capture.url,
    status: capture.status,
    statusText: capture.statusMessage || null,
    contentType: capture.headers['content-type'] ?? null,
    durationMs: capture.durationMs,
    bytes: capture.bytes,
    headers: presentHeaders(capture.headers),
    body,
    truncated,
    json,
  }
}
