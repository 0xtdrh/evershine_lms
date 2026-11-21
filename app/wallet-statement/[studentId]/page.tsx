'use client'

/** Printable wallet account statement (phase B): opening balance, every movement, closing balance. Final test 18/11: in the screen language. */

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { walletNote, walletType } from '@/components/wallet/WalletLedger'
import { ArrowLeft, ArrowRight, Printer } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { cairoToday } from '@/lib/dates/cairo'
import { I18nProvider, LanguageSwitch, useI18n } from '@/lib/i18n/client'

interface Statement {
  company: { companyName: string; companyPhone: string; companyAddress: string }
  student: { name: string; registrationNumber: string; campus: string }
  from: string; to: string; opening: number; closing: number
  totals: { in: number; out: number }
  lines: { date: string; type: string; amount: number; balance: number; document: string | null; detail: string | null }[]
}
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

function View({ studentId }: { studentId: string }) {
  const { pick, dir, locale } = useI18n()
  const today = cairoToday()
  const [from, setFrom] = useState(`${today.slice(0, 5)}01-01`)
  const [to, setTo] = useState(today)
  const { data: s, error, isLoading } = useQuery({
    queryKey: ['wallet-statement', studentId, from, to],
    queryFn: () => fetchApi<Statement>(`/api/students/${studentId}/wallet/statement?from=${from}&to=${to}`),
    retry: false,
  })
  const day = (d: string) => new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo' })
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft
  if (error) {
    return (
      <div className="p-6 text-sm" dir={dir}>
        <p className="mb-2 text-red-600">{(error as Error).message}</p>
        <Link href="/login" className="text-blue-600 underline">{pick('Sign in', 'ادخل')}</Link>
      </div>
    )
  }
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={dir}>
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-end justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}>
          <Back className="me-2 h-4 w-4" /> {pick('Back', 'رجوع')}
        </Button>
        <label className="text-xs">{pick('From', 'من')}<DateInput className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs">{pick('To', 'لحد')}<DateInput className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" /> {pick('Print / save as PDF', 'اطبع / احفظ PDF')}</Button>
        <LanguageSwitch />
      </div>
      {isLoading || !s ? <p className="text-center text-sm text-gray-500">{pick('Loading…', 'بيحمّل…')}</p> : (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-3 flex items-start justify-between border-b border-black pb-2">
            <div>
              <div className="text-lg font-bold">{s.company.companyName}</div>
              <div className="text-xs">{s.company.companyAddress}{s.company.companyPhone ? <> · <span dir="ltr">{s.company.companyPhone}</span></> : null}</div>
            </div>
            <div className="text-end">
              <div className="font-bold">{pick('Wallet statement', 'كشف حساب المحفظة')}</div>
              <div className="text-xs">{day(s.from)} – {day(s.to)}</div>
            </div>
          </div>
          <p className="mb-2"><strong>{s.student.name}</strong> · <span dir="ltr">{s.student.registrationNumber}</span> · {s.student.campus}</p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-black">
                <th className="py-1 text-start">{pick('Date', 'التاريخ')}</th>
                <th className="text-start">{pick('Movement', 'الحركة')}</th>
                <th className="text-start">{pick('Document', 'المستند')}</th>
                <th className="text-start">{pick('Details', 'التفاصيل')}</th>
                <th className="text-end">{pick('In / out', 'داخل / خارج')}</th>
                <th className="text-end">{pick('Balance', 'الرصيد')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-300"><td className="py-1" colSpan={5}>{pick('Opening balance', 'رصيد أول المدة')}</td><td className="text-end font-semibold" dir="ltr">{money(s.opening)}</td></tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-gray-200">
                  <td className="py-1">{day(l.date)}</td>
                  <td>{walletType(l.type)}</td>
                  <td className="font-mono" dir="ltr">{l.document ?? '—'}</td>
                  <td>{l.detail ? walletNote(l.detail) : ''}</td>
                  <td className={`text-end font-mono ${l.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`} dir="ltr">{l.amount >= 0 ? '+' : ''}{money(l.amount)}</td>
                  <td className="text-end font-mono" dir="ltr">{money(l.balance)}</td>
                </tr>
              ))}
              <tr className="border-t border-black font-semibold">
                <td className="py-1" colSpan={4}>{pick('Totals · closing balance', 'الإجمالي · رصيد آخر المدة')}</td>
                <td className="text-end" dir="ltr">+{money(s.totals.in)} / −{money(s.totals.out)}</td>
                <td className="text-end">{money(s.closing)} {pick('EGP', 'ج.م')}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-gray-500">
            {pick('Printed', 'اتطبع')} {new Date().toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo' })}.{' '}
            {pick('Every payment passes through the wallet: a top-up and its invoice payment appear together.', 'كل دفعة بتعدّي على المحفظة: الشحن ودفع الفاتورة بيظهروا مع بعض.')}
          </p>
        </div>
      )}
    </div>
  )
}

export default function WalletStatementPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  return <I18nProvider><View studentId={studentId} /></I18nProvider>
}
