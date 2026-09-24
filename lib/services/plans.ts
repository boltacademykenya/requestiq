import type { PlanIdDb } from '@/lib/db/schema'

/**
 * Commercial plans.
 *
 * Prices mirror `lib/pricing.ts` (the marketing source of truth) and are only
 * ever applied server-side: a client cannot choose its own price.
 */
export type PlanDefinition = {
  id: PlanIdDb
  label: string
  price: number
  seats: number
  paymentProvider: 'NONE' | 'MPESA' | 'PAYSTACK' | 'INVOICE'
  features: string[]
}

export const PLANS: Record<PlanIdDb, PlanDefinition> = {
  SMALL: {
    id: 'SMALL',
    label: 'Small Business',
    price: 8000,
    seats: 3,
    paymentProvider: 'MPESA',
    features: ['Reorder predictions', 'Customer profiles', 'Order history', 'Dashboard reporting'],
  },
  MEDIUM: {
    id: 'MEDIUM',
    label: 'Medium Business',
    price: 15000,
    seats: 8,
    paymentProvider: 'PAYSTACK',
    features: ['Everything in Small', 'Advanced insights', 'Segmentation', 'Campaigns', 'Revenue tracking'],
  },
  LARGE: {
    id: 'LARGE',
    label: 'Large Business',
    price: 20000,
    seats: 25,
    paymentProvider: 'PAYSTACK',
    features: ['Everything in Medium', 'Larger data capacity', 'Advanced reporting', 'Integrations'],
  },
  CUSTOM: {
    id: 'CUSTOM',
    label: 'Custom',
    price: 0,
    seats: 50,
    paymentProvider: 'INVOICE',
    features: ['Custom capacity', 'Custom integrations', 'Dedicated onboarding', 'Custom terms'],
  },
}

export function planFor(plan: PlanIdDb): PlanDefinition {
  return PLANS[plan]
}
