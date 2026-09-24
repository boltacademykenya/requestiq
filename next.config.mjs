/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors must fail the build: the backend is fully typed on purpose.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Do not advertise the framework version.
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Boot migrations read the SQL files in `drizzle/` with `fs`, which the output
  // tracer cannot follow, so they would otherwise be missing from the function
  // bundle and `instrumentation.ts` would fail with "Can't find
  // meta/_journal.json file" at runtime.
  outputFileTracingIncludes: {
    '/*': ['./drizzle/**/*'],
  },
  // Defence in depth: proxy.ts also sets these, but static assets bypass proxy.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig

