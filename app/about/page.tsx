import Link from 'next/link'
import { BarChart3, CheckCircle2, Clock3, Database, ShoppingBasket, Sparkles, Store, Truck, Users } from 'lucide-react'
import { InfoPageShell, InfoCta, ArticleSection } from '@/components/info-page-shell'

const steps = [
  ['01', 'Connect Your Data', 'Bring customer and order information into ReorderIQ through available integrations or supported data imports.'],
  ['02', 'Understand Customer Patterns', 'Review purchase frequency, previous purchases, order intervals, and customer value.'],
  ['03', 'Identify Reorder Opportunities', 'Surface customers who are approaching their expected reorder period as potential opportunities.'],
  ['04', 'Take Action', 'Prioritize outreach and retention activities around the customers most likely to need attention.'],
  ['05', 'Generate Repeat Sales', 'Turn timely customer follow-up into more opportunities for repeat purchases.'],
]

const audiences = [
  { title: 'Food & Grocery', copy: 'For businesses selling products customers regularly replenish.', Icon: Store },
  { title: 'Ecommerce', copy: 'For stores with repeat-purchase products and returning customers.', Icon: ShoppingBasket },
  { title: 'Wholesale & Distribution', copy: 'For businesses managing recurring customer orders.', Icon: Truck },
  { title: 'Subscription & Recurring Purchase Businesses', copy: 'For businesses where customer purchase cycles can be tracked over time.', Icon: Clock3 },
  { title: 'Other Repeat-Purchase Businesses', copy: 'For businesses that want better visibility into customer reorder behavior.', Icon: Users },
]

export const metadata = { title: 'About ReorderIQ', description: 'Learn how ReorderIQ turns customer purchase history into actionable repeat revenue opportunities.' }

export default function AboutPage() {
  return <InfoPageShell eyebrow="ABOUT REORDERIQ" title="Turn Customer Purchase History Into Your Next Sale." description="ReorderIQ helps businesses understand customer purchasing patterns, identify when customers are ready to reorder, and take action before repeat sales are missed.">
    <div className="flex flex-wrap gap-3"><Link href="/contact" className="inline-flex items-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-soft transition hover:text-emerald-700">Talk to Us</Link></div>
    <ArticleSection title="Most businesses already have the data they need."><p>Every order tells a story. Customers buy at different intervals, spend different amounts, and develop different purchasing patterns. But as customer data grows, it becomes difficult to manually track who is due to reorder and when.</p><div className="grid gap-3 sm:grid-cols-3"><div className="surface p-4"><Database className="text-emerald-700" size={20} /><p className="mt-3 font-semibold text-slate-900">Orders</p></div><div className="surface p-4"><Users className="text-emerald-700" size={20} /><p className="mt-3 font-semibold text-slate-900">Customer History</p></div><div className="rounded-2xl bg-rose-500/10 p-4"><Clock3 className="text-rose-700" size={20} /><p className="mt-3 font-semibold text-rose-900">Missed Reorder Opportunities</p></div></div><p>ReorderIQ turns that history into actionable reorder opportunities.</p></ArticleSection>
    <ArticleSection title="Built around one simple question."><div className="rounded-2xl bg-slate-950 p-6 text-2xl font-bold tracking-tight text-white sm:p-8 sm:text-3xl">“Who is ready to buy again?”</div><p>ReorderIQ was created around a simple business problem: repeat customers are valuable, but knowing exactly when to reach out can be difficult. Instead of treating every customer the same, ReorderIQ looks at purchasing patterns to help businesses identify customers who may be approaching their next expected purchase.</p></ArticleSection>
    <ArticleSection title="From historical orders to repeat revenue opportunities."><div className="grid gap-4 md:grid-cols-5">{steps.map(([number, title, copy]) => <div key={number} className="surface p-5"><span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-800">{number}</span><h3 className="mt-3 font-semibold text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p></div>)}</div></ArticleSection>
    <ArticleSection title="Built for businesses where customers buy again."><div className="grid gap-4 sm:grid-cols-2">{audiences.map(({ title, copy, Icon }) => <div key={title} className="surface p-5"><Icon className="text-emerald-700" size={20} /><h3 className="mt-4 font-semibold text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p></div>)}</div><p>ReorderIQ is designed around repeat purchasing behavior and can be adapted to different business models.</p></ArticleSection>
    <ArticleSection title="Data should lead to action."><div className="grid gap-4 sm:grid-cols-3">{[{ number: '01', title: 'Make Customer Data Useful', copy: 'Customer data should help businesses make decisions, not simply sit inside reports.', Icon: BarChart3 }, { number: '02', title: 'Focus on Timing', copy: 'The value of customer insights often depends on acting at the right time.', Icon: Clock3 }, { number: '03', title: 'Keep It Practical', copy: 'Move from customer history to clear opportunities for action.', Icon: CheckCircle2 }].map(({ number, title, copy, Icon }) => <div key={number} className="well p-5"><Icon className="text-emerald-700" size={20} /><span className="mt-5 block text-xs font-bold text-emerald-700">{number}</span><h3 className="mt-2 font-semibold text-slate-900">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{copy}</p></div>)}</div></ArticleSection>
    <ArticleSection title="Not another dashboard full of numbers."><p>ReorderIQ is designed to connect customer data with a practical business action: identifying opportunities to engage customers when they may be ready to purchase again.</p></ArticleSection>
    <ArticleSection title="Building a smarter way to grow repeat revenue."><p>ReorderIQ is being developed to help businesses make better use of the customer relationships they have already built. As the platform evolves, the focus remains on helping businesses understand customer behavior, identify opportunities, and turn insights into action.</p></ArticleSection>
    <InfoCta />
  </InfoPageShell>
}
