import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import * as schema from '@/lib/db/schema'

/**
 * Single pooled Postgres connection for the whole application.
 *
 * The pool is cached on `globalThis` outside production so that Next.js hot
 * reloads do not leak connections while developing.
 */
const globalForDb = globalThis as unknown as { __reorderIqPool?: Pool }

function createPool(): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === 'production' ? 10 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Kill runaway statements instead of holding a worker forever.
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: 'reorderiq',
    /*
     * TLS is deliberately not configured here. node-postgres merges the parsed
     * connection string *over* these options (`connection-parameters.js`), so an
     * `ssl` object built from the environment is silently discarded whenever
     * `DATABASE_URL` carries an `sslmode` — which every managed provider's string
     * does. The URL is therefore the single source of truth:
     *
     *   local    postgres://…@localhost:5432/reorderiq      -> no TLS
     *   managed  postgres://…?sslmode=verify-full           -> TLS, verified
     *
     * Prefer `verify-full` over `require`: from pg-connection-string v3 / pg v9,
     * `require` drops certificate verification to match libpq semantics, and
     * would do so silently.
     */
  })

  // A pooled client can die between queries (network reset, DB restart).
  // Without this handler Node would crash the process.
  pool.on('error', (error) => {
    console.error('[db] unexpected idle client error:', error.message)
  })

  return pool
}

export const pool: Pool = globalForDb.__reorderIqPool ?? createPool()

if (env.NODE_ENV !== 'production') {
  globalForDb.__reorderIqPool = pool
}

export const db = drizzle(pool, { schema })

export type Database = typeof db
export { schema }
