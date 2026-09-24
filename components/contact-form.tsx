'use client'

import { FormEvent, useState } from 'react'
import { contactTopics } from '@/lib/contact'

const initialForm = { name: '', business: '', email: '', phone: '', topic: '', message: '', website: '' }

type FormState = typeof initialForm

function validate(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {}
  if (!form.name.trim()) errors.name = 'Enter your full name.'
  if (!form.business.trim()) errors.business = 'Enter your business name.'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address.'
  if (form.phone && !/^[+()\d\s-]{7,20}$/.test(form.phone)) errors.phone = 'Enter a valid phone number.'
  if (!form.topic) errors.topic = 'Choose what you need help with.'
  if (form.message.trim().length < 20) errors.message = 'Add at least 20 characters so we can help.'
  return errors
}

export default function ContactForm() {
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [notice, setNotice] = useState('')
  function update(key: keyof FormState, value: string) { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined })); setStatus('idle') }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const nextErrors = validate(form); setErrors(nextErrors); if (Object.keys(nextErrors).length) return
    setStatus('loading'); setNotice('')
    try { const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const payload = (await response.json().catch(() => null)) as { data?: { message?: string }; error?: { message?: string } } | null; if (!response.ok) throw new Error(payload?.error?.message ?? 'We could not process your message. Please email us directly.'); setStatus('success'); setNotice(payload?.data?.message ?? 'Thanks. Your message reached the ReorderIQ team.'); setForm(initialForm) } catch (error) { setStatus('error'); setNotice(error instanceof Error ? error.message : 'We could not process your message. Please email us directly.') }
  }
  return <form onSubmit={submit} noValidate className="space-y-5"><input type="text" name="website" value={form.website} onChange={(event) => update('website', event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />{[['name', 'Full Name', 'text', true], ['business', 'Business Name', 'text', true], ['email', 'Email Address', 'email', true], ['phone', 'Phone Number', 'tel', false]].map(([key, label, type, required]) => <label key={key as string} className="block text-sm font-semibold text-slate-800">{label as string}{required ? ' *' : ''}<input type={type as string} value={form[key as keyof FormState]} onChange={(event) => update(key as keyof FormState, event.target.value)} className="mt-2 w-full px-3.5 py-2.5 font-normal field focus:ring-4 focus:ring-emerald-600/10" required={required as boolean} />{errors[key as keyof FormState] && <span className="mt-1 block text-xs font-normal text-rose-600">{errors[key as keyof FormState]}</span>}</label>)}<label className="block text-sm font-semibold text-slate-800">What Can We Help You With? *<select value={form.topic} onChange={(event) => update('topic', event.target.value)} className="mt-2 w-full px-3.5 py-2.5 font-normal field focus:ring-4 focus:ring-emerald-600/10"><option value="">Select a topic</option>{contactTopics.map((topic) => <option key={topic}>{topic}</option>)}</select>{errors.topic && <span className="mt-1 block text-xs font-normal text-rose-600">{errors.topic}</span>}</label><label className="block text-sm font-semibold text-slate-800">Message *<textarea value={form.message} onChange={(event) => update('message', event.target.value)} rows={6} placeholder="Tell us a little about your business and what you would like to discuss." className="mt-2 w-full resize-y px-3.5 py-2.5 font-normal field focus:ring-4 focus:ring-emerald-600/10" />{errors.message && <span className="mt-1 block text-xs font-normal text-rose-600">{errors.message}</span>}</label><button disabled={status === 'loading'} className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{status === 'loading' ? 'Sending…' : 'Send Message'}</button>{notice && <p role="status" className={`rounded-xl px-4 py-3 text-sm ${status === 'success' ? 'bg-emerald-500/10 text-emerald-800' : 'bg-amber-500/15 text-amber-900'}`}>{notice}</p>}</form>
}
