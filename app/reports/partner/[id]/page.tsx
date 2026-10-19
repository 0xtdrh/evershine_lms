'use client'

/** Partners part 1-B2: printable partner report (outside the dashboard so it prints clean). ?from&to (default: last month). */

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { I18nProvider, L, LanguageSwitch } from '@/lib/i18n/client'
import { Printer } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Report {
  partner: { id: string; name: string; kind: string }
  from: string; to: string
  totals: { groups: number; students: number; sessionsHeld: number; sessionsCancelled: number; attendancePct: number | null }
  groups: { id: string; name: string; place: string; level: string; students: number; unnamed: boolean; sessionsHeld: number; sessionsCancelled: number; attendancePct: number | null }[]
}

function lastMonth() {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1)
  const from = d.toISOString().slice(0, 10)
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  return { from, to: end }
}

function View({ id }: { id: string }) {
  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const def = lastMonth()
  const [range, setRange] = useState({ from: sp?.get('from') || def.from, to: sp?.get('to') || def.to })
  const { data: r, error } = useQuery({ queryKey: ['partner-report', id, range.from, range.to], queryFn: () => fetchApi<Report>(`/api/partners/${id}/report?from=${range.from}&to=${range.to}`) })
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <DateInput className="h-9 w-40" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <DateInput className="h-9 w-40" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / save as PDF', 'اطبع / احفظ PDF')}</Button>
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {r && (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{L('Partner report', 'تقرير الشريك')}</h1>
              <p className="text-xs text-gray-600">{r.partner.name} · {r.from} → {r.to}</p>
            </div>
          </div>
          <table className="mb-4 w-full text-center text-xs">
            <tbody><tr>
              <td className="border p-2"><b className="block text-lg">{r.totals.groups}</b>{L('groups', 'جروب')}</td>
              <td className="border p-2"><b className="block text-lg">{r.totals.students}</b>{L('students / children', 'طالب / طفل')}</td>
              <td className="border p-2"><b className="block text-lg">{r.totals.sessionsHeld}</b>{L('sessions held', 'حصة اتعملت')}</td>
              <td className="border p-2"><b className="block text-lg">{r.totals.sessionsCancelled}</b>{L('sessions cancelled', 'حصة اتلغت')}</td>
              <td className="border p-2"><b className="block text-lg">{r.totals.attendancePct ?? '—'}{r.totals.attendancePct !== null ? '%' : ''}</b>{L('attendance', 'الحضور')}</td>
            </tr></tbody>
          </table>
          <table className="w-full text-xs">
            <thead><tr style={{ background: '#1B4F8A', color: '#fff' }}>
              <th className="p-1 text-start">{L('Group', 'الجروب')}</th><th className="p-1 text-start">{L('Place', 'المكان')}</th><th className="p-1 text-start">{L('Course › level', 'الكورس › المستوى')}</th>
              <th className="p-1">{L('Students', 'الطلاب')}</th><th className="p-1">{L('Held', 'اتعملت')}</th><th className="p-1">{L('Cancelled', 'اتلغت')}</th><th className="p-1">{L('Attendance', 'الحضور')}</th>
            </tr></thead>
            <tbody>
              {r.groups.map((g) => (
                <tr key={g.id} className="border-b">
                  <td className="p-1">{g.name}</td><td className="p-1">{g.place}</td><td className="p-1">{g.level}</td>
                  <td className="p-1 text-center">{g.students}{g.unnamed ? '*' : ''}</td><td className="p-1 text-center">{g.sessionsHeld}</td><td className="p-1 text-center">{g.sessionsCancelled}</td>
                  <td className="p-1 text-center">{g.attendancePct === null ? '—' : `${g.attendancePct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.groups.some((g) => g.unnamed) && <p className="mt-2 text-xs text-gray-500">* {L('class without names: number of children', 'فصل من غير أسماء: عدد الأطفال')}</p>}
          <p className="mt-6 text-center text-xs text-gray-400">TechNova · {new Date().toISOString().slice(0, 10)}</p>
        </div>
      )}
    </div>
  )
}

export default function PartnerReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <I18nProvider><View id={id} /></I18nProvider>
}
