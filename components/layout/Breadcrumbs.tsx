'use client'

/**
 * Header title of every dashboard page. 2026-10-20 (live test): it used to print the raw URL in English
 * ("Backups › Admin › Dashboard", even database ids). Now: the menu item the page belongs to, in the screen's
 * language (same names as the sidebar), plus "Details" when the page is deeper than that item.
 */

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { navLabel } from '@/lib/i18n/nav'

export interface CrumbItem { name: string; href: string; match?: string[] }

/** The menu item a path belongs to: the longest menu href that is the path or a parent of it. */
export function pageItem(pathname: string, items: CrumbItem[]): CrumbItem | null {
  let best: CrumbItem | null = null
  let bestLen = 0
  const under = (p: string) => pathname === p || pathname.startsWith(p + '/')
  for (const it of items) {
    if (it.href === '/dashboard') continue
    // a page listed in `match` belongs to that item, and wins over a shorter parent like /dashboard/admin
    const len = under(it.href) ? it.href.length : it.match?.some(under) ? Math.max(...it.match.filter(under).map((m) => m.length)) : 0
    if (len > bestLen) { best = it; bestLen = len }
  }
  return best
}

export function Breadcrumbs({ pathname, items, locale }: { pathname: string; items: CrumbItem[]; locale: string }) {
  const ar = locale === 'ar'
  const home = ar ? 'الرئيسية' : 'Home'
  if (pathname === '/dashboard' || pathname === '/dashboard/') {
    return <p className="truncate text-sm font-semibold text-gray-800">{home}</p>
  }
  const item = pageItem(pathname, items)
  const Sep = ar ? ChevronLeft : ChevronRight
  const crumbs: { label: string; href: string }[] = []
  if (item) {
    crumbs.push({ label: navLabel(item.name, locale), href: item.href })
    if (pathname !== item.href) crumbs.push({ label: ar ? 'التفاصيل' : 'Details', href: pathname })
  } else {
    crumbs.push({ label: ar ? 'الصفحة دي' : 'This page', href: pathname })
  }
  return (
    <nav aria-label={ar ? 'المسار' : 'Breadcrumb'} className="mt-1 text-sm text-slate-500">
      <ol className="flex flex-wrap items-center gap-2">
        <li className="flex items-center gap-2">
          <Link href="/dashboard" className="hover:text-slate-900">{home}</Link>
          <Sep className="h-3.5 w-3.5 text-slate-400" />
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={c.href + i} className="flex min-w-0 items-center gap-2">
              {last
                ? <span className="truncate font-semibold text-slate-700" aria-current="page">{c.label}</span>
                : <Link href={c.href} className="truncate hover:text-slate-900">{c.label}</Link>}
              {!last && <Sep className="h-3.5 w-3.5 text-slate-400" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
