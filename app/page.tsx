import type { Viewport } from 'next'

import MarketingHome from '@/components/marketing-home'

/*
 * The home page is a full-bleed poster: it opens on the clay announcement bar
 * and a deep pine hero rather than the light canvas the rest of the product
 * uses, so the browser chrome is tinted to match its own top edge.
 */
export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#bf5525',
}

export default function Page() { return <MarketingHome /> }
