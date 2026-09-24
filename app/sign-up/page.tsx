import Link from 'next/link'
import { AuthForm } from '@/components/auth-form'

export default function SignUpPage() { return <main className="flex min-h-screen items-center justify-center bg-canvas p-4"><section className="w-full max-w-md surface p-7"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">ReorderIQ</p><h1 className="mt-2 text-2xl font-semibold text-slate-950">Create your organization account</h1><p className="mt-2 text-sm text-slate-500">Start with a secure workspace for your team and repeat revenue data.</p><div className="mt-6"><AuthForm mode="sign-up" /></div><p className="mt-5 text-center text-xs text-slate-500">Already have an account? <Link href="/sign-in" className="font-semibold text-emerald-700">Log in</Link></p></section></main> }
