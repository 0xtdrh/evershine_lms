'use client'

/**
 * Screen re-organisation (2026-10-16): about a dozen sidebar entries ("hubs"). Each opens its first page; the other
 * pages of the hub are tabs on top of the page (HubTabs). Search finds any page (English or Arabic), favourites pin
 * pages on top (per person, this browser), old template screens are a last entry for Super Admin only.
 * Small menus (the parent / student portal) stay a simple list.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Archive, Award, Banknote, BookOpen, Building, GraduationCap, LayoutDashboard, LineChart, MessageSquare, Search, Settings2, Star, UserPlus, Users, UsersRound, X,
} from 'lucide-react'
import { navLabel, NAV_AR } from '@/lib/i18n/nav'
import { buildHubs, hubLabel, matchesSearch, type HubKey } from '@/lib/navigation/sections'

export interface SideItem { name: string; href: string; icon: React.ComponentType<{ className?: string }>; match?: string[] }

const HUB_ICON: Record<HubKey, React.ComponentType<{ className?: string }>> = {
  home: LayoutDashboard, admissions: UserPlus, students: Users, groups: UsersRound, learning: BookOpen, certificates: Award, staff: GraduationCap,
  money: Banknote, communication: MessageSquare, places: Building, reports: LineChart, settings: Settings2, legacy: Archive,
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private window */ }
}

export function SidebarNav({ items, role, userId, locale, isActive, badge }: {
  items: SideItem[]; role: string; userId: string; locale: string
  isActive: (href: string, match?: string[]) => boolean
  badge: (name: string) => number
}) {
  const ar = locale === 'ar'
  const [q, setQ] = useState('')
  const [favs, setFavs] = useState<string[]>([])
  const favKey = `tn_nav_fav:${userId}`
  useEffect(() => { setFavs(read<string[]>(favKey, [])) }, [favKey])
  const toggleFav = (name: string) => {
    const next = favs.includes(name) ? favs.filter((x) => x !== name) : [...favs, name]
    setFavs(next)
    write(favKey, next)
  }
  const hubs = useMemo(() => buildHubs(items, role), [items, role])
  const all = [...new Map(hubs.flatMap((h) => h.items).map((i) => [i.name, i])).values()]
  const flat = all.length <= 11
  const hits = q.trim() ? all.filter((i) => matchesSearch(q, i.name, NAV_AR[i.name] ?? '')) : null
  const favItems = all.filter((i) => favs.includes(i.name))

  const linkCls = (active: boolean) => `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`
  const count = (n: number) => n > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-extrabold text-white">{n > 99 ? '99+' : n}</span>

  /** One page (search results, favourites, the flat portal menu) with a pin star. */
  const pageRow = (item: SideItem, key: string) => {
    const active = isActive(item.href, item.match)
    const fav = favs.includes(item.name)
    const n = badge(item.name)
    return (
      <div key={key} className="group relative">
        <Link href={item.href} className={linkCls(active)}>
          <span className="flex min-w-0 items-center gap-3"><item.icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : ''}`} /><span className="truncate">{navLabel(item.name, locale)}</span></span>
          {count(n)}
        </Link>
        {!flat && n === 0 && (
          <button type="button" onClick={() => toggleFav(item.name)}
            className={`absolute end-1 top-1/2 -translate-y-1/2 rounded p-1 ${fav ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'}`}
            title={fav ? (ar ? 'شيل من المفضلة' : 'Remove from favourites') : (ar ? 'ضيف للمفضلة' : 'Add to favourites')} aria-label={fav ? 'unpin' : 'pin'}>
            <Star className={`h-3.5 w-3.5 ${fav ? 'fill-amber-400' : ''}`} />
          </button>
        )}
      </div>
    )
  }

  if (flat) return <div className="space-y-0.5">{all.map((i) => pageRow(i, i.name))}</div>

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={ar ? 'دوّر على صفحة…' : 'Find a page…'}
          className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 ps-8 pe-7 text-sm outline-none focus:border-blue-300 focus:bg-white" />
        {q && <button type="button" className="absolute end-2 top-2.5 text-gray-400" onClick={() => setQ('')} aria-label="clear"><X className="h-4 w-4" /></button>}
      </div>
      {hits ? (
        <div className="space-y-0.5">
          {hits.map((i) => pageRow(i, `h-${i.name}`))}
          {!hits.length && <p className="px-3 py-2 text-xs text-gray-400">{ar ? 'مفيش صفحة بالاسم ده' : 'No page with that name'}</p>}
        </div>
      ) : (
        <>
          {favItems.length > 0 && (
            <div className="space-y-0.5 border-b border-gray-100 pb-2">
              <p className="flex items-center gap-1 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-600"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{ar ? 'المفضلة' : 'Favourites'}</p>
              {favItems.map((i) => pageRow(i, `f-${i.name}`))}
            </div>
          )}
          <div className="space-y-0.5">
            {hubs.map((h) => {
              const Icon = HUB_ICON[h.key]
              const active = h.items.some((i) => isActive(i.href, i.match))
              const n = h.items.reduce((s, i) => s + badge(i.name), 0)
              return (
                <Link key={h.key} href={h.items[0].href} onClick={() => { try { sessionStorage.setItem('tn_hub', h.key) } catch { /* private window */ } window.dispatchEvent(new Event('tn-hub')) }} className={`${linkCls(active)} ${h.key === 'legacy' ? 'mt-2 opacity-70' : ''}`}>
                  <span className="flex min-w-0 items-center gap-3"><Icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : ''}`} /><span className="truncate">{hubLabel(h.key, ar)}</span></span>
                  {count(n)}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
