'use client'

/**
 * a04 daily cash-close sheet (2026-10-31) — printable, outside the dashboard. /reports/cash-day/YYYY-MM-DD
 * Totals of every account the person sees (cash boxes first); ?account=<id> = one account's detail (every movement
 * of the day, the count, who counted / approved and when, hand-signature lines on print).
 */

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { Printer } from 'lucide-react'
import { MOVEMENT_KIND_LABEL, type MovementKind } from '@/lib/treasury/rules'
import type { AccountSheet } from '@/lib/treasury/daily-sheet'
import type { SheetGroup } from '@/lib/treasury/daily-sheet-calc'

interface Totals { opening: number; totalIn: number; totalOut: number; expected: number; counted: number; difference: number; notCounted: number }
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${L('EGP', 'ج.م')}`
const BLUE = '#1B4F8A'
const time = (d: string | Date | null) => (d && !/T00:00:00(\.000)?Z$/.test(new Date(d).toISOString()) ? new Date(d).toLocaleTimeString(L('en-GB', 'ar-EG-u-nu-latn'), { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '')
const dateTime = (d: string | Date | null) => (d ? new Date(d).toLocaleString(L('en-GB', 'ar-EG-u-nu-latn'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '')
const kindName = (k: string, ar: boolean) => (MOVEMENT_KIND_LABEL[k as MovementKind] ?? [k, k])[ar ? 1 : 0]

function stateText(s: AccountSheet['state']) {
  return ({
    NOT_COUNTED: L('Not counted yet', 'لسه متجردش'), PENDING: L('Counted — waiting for approval', 'اتجرد — مستني الموافقة'),
    APPROVED: L('Counted and approved', 'اتجرد واتوافق عليه'), REJECTED: L('Count rejected', 'الجرد اترفض'),
  } as const)[s]
}
const stateColor = (s: AccountSheet['state']) => (s === 'APPROVED' ? 'text-emerald-700' : s === 'NOT_COUNTED' ? 'text-amber-700' : s === 'REJECTED' ? 'text-rose-700' : 'text-indigo-700')

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: BLUE }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
      <div className="text-end">
        <h1 className="text-lg font-bold" style={{ color: BLUE }}>{title}</h1>
        <p className="text-xs text-gray-600">{sub}</p>
      </div>
    </div>
  )
}

function Groups({ title, groups, total, ar }: { title: string; groups: SheetGroup[]; total: number; ar: boolean }) {
  return (
    <section className="mb-4 break-inside-avoid">
      <h2 className="mb-1 border-b pb-1 text-sm font-bold" style={{ color: BLUE }}>{title}</h2>
      {!groups.length && <p className="text-xs text-gray-500">{L('Nothing', 'مفيش')}</p>}
      {groups.map((g) => (
        <div key={g.kind} className="mb-2">
          <p className="flex justify-between text-xs font-semibold"><span>{kindName(g.kind, ar)} ({g.count})</span><span>{money(g.amount)}</span></p>
          <table className="w-full text-[11px]"><tbody>
            {g.lines.map((m) => (
              <tr key={m.id} className="border-b text-gray-700">
                <td className="w-14 p-0.5">{time(m.date)}</td>
                <td className="p-0.5">{m.note ?? ''}{m.method ? <span className="text-gray-500"> · {m.method}</span> : null}</td>
                <td className="p-0.5 text-end">{money(m.amount)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ))}
      <p className="flex justify-between border-t pt-1 text-xs font-bold"><span>{L('Total', 'الإجمالي')}</span><span>{money(total)}</span></p>
    </section>
  )
}

function Detail({ date, accountId }: { date: string; accountId: string }) {
  const ar = useI18n().locale === 'ar'
  const { data: s, error, isLoading } = useQuery({ queryKey: ['cash-day', date, accountId], queryFn: () => fetchApi<AccountSheet>(`/api/treasury/daily/${accountId}?date=${date}`) })
  if (error) return <p className="text-center text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !s) return <p className="text-center text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>
  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
      <Head title={L('Daily cash-close sheet', 'كشف إقفال اليوم')} sub={`${s.account.name}${s.account.campus ? ` · ${s.account.campus}` : ''} · ${date}`} />
      <table className="mb-4 w-full text-center text-xs"><tbody><tr>
        <td className="border p-2"><b className="block text-base">{money(s.opening)}</b>{L('opening', 'رصيد أول اليوم')}<span className="block text-[10px] text-gray-500">{s.openingSource === 'YESTERDAY_COUNT' ? L("yesterday's approved count", 'جرد امبارح المعتمد') : L('from the books', 'من الدفاتر')}</span></td>
        <td className="border p-2"><b className="block text-base text-emerald-700">+ {money(s.totalIn)}</b>{L('in', 'دخل')}</td>
        <td className="border p-2"><b className="block text-base text-rose-700">− {money(s.totalOut)}</b>{L('out', 'خرج')}</td>
        <td className="border p-2" style={{ background: '#eef3fb' }}><b className="block text-base">{money(s.expected)}</b>{L('should be in the box', 'المفروض يكون موجود')}</td>
      </tr></tbody></table>
      <div className="grid gap-x-6 sm:grid-cols-2 print:grid-cols-2">
        <Groups title={L('Money in', 'الفلوس اللي دخلت')} groups={s.inGroups} total={s.totalIn} ar={ar} />
        <Groups title={L('Money out', 'الفلوس اللي خرجت')} groups={s.outGroups} total={s.totalOut} ar={ar} />
      </div>
      <section className="mb-4 break-inside-avoid rounded border p-3">
        <h2 className="mb-1 text-sm font-bold" style={{ color: BLUE }}>{L('End-of-day count', 'جرد آخر اليوم')} · <span className={stateColor(s.state)}>{stateText(s.state)}</span></h2>
        {s.count ? (
          <table className="w-full text-xs"><tbody>
            <tr className="border-b"><td className="p-1">{L('Counted', 'المعدود')}</td><td className="p-1 text-end font-bold">{money(s.count.counted)}</td></tr>
            <tr className="border-b"><td className="p-1">{L('The books at the time of the count', 'الدفاتر وقت الجرد')}</td><td className="p-1 text-end">{money(s.count.expected)}</td></tr>
            <tr className="border-b"><td className="p-1">{L('Difference (counted − books)', 'الفرق (المعدود − الدفاتر)')}</td><td className={`p-1 text-end font-bold ${s.difference ? (s.difference > 0 ? 'text-emerald-700' : 'text-rose-700') : ''}`}>{money(s.difference ?? 0)}</td></tr>
            <tr className="border-b"><td className="p-1">{L('Counted by', 'جرده')}</td><td className="p-1 text-end">{s.count.countedBy} · {dateTime(s.count.countedAt)}</td></tr>
            <tr className="border-b"><td className="p-1">{L('Approved by', 'وافق عليه')}</td><td className="p-1 text-end">{s.count.approvedBy ? `${s.count.approvedBy} · ${dateTime(s.count.approvedAt)}` : '—'}</td></tr>
            {s.afterCount !== 0 && <tr className="border-b"><td className="p-1">{L('In − out after the count (same day)', 'دخل − خرج بعد الجرد (نفس اليوم)')}</td><td className="p-1 text-end">{money(s.afterCount)}</td></tr>}
            {s.count.note && <tr><td className="p-1">{L('Note', 'ملاحظة')}</td><td className="p-1 text-end">{s.count.note}</td></tr>}
          </tbody></table>
        ) : <p className="text-xs text-amber-700">{L('No count was made this day. Count it from Accounts & Cash → Daily cash count.', 'مفيش جرد اتعمل اليوم ده. اعمله من الحسابات والخزن ← جرد الخزنة.')}</p>}
      </section>
      <div className="mt-8 grid grid-cols-3 gap-6 text-center text-xs">
        {[L('Counted by', 'اللي جرد'), L('Received by', 'اللي استلم'), L('Branch manager', 'مدير الفرع')].map((x) => (
          <div key={x}><div className="mb-1 h-10 border-b border-gray-400" />{x}</div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-gray-400">TechNova · {date}</p>
    </div>
  )
}

function Summary({ date, campusId }: { date: string; campusId: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: ['cash-day', date, campusId], queryFn: () => fetchApi<{ date: string; sheets: AccountSheet[]; totals: Totals }>(`/api/treasury/daily?date=${date}${campusId ? `&campusId=${campusId}` : ''}`) })
  if (error) return <p className="text-center text-sm text-red-600">{(error as Error).message}</p>
  if (isLoading || !data) return <p className="text-center text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>
  const t = data.totals
  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
      <Head title={L('Daily cash-close — all accounts', 'إقفال اليوم — كل الحسابات')} sub={date} />
      {t.notCounted > 0 && <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{L(`${t.notCounted} account(s) not counted yet`, `${t.notCounted} حساب لسه متجردش`)}</p>}
      <table className="w-full text-xs">
        <thead><tr className="bg-gray-50">
          <th className="p-1 text-start">{L('Account', 'الحساب')}</th><th className="p-1 text-end">{L('Opening', 'أول اليوم')}</th><th className="p-1 text-end">{L('In', 'دخل')}</th>
          <th className="p-1 text-end">{L('Out', 'خرج')}</th><th className="p-1 text-end">{L('Should be', 'المفروض')}</th><th className="p-1 text-end">{L('Counted', 'المعدود')}</th>
          <th className="p-1 text-end">{L('Difference', 'الفرق')}</th><th className="p-1 text-start">{L('State', 'الحالة')}</th>
        </tr></thead>
        <tbody>{data.sheets.map((s) => (
          <tr key={s.account.id} className="border-b">
            <td className="p-1"><a className="text-indigo-700 underline print:no-underline" href={`/reports/cash-day/${date}?account=${s.account.id}`}>{s.account.name}</a>{s.account.campus ? <span className="text-gray-500"> · {s.account.campus}</span> : null}</td>
            <td className="p-1 text-end">{money(s.opening)}</td><td className="p-1 text-end">{money(s.totalIn)}</td><td className="p-1 text-end">{money(s.totalOut)}</td>
            <td className="p-1 text-end font-semibold">{money(s.expected)}</td><td className="p-1 text-end">{s.count ? money(s.count.counted) : '—'}</td>
            <td className={`p-1 text-end ${s.difference ? (s.difference > 0 ? 'text-emerald-700' : 'text-rose-700') : ''}`}>{s.difference == null ? '—' : money(s.difference)}</td>
            <td className={`p-1 ${stateColor(s.state)}`}>{stateText(s.state)}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="font-bold" style={{ background: '#eef3fb' }}>
          <td className="p-1">{L('Total', 'الإجمالي')}</td><td className="p-1 text-end">{money(t.opening)}</td><td className="p-1 text-end">{money(t.totalIn)}</td><td className="p-1 text-end">{money(t.totalOut)}</td>
          <td className="p-1 text-end">{money(t.expected)}</td><td className="p-1 text-end">{money(t.counted)}</td><td className="p-1 text-end">{money(t.difference)}</td><td />
        </tr></tfoot>
      </table>
      {!data.sheets.length && <p className="py-6 text-center text-gray-500">{L('No accounts in your places.', 'مفيش حسابات في أماكنك.')}</p>}
      <div className="mt-8 grid grid-cols-2 gap-6 text-center text-xs">
        {[L('Prepared by', 'أعدّه'), L('Reviewed by', 'راجعه')].map((x) => <div key={x}><div className="mb-1 h-10 border-b border-gray-400" />{x}</div>)}
      </div>
    </div>
  )
}

function View({ date }: { date: string }) {
  useI18n()
  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const accountId = sp?.get('account') || ''
  const campusId = sp?.get('campusId') || ''
  const [day, setDay] = useState(date)
  const go = (d: string) => { if (d) window.location.href = `/reports/cash-day/${d}${accountId ? `?account=${accountId}` : campusId ? `?campusId=${campusId}` : ''}` }
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <DateInput className="h-9 w-40" value={day} onChange={(e) => { setDay(e.target.value); go(e.target.value) }} />
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / PDF', 'اطبع / PDF')}</Button>
        {accountId && <Button variant="outline" onClick={() => { window.location.href = `/reports/cash-day/${date}` }}>{L('All accounts', 'كل الحسابات')}</Button>}
        <LanguageSwitch />
      </div>
      {accountId ? <Detail date={date} accountId={accountId} /> : <Summary date={date} campusId={campusId} />}
    </div>
  )
}

export default function CashDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params)
  return <I18nProvider><View date={date} /></I18nProvider>
}
