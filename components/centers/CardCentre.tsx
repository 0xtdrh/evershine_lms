'use client'

/**
 * One page of cards in groups with search (5-C): used by the settings centre and the reports centre.
 * Cards come from a registry (lib/settings/registry.ts, lib/reports/registry.ts); only cards the person may open show.
 */

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { matchesCard, visibleCards } from '@/lib/settings/registry'
import type { AcademicResource, Action } from '@/lib/rbac'
import { Loader2, Search } from 'lucide-react'

export interface CentreCard {
  key: string; group: string; en: string; ar: string; descEn: string; descAr: string; href: string
  formats?: string[]; roles?: string[]; perm?: [AcademicResource, Action]
}

const FORMAT: Record<string, [string, string]> = { excel: ['Excel', 'Excel'], pdf: ['PDF', 'PDF'], print: ['Print', 'طباعة'] }

export function CardCentre({ icon: Icon, title, subtitle, searchHint, groups, cards }: {
  icon: React.ComponentType<{ className?: string }>
  title: [string, string]; subtitle: [string, string]; searchHint: [string, string]
  groups: { key: string; en: string; ar: string }[]
  cards: CentreCard[]
}) {
  const ar = useI18n().locale === 'ar'
  const { role, can, ready } = useMyPermissions()
  const [q, setQ] = useState('')
  const shown = visibleCards(cards, role, can).filter((c) => matchesCard(q, c))
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Icon className="h-7 w-7 text-indigo-600" /> {L(...title)}</h1>
          <p className="mt-1 text-sm text-slate-500">{L(...subtitle)}</p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" placeholder={L(...searchHint)} />
        </div>
      </div>
      {!ready && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{L('Loading…', 'بيحمّل…')}</p>}
      {ready && !shown.length && <p className="text-sm text-slate-500">{L('Nothing with that name.', 'مفيش حاجة بالاسم ده.')}</p>}
      {groups.map((g) => {
        const items = shown.filter((c) => c.group === g.key)
        if (!items.length) return null
        return (
          <div key={g.key} className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-500">{ar ? g.ar : g.en}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <Link key={c.key} href={c.href}>
                  <Card className="h-full transition hover:shadow-md"><CardContent className="space-y-1 pt-4">
                    <p className="font-semibold text-slate-800">{ar ? c.ar : c.en}</p>
                    <p className="text-xs text-slate-500">{ar ? c.descAr : c.descEn}</p>
                    {!!c.formats?.length && (
                      <p className="flex flex-wrap gap-1 pt-0.5">
                        {c.formats.map((f) => <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{FORMAT[f] ? (ar ? FORMAT[f][1] : FORMAT[f][0]) : f}</span>)}
                      </p>
                    )}
                  </CardContent></Card>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
