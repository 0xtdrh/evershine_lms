'use client'

/**
 * Screen re-organisation 5-A: the sidebar in sections that open and close, a search box (English or Arabic names),
 * favourites pinned on top (per person, this browser), and old template screens hidden in a closed "Old screens"
 * section for Super Admin only. Small menus (the parent / student portal) stay a simple list.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Search, Star, X } from 'lucide-react'
import { navLabel, NAV_AR } from '@/lib/i18n/nav'
import { groupIntoSections, matchesSearch, SECTION_LABELS, type SectionKey } from '@/lib/navigation/sections'

export interface SideItem { name: string; href: string; icon: React.ComponentType<{ className?: string }>; match?: string[] }

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
  const [closed, setClosed] = useState<SectionKey[]>(['legacy'])
  const [favs, setFavs] = useState<string[]>([])
  const favKey = `tn_nav_fav:${userId}`
  useEffect(() => {
    setClosed(read<SectionKey[]>('tn_nav_closed', ['legacy']))
    setFavs(read<string[]>(favKey, []))
  }, [favKey])
  const toggleSection = (k: SectionKey) => {
    const next = closed.includes(k) ? closed.filter((x) => x !== k) : [...closed, k]
    setClosed(next)
    write('tn_nav_closed', next)
  }
  const toggleFav = (name: string) => {
    const next = favs.includes(name) ? favs.filter((x) => x !== name) : [...favs, name]
    setFavs(next)
    write(favKey, next)
  }
  const sections = useMemo(() => groupIntoSections(items, role), [items, role])
  const flat = sections.reduce((n, s) => n + s.items.length, 0) <= 9
  const searchHits = q.trim() ? sections.flatMap((s) => s.items).filter((i) => matchesSearch(q, i.name, NAV_AR[i.name] ?? '')) : null
  const favItems = items.filter((i) => favs.includes(i.name))
  // the section of the open page stays open
  const activeSection = sections.find((s) => s.items.some((i) => isActive(i.href, i.match)))?.key

  const row = (item: SideItem, inFavs = false) => {
    const active = isActive(item.href, item.match)
    const n = badge(item.name)
    const fav = favs.includes(item.name)
    return (
      <div key={`${inFavs ? 'f' : 's'}-${item.name}`} className="group relative">
        <Link
          href={item.href}
          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <item.icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-blue-600' : ''}`} />
            <span className="truncate">{navLabel(item.name, locale)}</span>
          </span>
          {n > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-extrabold text-white">{n > 99 ? '99+' : n}</span>}
        </Link>
        {!flat && (
          <button
            type="button"
            onClick={() => toggleFav(item.name)}
            className={`absolute end-1 top-1/2 -translate-y-1/2 rounded p-1 ${fav ? 'text-amber-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'} ${n > 0 ? 'hidden' : ''}`}
            title={fav ? (ar ? 'شيل من المفضلة' : 'Remove from favourites') : (ar ? 'ضيف للمفضلة' : 'Add to favourites')}
            aria-label={fav ? 'unpin' : 'pin'}
          >
            <Star className={`h-3.5 w-3.5 ${fav ? 'fill-amber-400' : ''}`} />
          </button>
        )}
      </div>
    )
  }

  if (flat) return <div className="space-y-0.5">{sections.flatMap((s) => s.items).map((i) => row(i))}</div>

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? 'دوّر على صفحة…' : 'Find a page…'}
          className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 ps-8 pe-7 text-sm outline-none focus:border-blue-300 focus:bg-white"
        />
        {q && <button type="button" className="absolute end-2 top-2.5 text-gray-400" onClick={() => setQ('')} aria-label="clear"><X className="h-4 w-4" /></button>}
      </div>
      {searchHits ? (
        <div className="space-y-0.5">
          {searchHits.map((i) => row(i))}
          {!searchHits.length && <p className="px-3 py-2 text-xs text-gray-400">{ar ? 'مفيش صفحة بالاسم ده' : 'No page with that name'}</p>}
        </div>
      ) : (
        <>
          {favItems.length > 0 && (
            <div>
              <p className="flex items-center gap-1 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-600"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{ar ? 'المفضلة' : 'Favourites'}</p>
              <div className="space-y-0.5">{favItems.map((i) => row(i, true))}</div>
            </div>
          )}
          {sections.map((s) => {
            const open = !closed.includes(s.key) || s.key === activeSection
            return (
              <div key={s.key}>
                <button type="button" onClick={() => toggleSection(s.key)} className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                  <span>{ar ? SECTION_LABELS[s.key].ar : SECTION_LABELS[s.key].en}</span>
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />}
                </button>
                {open && <div className="space-y-0.5">{s.items.map((i) => row(i))}</div>}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
