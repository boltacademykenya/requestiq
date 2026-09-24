'use client'

import { useCallback, useEffect, useState, type DependencyList } from 'react'
import { ApiClientError } from '@/lib/api/client'

export type Resource<T> = {
  data: T | null
  error: ApiClientError | null
  loading: boolean
  /** Re-runs the loader (used after a write, or by a Retry button). */
  reload: () => void
}

/**
 * Loads one API resource and tracks loading/error state.
 *
 * Results from a superseded run are discarded, so a fast retry can never
 * overwrite fresher data with an older response.
 */
export function useResource<T>(load: () => Promise<T>, deps: DependencyList): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiClientError | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    load()
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setData(null)
        setError(
          cause instanceof ApiClientError
            ? cause
            : new ApiClientError(0, 'unknown_error', 'Something went wrong. Please try again.'),
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
    // `load` is an inline arrow in every caller; `deps` is the real dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  return { data, error, loading, reload }
}
