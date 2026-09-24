'use client'

import { useState } from 'react'
import type { MemberDto } from '@/lib/api/dto'
import { apiDelete, apiGet, apiSend } from '@/lib/api/client'
import {
  DataTable,
  EmptyState,
  Field,
  Notice,
  Panel,
  Spinner,
  buttonPrimary,
  formatDate,
  inputClass,
  selectClass,
  tdClass,
} from './ui'
import { useResource } from './use-resource'

const ASSIGNABLE_ROLES = ['ADMIN', 'ANALYST', 'SALES'] as const
const ALL_ROLES = ['OWNER', ...ASSIGNABLE_ROLES] as const
const STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED'] as const

export default function TeamTab({ canManage, currentUserId }: { canManage: boolean; currentUserId: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('SALES')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, error, loading, reload } = useResource(() => apiGet<MemberDto[]>('/api/v1/team'), [])

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      const member = await apiSend<MemberDto>('/api/v1/team', 'POST', {
        email: email.trim().toLowerCase(),
        role,
      })
      setEmail('')
      setNotice(`${member.name} was added as ${member.role}.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not add that person.')
    } finally {
      setBusy(false)
    }
  }

  async function patch(member: MemberDto, input: { role?: string; status?: string }) {
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<MemberDto>(`/api/v1/team/${member.id}`, 'PATCH', input)
      setNotice(`${member.name} updated.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not update that member.')
    }
  }

  async function remove(member: MemberDto) {
    if (!window.confirm(`Remove ${member.name} from this organization?`)) return
    setMutationError(null)
    setNotice(null)
    try {
      await apiDelete(`/api/v1/team/${member.id}`)
      setNotice(`${member.name} was removed.`)
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not remove that member.')
    }
  }

  const rows = data ?? []

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      {canManage && (
        <Panel
          title="Add a teammate"
          description="They need a ReorderIQ account first — add them by the email they signed up with."
        >
          <form onSubmit={invite} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field label="Work email">
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(event) => setRole(event.target.value)} className={selectClass}>
                {ASSIGNABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" disabled={busy} className={buttonPrimary}>
              {busy ? 'Adding…' : 'Add member'}
            </button>
          </form>
        </Panel>
      )}

      <Panel title="Team" description="Who can see and act on this workspace's data.">
        {loading ? (
          <Spinner label="Loading team…" />
        ) : error ? (
          <Notice onRetry={reload}>{error.message}</Notice>
        ) : rows.length === 0 ? (
          <EmptyState title="No members" description="Add a teammate to collaborate on reorder opportunities." />
        ) : (
          <DataTable head={['Name', 'Email', 'Role', 'Status', 'Joined', '']}>
            {rows.map((member) => (
              <tr key={member.id}>
                <td className={`${tdClass} font-medium text-slate-900`}>{member.name}</td>
                <td className={tdClass}>{member.email}</td>
                <td className={tdClass}>
                  {canManage ? (
                    <select
                      value={member.role}
                      onChange={(event) => void patch(member, { role: event.target.value })}
                      aria-label={`Role for ${member.name}`}
                      className={`${selectClass} mt-0 h-9 w-32`}
                    >
                      {ALL_ROLES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
                <td className={tdClass}>
                  {canManage ? (
                    <select
                      value={member.status}
                      onChange={(event) => void patch(member, { status: event.target.value })}
                      aria-label={`Status for ${member.name}`}
                      className={`${selectClass} mt-0 h-9 w-36`}
                    >
                      {STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.status
                  )}
                </td>
                <td className={tdClass}>{formatDate(member.createdAt)}</td>
                <td className={tdClass}>
                  {canManage && member.userId !== currentUserId && member.role !== 'OWNER' && (
                    <button
                      type="button"
                      onClick={() => void remove(member)}
                      className="text-xs font-semibold text-rose-700 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
