import type { ConnectorConfig } from './config'

/**
 * Turns a connector config plus a credential into an actual outbound request.
 *
 * A leading "/" in a resource path is relative to `baseUrl`, not to the host, so
 * `baseUrl=https://host/inventory/v1` + `path=/contacts` means
 * `https://host/inventory/v1/contacts` — which is how provider docs read.
 */

export function resolveEndpoint(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const trimmedPath = path.trim()
  const url = /^https?:\/\//i.test(trimmedPath)
    ? new URL(trimmedPath)
    : new URL(trimmedPath.replace(/^\/+/, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export type AuthType = ConnectorConfig['auth']['type']

/** True when the connector cannot call anything without a stored credential. */
export function requiresCredential(auth: ConnectorConfig['auth']): boolean {
  return auth.type !== 'none'
}

/** Headers that carry the credential (never logged, never returned to the client). */
export function authHeaders(auth: ConnectorConfig['auth'], credential: string | null): Record<string, string> {
  if (!credential || auth.type === 'none' || auth.type === 'query') return {}
  if (auth.type === 'bearer') return { authorization: `Bearer ${credential}` }
  if (auth.type === 'header' && auth.header) return { [auth.header.toLowerCase()]: credential }
  if (auth.type === 'basic') {
    return { authorization: `Basic ${Buffer.from(`${auth.username ?? ''}:${credential}`, 'utf8').toString('base64')}` }
  }
  return {}
}

/** Query parameters that carry the credential (some APIs only accept them there). */
export function authQuery(auth: ConnectorConfig['auth'], credential: string | null): Record<string, string> {
  if (!credential || auth.type !== 'query' || !auth.param) return {}
  return { [auth.param]: credential }
}

/** One line the UI shows so the operator knows what the credential is used for. */
export function describeAuth(auth: ConnectorConfig['auth']): string {
  switch (auth.type) {
    case 'bearer':
      return 'Sent as Authorization: Bearer <credential>.'
    case 'header':
      return `Sent in the ${auth.header ?? '…'} header, exactly as entered.`
    case 'basic':
      return `Sent as HTTP Basic, username "${auth.username ?? '…'}". The credential is the second part.`
    case 'query':
      return `Sent as the "${auth.param ?? '…'}" query parameter.`
    default:
      return 'No credential is sent. Only use this for a public endpoint.'
  }
}
