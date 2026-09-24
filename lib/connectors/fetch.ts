import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { ApiError } from '@/lib/api/errors'
import { env } from '@/lib/env'

/**
 * Outbound fetch for connector endpoints.
 *
 * Letting a tenant name a URL we then call turns this server into a proxy into
 * its own network, so every rule here exists to keep that from happening:
 *
 * - only http(s), and only https in production;
 * - no credentials embedded in the URL;
 * - the hostname is resolved **first**, every address it maps to is checked
 *   against loopback/private/link-local/metadata ranges, and the socket is then
 *   pinned to the validated address (a second, unvalidated lookup would be a
 *   DNS-rebinding hole);
 * - redirects are followed manually, re-validating each hop, and bounded;
 * - the response is time- and size-capped so a hostile endpoint cannot exhaust
 *   the process.
 *
 * On-premise sources (a Zoho or ERP instance on the office LAN) are the one
 * legitimate reason to relax this, and they must opt in explicitly with
 * `INTEGRATION_ALLOW_PRIVATE_NETWORKS=true`.
 */

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 10_000
const USER_AGENT = 'ReorderIQ-Connector/1.0 (+https://reorderiq.co.ke)'

export type JsonFetchResult = {
  status: number
  headers: Record<string, string>
  json: unknown
  bytes: number
  /** The final URL after redirects, for diagnostics. */
  url: string
}

/**
 * The final response of one request, kept so an operator can read it.
 *
 * `fetchJson` throws for a non-2xx status and for a non-JSON body, which is the
 * right behaviour for a sync — but the mapping preview and the connection test
 * exist to *show* that failure, so they pass `onResponse` and read the capture
 * afterwards. Only the final response is captured: a redirect hop carries nothing
 * a tenant can act on, and the body is decoded (and truncated) only when someone
 * asked for it, so the sync path pays nothing.
 */
export type HttpResponseCapture = {
  status: number
  statusMessage: string
  headers: Record<string, string>
  bytes: number
  /** The final URL after redirects. */
  url: string
  /** Decoded body, capped at `MAX_CAPTURE_CHARS`. */
  text: string
  /** Whether the body was cut for display. */
  truncated: boolean
  durationMs: number
}

/** Enough of a body to diagnose a mapping; far from enough to be a data export. */
const MAX_CAPTURE_CHARS = 20_000

type ResolvedTarget = { address: string; family: 4 | 6 }

/** True for addresses that must never be reachable through a tenant mapping. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(bare)

  if (version === 4) return isBlockedIpv4(bare)
  if (version !== 6) return true // not an address at all: refuse

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare)
  if (mapped) return isBlockedIpv4(mapped[1]!)
  if (bare === '::' || bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true
  if (bare.startsWith('fc') || bare.startsWith('fd')) return true // unique local
  if (/^fe[89ab]/.test(bare)) return true // link-local
  if (bare.startsWith('ff')) return true // multicast
  if (bare.startsWith('2002')) return true // 6to4 can tunnel to a private v4
  if (bare.startsWith('2001:db8')) return true // documentation
  return false
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b, c] = octets as [number, number, number, number]

  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 169 && b === 254) return true // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 192 && b === 0 && c === 2) return true // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast and reserved
  return false
}

/**
 * Resolves the host and validates every address it maps to.
 * Returns the address the socket will be pinned to.
 */
async function resolveTarget(url: URL): Promise<ResolvedTarget> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw ApiError.unprocessable('Only http(s) endpoints can be connected.')
  }
  if (url.username || url.password) {
    throw ApiError.unprocessable('Remove the credentials from the URL and enter them in the credential field instead.')
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw ApiError.unprocessable('Only https endpoints can be connected in production.')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: ResolvedTarget[]

  if (isIP(host)) {
    addresses = [{ address: host, family: host.includes(':') ? 6 : 4 }]
  } else {
    try {
      const resolved = await dnsLookup(host, { all: true, verbatim: true })
      addresses = resolved.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }))
    } catch {
      throw ApiError.unprocessable(`Could not resolve the host "${url.hostname}".`)
    }
  }

  if (!addresses.length) throw ApiError.unprocessable(`The host "${url.hostname}" has no address.`)

  if (env.INTEGRATION_ALLOW_PRIVATE_NETWORKS !== 'true') {
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address))
    if (blocked) {
      throw ApiError.forbidden(
        `Refusing to connect to "${url.hostname}": it resolves to a private or reserved address. ` +
          'Set INTEGRATION_ALLOW_PRIVATE_NETWORKS=true to reach on-premise systems.',
      )
    }
  }

  return addresses[0]!
}

/**
 * Pins the connection to the address that was validated.
 *
 * `options.all` is honoured because Node may ask for the whole list when happy
 * eyeballs / auto-select is in play.
 */
function pinnedLookup(target: ResolvedTarget): LookupFunction {
  return ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      callback(null, [{ address: target.address, family: target.family }])
      return
    }
    callback(null, target.address, target.family)
  }) as unknown as LookupFunction
}

