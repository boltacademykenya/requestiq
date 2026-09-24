'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

/** Maps better-auth error codes to messages that help the user fix the problem. */
function describeAuthError(error: { code?: string; message?: string }) {
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password combination is not correct.'
    // better-auth returns 422 with this code when the email is already registered.
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'USER_ALREADY_EXISTS':
      return 'An account with that email already exists. Try signing in instead.'
    case 'PASSWORD_TOO_SHORT':
      return 'Choose a password with at least 10 characters.'
    case 'PASSWORD_TOO_LONG':
      return 'Choose a shorter password (128 characters maximum).'
    case 'INVALID_EMAIL':
      return 'Enter a valid email address.'
    case 'FAILED_TO_CREATE_USER':
      return 'We could not create your account. Please try again in a moment.'
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Please wait a few minutes and try again.'
    default:
      return 'We could not complete that request. Check your details and try again.'
  }
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [organization, setOrganization] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isSignUp = mode === 'sign-up'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (isSignUp) {
        const signUp = await authClient.signUp.email({ email, password, name: name.trim() || organization.trim() })
        if (signUp.error) {
          setError(describeAuthError(signUp.error))
          return
        }

        // better-auth owns identities; the API owns the workspace. Onboarding is
        // idempotent, so retrying here can never create a duplicate organization.
        const onboarded = await fetch('/api/v1/organizations/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ organizationName: organization.trim() }),
        })

        if (!onboarded.ok) {
          const payload = (await onboarded.json().catch(() => null)) as { error?: { message?: string } } | null
          setError(
            payload?.error?.message ??
              'Your account was created, but we could not create the workspace. Please sign in and try again.',
          )
          return
        }
      } else {
        const signIn = await authClient.signIn.email({ email, password })
        if (signIn.error) {
          setError(describeAuthError(signIn.error))
          return
        }
      }

      // `/` is the public marketing page; the signed-in app lives at /workspace.
      router.push('/workspace')
      router.refresh()
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return <form onSubmit={submit} className="flex flex-col gap-4">
    {isSignUp && <><label className="text-xs font-medium text-slate-700">Organization name<input required value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Acme Foods Ltd" className="field mt-1 h-11 w-full px-3.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">Your name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Doe" className="field mt-1 h-11 w-full px-3.5 text-sm" /></label></>}
    <label className="text-xs font-medium text-slate-700">Work email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-1 h-11 w-full px-3.5 text-sm" /></label>
    <label className="text-xs font-medium text-slate-700">Password<input required minLength={10} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="field mt-1 h-11 w-full px-3.5 text-sm" /></label>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    <button disabled={loading} className="h-11 rounded-lg bg-emerald-700 text-sm font-semibold text-white disabled:opacity-60">{loading ? 'Please wait…' : isSignUp ? 'Create organization account' : 'Log in to ReorderIQ'}</button>
  </form>
}
