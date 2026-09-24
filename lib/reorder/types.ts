/**
 * ReorderIQ domain types.
 *
 * Shared by the prediction engine (client and server), the database mappers and
 * the transport layer. This module is import-only (it has no runtime code), so
 * it is erased at build time and safe to import from anywhere.
 */

/** Customer lifecycle status derived from their order history. */
export type Status = 'NEW' | 'ACTIVE' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'AT_RISK' | 'DORMANT'

/** Persisted opportunity workflow status. Mirrors the `opportunity_status` enum. */
export type OpportunityStatus =
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'HIGH_OPPORTUNITY'
  | 'AT_RISK'
  | 'CONTACTED'
  | 'ORDER_CREATED'
  | 'CONVERTED'
  | 'DISMISSED'

/** How an order entered the system. Mirrors the `order_source` enum. */
export type OrderSource = 'MANUAL' | 'SIMULATED' | 'API' | 'IMPORT'

export type Organization = {
  id: string
  name: string
  industry: string
  country: string
  currency: string
  createdAt: Date
}

export type Product = {
  id: string
  organizationId: string
  name: string
  price: number
  category?: string
}

export type OrderProduct = {
  name: string
  quantity: number
}

export type Order = {
  id: string
  organizationId: string
  customerId: string
  date: Date
  total: number
  products: OrderProduct[]
  source: OrderSource
}

export type Customer = {
  id: string
  organizationId: string
  name: string
  initials: string
  phone: string
  email: string
  location: string
  customerType: string
  assignedSalesperson?: string
  orders: Order[]
  marketingOptIn: boolean
}

/** A customer plus the reorder prediction derived from their order history. */
export type CustomerInsight = Customer & {
  intervals: number[]
  averageInterval: number
  medianInterval: number
  confidence: number
  predictedNext: Date | null
  status: Status
  reorderScore: number
  totalSpend: number
  averageOrderValue: number
  recommendedProducts: string[]
  action: string
}
