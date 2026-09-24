/**
 * Role based capabilities.
 *
 * Every route declares the capability it needs, so authorization lives in one
 * place instead of being re-implemented per handler.
 */
export type Capability =
  | 'org:read'
  | 'org:update'
  | 'member:read'
  | 'member:manage'
  | 'customer:read'
  | 'customer:write'
  | 'order:read'
  | 'order:write'
  | 'product:read'
  | 'product:write'
  | 'opportunity:read'
  | 'opportunity:write'
  | 'campaign:read'
  | 'campaign:write'
  | 'message:read'
  | 'message:write'
  | 'integration:read'
  | 'integration:manage'
  | 'billing:read'
  | 'billing:manage'
  | 'audit:read'
// NOTE: there is deliberately no tenant capability for inbound contact-form
// leads. Those submissions come from an anonymous public form, so they cannot
// be attributed to a tenant; they are served by the platform surface gated on
// PLATFORM_ADMIN_EMAILS (see lib/env.ts and app/api/v1/platform/**).

export type RoleName = 'OWNER' | 'ADMIN' | 'ANALYST' | 'SALES'

const READ_ONLY: Capability[] = [
  'org:read',
  'member:read',
  'customer:read',
  'order:read',
  'product:read',
  'opportunity:read',
  'campaign:read',
  'message:read',
  'integration:read',
  'billing:read',
]

export const ROLE_CAPABILITIES: Record<RoleName, ReadonlySet<Capability>> = {
  OWNER: new Set<Capability>([
    ...READ_ONLY,
    'org:update',
    'member:manage',
    'customer:write',
    'order:write',
    'product:write',
    'opportunity:write',
    'campaign:write',
    'message:write',
    'integration:manage',
    'billing:manage',
    'audit:read',
  ]),
  ADMIN: new Set<Capability>([
    ...READ_ONLY,
    'org:update',
    'member:manage',
    'customer:write',
    'order:write',
    'product:write',
    'opportunity:write',
    'campaign:write',
    'message:write',
    'integration:manage',
    'billing:manage',
    'audit:read',
  ]),
  ANALYST: new Set<Capability>([...READ_ONLY, 'campaign:write']),
  SALES: new Set<Capability>([
    ...READ_ONLY,
    'customer:write',
    'order:write',
    'opportunity:write',
    'campaign:write',
    'message:write',
  ]),
}

export function hasCapability(role: RoleName, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability)
}

export function capabilitiesFor(role: RoleName): Capability[] {
  return [...ROLE_CAPABILITIES[role]].sort()
}
