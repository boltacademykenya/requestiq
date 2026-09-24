'use client'

import { Menu } from '@base-ui/react/menu'
import { ChevronDown, LogOut, Settings } from 'lucide-react'
import { useSignOut } from './use-sign-out'

/**
 * Account menu in the workspace header: who is signed in, a shortcut to the
 * settings tab and the sign-out action.
 *
 * Built on Base UI's Menu so the interaction is the expected one rather than a
 * hand-rolled approximation: Escape closes it, arrow keys move between items,
 * outside clicks dismiss it and focus returns to the trigger. The menu is a
 * portal, so opening it can never be clipped by the sticky header.
 */
const itemClass =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-slate-600 transition outline-none data-[highlighted]:bg-wash data-[highlighted]:text-slate-900 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60'

const dangerItemClass =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-700 transition outline-none data-[highlighted]:bg-rose-500/10 data-[highlighted]:text-rose-800 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60'

export default function UserMenu({
  name,
  email,
  onOpenSettings,
}: {
  name: string
  email: string
  /** Switches the workspace to the settings tab; omitted if the caller has none. */
  onOpenSettings?: () => void
}) {
  const { signOut, pending, error } = useSignOut()
  const initial = (name.trim().charAt(0) || email.trim().charAt(0) || 'U').toUpperCase()

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account menu"
        disabled={pending}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-wash data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
          {initial}
        </span>
        <span className="hidden max-w-40 truncate text-xs font-semibold text-slate-700 sm:block">{name}</span>
        {pending ? (
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-700" />
        ) : (
          <ChevronDown aria-hidden size={14} className="text-slate-400" />
        )}
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="w-64 rounded-2xl bg-white p-2 shadow-lift">
            <div className="px-3 pb-2 pt-1">
              <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
              <p className="truncate text-xs text-slate-500">{email}</p>
            </div>

            <Menu.Separator className="mx-2 my-1 h-px bg-slate-900/5" />

            {onOpenSettings && (
              <Menu.Item onClick={onOpenSettings} className={itemClass}>
                <Settings aria-hidden size={15} />
                Workspace settings
              </Menu.Item>
            )}

            {/* Kept open while signing out so a failure is visible where the
                action was taken; a success navigates and unloads the page. */}
            <Menu.Item
              onClick={signOut}
              closeOnClick={false}
              disabled={pending}
              className={dangerItemClass}
            >
              <LogOut aria-hidden size={15} />
              {pending ? 'Signing out…' : 'Sign out'}
            </Menu.Item>

            {error && (
              <p role="alert" className="px-3 pb-1 pt-2 text-xs leading-5 text-rose-600">
                {error}
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
