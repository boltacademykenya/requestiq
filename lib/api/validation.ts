import type { NextRequest } from 'next/server'
import type { ZodType } from 'zod'
import { ApiError } from './errors'

export const MAX_JSON_BYTES = 128 * 1024

type Issue = { path: string; message: string }

function toIssues(error: { issues: Array<{ path: Array<string | number | symbol>; message: string }> }): Issue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map((part) => String(part)).join('.') || '_root',
    message: issue.message,
  }))
}

/**
 * Parses and validates a JSON body.
 *
 * - enforces `application/json`
 * - enforces a byte ceiling before parsing (DoS protection)
 * - rejects unknown keys because every schema is a strict object
 */
export async function readJsonBody<T>(request: NextRequest, schema: ZodType<T>, maxBytes = MAX_JSON_BYTES): Promise<T> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw ApiError.unsupportedMediaType()
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw ApiError.payloadTooLarge()
  }

  const raw = await request.text()
  if (raw.length > maxBytes) {
    throw ApiError.payloadTooLarge()
  }
  if (!raw.trim()) {
    throw ApiError.badRequest('A JSON body is required.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw ApiError.badRequest('The request body is not valid JSON.')
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw ApiError.unprocessable('The submitted values are invalid.', toIssues(result.error))
  }
  return result.data
}

/** Validates query string parameters (unknown params are rejected). */
export function readQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  const entries: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (!(key in entries)) entries[key] = value
  }
  const result = schema.safeParse(entries)
  if (!result.success) {
    throw ApiError.unprocessable('The query parameters are invalid.', toIssues(result.error))
  }
  return result.data
}

/** Validates dynamic route params (e.g. a UUID customer id). */
export function readParams<T>(params: Record<string, string>, schema: ZodType<T>): T {
  const result = schema.safeParse(params)
  if (!result.success) {
    throw ApiError.unprocessable('The path parameters are invalid.', toIssues(result.error))
  }
  return result.data
}
