'use client'

import { LogOut } from 'lucide-react'
import { useSignOut } from './use-sign-out'
import { buttonSecondary } from './ui'

/**
 * Compact sign-out for surfaces that are not the workspace shell (the staff
 * leads inbox), where an account menu would be out of place. Revocation,
 * cookie clearing and the redirect all come from `useSignOut`.
 */
export default function SignOutButton({ className = '' }: { className?: string }) {
  const { signOut, pending, error } = useSignOut()

  return (
    <div className={`flex flex-col items-end gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        aria-busy={pending}
        className={`${buttonSecondary} gap-2`}
      >
        <LogOut aria-hidden size={15} />
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="max-w-64 text-right text-xs leading-5 text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
