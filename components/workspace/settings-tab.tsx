'use client'

import { useEffect, useState } from 'react'
import type { OrganizationDto } from '@/lib/api/dto'
import { apiGet, apiSend } from '@/lib/api/client'
import {
  Field,
  Notice,
  Panel,
  Spinner,
  buttonPrimary,
  inputClass,
  selectClass,
} from './ui'
import { useResource } from './use-resource'

const CURRENCIES = ['KES', 'USD', 'UGX', 'TZS', 'NGN', 'ZAR', 'EUR', 'GBP'] as const

type FormState = {
  name: string
  industry: string
  country: string
  currency: string
  timezone: string
}

const EMPTY_FORM: FormState = { name: '', industry: '', country: '', currency: 'KES', timezone: '' }

export default function SettingsTab({ canUpdate }: { canUpdate: boolean }) {
  const { data, error, loading, reload } = useResource(
    () => apiGet<OrganizationDto>('/api/v1/organization'),
    [],
  )
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Seed the form whenever the canonical organization record (re)loads.
  useEffect(() => {
    if (!data) return
    setForm({
      name: data.name,
      industry: data.industry,
      country: data.country,
      currency: data.currency,
      timezone: data.timezone,
    })
  }, [data])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMutationError(null)
    setNotice(null)
    try {
      await apiSend<OrganizationDto>('/api/v1/organization', 'PATCH', {
        name: form.name.trim(),
        industry: form.industry.trim(),
        country: form.country.trim(),
        currency: form.currency,
        timezone: form.timezone.trim(),
      })
      setNotice('Workspace settings saved.')
      reload()
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'We could not save your settings.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner label="Loading workspace settings…" />
  if (error) return <Notice onRetry={reload}>{error.message}</Notice>
  if (!data) return null

  return (
    <div className="space-y-5">
      {mutationError && <Notice>{mutationError}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel
        title="Workspace profile"
        description={`Identifier: ${data.slug} · created ${new Date(data.createdAt).toLocaleDateString('en-KE')}`}
      >
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Organization name" hint="2–160 characters.">
            <input
              required
              minLength={2}
              maxLength={160}
              disabled={!canUpdate}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Industry">
            <input
              disabled={!canUpdate}
              value={form.industry}
              onChange={(event) => setForm({ ...form, industry: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Country">
            <input
              disabled={!canUpdate}
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Currency" hint="Applied to prices, order totals and forecasts.">
            <select
              disabled={!canUpdate}
              value={form.currency}
              onChange={(event) => setForm({ ...form, currency: event.target.value })}
              className={selectClass}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timezone" hint="IANA name, e.g. Africa/Nairobi.">
            <input
              disabled={!canUpdate}
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="flex items-end">
            <button type="submit" disabled={busy || !canUpdate} className={buttonPrimary}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
        {!canUpdate && (
          <div className="mt-4">
            <Notice tone="info">Your role can view these settings but not change them.</Notice>
          </div>
        )}
      </Panel>
    </div>
  )
}
