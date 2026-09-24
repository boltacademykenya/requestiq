import { NextResponse } from 'next/server'
import type { ApiError } from './errors'

/**
 * Response helpers.
 *
 * Every API response is JSON with an explicit envelope so clients can rely on
 * one shape: `{ data }`, `{ data, pagination }` or `{ error, requestId }`.
 */
export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
}

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown }
  requestId: string
}

export type Pagination = { limit: number; cursor: string | null; nextCursor: string | null; total?: number }
export type ItemResponse<T> = { data: T }
export type ListResponse<T> = { data: T[]; pagination: Pagination }

export function jsonResponse<T extends object>(body: T, status: number, requestId: string, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, 'X-Request-Id': requestId, ...extraHeaders },
  })
}

export function ok<T>(data: T, requestId: string) {
  return jsonResponse({ data } as { data: T }, 200, requestId)
}

export function created<T>(data: T, requestId: string) {
  return jsonResponse({ data } as { data: T }, 201, requestId)
}

export function noContent(requestId: string) {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, 'X-Request-Id': requestId } })
}

export function listed<T>(data: T[], pagination: Pagination, requestId: string) {
  return jsonResponse({ data, pagination } as { data: T[]; pagination: Pagination }, 200, requestId)
}

export function errorResponse(error: ApiError, requestId: string) {
  const headers: Record<string, string> = { 'X-Request-Id': requestId }
  if (error.code === 'too_many_requests') {
    const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds
    if (typeof retryAfter === 'number') headers['Retry-After'] = String(Math.max(1, Math.ceil(retryAfter)))
  }
  return jsonResponse(
    {
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      requestId,
    } as ApiErrorBody,
    error.status,
    requestId,
    headers,
  )
}

/** Cursor helpers keep pagination stable and opaque to clients. */
export function encodeCursor(value: { id: string; sort: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { id: string; sort: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      typeof (parsed as { sort?: unknown }).sort === 'string'
    ) {
      return parsed as { id: string; sort: string }
    }
    return null
  } catch {
    return null
  }
}
