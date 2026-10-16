'use client'

/** Partners part 1-B2: numbers and things that need attention, on top of the partners page, + Excel exports. */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Download } from 'lucide-react'

interface Overview {
  counts: { partners: number; active: number; places: number; activeGroups: number; endingContracts: number; draftStatements: number; followUpsDue: number }
  money: { toReceive: number; toPay: number; byPartner: { partnerId: string; name: string; rest: number }[] } | null
  ending: { partnerId: string; partner: string; contract: string; daysLeft: number | null; state: string }[]
  notStarted: { partnerId: string; partner: string }[]
  incomplete: { partnerId: string; partner: string; missing: string[] }[]
  followUps: { id: string; partnerId: string; partner: string; kind: string; summary: string; followUpAt: string }[]
  drafts: { id: string; number: string; partnerId: string; partner: string }[]
}

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} EGP`
const MISSING: Record<string, [string, string]> = { place: ['no place', 'مفيش مكان'], contact: ['no contact', 'مفيش مسؤول'], contract: ['no contract', 'مفيش عقد'] }

export function PartnersOverview({ canExportMoney }: { canExportMoney: boolean }) {
  const { data: o } = useQuery({ queryKey: ['partners-overview'], queryFn: () => fetchApi<Overview>('/api/partners/overview') })
  if (!o) return null
  const tile = (label: string, value: string | number, tone = 'text-slate-900') => (
    <Card><CardContent className="p-3"><p className="text-xs text-slate-500">{label}</p><p className={`text-xl font-bold ${tone}`}>{value}</p></CardContent></Card>
  )
  const attention = [
    ...o.ending.map((e) => ({ key: `e${e.partnerId}${e.contract}`, href: `/dashboard/partners/${e.partnerId}`, text: `${e.partner}: ${e.contract} — ${e.state === 'ENDED' ? L('ended', 'انتهى') : `${L('ends in', 'بينتهي بعد')} ${e.daysLeft} ${L('days', 'يوم')}`}` })),
    ...o.followUps.map((f) => ({ key: `f${f.id}`, href: `/dashboard/partners/${f.partnerId}`, text: `${L('Follow up', 'متابعة')} — ${f.partner}: ${f.summary.slice(0, 80)}` })),
    ...o.drafts.map((d) => ({ key: `d${d.id}`, href: `/dashboard/partners/${d.partnerId}`, text: `${L('Statement waiting', 'كشف مستني')} ${d.number} — ${d.partner}` })),
    ...o.notStarted.map((n) => ({ key: `n${n.partnerId}`, href: `/dashboard/partners/${n.partnerId}`, text: `${n.partner}: ${L('contract signed but no running group', 'العقد ماضي ومفيش جروب شغال')}` })),
    ...o.incomplete.map((i) => ({ key: `i${i.partnerId}`, href: `/dashboard/partners/${i.partnerId}`, text: `${i.partner}: ${i.missing.map((m) => L(...MISSING[m])).join('، ')}` })),
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {tile(L('Partners', 'الشركاء'), `${o.counts.active} / ${o.counts.partners}`)}
        {tile(L('Places', 'الأماكن'), o.counts.places)}
        {tile(L('Running groups', 'جروبات شغالة'), o.counts.activeGroups)}
        {tile(L('Contracts ending', 'عقود قربت تنتهي'), o.counts.endingContracts, o.counts.endingContracts ? 'text-amber-600' : undefined)}
        {tile(L('Follow-ups today', 'متابعات النهارده'), o.counts.followUpsDue, o.counts.followUpsDue ? 'text-amber-600' : undefined)}
        {o.money && tile(L('Partners owe us', 'الشركاء عليهم لينا'), money(o.money.toReceive), 'text-emerald-700')}
        {o.money && tile(L('We owe partners', 'علينا للشركاء'), money(o.money.toPay), 'text-rose-700')}
      </div>
      {attention.length > 0 && (
        <Card><CardContent className="space-y-1 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-700"><AlertTriangle className="h-4 w-4" />{L('Needs attention', 'محتاج متابعة')}</p>
          <ul className="space-y-1">{attention.slice(0, 12).map((x) => <li key={x.key}><Link href={x.href} className="text-slate-700 hover:underline">• {x.text}</Link></li>)}</ul>
        </CardContent></Card>
      )}
      <div className="flex flex-wrap gap-2">
        <a href="/api/partners/export?kind=partners"><Button size="sm" variant="outline"><Download className="me-1 h-4 w-4" />{L('Partners (Excel)', 'الشركاء (Excel)')}</Button></a>
        {canExportMoney && <a href="/api/partners/export?kind=statements"><Button size="sm" variant="outline"><Download className="me-1 h-4 w-4" />{L('Statements (Excel)', 'الكشوف (Excel)')}</Button></a>}
        {canExportMoney && <a href="/api/partners/export?kind=balances"><Button size="sm" variant="outline"><Download className="me-1 h-4 w-4" />{L('Balances (Excel)', 'الأرصدة (Excel)')}</Button></a>}
      </div>
    </div>
  )
}
