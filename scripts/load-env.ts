import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal `.env` loader for scripts run through `tsx`.
 *
 * Next.js loads `.env.local` automatically for the app itself, but CLI scripts
 * (checks, migrations) need the same values. Kept dependency-free on purpose.
 *
 * Import this module FIRST in a script so the environment is populated before
 * any module that validates it (see `lib/env.ts`) is evaluated.
 */
const FILES = ['.env.local', '.env.development.local', '.env']

function parse(contents: string) {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

for (const file of FILES) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue
  parse(readFileSync(path, 'utf8'))
}

export {}
