import './load-env'

import { applyMigrations, migrationConnectionString, shouldMigrateOnBoot } from '../lib/db/migrate'

/**
 * Applies pending migrations from the command line (`pnpm db:migrate:deploy`).
 *
 * Used as a Vercel build step (see `vercel.json`) and for migrating by hand
 * against a specific database:
 *
 *   DATABASE_URL="postgres://…" pnpm db:migrate:deploy
 *
 * The migration itself lives in `lib/db/migrate.ts`, shared with the boot hook
 * in `instrumentation.ts`.
 */
async function main() {
  if (!shouldMigrateOnBoot()) {
    console.log(
      `[migrate] VERCEL_ENV=${process.env.VERCEL_ENV}: skipping migrations, production deploys only.`,
    )
    return
  }

  if (!migrationConnectionString()) {
    throw new Error(
      'No database connection string. Set DATABASE_URL (or MIGRATION_DATABASE_URL / DATABASE_URL_UNPOOLED / DIRECT_URL).',
    )
  }

  const outcome = await applyMigrations()
  const summary =
    outcome.applied === null
      ? 'schema migrated'
      : outcome.applied === 0
        ? 'schema up to date'
        : `applied ${outcome.applied} migration(s)`

  console.log(`[migrate] ${summary} (${outcome.total ?? '?'} applied, ${outcome.durationMs}ms)`)
}

main().catch((error: unknown) => {
  console.error(`[migrate] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
