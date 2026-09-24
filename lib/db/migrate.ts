import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/**
 * Schema migrations.
 *
 * Shared by two callers:
 *
 *  - `instrumentation.ts`, which runs on server boot — the closest thing
 *    Next.js has to `main()`, so a deployment migrates itself the way a
 *    single-process server does before it starts accepting traffic;
 *  - `scripts/deploy-migrate.ts` (`pnpm db:migrate:deploy`), for running the
 *    same migration by hand or as a build step.
 *
 * Two properties matter for correctness wherever it runs:
 *
 *  - **Serialised.** Drizzle reads its bookkeeping row *outside* the DDL
 *    transaction (`pg-core/dialect.js` picks the last applied migration, then
 *    opens one transaction for everything pending), so two callers racing would
 *    both replay the same statements and the loser would fail on
 *    `relation already exists`. A Postgres advisory lock makes the second
 *    caller wait instead. This is not theoretical on a serverless host: every
 *    cold-started instance runs the boot hook independently.
 *  - **Idempotent.** Already-applied migrations are skipped, so the common case
 *    costs one `select` against the bookkeeping table.
 */

/** Lock identity; `hashtext` maps it onto the bigint the advisory locks take. */
const LOCK_NAME = 'reorderiq:migrations'

/** Stop waiting if another caller holds the lock for this long. */
const LOCK_TIMEOUT = '120s'

/** Neon suspends idle computes, so allow for a wake-up on connect. */
const CONNECT_TIMEOUT_MS = 15_000

/**
 * Preference order. An unpooled URL is safest for DDL, and the Neon Vercel
 * integration provisions one as `DATABASE_URL_UNPOOLED`.
 */
const CONNECTION_VARS = [
  'MIGRATION_DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'DIRECT_URL',
  'DATABASE_URL',
] as const

export type MigrationOutcome = {
  /** Migrations applied by this call; null when the baseline was unknown. */
  applied: number | null
  /** Migrations recorded as applied afterwards. */
  total: number | null
  durationMs: number
}

export function migrationsFolder(): string {
  return resolve(process.cwd(), 'drizzle')
}

export function migrationConnectionString(): string | null {
  for (const name of CONNECTION_VARS) {
    const value = (process.env[name] ?? '').trim()
    if (value) return value
  }
  return null
}

/**
 * Migrations on disk, for logging only; the migrator reports its own errors.
 */
function migrationsOnDisk(folder: string): number | null {
  try {
    const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
      entries?: unknown[]
    }
    return journal.entries?.length ?? 0
  } catch {
    return null
  }
}

/** Migrations recorded as applied; null until the bookkeeping table exists. */
async function appliedCount(client: Client): Promise<number | null> {
  try {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    )
    return Number(result.rows[0]?.count ?? 0)
  } catch {
    return null
  }
}

/**
 * Applies every pending migration, under an advisory lock.
 *
 * Throws if the database cannot be reached or a migration fails — callers
 * decide whether that should stop the process.
 */
export async function applyMigrations(): Promise<MigrationOutcome> {
  const url = migrationConnectionString()
  if (!url) {
    throw new Error(`No database connection string. Set one of: ${CONNECTION_VARS.join(', ')}.`)
  }

  const folder = migrationsFolder()
  const onDisk = migrationsOnDisk(folder)

  // TLS comes from the `sslmode` in the connection string — see the note in
  // `lib/db/client.ts` for why it is not configured here.
  const client = new Client({
    connectionString: url,
    application_name: 'reorderiq-migrate',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  })

  await client.connect()
  const started = Date.now()

  try {
    console.log(`[migrate] folder: ${folder}${onDisk === null ? '' : ` (${onDisk} migration(s) on disk)`}`)

    // Serialise callers. The lock is session scoped, so it is released when this
    // connection ends — including if the process is killed.
    await client.query(`set lock_timeout = '${LOCK_TIMEOUT}'`)
    await client.query('select pg_advisory_lock(hashtext($1)::bigint)', [LOCK_NAME])

    const before = await appliedCount(client)
    await migrate(drizzle(client), { migrationsFolder: folder })
    const after = await appliedCount(client)

    return {
      applied: before === null || after === null ? null : after - before,
      total: after,
      durationMs: Date.now() - started,
    }
  } finally {
    await client
      .query('select pg_advisory_unlock(hashtext($1)::bigint)', [LOCK_NAME])
      .catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

/**
 * Whether this deployment migrates itself.
 *
 * `VERCEL_ENV` is set to `production`, `preview` or `development` on Vercel and
 * is absent elsewhere. Preview deployments are deliberately excluded: they
 * usually share the production connection string, so a branch push must not be
 * able to mutate the production schema.
 */
export function shouldMigrateOnBoot(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV ?? '').trim()
  return vercelEnv.length === 0 || vercelEnv === 'production'
}

/**
 * Boot hook, called once per server instance before it accepts requests.
 *
 * An unreachable database is reported and skipped — the instance still serves
 * static pages, and database-backed routes fail on their own terms. A migration
 * that *starts and fails*, however, throws: the schema is then in an unknown
 * state, so the instance must not serve code written against the new shape.
 */
export async function migrateOnBoot(): Promise<void> {
  if (!shouldMigrateOnBoot()) {
    console.log(
      `[migrate] VERCEL_ENV=${process.env.VERCEL_ENV}: skipping boot migrations, production only.`,
    )
    return
  }

  if (!migrationConnectionString()) {
    console.warn('[migrate] no database connection string configured; skipping boot migrations.')
    return
  }

  try {
    const outcome = await applyMigrations()
    const summary =
      outcome.applied === null
        ? 'schema migrated'
        : outcome.applied === 0
          ? 'schema up to date'
          : `applied ${outcome.applied} migration(s)`
    console.log(
      `[migrate] boot: ${summary} (${outcome.total ?? '?'} applied, ${outcome.durationMs}ms)`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Boot migration failed, refusing to serve requests: ${detail}`)
  }
}
