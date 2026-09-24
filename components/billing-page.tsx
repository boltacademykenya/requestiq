'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, CreditCard, FileText, X } from 'lucide-react'
import type { SubscriptionDto } from '@/lib/api/dto'
import { formatKes, pricingPlans } from '@/lib/pricing'

const PLAN_LABELS: Record<SubscriptionDto['plan'], string> = {
  SMALL: 'Small Business',
  MEDIUM: 'Medium Business',
  LARGE: 'Large Business',
  CUSTOM: 'Custom',
}

const PROVIDER_LABELS: Record<SubscriptionDto['paymentProvider'], string> = {
  NONE: 'Not set',
  MPESA: 'M-Pesa',
  PAYSTACK: 'Paystack',
  INVOICE: 'Invoice',
}

const STATUS_STYLES: Record<SubscriptionDto['status'], { label: string; className: string }> = {
  TRIALING: { label: 'Trial', className: 'bg-amber-50 text-amber-700' },
  ACTIVE: { label: 'Active', className: 'bg-emerald-50 text-emerald-700' },
  PAST_DUE: { label: 'Past due', className: 'bg-rose-50 text-rose-700' },
  CANCELLED: { label: 'Cancelled', className: 'bg-rose-50 text-rose-700' },
}

type EditablePlan = Extract<SubscriptionDto['plan'], 'SMALL' | 'MEDIUM' | 'LARGE'>
const EDITABLE_PLANS: EditablePlan[] = ['SMALL', 'MEDIUM', 'LARGE']

function priceLabelFor(plan: SubscriptionDto['plan']) {
  return pricingPlans.find((item) => item.id === plan.toLowerCase())?.priceLabel ?? 'Custom'
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<EditablePlan>('SMALL')
  const [cancelOpen, setCancelOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch('/api/v1/billing/subscription', { headers: { Accept: 'application/json' } })
      const payload = (await response.json().catch(() => null)) as
        | { data?: SubscriptionDto; error?: { message?: string } }
        | null
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? 'We could not load your subscription.')
      }
      setSubscription(payload.data)
      if (payload.data.plan !== 'CUSTOM') setPlan(payload.data.plan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not load your subscription.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function update(input: Record<string, unknown>, successMessage: string) {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/v1/billing/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = (await response.json().catch(() => null)) as
        | { data?: SubscriptionDto; error?: { message?: string } }
        | null
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? 'We could not update your subscription.')
      }
      setSubscription(payload.data)
      if (payload.data.plan !== 'CUSTOM') setPlan(payload.data.plan)
      setNotice(successMessage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not update your subscription.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-slate-950">
      <header className="bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/workspace" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
            <ArrowLeft size={16} /> Back to workspace
          </Link>
          <Link href="/" className="text-lg font-bold tracking-tight">ReorderIQ</Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-12 lg:px-8">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Workspace billing</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight">Billing</h1>
          <p className="mt-3 text-sm text-slate-500">Manage your ReorderIQ subscription and payment preferences.</p>
        </div>

        {loading ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" />
            <p className="mt-4 text-sm text-slate-500">Loading your subscription…</p>
          </div>
        ) : !subscription ? (
          <div className="mt-10 rounded-2xl bg-rose-500/10 p-6 text-sm text-rose-800">
            <p className="font-semibold">We could not load your subscription.</p>
            <p className="mt-1">{error ?? 'Please try again in a moment.'}</p>
            <button onClick={() => void load()} className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">
              Retry
            </button>
          </div>
        ) : (
          <>
            {error && <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>}
            {notice && (
              <p className="mt-6 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                <CheckCircle2 size={16} /> {notice}
              </p>
            )}

            <div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
              <section className="surface p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
                    <h2 className="mt-2 text-2xl font-semibold">{PLAN_LABELS[subscription.plan]}</h2>
                    <p className="mt-2 text-3xl font-bold">
                      {subscription.plan === 'CUSTOM' ? 'Custom' : formatKes(subscription.amount)}
                      {subscription.plan !== 'CUSTOM' && <span className="ml-1 text-sm font-normal text-slate-500">/ month</span>}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[subscription.status].className}`}>
                    {STATUS_STYLES[subscription.status].label}
                  </span>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">Next billing date</p>
                    <p className="mt-2 text-sm font-semibold">{formatDate(subscription.currentPeriodEnd)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">Payment method</p>
                    <p className="mt-2 text-sm font-semibold">{PROVIDER_LABELS[subscription.paymentProvider]}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">Seats</p>
                    <p className="mt-2 text-sm font-semibold">{subscription.seats}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/pricing" className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Compare Plans</Link>
                  {!subscription.cancelAtPeriodEnd && subscription.status !== 'CANCELLED' && (
                    <button onClick={() => setCancelOpen(true)} className="rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-500/20">Cancel Subscription</button>
                  )}
                </div>
              </section>

              <section className="surface p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CreditCard size={18} /></div>
                  <div>
                    <h2 className="font-semibold">Change plan</h2>
                    <p className="text-xs text-slate-500">The plan price is applied server-side on confirmation.</p>
                  </div>
                </div>
                <select
                  value={plan}
                  onChange={(event) => setPlan(event.target.value as EditablePlan)}
                  className="field mt-6 h-11 w-full px-3.5 text-sm"
                >
                  {EDITABLE_PLANS.map((option) => (
                    <option key={option} value={option}>
                      {PLAN_LABELS[option]} · {priceLabelFor(option)} / month
                    </option>
                  ))}
                </select>
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
                  <p>New monthly price <b className="float-right">{priceLabelFor(plan)}</b></p>
                  <p className="mt-3 text-slate-500">Billing starts <b className="float-right text-slate-900">{formatDate(subscription.currentPeriodEnd)}</b></p>
                </div>
                <button
                  onClick={() => void update({ plan }, `Your subscription is now on the ${PLAN_LABELS[plan]} plan.`)}
                  disabled={saving || plan === subscription.plan}
                  className="mt-4 w-full rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving…' : plan === subscription.plan ? 'Current plan' : 'Confirm Plan Change'}
                </button>
              </section>
            </div>

            <section className="surface mt-5">
              <div className="p-6 pb-2">
                <h2 className="font-semibold">Billing history</h2>
                <p className="mt-1 text-xs text-slate-500">Provider-confirmed invoices and payment status.</p>
              </div>
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <FileText className="text-slate-300" size={28} />
                <p className="mt-4 text-sm font-semibold text-slate-700">No invoices yet</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Invoices appear here once a payment has been collected by the provider.
                </p>
              </div>
            </section>
          </>
        )}
      </div>

      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-5">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-lift">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">Are you sure you want to cancel your subscription?</h2>
              <button onClick={() => setCancelOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-500">
              Your subscription stays active until the end of the current billing period, then will not renew. Your business data is not deleted.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setCancelOpen(false)} className="rounded-xl bg-wash px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-wash-strong">Keep Subscription</button>
              <button
                onClick={() => {
                  setCancelOpen(false)
                  void update({ cancelAtPeriodEnd: true }, 'Your subscription will end at the close of the current billing period.')
                }}
                disabled={saving}
                className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Cancel Subscription
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
