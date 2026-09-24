import './load-env'

import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'

/** Connectivity + migration smoke check (`pnpm db:check`). */
async function main() {
  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  )
  const names = tables.rows.map((row) => row.table_name)
  console.log(`✔ connected to PostgreSQL · ${names.length} tables`)
  console.log('  ', names.join(', '))

  const counts = await db.execute<{ organizations: number; customers: number; orders: number; orders_items: number }>(
    sql`select
          (select count(*) from organizations)::int as organizations,
          (select count(*) from customers)::int as customers,
          (select count(*) from orders)::int as orders,
          (select count(*) from order_items)::int as orders_items`,
  )
  console.log('   rows:', counts.rows[0])

  const expected = ['organizations', 'members', 'customers', 'products', 'orders', 'order_items', 'opportunities', 'campaigns', 'messages', 'integrations', 'subscriptions', 'contact_submissions', 'audit_logs', 'rate_limit_counters', 'user', 'session', 'account', 'verification']
  const missing = expected.filter((table) => !names.includes(table))
  if (missing.length) {
    console.error('✖ missing tables:', missing.join(', '))
    console.error('  Run `pnpm db:migrate` to apply migrations.')
    process.exitCode = 1
  }
}

main()
  .then(async () => {
    await pool.end()
  })
  .catch(async (error) => {
    console.error('✖ database check failed:', error instanceof Error ? error.message : error)
    await pool.end()
    process.exit(1)
  })
