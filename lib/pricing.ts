export type PlanId = 'small' | 'medium' | 'large' | 'custom'

export type PricingPlan = {
  id: PlanId
  name: string
  price: number | null
  priceLabel: string
  currency: 'KSh'
  billingInterval: 'month' | null
  description: string
  features: string[]
  cta: string
  highlighted: boolean
  paymentProvider: 'paystack' | 'mpesa' | 'sales'
}

export const pricingPlans: PricingPlan[] = [
  { id: 'small', name: 'Small Business', price: 8000, priceLabel: 'KSh 8,000', currency: 'KSh', billingInterval: 'month', description: 'For small businesses building a repeat customer engine.', features: ['Customer reorder predictions', 'Customer purchase history', 'Reorder opportunities', 'Customer profiles', 'Order history', 'Basic analytics', 'Reorder reminders', 'Dashboard reporting', 'Email support'], cta: 'Start with Small', highlighted: false, paymentProvider: 'mpesa' },
  { id: 'medium', name: 'Medium Business', price: 15000, priceLabel: 'KSh 15,000', currency: 'KSh', billingInterval: 'month', description: 'For growing businesses managing more customers and repeat orders.', features: ['Everything in Small', 'Advanced reorder insights', 'Advanced analytics', 'Customer segmentation', 'Reorder campaigns', 'Revenue opportunity tracking', 'More team access', 'Priority support'], cta: 'Choose Medium', highlighted: true, paymentProvider: 'paystack' },
  { id: 'large', name: 'Large Business', price: 20000, priceLabel: 'KSh 20,000', currency: 'KSh', billingInterval: 'month', description: 'For established businesses with larger customer and order volumes.', features: ['Everything in Medium', 'Advanced customer insights', 'Larger data capacity', 'Advanced reporting', 'Multiple team members', 'Priority support', 'Advanced integrations', 'Business performance insights'], cta: 'Choose Large', highlighted: false, paymentProvider: 'paystack' },
  { id: 'custom', name: 'Custom', price: null, priceLabel: "Let's Talk", currency: 'KSh', billingInterval: null, description: 'For businesses with unique requirements or larger-scale operations.', features: ['Custom data capacity', 'Custom integrations', 'Dedicated onboarding', 'Custom workflows', 'Advanced reporting', 'Multiple teams', 'Dedicated support', 'Custom commercial terms'], cta: 'Talk to Sales', highlighted: false, paymentProvider: 'sales' },
]

export const faqs = [
  ['Is ReorderIQ billed monthly?', 'Yes. ReorderIQ uses a monthly subscription model.'],
  ['Can I change my plan?', 'Yes. Customers can upgrade or change their subscription from the Billing section.'],
  ['Which payment methods are supported?', 'ReorderIQ is being designed to support M-Pesa and Paystack.'],
  ['Can I request custom pricing?', 'Yes. Businesses with unique requirements can contact the ReorderIQ team for a customized plan.'],
  ['Can I cancel my subscription?', 'Yes. Subscription cancellation should be available from the Billing section.'],
  ['Is my payment information secure?', 'Payment credentials should be handled by the supported payment providers rather than stored directly by ReorderIQ.'],
] as const

export function getPlan(id: PlanId) { return pricingPlans.find((plan) => plan.id === id) ?? pricingPlans[0] }
export function formatKes(amount: number) { return `KSh ${amount.toLocaleString('en-KE')}` }
