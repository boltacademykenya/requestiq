import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'
import { Notice } from '@/components/workspace/ui'

/**
 * Sign-out lands here with `?signedOut=1` so the page can confirm what just
 * happened; a bare login form after clicking "Sign out" reads like a failure.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ signedOut?: string | string[] }>
}) {
  const { signedOut } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <section className="w-full max-w-md surface p-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">ReorderIQ</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-500">Log in to your organization workspace.</p>
        {signedOut === '1' && (
          <div className="mt-5">
            <Notice tone="success">You have been signed out. Sign in again to reopen your workspace.</Notice>
          </div>
        )}
        <div className="mt-6">
          <AuthForm mode="sign-in" />
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">
          New organization?{' '}
          <Link href="/sign-up" className="font-semibold text-emerald-700">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  )
}

