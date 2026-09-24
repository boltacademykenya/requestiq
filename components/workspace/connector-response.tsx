'use client'

import { useMemo } from 'react'
import type { ConnectorHttpDto } from '@/lib/api/dto'
import { summariseStructure } from '@/lib/connectors/discovery'
import { Notice, tdClass, thClass } from './ui'

/**
 * What the endpoint actually answered.
 *
 * A mapping is only as good as the response it reads, so both "Test connection" and
 * "Test & preview" show this panel: the status, how long the call took, the headers
 * worth reading and the body itself — which the server has already redacted and
 * capped. For a JSON body it also names the structure (where the list is, what one
 * record looks like), because that is the question the mapping form is really
 * asking.
 */

const MAX_BODY_HEIGHT = 'max-h-80'

function statusTone(status: number | null): string {
  if (status === null) return 'bg-slate-100 text-slate-600'
  if (status >= 200 && status < 300) return 'bg-emerald-100 text-emerald-800'
  if (status >= 300 && status < 400) return 'bg-amber-100 text-amber-800'
  return 'bg-rose-100 text-rose-800'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatPath(path: string | null): string {
  if (path === null) return ''
  return path === '' ? 'the response itself' : path
}

export default function ConnectorResponsePanel({
  response,
  error = null,
  title = 'Endpoint response',
}: {
  response: ConnectorHttpDto
  /** Why the call failed, when it did (a 401, a non-JSON body, a wrong path). */
  error?: string | null
  title?: string
}) {
  const structure = useMemo(() => {
    // A truncated body is not valid JSON, so the structure can only be read when
    // the server sent the whole payload.
    if (!response.json || response.truncated) return null
    try {
      return summariseStructure(JSON.parse(response.body) as unknown)
    } catch {
      return null
    }
  }, [response.body, response.json, response.truncated])

  return (
    <div className="space-y-3">
      {error && <Notice>{error}</Notice>}

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="text-xs font-semibold text-slate-900">{title}</span>
          <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + statusTone(response.status)}>
            {response.status ?? 'no response'}
            {response.statusText ? ` ${response.statusText}` : ''}
          </span>
          <span className="text-[11px] text-slate-500">{response.durationMs} ms</span>
          <span className="text-[11px] text-slate-500">{formatBytes(response.bytes)}</span>
          {response.contentType && <span className="text-[11px] text-slate-500">{response.contentType}</span>}
          <span className="truncate font-mono text-[11px] text-slate-400" title={response.endpoint}>
            {response.endpoint}
          </span>
        </div>

        {structure && (
          <p className="border-t border-slate-900/5 px-4 py-2 text-[11px] text-slate-600">
            {structure.listPath !== null ? (
              <>
                List at <span className="font-mono font-semibold">{formatPath(structure.listPath)}</span>
                {structure.listCount !== null ? ` · ${structure.listCount} record(s)` : ''}
                {structure.itemKeys.length > 0 ? ` · record keys: ${structure.itemKeys.join(', ')}` : ''}
              </>
            ) : (
              <>No record list detected{structure.topLevelKeys.length > 0 ? ` · top-level keys: ${structure.topLevelKeys.join(', ')}` : ''}</>
            )}
          </p>
        )}

        {response.headers.length > 0 && (
          <div className="overflow-x-auto border-t border-slate-900/5">
            <table className="w-full min-w-[420px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Header
                  </th>
                  <th scope="col" className={thClass}>
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.headers.map((header) => (
                  <tr key={header.name}>
                    <td className={`${tdClass} font-mono text-xs`}>{header.name}</td>
                    <td className={`${tdClass} font-mono text-xs break-all`}>{header.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-900/5">
          <pre className={`${MAX_BODY_HEIGHT} overflow-auto px-4 py-3 font-mono text-[11px] leading-5 text-slate-700`}>
            {response.body.trim() ? response.body : '(empty body)'}
          </pre>
          {response.truncated && (
            <p className="px-4 pb-3 text-[11px] text-amber-700">The body was cut for display — the full response is larger.</p>
          )}
        </div>
      </div>
    </div>
  )
}
