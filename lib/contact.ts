export const contactConfig = {
  email: 'reorderiq@gmail.com',
  phoneDisplay: '0727 876 632',
  phoneHref: 'tel:+254727876632',
  whatsappHref: 'https://wa.me/254727876632',
} as const

export const contactTopics = [
  'Learn about ReorderIQ',
  'Request a Product Demo',
  'Pricing',
  'Custom Pricing',
  'Integration',
  'Existing Customer Support',
  'Partnership',
  'Other',
] as const

export type ContactTopic = (typeof contactTopics)[number]

export function isContactTopic(value: string): value is ContactTopic {
  return contactTopics.includes(value as ContactTopic)
}
