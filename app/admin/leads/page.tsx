import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import AdminLeadsPage from '@/components/admin/leads-page'
import { auth } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/env'

/**
 * ReorderIQ staff inbox for inbound leads.
 *
 * Two independent gates protect this data:
 *  - this server guard keeps the page (and its existence) away from tenants
 *  - `platformAdmin: true` on the API routes rejects them even if they call the
 *    endpoint directly
 *
 * Non-admins get a 404 rather than a 403 so the surface is not advertised. With
 * `PLATFORM_ADMIN_EMAILS` unset, nobody is an admin and this page 404s for
 * everyone — the safe default.
 */
export default async function AdminLeadsPageRoute() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) redirect('/sign-in')
  if (!isPlatformAdmin(session.user.email)) notFound()

  return <AdminLeadsPage />
}
