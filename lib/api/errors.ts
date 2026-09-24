/**
 * Transport-level error type.
 *
 * Handlers throw `ApiError` and the route wrapper converts it into a stable JSON
 * envelope. Internal errors never leak: only `apiError` messages reach clients.
 */
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable_entity'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'too_many_requests'
  | 'internal_error'
  | 'service_unavailable'

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message = 'The request could not be understood.') {
    return new ApiError(400, 'bad_request', message)
  }

  static unauthorized(message = 'You must sign in to continue.') {
    return new ApiError(401, 'unauthorized', message)
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new ApiError(403, 'forbidden', message)
  }

  static notFound(message = 'The requested resource was not found.') {
    return new ApiError(404, 'not_found', message)
  }

  static conflict(message = 'That resource already exists.') {
    return new ApiError(409, 'conflict', message)
  }

  static unprocessable(message = 'The submitted values are invalid.', details?: unknown) {
    return new ApiError(422, 'unprocessable_entity', message, details)
  }

  static payloadTooLarge(message = 'The request body is too large.') {
    return new ApiError(413, 'payload_too_large', message)
  }

  static unsupportedMediaType(message = 'Content-Type must be application/json.') {
    return new ApiError(415, 'unsupported_media_type', message)
  }

  static tooManyRequests(message = 'Too many requests. Please slow down.', retryAfterSeconds = 60) {
    return new ApiError(429, 'too_many_requests', message, { retryAfterSeconds })
  }

  static internal(message = 'Something went wrong on our side.') {
    return new ApiError(500, 'internal_error', message)
  }

  static serviceUnavailable(message = 'The service is temporarily unavailable.') {
    return new ApiError(503, 'service_unavailable', message)
  }
}

/** Postgres error codes we translate into user-facing responses. */
export const PG_ERROR_CODES = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
} as const

type PgError = { code?: string; constraint?: string; detail?: string; cause?: unknown }

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError`, so the Postgres error
 * code lives on `error.cause`. This walks the chain to find it.
 */
export function isPgError(error: unknown): error is PgError {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && typeof (current as PgError).code === 'string') {
      return true
    }
    current = typeof current === 'object' && current !== null ? (current as PgError).cause : undefined
  }
  return false
}

export function pgErrorCode(error: unknown): { code: string; constraint?: string } | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as PgError
    if (typeof candidate === 'object' && candidate !== null && typeof candidate.code === 'string') {
      return { code: candidate.code, ...(candidate.constraint ? { constraint: candidate.constraint } : {}) }
    }
    current = candidate?.cause
  }
  return null
}

/** Maps database constraint failures to safe, specific ApiErrors. */
export function fromPgError(error: unknown, fallbackMessage: string): ApiError {
  const pg = pgErrorCode(error)
  switch (pg?.code) {
    case PG_ERROR_CODES.uniqueViolation:
      return ApiError.conflict(fallbackMessage)
    case PG_ERROR_CODES.foreignKeyViolation:
      return ApiError.unprocessable('A referenced record does not exist in this organization.')
    case PG_ERROR_CODES.checkViolation:
    case PG_ERROR_CODES.notNullViolation:
      return ApiError.unprocessable('The submitted values violate a data integrity rule.')
    default:
      return ApiError.internal()
  }
}
