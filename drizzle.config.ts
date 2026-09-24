import { defineConfig } from 'drizzle-kit'

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://postgres:1234@localhost:5432/reorderiq'

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
  casing: 'snake_case',
})
