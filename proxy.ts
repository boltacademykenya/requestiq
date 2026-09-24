import { NextResponse, type NextRequest } from 'next/server'

/**
 * Security proxy (Next.js 16 middleware).
 *
 * Responsibilities:
 *  - attach hardening headers to every response
 *  - apply a Content Security Policy that matches how the page was rendered
 *
 * CSP note: nonces only work for dynamically rendered pages (React must be able
 * to stamp the nonce onto its script tags). Prerendered marketing pages ship
 * their hydration scripts at build time, so they get a policy that allows
 * `'unsafe-inline'` for scripts instead of a nonce. Everything that renders user
 * data is dynamic and gets the strict policy.
 */

/** Routes that render per request (dynamic) and can therefore use a nonce. */
const DYNAMIC_HTML_PREFIXES = ['/workspace', '/admin']

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
}

const COMMON_CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
]

function buildCsp(nonce: string | null, isDev: boolean) {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`
    : `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`

  // `style-src 'unsafe-inline'` is required because chart components set inline
  // style attributes; styles carry far less risk than scripts.
  const styleSrc = `style-src 'self' 'unsafe-inline'${nonce ? ` 'nonce-${nonce}'` : ''}`

  return [...COMMON_CSP_DIRECTIVES, scriptSrc, styleSrc].join('; ')
}

export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development'
  const { pathname } = request.nextUrl
  const needsNonce = DYNAMIC_HTML_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  const nonce = needsNonce ? Buffer.from(crypto.randomUUID()).toString('base64') : null
  const csp = buildCsp(nonce, isDev)

  const requestHeaders = new Headers(request.headers)
  if (nonce) requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  // Skip static assets: headers there are handled by the CDN/host layer.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|placeholder).*)'],
}
