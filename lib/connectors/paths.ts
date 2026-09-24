/**
 * Path reader for arbitrary JSON.
 *
 * Field mappings are data, so they must never be evaluated as code. This module
 * is the whole expression language: dot keys, `[0]` indexes, `[*]` flattening,
 * bracketed keys for names with spaces, and `{a} {b}` templates for values that
 * need gluing together (Shopify has `first_name` + `last_name`, not `name`).
 *
 * A malformed path throws `MappingError`, which is a *configuration* fault: the
 * sync stops and reports it instead of quietly importing nothing.
 */

/** Raised when a mapping expression cannot be understood. */
export class MappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MappingError'
  }
}

type Segment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }

/**
 * `$.data.items[0].name` -> [{key:'data'},{key:'items'},{index:0},{key:'name'}]
 *
 * Parsed segments are cached: the same handful of paths is resolved once per
 * row, so re-parsing them for every record would be wasted work.
 */
const segmentCache = new Map<string, Segment[]>()

export function parsePath(path: string): Segment[] {
  const cached = segmentCache.get(path)
  if (cached) return cached

  let input = path.trim()
  if (input.startsWith('$')) input = input.slice(1)
  if (input.startsWith('.')) input = input.slice(1)

  const segments: Segment[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]

    if (char === '.') {
      index += 1
      continue
    }

    if (char === '[') {
      const end = input.indexOf(']', index)
      if (end === -1) throw new MappingError(`Unclosed "[" in mapping expression "${path}".`)
      const inner = input.slice(index + 1, end).trim()
      if (inner === '*') segments.push({ kind: 'wildcard' })
      else if (/^\d+$/.test(inner)) segments.push({ kind: 'index', index: Number(inner) })
      else if (/^".*"$/.test(inner) || /^'.*'$/.test(inner)) segments.push({ kind: 'key', key: inner.slice(1, -1) })
      else if (inner.length) segments.push({ kind: 'key', key: inner })
      else throw new MappingError(`Empty "[]" in mapping expression "${path}".`)
      index = end + 1
      continue
    }

    let end = index
    while (end < input.length && input[end] !== '.' && input[end] !== '[') end += 1
    const key = input.slice(index, end).trim()
    if (key.length) segments.push({ kind: 'key', key })
    index = end
  }

  if (segments.length === 0) throw new MappingError(`Mapping expression "${path}" is empty.`)
  segmentCache.set(path, segments)
  return segments
}

/**
 * Reads one value. A `[*]` segment returns the array it found rather than
 * guessing, so callers can report "this path matched 12 values" instead of
 * silently importing the first one.
 */
export function readPath(value: unknown, path: string): unknown {
  const segments = parsePath(path)
  let current: unknown = value

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (segment.kind === 'wildcard') return Array.isArray(current) ? current : undefined
    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return undefined
      current = current[segment.index]
      continue
    }
    if (typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment.key]
  }

  return current
}

/**
 * Resolves a mapping expression to a single value.
 *
 * `"@reorderiq.example"` is a literal; `"{first_name} {last_name}"` interpolates
 * paths; anything else is a path. Literals make it possible to supply constants
 * (a default customer type, a store name) without inventing a separate field.
 */
export function resolveExpression(record: unknown, expression: string): unknown {
  const expr = expression.trim()
  if (!expr) return undefined

  // Some APIs put the same value in one of several fields (for example a
  // contact's `phone` or `mobile`). `a || b` keeps that choice declarative so a
  // tenant does not have to invent a server-side transform just to use a
  // provider's alternate field. Empty strings count as absent.
  const alternatives = expr.split(/\s+\|\|\s+/)
  if (alternatives.length > 1) {
    for (const alternative of alternatives) {
      const value = resolveExpression(record, alternative)
      if (value === null || value === undefined) continue
      if (typeof value === 'string' && value.trim().length === 0) continue
      return value
    }
    return undefined
  }

  // `@` marks text that is not a path. It still interpolates, so a source with no
  // usable identifier can be given one (`@+25470000000{id}`) rather than the row
  // being dropped.
  if (expr.startsWith('@')) {
    const literal = expr.slice(1)
    return literal.includes('{') ? interpolate(record, literal) : literal
  }

  if (expr.includes('{')) return interpolate(record, expr)

  return readPath(record, expr)
}

/** Replaces every `{path}` in a template with the value it resolves to. */
function interpolate(record: unknown, template: string): string | undefined {
  const rendered = template
    .split(/(\{[^{}]*\})/)
    .map((part) => {
      if (part.startsWith('{') && part.endsWith('}')) {
        const inner = part.slice(1, -1).trim()
        if (!inner) return ''
        const value = readPath(record, inner)
        return value === null || value === undefined ? '' : toPlainText(value)
      }
      return part
    })
    .join('')
  const collapsed = rendered.replace(/\s+/g, ' ').trim()
  return collapsed.length ? collapsed : undefined
}

/** Renders a scalar for interpolation; objects and arrays interpolate to nothing. */
function toPlainText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Extracts the array of records from a response body.
 *
 * `recordsPath` may point straight at the array, at an object property, or use
 * `[*]` to flatten nested lists (e.g. Shopify's `orders[*].line_items`).
 */
export function collectRecords(root: unknown, recordsPath: string): unknown[] {
  const trimmed = recordsPath.trim()
  if (!trimmed || trimmed === '$') return Array.isArray(root) ? root : []

  const segments = parsePath(trimmed)

  const walk = (value: unknown, index: number): unknown[] => {
    if (index >= segments.length) return [value]
    if (value === null || value === undefined) return []

    const segment = segments[index]!
    if (segment.kind === 'wildcard') {
      if (!Array.isArray(value)) return []
      return value.flatMap((entry) => walk(entry, index + 1))
    }
    if (segment.kind === 'index') {
      if (!Array.isArray(value)) return []
      return walk(value[segment.index], index + 1)
    }
    if (typeof value !== 'object' || Array.isArray(value)) return []
    return walk((value as Record<string, unknown>)[segment.key], index + 1)
  }

  const found = walk(root, 0).filter((entry) => entry !== null && entry !== undefined)
  // A path that lands on the array itself yields one result which *is* the list.
  return found.length === 1 && Array.isArray(found[0]) ? (found[0] as unknown[]) : found
}
