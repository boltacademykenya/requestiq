'use client'

import Link from 'next/link'
import { Archivo } from 'next/font/google'
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Mail, Menu, Radar, Send, Sparkles, TrendingUp, Users, X } from 'lucide-react'
import { useState } from 'react'

/*
 * Marketing home.
 *
 * The page speaks the printed-poster language of the reference design: a warm
 * paper canvas, one dominant accent, hard offset shadows, a wide display face
 * on every headline, and artwork drawn from flat shapes instead of chrome.
 * The copy, the numbers and the product mocks are ReorderIQ's own.
 *
 * The italic face is only loaded so the swiped phrases in `.mark` can be set in
 * the real italic rather than a synthesised slant; it carries the same `wdth`
 * axis, so those phrases stay as wide as the headings they sit in.
 */
const display = Archivo({ subsets: ['latin'], axes: ['wdth'], style: ['normal', 'italic'], display: 'swap', variable: '--font-archivo' })

const navLinks = [
  { label: 'Product', href: '#product' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
]

const sources = ['Shopify', 'WooCommerce', 'Zoho Inventory', 'Paystack', 'Any REST API']

const queue = [
  { name: 'Nairobi Coffee Co.', detail: 'Every 30 days · last order 41 days ago', state: 'Due now' },
  { name: 'Brightline Retail', detail: 'Every 21 days · last order 19 days ago', state: 'Approaching' },
  { name: 'Harbour Supplies', detail: 'Every 45 days · last order 12 days ago', state: 'Healthy' },
]

const chipTone: Record<string, string> = {
  'Due now': 'bg-clay text-ink',
  Approaching: 'bg-pine/15 text-pine',
  Healthy: 'bg-ink/8 text-ink-soft',
}

export default function MarketingHome() {
  const [open, setOpen] = useState(false)

  return <main className={`${display.variable} min-h-screen bg-paper text-ink`}>
    <div className="bg-clay-deep text-paper">
      <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-5 px-5 py-2.5 sm:justify-between lg:px-8">
        <p className="text-center text-[10px] font-bold uppercase leading-4 tracking-[0.18em]">Your next repeat order is already in your data — ReorderIQ keeps score.</p>
        <Link href="/sign-up" className="hidden shrink-0 rounded-full bg-paper px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-clay-deep transition hover:bg-clay-soft sm:inline-block">Start free</Link>
      </div>
    </div>

    <section id="product" className="relative isolate overflow-hidden rounded-b-[2.5rem] bg-pine-night pb-16 lg:rounded-b-[4rem] lg:pb-24">
      <HeroScene />
      <div className="relative z-30 mx-auto max-w-[1400px] px-4 pt-6 lg:px-8 lg:pt-8">
        <div className="flex w-full items-center justify-between gap-4 rounded-full bg-clay px-4 py-2.5 shadow-capsule sm:px-5 lg:px-6">
          <Link href="/" className="display flex items-center gap-2.5 text-lg leading-none text-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm text-paper">R</span>
            ReorderIQ
          </Link>
          <nav className="hidden items-center gap-7 lg:flex">
            {navLinks.map((link) => link.href.startsWith('#')
              ? <a key={link.label} href={link.href} className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink/75 transition hover:text-ink">{link.label}</a>
              : <Link key={link.label} href={link.href} className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink/75 transition hover:text-ink">{link.label}</Link>)}
          </nav>
          <div className="hidden items-center gap-4 lg:flex">
            <Link href="/sign-in" className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink/75 transition hover:text-ink">Log in</Link>
            <Link href="/sign-up" className="rounded-full bg-ink px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-paper transition hover:bg-pine-night">Get started</Link>
          </div>
          <button type="button" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open} className="rounded-full bg-ink p-2.5 text-paper lg:hidden">{open ? <X size={16} /> : <Menu size={16} />}</button>
        </div>
        {open && <div className="mt-3 rounded-[26px] bg-paper p-4 shadow-print lg:hidden">
          <div className="flex flex-col">
            {navLinks.map((link) => link.href.startsWith('#')
              ? <a key={link.label} href={link.href} onClick={() => setOpen(false)} className="rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] transition hover:bg-paper-deep">{link.label}</a>
              : <Link key={link.label} href={link.href} onClick={() => setOpen(false)} className="rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] transition hover:bg-paper-deep">{link.label}</Link>)}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Link href="/sign-in" onClick={() => setOpen(false)} className="rounded-full bg-paper-deep px-5 py-3.5 text-center text-[11px] font-bold uppercase tracking-[0.16em]">Log in</Link>
            <Link href="/sign-up" onClick={() => setOpen(false)} className="rounded-full bg-ink px-5 py-3.5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-paper">Get started</Link>
          </div>
        </div>}
      </div>

      <div className="relative z-20 mx-auto grid max-w-[1400px] gap-14 px-5 pt-14 lg:grid-cols-[1.06fr_.94fr] lg:items-center lg:gap-12 lg:px-8 lg:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-paper/15 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-paper backdrop-blur-sm"><Sparkles size={12} /> Repeat revenue intelligence</span>
          <h1 className="display print-text mt-6 max-w-[15ch] text-[2.6rem] text-paper sm:text-[3.3rem] lg:text-[4rem]">Know when customers are <span className="mark">ready to reorder</span>.</h1>
          <p className="mt-7 max-w-[54ch] text-base font-medium leading-8 text-paper/80 lg:text-lg">ReorderIQ reads your order history, learns each customer’s buying rhythm and tells your team who is due to buy again — before the window closes.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-full bg-clay px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">Get a demo <ArrowRight size={15} /></Link>
            <a href="#how-it-works" className="inline-flex items-center justify-center rounded-full bg-paper px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">See how it works</a>
          </div>
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-paper/50">Free 14-day trial · No card required · Connect in minutes</p>
        </div>
        <QueueCard />
      </div>
    </section>

    <section aria-label="Data sources" className="bg-paper">
      <div className="mx-auto max-w-[1400px] px-5 py-14 lg:px-8 lg:py-16">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.22em] text-ink-soft">Reads order data from the stack you already run</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 lg:gap-x-20">
          {sources.map((source) => <span key={source} className="display text-lg text-ink/30 sm:text-xl">{source}</span>)}
        </div>
      </div>
    </section>

    <section className="bg-paper pb-16 lg:pb-24">
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8">
        <h2 className="display mx-auto max-w-4xl text-center text-[1.8rem] sm:text-[2.6rem] lg:text-[3.3rem]">Finding repeat buyers was never meant to be a spreadsheet job. <span className="mark">But the signal is buried.</span></h2>
        <p className="mx-auto mt-8 max-w-2xl text-center text-base leading-8 text-ink-soft lg:text-lg">Orders sit in one tool, invoices in another, payments in a third. ReorderIQ pulls them together, learns each customer’s rhythm and ranks the ones whose window is open right now.</p>
      </div>
    </section>
    <section className="bg-paper pb-20 lg:pb-28">
      <div className="mx-auto grid max-w-[1400px] items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-pine/10 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-pine"><Users size={12} /> 01 · The signal</p>
          <h2 className="display mt-6 text-[1.9rem] sm:text-4xl lg:text-[3.1rem]">Every customer has a rhythm.</h2>
          <p className="mt-6 max-w-xl text-base leading-8 text-ink-soft lg:text-lg">ReorderIQ scores each customer on how overdue they are — using their own cadence, order value, product mix and recency rather than a segment somebody has to maintain by hand.</p>
          <ul className="mt-8 flex flex-col gap-3">
            {['Cadence and recency learned per customer', 'Segments that rebuild themselves on every sync', 'Scores that explain why, not just how likely'].map((item) => <li key={item} className="flex items-start gap-3 text-sm font-semibold">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-clay-deep" />{item}
            </li>)}
          </ul>
        </div>
        <div className="lg:pb-3 lg:pr-3"><BoardPanel /></div>
      </div>
    </section>
    <section id="how-it-works" className="scroll-mt-12 bg-paper pb-20 lg:pb-28">
      <div className="mx-auto grid max-w-[1400px] items-center gap-12 px-5 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="lg:order-2">
          <p className="inline-flex items-center gap-2 rounded-full bg-clay/15 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-clay-deep"><Send size={12} /> 02 · The follow-through</p>
          <h2 className="display mt-6 text-[1.9rem] sm:text-4xl lg:text-[3.1rem]">Then turn the signal into revenue.</h2>
          <p className="mt-6 max-w-xl text-base leading-8 text-ink-soft lg:text-lg">Work the board one customer at a time, or push a whole signal list into a campaign. Every message is drafted from that customer’s own order history, and the repeat revenue it produces is attributed back to the send.</p>
          <ul className="mt-8 flex flex-col gap-3">
            {['Triggers from any signal or segment', 'Drafts grounded in real order history', 'Repeat revenue attributed to each send'].map((item) => <li key={item} className="flex items-start gap-3 text-sm font-semibold">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-clay-deep" />{item}
            </li>)}
          </ul>
        </div>
        <div className="lg:order-1 lg:pb-3 lg:pl-3"><CampaignPanel /></div>
      </div>
    </section>

    <section className="bg-paper pb-20 lg:pb-28">
      <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 lg:grid-cols-[1.05fr_.95fr] lg:gap-16 lg:px-8">
        <div>
          <p className="display text-2xl lg:text-[1.75rem]">Meet ReorderIQ:</p>
          <h2 className="display mt-3 text-[1.9rem] sm:text-4xl lg:text-[2.9rem]"><span className="mark">Reorder signals</span> for the customers you already have.</h2>
          <p className="mt-7 max-w-xl text-base leading-8 text-ink-soft lg:text-lg">Repeat-purchase prediction, campaign triggers and revenue attribution, built on the order data you already hold — no warehouse to stand up, no analyst queue to wait in.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-full bg-clay px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">Start free trial <ArrowRight size={15} /></Link>
            <Link href="/documentation" className="inline-flex items-center justify-center rounded-full bg-ink px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-paper transition hover:bg-pine-night">Read the docs</Link>
          </div>
        </div>
        <EngineArt className="mx-auto w-full max-w-[440px]" />
      </div>
    </section>

    <section id="features" className="scroll-mt-12 bg-paper pb-20 lg:pb-28">
      <div className="mx-auto grid max-w-[1400px] gap-6 px-5 lg:grid-cols-2 lg:px-8">
        <article className="rounded-[2.5rem] bg-clay-wash p-8 lg:p-10">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-clay-deep"><Radar size={22} /></span>
          <h3 className="display mt-7 text-2xl text-clay-deep">Reorder signals</h3>
          <p className="mt-2 text-sm font-bold uppercase tracking-[0.12em] text-ink/70">Predictive repeat-purchase timing</p>
          <p className="mt-5 max-w-lg text-sm leading-7 text-ink-soft">Every customer carries a live score built from their own cadence, order value and product mix, so outreach lands while the need is still open.</p>
          <Link href="/documentation" className="mt-7 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-clay-deep underline underline-offset-[6px]">Explore reorder signals <ArrowRight size={14} /></Link>
        </article>
        <article className="rounded-[2.5rem] bg-[#e6f0ea] p-8 lg:p-10">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-pine"><Send size={22} /></span>
          <h3 className="display mt-7 text-2xl text-pine">Campaign studio</h3>
          <p className="mt-2 text-sm font-bold uppercase tracking-[0.12em] text-ink/70">Signals, messages and attribution in one run</p>
          <p className="mt-5 max-w-lg text-sm leading-7 text-ink-soft">Turn a signal list into a campaign, draft the follow-up from each customer’s own order history, and see the repeat revenue it produced.</p>
          <Link href="/documentation" className="mt-7 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-pine underline underline-offset-[6px]">Explore campaign studio <ArrowRight size={14} /></Link>
        </article>
      </div>
    </section>

    <section className="bg-paper">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-5 py-16 lg:flex-row lg:items-end lg:justify-between lg:px-8 lg:py-24">
        <h2 className="display max-w-3xl text-[1.9rem] sm:text-[2.8rem] lg:text-[3.6rem]">Every customer. <span className="mark">Every signal.</span></h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-clay px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">Start free <ArrowRight size={15} /></Link>
          <Link href="/pricing" className="inline-flex items-center rounded-full bg-ink px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-paper transition hover:bg-pine-night">See pricing</Link>
        </div>
      </div>
    </section>

    <Footer />
  </main>
}

function HeroScene() {
  const windows: [number, number][] = [[176, 446], [176, 486], [196, 446], [196, 486], [222, 520], [252, 520], [282, 520], [612, 466], [612, 506], [668, 516], [700, 516], [732, 516], [1012, 504], [1076, 470], [1076, 510], [1134, 530], [1164, 530], [1312, 488], [1312, 528], [1342, 488]]

  return <svg aria-hidden="true" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
    <defs>
      <linearGradient id="riq-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#062e26" />
        <stop offset="42%" stopColor="#0b5c49" />
        <stop offset="66%" stopColor="#2f6b4f" />
        <stop offset="79%" stopColor="#bf5c33" />
        <stop offset="90%" stopColor="#e9a877" />
        <stop offset="100%" stopColor="#f8c9ac" />
      </linearGradient>
      <radialGradient id="riq-glow">
        <stop offset="0%" stopColor="#fff4e4" stopOpacity="0.95" />
        <stop offset="55%" stopColor="#f6be93" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#f8c9ac" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="riq-scrim" x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0%" stopColor="#04241e" stopOpacity="0.88" />
        <stop offset="48%" stopColor="#04241e" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#04241e" stopOpacity="0" />
      </linearGradient>
    </defs>
    <rect width="1440" height="760" fill="url(#riq-sky)" />
    <circle cx="1104" cy="548" r="250" fill="url(#riq-glow)" />
    <circle cx="1104" cy="548" r="62" fill="#fff3e0" opacity="0.92" />
    <path d="M0 592 C 180 556 300 606 470 586 C 640 566 760 612 930 590 C 1100 568 1240 608 1440 574 L1440 760 L0 760 Z" fill="#0a4f3f" opacity="0.75" />
    <g fill="#083f34">
      <rect x="96" y="470" width="58" height="132" rx="8" />
      <rect x="164" y="428" width="40" height="174" rx="8" />
      <rect x="214" y="502" width="76" height="100" rx="8" />
      <rect x="596" y="446" width="46" height="156" rx="8" />
      <rect x="652" y="498" width="88" height="104" rx="8" />
      <rect x="1000" y="486" width="54" height="116" rx="8" />
      <rect x="1064" y="452" width="34" height="150" rx="8" />
      <rect x="1122" y="512" width="70" height="90" rx="8" />
      <rect x="1300" y="470" width="60" height="132" rx="8" />
    </g>
    <g fill="#f8c9ac" opacity="0.75">
      {windows.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="6" height="12" rx="2" />)}
    </g>
    <path d="M0 660 C 220 620 420 690 660 660 C 900 630 1120 700 1440 648 L1440 760 L0 760 Z" fill="#04241e" />
    <rect width="1440" height="760" fill="url(#riq-scrim)" />
  </svg>
}

