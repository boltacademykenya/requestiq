/** Splits large id lists so they stay inside Postgres parameter limits. */
export function chunk<T>(items: T[], size = 500): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive')
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
