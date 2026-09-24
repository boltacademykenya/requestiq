/**
 * Server boot hook — the closest thing Next.js has to a `main()` function.
 *
 * `register` is called once when a server instance starts and must complete
 * before that instance serves a request, which is exactly the guarantee a
 * single-process server relies on when it migrates at startup. So pending
 * migrations are applied here rather than only from the build.
 *
 * On a serverless host "once per server instance" means once per cold start,
 * and instances start concurrently — `lib/db/migrate.ts` explains how that is
 * made safe (advisory lock + idempotent bookkeeping).
 *
 * `register` is invoked for every runtime, and `pg` is Node-only, so the import
 * is dynamic and guarded. A static import here would drag the Postgres driver
 * into the Edge bundle that `proxy.ts` runs in.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { migrateOnBoot } = await import('@/lib/db/migrate')
  await migrateOnBoot()
}
