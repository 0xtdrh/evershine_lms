'use client'

/**
 * Instructor pay statement (2026-10-26) — printable, outside the dashboard. ?month=YYYY-MM&campusId=&groupId=
 * Session by session / each student's share (the instructor's share only) / fixed / bonuses & deductions → total.
 */

import { use, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { FileSpreadsheet, Printer, ReceiptText } from 'lucide-react'
import { cairoToday } from '@/lib/dates/cairo'
import type { PayStatement } from '@/lib/teachers/pay-statement'

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${L('EGP', 'ج.م')}`
const thisMonth = () => cairoToday().slice(0, 7)
const KIND = (k: string, coveredOnly?: boolean) => coveredOnly ? L('covered as a substitute', 'تغطية كبديل') : ({ PER_SESSION: L('per session', 'بالحصة'), PERCENT: L('percent', 'نسبة'), FIXED: L('fixed', 'ثابت'), MIXED: L('mixed', 'مكس'), NONE: L('no pay set', 'مفيش أجر متحدد') } as Record<string, string>)[k] ?? k
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'), { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })

function View({ id }: { id: string }) {
  useI18n()
  const { data: session } = useSession()
  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const [month, setMonth] = useState(sp?.get('month') || thisMonth())
  const [campusId, setCampusId] = useState(sp?.get('campusId') || '')
  const [groupId, setGroupId] = useState(sp?.get('groupId') || '')
  const qs = `month=${month}${campusId ? `&campusId=${campusId}` : ''}${groupId ? `&groupId=${groupId}` : ''}`
  const { data: all } = useQuery({ queryKey: ['pay-statement', id, month, 'all'], queryFn: () => fetchApi<PayStatement>(`/api/teachers/${id}/pay-statement?month=${month}`) })
  const { data: st, error, isLoading } = useQuery({ queryKey: ['pay-statement', id, qs], queryFn: () => fetchApi<PayStatement>(`/api/teachers/${id}/pay-statement?${qs}`) })
  const places = useMemo(() => [...new Map((all?.groups ?? []).filter((g) => g.campusId).map((g) => [g.campusId!, g.place])).entries()], [all])
  const isFinance = !!session && session.user.role !== 'TEACHER'

  const excel = async () => {
    try {
      const r = await fetch(`/api/teachers/${id}/pay-statement?${qs}&format=xlsx`)
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message || 'Export failed')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a'); a.href = url; a.download = `pay-statement-${month}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { notify.error((e as Error).message) }
  }

  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <label className="text-sm" htmlFor="ps-month">{L('Month', 'الشهر')}</label>
        <input id="ps-month" type="month" className="h-9 rounded-md border px-2 text-sm" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <select aria-label={L('Place', 'الفرع')} className="h-9 rounded-md border px-2 text-sm" value={campusId} onChange={(e) => { setCampusId(e.target.value); setGroupId('') }}>
          <option value="">{L('All places', 'كل الفروع')}</option>
          {places.map(([cid, name]) => <option key={cid} value={cid}>{name}</option>)}
        </select>
        <select aria-label={L('Group', 'الجروب')} className="h-9 rounded-md border px-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">{L('All groups', 'كل الجروبات')}</option>
          {(all?.groups ?? []).filter((g) => !campusId || g.campusId === campusId).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / PDF', 'اطبع / PDF')}</Button>
        <Button variant="outline" onClick={excel}><FileSpreadsheet className="me-2 h-4 w-4" />Excel</Button>
        {isFinance && st && (
          <Button variant="outline" onClick={() => { window.location.href = `/dashboard/accountant/salary-slips?statementTeacher=${st.teacher.userId}&statementMonth=${month}${campusId ? `&statementCampus=${campusId}` : ''}${groupId ? `&statementGroup=${groupId}` : ''}` }}>
            <ReceiptText className="me-2 h-4 w-4" />{L('Issue a slip from this statement', 'اطلع قسيمة من الكشف')}
          </Button>
        )}
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {isLoading && <p className="text-center text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>}
      {st && (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{L('Instructor pay statement', 'كشف أجر المدرب')}</h1>
              <p className="text-xs text-gray-600">{st.teacher.name}{st.teacher.employeeId ? ` · ${st.teacher.employeeId}` : ''} · {month}{st.scope.label ? ` · ${st.scope.label}` : ''}</p>
            </div>
          </div>

          <table className="mb-4 w-full text-center text-xs">
            <tbody><tr>
              <td className="border p-2"><b className="block text-base">{st.totals.sessions}</b>{L('sessions paid', 'حصة محسوبة')}</td>
              <td className="border p-2"><b className="block text-base">{money(st.totals.earnings)}</b>{L('earned', 'الأجر')}</td>
              <td className="border p-2"><b className="block text-base">{money(st.totals.bonuses)}</b>{L('bonuses', 'إضافات')}</td>
              <td className="border p-2"><b className="block text-base">{money(st.totals.deductions)}</b>{L('deductions', 'خصومات')}</td>
              <td className="border p-2" style={{ background: '#eef3fb' }}><b className="block text-base">{money(st.totals.net)}</b>{L('net', 'الصافي')}</td>
            </tr></tbody>
          </table>

          {st.groups.length === 0 && <p className="py-6 text-center text-gray-500">{L('Nothing to pay this month.', 'مفيش أجر في الشهر ده.')}</p>}
          {st.groups.map((g) => (
            <section key={g.id} className="mb-5 break-inside-avoid">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
                <h2 className="text-sm font-bold">{g.label} <span className="font-normal text-gray-500">· {g.place} · {KIND(g.payKind, g.coveredOnly)}</span></h2>
                <b>{money(g.total)}</b>
              </div>
              {g.payKind === 'NONE' && !g.coveredOnly && (
                <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 print:hidden">{L('⚠ No pay is set for this instructor in this group — set it on the group page (instructor pay) or on the instructor page, then open the statement again.', '⚠ مفيش أجر متحدد للمدرب ده في الجروب ده — حدده من صفحة الجروب (أجر المدرب) أو من صفحة المدرب، وافتح الكشف تاني.')}</p>
              )}
              {g.sessions.length > 0 && (
                <table className="mb-2 w-full text-xs">
                  <thead><tr className="bg-gray-50"><th className="p-1 text-start">{L('Session', 'الحصة')}</th><th className="p-1 text-start">{L('Date', 'التاريخ')}</th><th className="p-1 text-start">{L('Taught by', 'شرحها')}</th><th className="p-1 text-end">{L('Amount', 'المبلغ')}</th></tr></thead>
                  <tbody>{g.sessions.map((s) => (
                    <tr key={s.date} className="border-b">
                      <td className="p-1">{s.n ?? '—'}{s.of ? ` ${L('of', 'من')} ${s.of}` : ''}</td>
                      <td className="p-1">{dayName(s.date)}</td>
                      <td className="p-1">{s.counted ? st.teacher.name : s.otherTeacher ? `${s.otherTeacher} (${L('substitute', 'بديل')})` : s.notPaidByTechNova ? L('not paid by TechNova that day', 'مش على حساب TechNova اليوم ده') : '—'}</td>
                      <td className="p-1 text-end">{s.counted && g.rule.perSession ? money(g.rule.perSession) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {g.studentShares.length > 0 && (
                <table className="mb-2 w-full text-xs">
                  <thead><tr className="bg-gray-50"><th className="p-1 text-start">{L('Student', 'الطالب')}</th><th className="p-1 text-end">{L(`Instructor share (${g.rule.percent}%)`, `نصيب المدرب (${g.rule.percent}%)`)}</th></tr></thead>
                  <tbody>{g.studentShares.map((x) => <tr key={x.student} className="border-b"><td className="p-1">{x.student}</td><td className="p-1 text-end">{money(x.share)}</td></tr>)}</tbody>
                </table>
              )}
              {g.fixedAmount > 0 && <p className="text-xs">{L('Fixed amount for this group', 'المبلغ الثابت للجروب')}: <b>{money(g.fixedAmount)}</b></p>}
              {g.adjustments.map((a, i) => (
                <p key={i} className={`text-xs ${a.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{a.amount < 0 ? L('Deduction', 'خصم') : L('Bonus', 'إضافة')} · {a.date} · {a.reason}: <b>{money(Math.abs(a.amount))}</b></p>
              ))}
            </section>
          ))}
          {st.general.map((a, i) => (
            <p key={i} className={`text-xs ${a.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{a.amount < 0 ? L('Deduction', 'خصم') : L('Bonus', 'إضافة')} · {a.date} · {a.reason}: <b>{money(Math.abs(a.amount))}</b></p>
          ))}
          <div className="mt-4 flex justify-between border-t-2 pt-2 text-base font-bold" style={{ borderColor: '#1B4F8A' }}><span>{L('Net', 'الصافي')}</span><span>{money(st.totals.net)}</span></div>
          <p className="mt-6 text-center text-xs text-gray-400">TechNova · {cairoToday()}</p>
        </div>
      )}
    </div>
  )
}

export default function TeacherPayStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <I18nProvider><View id={id} /></I18nProvider>
}
