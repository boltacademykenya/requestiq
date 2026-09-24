'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Activity,
  BarChart3,
  Bell,
  Database,
  History,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Package,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react'
import type { SessionDto } from '@/lib/api/dto'
import { apiGet, apiSend } from '@/lib/api/client'
import AuditTab from './workspace/audit-tab'
import CampaignsTab from './workspace/campaigns-tab'
import CustomersTab from './workspace/customers-tab'
import IntegrationsTab from './workspace/integrations-tab'
import MessagesTab from './workspace/messages-tab'
import OpportunitiesTab from './workspace/opportunities-tab'
import OrdersTab from './workspace/orders-tab'
import OverviewTab from './workspace/overview-tab'
import ProductsTab from './workspace/products-tab'
import SettingsTab from './workspace/settings-tab'
import TeamTab from './workspace/team-tab'
import UserMenu from './workspace/user-menu'
import { Notice, Panel, buttonPrimary, inputClass } from './workspace/ui'
import { useResource } from './workspace/use-resource'

/** A workspace section. `capability` mirrors the check the API route performs. */
type Tab = {
  label: string
  icon: typeof LayoutDashboard
  capability: string
  /** Shown once the section data is loaded, with the caller's capability for writes. */
  render: (session: SessionDto, can: (capability: string) => boolean) => ReactNode
}

const TABS: Tab[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    capability: 'customer:read',
    render: () => <OverviewTab variant="dashboard" />,
  },
  {
    label: 'Customers',
    icon: Users,
    capability: 'customer:read',
    render: (_session, can) => (
      <CustomersTab canWrite={can('customer:write')} canManageSources={can('integration:manage')} />
    ),
  },
  {
    label: 'Reorder Opportunities',
    icon: Sparkles,
    capability: 'opportunity:read',
    render: (session, can) => (
      <OpportunitiesTab canWrite={can('opportunity:write')} currency={session.organization?.currency ?? 'KES'} />
    ),
  },
  {
    label: 'Orders',
    icon: RefreshCw,
    capability: 'order:read',
    render: (session, can) => (
      <OrdersTab canWrite={can('order:write')} currency={session.organization?.currency ?? 'KES'} />
    ),
  },
  {
    label: 'Products',
    icon: Package,
    capability: 'product:read',
    render: (session, can) => (
      <ProductsTab canWrite={can('product:write')} currency={session.organization?.currency ?? 'KES'} />
    ),
  },
  { label: 'Analytics', icon: BarChart3, capability: 'customer:read', render: () => <OverviewTab variant="analytics" /> },
  {
    label: 'Campaigns',
    icon: Send,
    capability: 'campaign:read',
    render: (_session, can) => <CampaignsTab canWrite={can('campaign:write')} />,
  },
  {
    label: 'Messages',
    icon: MessageSquare,
    capability: 'message:read',
    render: (_session, can) => <MessagesTab canWrite={can('message:write')} />,
  },
  {
    label: 'Integrations',
    icon: Database,
    capability: 'integration:read',
    render: (_session, can) => <IntegrationsTab canManage={can('integration:manage')} />,
  },
  {
    label: 'Team',
    icon: Users,
    capability: 'member:read',
    render: (session, can) => (
      <TeamTab canManage={can('member:manage')} currentUserId={session.user.id} />
    ),
  },
  { label: 'Activity', icon: History, capability: 'audit:read', render: () => <AuditTab /> },
  {
    label: 'Settings',
    icon: Settings,
    capability: 'org:read',
    render: (_session, can) => <SettingsTab canUpdate={can('org:update')} />,
  },
]

/** First-run state: the account exists but has no workspace yet. */
function OnboardingPanel({ onDone }: { onDone: () => void }) {
  const [organizationName, setOrganizationName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Idempotent server-side, so a retry can never fork a second workspace.
      await apiSend('/api/v1/organizations/onboard', 'POST', { organizationName: organizationName.trim() })
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not create your workspace.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <Panel title="Create your workspace" description="Your account is ready — name the organization to continue.">
        {error && (
          <div className="mb-4">
            <Notice>{error}</Notice>
          </div>
        )}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="block text-xs font-medium text-slate-700">
            Organization name
            <input
              required
              minLength={2}
              maxLength={160}
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Acme Foods Ltd"
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={busy} className={buttonPrimary}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      </Panel>
    </div>
  )
}

