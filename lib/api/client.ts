'use client'

/**
 * Browser-side API client.
 *
 * Every route handler answers with the envelope built in `lib/api/response.ts`:
 * `{ data }`, `{ data, pagination }` or `{ error, requestId }`. This module is the
 * only place that knows that shape, so components deal in typed data and thrown
 * `ApiClientError`s instead of re-parsing envelopes by hand.
 *
 * The session cookie is sent with the default `credentials: 'same-origin'`, and
 * mutations reach the server with a trustworthy origin signal, which is what
 * `assertTrustedOrigin` requires for cookie-authenticated traffic.
 */

export type ApiPagination = {
  limit: number
  cursor: string | null
  nextCursor: string | null
  total?: number
}

/** One field-level problem reported by the server's validation. */
export type ApiFieldIssue = { path: string; message: string }

/** A validated API failure. `code` is the server's stable error code. */
export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  /** Field-level validation issues, when the server supplied them. */
  readonly details: unknown

  constructor(status: number, code: string, message: string, requestId: string | null = null, details: unknown = null) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }

  /** True when the account cannot see this resource, rather than a transient fault. */
  get isPermissionError() {
    return this.status === 401 || this.status === 403
  }

  /**
   * Validation issues, if this failure carried any.
   *
   * A mapping form is unusable without them: "the submitted values are invalid"
   * does not tell anyone which of forty text inputs is wrong.
   */
  get fieldIssues(): ApiFieldIssue[] {
    if (!Array.isArray(this.details)) return []
    return this.details
      .filter((entry): entry is ApiFieldIssue =>
        typeof entry === 'object' && entry !== null && typeof (entry as ApiFieldIssue).path === 'string' && typeof (entry as ApiFieldIssue).message === 'string',
      )
      .slice(0, 12)
  }
}

type Envelope<T> = {
  data?: T
  pagination?: ApiPagination
  error?: { code?: string; message?: string; details?: unknown }
  requestId?: string
}

const FALLBACK_MESSAGE = 'We could not reach the server. Check your connection and try again.'

async function request<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiClientError(0, 'network_error', FALLBACK_MESSAGE)
  }

  // 204 from a DELETE carries no body.
  if (response.status === 204) return {}

  const payload = (await response.json().catch(() => null)) as Envelope<T> | null

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload?.error?.code ?? 'internal_error',
      payload?.error?.message ?? FALLBACK_MESSAGE,
      payload?.requestId ?? null,
      payload?.error?.details ?? null,
    )
  }

  return payload ?? {}
}

function unwrap<T>(envelope: Envelope<T>, path: string): T {
  if (envelope.data === undefined) {
    throw new ApiClientError(500, 'internal_error', `The server returned no data for ${path}.`)
  }
  return envelope.data
}

/** GET a single resource (`{ data }` envelope). */
export async function apiGet<T>(path: string): Promise<T> {
  return unwrap(await request<T>(path), path)
}

/** GET a collection (`{ data, pagination }` envelope). */
export async function apiList<T>(path: string): Promise<{ items: T[]; pagination: ApiPagination | null }> {
  const envelope = await request<T[]>(path)
  return { items: unwrap(envelope, path), pagination: envelope.pagination ?? null }
}

/** POST/PATCH/PUT a JSON body and read the returned resource. */
export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body?: unknown,
): Promise<T> {
  return unwrap(await request<T>(path, { method, body: JSON.stringify(body ?? {}) }), path)
}

/** DELETE a resource (204, no body). */
export async function apiDelete(path: string): Promise<void> {
  await request<never>(path, { method: 'DELETE' })
}

/** Builds a query string, dropping empty values so strict schemas never see `?search=`. */
export function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}
