'use client'

/**
 * Screen re-organisation (2026-10-16): the pages of the current sidebar entry ("hub") as tabs on top of the page,
 * e.g. Money → Invoices · Collection · Wallet · Discounts · Refunds · Expenses. Only the pages the person may open.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { navLabel } from '@/lib/i18n/nav'
import { buildHubs } from '@/lib/navigation/sections'
import type { SideItem } from './SidebarNav'

export function HubTabs({ items, role, locale, isActive }: { items: SideItem[]; role: string; locale: string; isActive: (href: string, match?: string[]) => boolean }) {
  const [opened, setOpened] = useState<string | null>(null)
  useEffect(() => {
    const read = () => { try { setOpened(sessionStorage.getItem('tn_hub')) } catch { /* private window */ } }
    read()
    window.addEventListener('tn-hub', read)
    return () => window.removeEventListener('tn-hub', read)
  }, [])
  const hubs = buildHubs(items, role)
  if (new Set(hubs.flatMap((h) => h.items.map((i) => i.name))).size <= 11) return null // the small portal menu has no tabs
  // the most specific match wins (e.g. /dashboard/accountant/fees is "Fee Collection", not "Accounting Hub"); a page in
  // two hubs (a report) keeps the tabs of the hub the person opened from the sidebar
  let best: { hub: (typeof hubs)[number]; len: number } | null = null
  for (const hub of hubs) for (const i of hub.items) {
    if (!isActive(i.href, i.match)) continue
    const better = !best || i.href.length > best.len || (i.href.length === best.len && hub.key === opened)
    if (better) best = { hub, len: i.href.length }
  }
  if (!best || best.hub.items.length < 2) return null
  const current = best.hub.items.filter((i) => isActive(i.href, i.match)).sort((a, b) => b.href.length - a.href.length)[0]
  return (
    <div className="-mt-1 mb-4 overflow-x-auto print:hidden">
      <nav className="flex min-w-max gap-1 border-b border-gray-200">
        {best.hub.items.map((i) => {
          const on = i === current
          return (
            <Link key={i.name} href={i.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${on ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
              {navLabel(i.name, locale)}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