function QueueCard() {
  return <div className="rounded-[28px] bg-paper p-5 shadow-[0_36px_70px_-34px_rgba(4,26,20,.75)] sm:p-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-clay-deep">Reorder board</p>
        <p className="display mt-1.5 text-xl">Today’s follow-ups</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pine/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pine"><span className="h-1.5 w-1.5 rounded-full bg-pine" />Live</span>
    </div>
    <div className="mt-5 flex flex-col gap-2.5">
      {queue.map((row) => <div key={row.name} className="flex items-center justify-between gap-4 rounded-[18px] bg-paper-deep px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{row.name}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-ink-soft">{row.detail}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${chipTone[row.state]}`}>{row.state}</span>
      </div>)}
    </div>
    <div className="mt-5 flex items-center gap-3 rounded-[18px] bg-clay-wash px-4 py-3.5">
      <TrendingUp size={18} className="shrink-0 text-clay-deep" />
      <p className="text-xs font-semibold">Repeat revenue from signals sent <span className="display text-sm">+18.4%</span></p>
    </div>
  </div>
}
function EngineArt({ className }: { className?: string }) {
  return <svg viewBox="0 0 460 330" role="img" aria-label="Illustration: order history goes in, reorder signals come out" className={className}>
    <defs>
      <radialGradient id="riq-halo">
        <stop offset="0%" stopColor="#fdeade" />
        <stop offset="70%" stopColor="#f8c9ac" stopOpacity="0.6" />
        <stop offset="100%" stopColor="#f8c9ac" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="228" cy="168" r="158" fill="url(#riq-halo)" />
    <ellipse cx="212" cy="302" rx="152" ry="9" fill="#0b5c49" opacity="0.13" />
    <circle cx="58" cy="92" r="7" fill="#e2713b" />
    <path d="M92 112 L92 92 L110 102 Z" fill="#0b5c49" opacity="0.75" />

    <g transform="rotate(-9 208 40)">
      <rect x="192" y="20" width="30" height="38" rx="7" fill="#fbf9f3" stroke="#10201f" strokeWidth="4" />
      <rect x="199" y="29" width="16" height="4" rx="2" fill="#f8c9ac" />
      <rect x="199" y="38" width="11" height="4" rx="2" fill="#cfe3db" />
    </g>
    <g transform="rotate(8 248 48)">
      <rect x="234" y="28" width="28" height="36" rx="7" fill="#fdeade" stroke="#10201f" strokeWidth="4" />
      <rect x="240" y="37" width="16" height="4" rx="2" fill="#f8c9ac" />
    </g>

    <rect x="156" y="62" width="136" height="48" rx="13" fill="#083f34" stroke="#10201f" strokeWidth="5" />
    <path d="M318 124 Q 348 92 318 60" fill="none" stroke="#e2713b" strokeWidth="5" strokeLinecap="round" />
    <path d="M338 138 Q 376 92 338 46" fill="none" stroke="#bf5525" strokeWidth="5" strokeLinecap="round" opacity="0.6" />

    <rect x="140" y="104" width="180" height="142" rx="24" fill="#0b5c49" stroke="#10201f" strokeWidth="5" />
    <circle cx="232" cy="126" r="8" fill="#f8c9ac" stroke="#10201f" strokeWidth="4" />
    <circle cx="258" cy="126" r="8" fill="#f8c9ac" stroke="#10201f" strokeWidth="4" />
    <circle cx="182" cy="160" r="26" fill="#fbf9f3" stroke="#10201f" strokeWidth="5" />
    <path d="M182 160 L195 147" stroke="#bf5525" strokeWidth="5" strokeLinecap="round" />
    <path d="M182 138 L182 144" stroke="#10201f" strokeWidth="4" strokeLinecap="round" />
    <path d="M200 147 L196 152" stroke="#10201f" strokeWidth="4" strokeLinecap="round" />
    <rect x="222" y="152" width="80" height="60" rx="12" fill="#062e26" stroke="#10201f" strokeWidth="5" />
    <rect x="236" y="180" width="11" height="18" rx="3" fill="#f8c9ac" />
    <rect x="253" y="170" width="11" height="28" rx="3" fill="#f8c9ac" />
    <rect x="270" y="158" width="11" height="40" rx="3" fill="#e2713b" />

    <rect x="40" y="246" width="386" height="24" rx="12" fill="#e2713b" stroke="#10201f" strokeWidth="5" />
    <circle cx="78" cy="258" r="7" fill="#fbf9f3" stroke="#10201f" strokeWidth="4" />
    <circle cx="300" cy="258" r="7" fill="#fbf9f3" stroke="#10201f" strokeWidth="4" />
    <rect x="96" y="270" width="14" height="28" rx="6" fill="#083f34" stroke="#10201f" strokeWidth="4" />
    <rect x="348" y="270" width="14" height="28" rx="6" fill="#083f34" stroke="#10201f" strokeWidth="4" />

    <rect x="322" y="212" width="60" height="34" rx="9" fill="#fbf9f3" stroke="#10201f" strokeWidth="4" />
    <rect x="331" y="222" width="30" height="5" rx="2.5" fill="#f8c9ac" />
    <rect x="331" y="232" width="20" height="5" rx="2.5" fill="#cfe3db" />
    <circle cx="372" cy="220" r="9" fill="#0b5c49" stroke="#10201f" strokeWidth="3" />
    <path d="M368 220 L371 223 L377 216" fill="none" stroke="#fbf9f3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="392" y="220" width="34" height="26" rx="8" fill="#fdeade" stroke="#10201f" strokeWidth="4" />
  </svg>
}

const board = [
  { name: 'Nairobi Coffee Co.', last: '41 days ago', cadence: 'every 30 days', score: 92, state: 'Due now' },
  { name: 'Harbour Supplies', last: '44 days ago', cadence: 'every 28 days', score: 88, state: 'Due now' },
  { name: 'Brightline Retail', last: '19 days ago', cadence: 'every 21 days', score: 74, state: 'Approaching' },
  { name: 'Maple & Stone', last: '9 days ago', cadence: 'every 35 days', score: 41, state: 'Healthy' },
]

function BoardPanel() {
  return <div className="overflow-hidden rounded-[28px] bg-paper shadow-print">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-paper-deep px-5 py-4 sm:px-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-clay-deep">Customer intelligence</p>
        <p className="display mt-1 text-lg">Reorder board</p>
      </div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-soft">1,248 customers scored</p>
    </div>
    <div className="px-2 py-3 sm:px-4">
      <div className="hidden grid-cols-[1.6fr_1fr_1fr_.9fr_auto] gap-4 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-soft sm:grid">
        <span>Customer</span><span>Last order</span><span>Cadence</span><span>Score</span><span>Status</span>
      </div>
      {board.map((row) => <div key={row.name} className="grid grid-cols-[1.6fr_auto] items-center gap-4 rounded-[18px] px-3 py-3 transition hover:bg-paper-deep sm:grid-cols-[1.6fr_1fr_1fr_.9fr_auto]">
        <p className="truncate text-sm font-bold">{row.name}</p>
        <p className="hidden text-xs font-medium text-ink-soft sm:block">{row.last}</p>
        <p className="hidden text-xs font-medium text-ink-soft sm:block">{row.cadence}</p>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="display text-sm">{row.score}</span>
          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-paper-deep"><span className="block h-full rounded-full bg-clay" style={{ width: `${row.score}%` }} /></span>
        </div>
        <span className={`ml-auto shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${chipTone[row.state]}`}>{row.state}</span>
      </div>)}
    </div>
    <p className="px-5 pb-5 text-[11px] font-medium leading-5 text-ink-soft sm:px-6">Scores blend cadence, recency, order value and product mix — and refresh with every sync.</p>
  </div>
}

const footerColumns = [
  { title: 'Product', links: [{ label: 'Features', href: '#features' }, { label: 'How It Works', href: '#how-it-works' }, { label: 'Pricing', href: '/pricing' }] },
  { title: 'Resources', links: [{ label: 'Help / FAQ', href: '/faq' }, { label: 'Documentation', href: '/documentation' }] },
  { title: 'Company', links: [{ label: 'About Us', href: '/about' }, { label: 'Contact Us', href: '/contact' }] },
  { title: 'Contact', links: [{ label: '0727 876 632', href: 'tel:+254727876632' }, { label: 'reorderiq@gmail.com', href: 'mailto:reorderiq@gmail.com' }] },
  { title: 'Legal', links: [{ label: 'Privacy Policy', href: '/privacy' }, { label: 'Terms of Service', href: '#terms' }, { label: 'Cookie Policy', href: '/cookies' }] },
]

function Footer() {
  return <footer className="bg-ink text-paper">
    <div className="mx-auto max-w-[1400px] px-5 pb-10 pt-16 lg:px-8 lg:pt-20">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.7fr_repeat(5,minmax(0,1fr))] lg:gap-8">
        <div>
          <Link href="/" className="display flex items-center gap-2.5 text-xl leading-none text-paper">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-clay text-sm text-ink">R</span>
            ReorderIQ
          </Link>
          <p className="mt-6 max-w-xs text-sm font-bold">Know when customers are ready to reorder.</p>
          <p className="mt-3 max-w-sm text-sm leading-7 text-paper/55">Turn customer purchase history into timely reorder opportunities and repeat revenue.</p>
          <Link href="/sign-up" className="mt-7 inline-flex items-center gap-2 rounded-full bg-clay px-5 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">Get started <ArrowRight size={14} /></Link>
        </div>
        {footerColumns.map((column) => <div key={column.title}>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-paper/45">{column.title}</h3>
          <div className="mt-5 flex flex-col gap-3 text-sm">
            {column.links.map((link) => link.href.startsWith('#')
              ? <a key={link.label} href={link.href} className="text-paper/75 transition hover:text-clay-soft">{link.label}</a>
              : <Link key={link.label} href={link.href} className="text-paper/75 transition hover:text-clay-soft">{link.label}</Link>)}
          </div>
        </div>)}
      </div>
      <div className="mt-16 flex flex-col gap-5 text-[11px] font-bold uppercase tracking-[0.14em] text-paper/40 sm:flex-row sm:items-center sm:justify-between">
        <span>© 2026 ReorderIQ. All rights reserved.</span>
        <div className="flex items-center gap-5">
          <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="transition hover:text-clay-soft"><BriefcaseBusiness size={17} /></a>
          <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X" className="transition hover:text-clay-soft">X</a>
          <a href="mailto:hello@reorderiq.com" aria-label="Email" className="transition hover:text-clay-soft"><Mail size={17} /></a>
        </div>
      </div>
    </div>
  </footer>
}
const steps = ['Signal', 'Audience', 'Message', 'Revenue']

const campaignStats = [
  { label: 'Opened', value: '68%' },
  { label: 'Replied', value: '24%' },
  { label: 'Repeat revenue', value: 'KES 412K' },
]

function CampaignPanel() {
  return <div className="overflow-hidden rounded-[28px] bg-paper shadow-print-pine">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-pine px-5 py-4 text-paper sm:px-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-clay-soft">Campaign studio</p>
        <p className="display mt-1 text-lg">Reorder reminder · weekly</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"><Send size={11} /> 214 sends</span>
    </div>
    <div className="flex flex-wrap items-center gap-2 px-5 py-5 sm:px-6">
      {steps.map((step, index) => <div key={step} className="flex items-center gap-2">
        <span className="rounded-full bg-paper-deep px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink">{step}</span>
        {index < steps.length - 1 && <ArrowRight size={13} className="text-ink-soft" />}
      </div>)}
    </div>
    <div className="px-5 pb-6 sm:px-6">
      <div className="rounded-[20px] bg-paper-deep p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-clay-deep">Drafted from real order history</p>
        <p className="mt-3 text-sm leading-7 text-ink">Hi Amina — your last order of 12 cases shipped 41 days ago. Want the same again, or should we adjust the mix?</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-clay px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink transition hover:bg-clay-soft">Approve &amp; send <ArrowRight size={13} /></Link>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-soft">Signal · Due now</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {campaignStats.map((stat) => <div key={stat.label} className="rounded-[18px] bg-paper-deep px-3 py-3.5 text-center">
          <p className="display text-base">{stat.value}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft">{stat.label}</p>
        </div>)}
      </div>
    </div>
  </div>
}
