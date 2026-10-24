'use client'

/** Partners part 1-B2: printable partner statement (TechNova logo + colours), outside the dashboard so it prints clean. */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { I18nProvider, L, LanguageSwitch } from '@/lib/i18n/client'
import type { DealLine } from '@/lib/partners/deal'
import type { ManualLine } from '@/lib/partners/statement'
import { Printer } from 'lucide-react'
import { cairoToday } from '@/lib/dates/cairo'

interface S {
  number: string; status: string; periodFrom: string; periodTo: string; placeName: string | null
  partner: { name: string }; lines: DealLine[]; manualLines: ManualLine[] | null
  periodBalance: number; previousBalance: number; totalDue: number; rest: number
  payments: { id: string; direction: string; amount: number; method: string; paidAt: string; reference: string | null }[]
}

const money = (n: number) => `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
const who = (n: number) => (n > 0 ? L('owed by the partner to TechNova', 'على الشريك لـ TechNova') : n < 0 ? L('owed by TechNova to the partner', 'على TechNova للشريك') : L('settled', 'متسوّي'))

function View({ id }: { id: string }) {
  const { data: s, error } = useQuery({ queryKey: ['partner-statement', id], queryFn: () => fetchApi<S>(`/api/partner-statements/${id}`) })
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl justify-center gap-2 px-4 print:hidden">
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / save as PDF', 'اطبع / احفظ PDF')}</Button>
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {s && (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{L('Statement', 'كشف حساب')} {s.number}</h1>
              <p className="text-xs text-gray-600">{s.partner.name}{s.placeName ? ` · ${s.placeName}` : ''} · {s.periodFrom.slice(0, 10)} → {s.periodTo.slice(0, 10)}</p>
              {s.status === 'DRAFT' && <p className="text-xs font-bold text-red-600">{L('DRAFT — not approved', 'مسودة — مش معتمد')}</p>}
            </div>
          </div>
          <table className="w-full text-xs">
            <thead><tr style={{ background: '#1B4F8A', color: '#fff' }}><th className="p-1 text-start">{L('Item', 'البند')}</th><th className="p-1">{L('Qty × rate', 'العدد × السعر')}</th><th className="p-1 text-end">{L('Amount', 'المبلغ')}</th><th className="p-1 text-end">{L('Paid by', 'بيدفعه')}</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b"><td className="p-1">{L(l.label, l.labelAr)}</td><td className="p-1 text-center">{l.quantity} × {l.rate}</td><td className="p-1 text-end">{money(l.amount)}</td><td className="p-1 text-end">{l.payer === 'TECHNOVA' ? 'TechNova' : L('Partner', 'الشريك')}</td></tr>
              ))}
              {(s.manualLines ?? []).map((l, i) => (
                <tr key={`m${i}`} className="border-b"><td className="p-1">{l.label}{l.reason ? ` — ${l.reason}` : ''}</td><td /><td className="p-1 text-end">{money(l.amount)}</td><td className="p-1 text-end">{l.payer === 'TECHNOVA' ? 'TechNova' : L('Partner', 'الشريك')}</td></tr>
              ))}
            </tbody>
          </table>
          <table className="mt-3 w-full text-sm">
            <tbody>
              <tr><td>{L('This period', 'الفترة دي')}</td><td className="text-end font-semibold">{money(s.periodBalance)} — {who(s.periodBalance)}</td></tr>
              {s.previousBalance !== 0 && <tr><td>{L('Carried from earlier statements', 'مترحّل من كشوف قبل كده')}</td><td className="text-end font-semibold">{money(s.previousBalance)} — {who(s.previousBalance)}</td></tr>}
              <tr className="border-t"><td className="font-bold">{L('Total', 'الإجمالي')}</td><td className="text-end font-bold">{money(s.totalDue)} — {who(s.totalDue)}</td></tr>
              {s.payments.map((p) => <tr key={p.id} className="text-xs text-gray-600"><td>{L('Paid', 'اتدفع')} {p.paidAt.slice(0, 10)} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td className="text-end">{money(p.amount)}</td></tr>)}
              {s.status !== 'DRAFT' && <tr className="border-t"><td className="font-bold">{L('Left', 'الباقي')}</td><td className="text-end font-bold">{money(s.rest)} — {who(s.rest)}</td></tr>}
            </tbody>
          </table>
          <p className="mt-6 text-center text-xs text-gray-400">TechNova · {cairoToday()}</p>
        </div>
      )}
    </div>
  )
}

export default function PartnerStatementPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <I18nProvider><View id={id} /></I18nProvider>
}