export default function WorkspaceClient() {
  // The session endpoint is the bootstrap payload: who, which org, and what they may do.
  const { data: session, error, loading, reload } = useResource<SessionDto>(
    () => apiGet<SessionDto>('/api/v1/session'),
    [],
  )
  const [activeLabel, setActiveLabel] = useState('Dashboard')

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-emerald-700 border-r-transparent" />
          <p className="mt-4 text-sm text-slate-600">Loading workspace…</p>
        </div>
      </div>
    )
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md">
          <Notice onRetry={reload}>{error?.message ?? 'We could not load your workspace.'}</Notice>
        </div>
      </div>
    )
  }

  // The session endpoint answers 200 with `user: null` once the cookie no longer
  // resolves to a live session — the account signed out in another tab, or the
  // session was revoked. The server page guards this route, so that can only
  // happen mid-session: acknowledge it and offer the way back in rather than
  // rendering a shell with no one in it.
  const user = session.user
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md space-y-3">
          <Notice tone="info">Your session has ended. Sign in again to reopen your workspace.</Notice>
          <Link href="/sign-in" className={`${buttonPrimary} w-full`}>
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  const can = (capability: string) => session.capabilities.includes(capability)
  const visibleTabs = TABS.filter((tab) => can(tab.capability))
  const active = visibleTabs.find((tab) => tab.label === activeLabel) ?? visibleTabs[0]
  const organization = session.organization

  return (
    <div className="min-h-screen bg-canvas text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 bg-[#0f2224] text-white shadow-[14px_0_40px_-36px_rgba(15,23,42,0.9)] lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <Activity size={17} />
          </div>
          <div>
            <p className="text-sm font-bold">
              Reorder<span className="text-emerald-700">IQ</span>
            </p>
            <p className="text-[9px] uppercase tracking-[.18em] text-slate-400">Revenue intelligence</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon
            const isActive = active?.label === tab.label
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => setActiveLabel(tab.label)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-[0_10px_24px_-16px_rgb(16_185_129/0.9)]'
                    : 'text-slate-300/85 hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            )
          })}
        </nav>

        <div className="m-3 rounded-2xl bg-white/[0.07] p-4">
          <p className="text-xs font-semibold text-white">{organization?.name ?? 'Your Organization'}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {organization ? `${organization.industry} · ${session.role}` : 'No workspace yet'}
          </p>
        </div>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 bottom-3 z-30 flex gap-1 overflow-x-auto rounded-2xl bg-white/95 px-1.5 py-2 shadow-lift backdrop-blur-xl lg:hidden"
      >
        {visibleTabs.slice(0, 5).map((tab) => {
          const Icon = tab.icon
          const isActive = active?.label === tab.label
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => setActiveLabel(tab.label)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium transition ${
                isActive ? 'bg-emerald-500/10 text-emerald-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={17} />
              <span className="max-w-full truncate">
                {tab.label === 'Reorder Opportunities' ? 'Predictions' : tab.label}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-canvas/85 px-4 shadow-header backdrop-blur-md md:px-8">
          <div className="flex items-center gap-3">
            <Menu className="lg:hidden" size={20} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-emerald-700">
                Customer retention platform
              </p>
              <h1 className="text-base font-semibold">{active?.label ?? 'Workspace'}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Bell size={17} className="text-slate-500" />
            {/* Identity, settings shortcut and sign-out live together: the
                avatar is the account affordance people already reach for. */}
            <UserMenu name={user.name} email={user.email} onOpenSettings={() => setActiveLabel('Settings')} />
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] p-4 pb-20 md:p-8 lg:pb-8">
          {!organization ? (
            <OnboardingPanel onDone={reload} />
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-semibold tracking-tight">{active?.label}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {active?.label === 'Dashboard'
                    ? 'Predict when customers are likely to reorder and turn history into repeat sales.'
                    : `Manage your ${active?.label.toLowerCase()} from the ReorderIQ workspace.`}
                </p>
              </div>
              {active?.render(session, can)}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