type RawResponse = { status: number; statusMessage: string; headers: Record<string, string>; body: Buffer }

function requestOnce(
  url: URL,
  target: ResolvedTarget,
  options: { headers: Record<string, string>; timeoutMs: number; maxBytes: number },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const requestOptions: RequestOptions = {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...options.headers },
      lookup: pinnedLookup(target),
      // Keep SNI/certificate validation on the real hostname while connecting to the pinned IP.
      servername: url.hostname,
      // Emits 'timeout' on the request, which we turn into a readable ApiError.
      timeout: options.timeoutMs,
    }

    const onResponse = (response: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = []
      let bytes = 0

      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > options.maxBytes) {
          response.destroy()
          reject(ApiError.unprocessable(`The endpoint returned more than ${Math.round(options.maxBytes / 1024)} KB.`))
          return
        }
        chunks.push(chunk)
      })

      response.on('end', () => {
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers[key.toLowerCase()] = value
          else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(', ')
        }
        resolve({
          status: response.statusCode ?? 0,
          statusMessage: response.statusMessage ?? '',
          headers,
          body: Buffer.concat(chunks),
        })
      })

      response.on('error', reject)
    }

    const request = url.protocol === 'https:'
      ? httpsRequest(url, requestOptions, onResponse)
      : httpRequest(url, requestOptions, onResponse)

    request.on('timeout', () => request.destroy(new Error(`__timeout__`)))
    request.on('error', (error: Error) => {
      if (error.message === '__timeout__') {
        reject(ApiError.unprocessable(`The endpoint did not respond within ${Math.round(options.timeoutMs / 1000)}s.`))
        return
      }
      reject(ApiError.unprocessable(`Could not reach the endpoint (${error.message}).`))
    })

    request.end()
  })
}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) {
    return `The endpoint rejected our credentials (${status}). Update the credential and try again.`
  }
  if (status === 404) return 'The endpoint returned 404. Check the path in the resource mapping.'
  if (status === 429) return 'The endpoint is rate limiting us (429). Try again in a few minutes.'
  if (status >= 500) return `The endpoint failed with ${status}. This is usually temporary.`
  return `The endpoint responded with ${status}.`
}

/** Fetches and parses JSON, following redirects with re-validation at each hop. */
export async function fetchJson(
  url: string,
  options: {
    headers?: Record<string, string>
    timeoutMs?: number
    maxBytes?: number
    /**
     * Receives the final response before it is validated. Diagnostic callers use
     * it to show the operator what the endpoint actually answered; a sync passes
     * nothing and never pays for decoding the body twice.
     */
    onResponse?: (capture: HttpResponseCapture) => void
  } = {},
): Promise<JsonFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_BYTES
  let current = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw ApiError.unprocessable(`"${current}" is not a valid URL.`)
    }

    const target = await resolveTarget(parsed)
    const startedAt = Date.now()
    const response = await requestOnce(parsed, target, { headers: options.headers ?? {}, timeoutMs, maxBytes })
    const durationMs = Date.now() - startedAt

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location
      if (!location) throw ApiError.unprocessable('The endpoint redirected without a Location header.')
      current = new URL(location, parsed).toString()
      continue
    }

    if (options.onResponse) {
      const text = response.body.toString('utf8')
      const truncated = text.length > MAX_CAPTURE_CHARS
      options.onResponse({
        status: response.status,
        statusMessage: response.statusMessage,
        headers: response.headers,
        bytes: response.body.length,
        url: parsed.toString(),
        text: truncated ? text.slice(0, MAX_CAPTURE_CHARS) : text,
        truncated,
        durationMs,
      })
    }

    // The status check must come first. Many APIs answer an error with an empty
    // body, and treating "no body" as success would make a broken credential or a
    // wrong path look like a healthy connector that simply has no data — the worst
    // possible failure mode for a data product.
    if (response.status < 200 || response.status >= 300) {
      throw ApiError.unprocessable(describeStatus(response.status))
    }

    if (response.status === 204 || response.body.length === 0) {
      return { status: response.status, headers: response.headers, json: null, bytes: 0, url: parsed.toString() }
    }

    const text = response.body.toString('utf8')
    try {
      return {
        status: response.status,
        headers: response.headers,
        json: JSON.parse(text) as unknown,
        bytes: response.body.length,
        url: parsed.toString(),
      }
    } catch {
      throw ApiError.unprocessable(
        `The endpoint did not return JSON (content-type: ${response.headers['content-type'] ?? 'unknown'}).`,
      )
    }
  }

  throw ApiError.unprocessable('The endpoint redirected too many times.')
}

/** Extracts the RFC 5988 `rel="next"` URL, which Shopify and GitHub use for paging. */
export function nextLinkFromHeader(header: string | undefined, base: string): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part)
    if (match?.[1]) {
      try {
        return new URL(match[1], base).toString()
      } catch {
        return null
      }
    }
  }
  return null
}
