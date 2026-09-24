'use client'

import type { ReactNode } from 'react'

/**
 * Small presentational primitives shared by the workspace tabs.
 *
 * They keep the tab components focused on data and mutations, and give the whole
 * workspace one consistent set of surfaces, spacing and states.
 *
 * Nothing here draws a stroke: `surface`, `well` and `field` (defined in
 * globals.css) carry the hierarchy with tone, elevation and radius instead.
 */

export const inputClass = 'field mt-1 h-10 w-full px-3.5 text-sm'

export const selectClass = `${inputClass} cursor-pointer`

export const buttonPrimary =
  'inline-flex h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-emerald-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60'

export const buttonSecondary =
  'inline-flex h-10 items-center justify-center rounded-xl bg-wash px-4 text-sm font-semibold text-slate-700 transition hover:bg-wash-strong hover:text-slate-900 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60'

export const buttonDanger =
  'inline-flex h-10 items-center justify-center rounded-xl bg-rose-500/10 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/20 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60'

/** Money is stored per organization, so amounts render with the workspace currency. */
export function formatMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString('en-KE')}`
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const thClass =
  'bg-wash px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:rounded-l-xl last:rounded-r-xl'
export const tdClass = 'px-4 py-3.5 text-sm text-slate-700'

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="surface p-5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

const NOTICE_TONES = {
  error: 'bg-rose-500/10 text-rose-800',
  success: 'bg-emerald-500/10 text-emerald-800',
  info: 'bg-wash text-slate-700',
  warning: 'bg-amber-500/15 text-amber-900',
} as const

export function Notice({
  tone = 'error',
  children,
  onRetry,
}: {
  tone?: keyof typeof NOTICE_TONES
  children: ReactNode
  onRetry?: () => void
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${NOTICE_TONES[tone]}`}>
      <span>{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-slate-500">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" />
      {label}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="well px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      {children}
      {hint && <span className="mt-1 block text-[11px] font-normal text-slate-400">{hint}</span>}
    </label>
  )
}

/** Renders a page of rows plus the shared "nothing here yet" state. */
export function DataTable({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0">
        <thead>
          <tr>
            {head.map((column) => (
              <th key={column} scope="col" className={thClass}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {/* Rows read as one continuous list: a barely-there zebra plus a hover
            wash replaces the row rules the tables used to draw. */}
        <tbody className="[&>tr]:transition-colors [&>tr:nth-child(even)]:bg-slate-900/[0.015] [&>tr:hover]:bg-wash">
          {children}
        </tbody>
      </table>
    </div>
  )
}

export function PaginationNote({ count, total }: { count: number; total?: number }) {
  return (
    <p className="mt-3 text-xs text-slate-400">
      Showing {count} {count === 1 ? 'record' : 'records'}
      {total !== undefined && total !== count ? ` of ${total}` : ''}.
    </p>
  )
}
/** One entry in a tab's inner sidebar (the integrations list, the channel list, …). */
export function SidebarItem({
  label,
  active,
  onClick,
  trailing,
}: {
  label: string
  active: boolean
  onClick: () => void
  /** Optional right-aligned extra — a status dot, a count pill, … */
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
        active ? 'bg-emerald-700 text-white shadow-sm shadow-emerald-900/20' : 'text-slate-600 hover:bg-wash hover:text-slate-900'
      }`}
    >
      <span className="truncate">{label}</span>
      {trailing}
    </button>
  )
}
