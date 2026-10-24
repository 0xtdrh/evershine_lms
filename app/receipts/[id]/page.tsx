'use client'

/**
 * Printable payment receipt (outside the dashboard layout so it prints clean).
 * Paper size from Settings > Payments: thermal 80mm / 58mm, or A4.
 * ?print=1 opens the print dialog as soon as it loads.
 */

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Copy, MessageCircle, Printer } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface Receipt {
  receiptNumber: string
  paidAt: string
  amount: number
  method: string
  transactionId: string | null
  status: string
  receivedBy: string
  student: { id: string; name: string; registrationNumber: string }
  parent: { name: string; phone: string } | null
  invoice: { id: string; number: string; month: string; subtotal: number; discount: number; total: number; paidSoFar: number; remaining: number; group: string | null; course: string | null; level: string | null }
  company: { companyName: string; companyPhone: string; companyAddress: string; receiptFooter: string; receiptPaper: '80mm' | '58mm' | 'A4' }
  text: string
  whatsappTo: string | null
}

const WIDTH: Record<string, string> = { '80mm': '72mm', '58mm': '48mm', A4: '150mm' }
const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} EGP`

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  useI18n() // re-render on a language switch
  const { id } = use(params)
  const [autoPrint, setAutoPrint] = useState(false)
  useEffect(() => {
    try { setAutoPrint(new URLSearchParams(window.location.search).get('print') === '1') } catch {}
  }, [])
  const { data: r, error, isLoading } = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => fetchApi<Receipt>(`/api/payments/${id}/receipt`),
    retry: false,
  })
  useEffect(() => {
    if (r && autoPrint) setTimeout(() => window.print(), 300)
  }, [r, autoPrint])

  if (isLoading) return <p className="p-6 text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>
  if (error || !r) {
    return (
      <div className="p-6 text-sm">
        <p className="mb-2 text-red-600">{(error as Error)?.message || 'Receipt not found'}</p>
        <Link href="/login" className="text-blue-600 underline">{L('Sign in', 'ادخل')}</Link>
      </div>
    )
  }

  const paper = r.company.receiptPaper
  const thermal = paper !== 'A4'
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.text); notify.success(L('Receipt text copied', 'نص الإيصال اتنسخ')) } catch { notify.error(L('Copy failed', 'النسخ فشل')) }
  }
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )

  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: ${thermal ? `${paper} auto` : 'A4'}; margin: ${thermal ? '0' : '15mm'}; } body { background: #fff; } }`}</style>

      <div className="mx-auto mb-4 flex max-w-xl flex-wrap justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => history.length > 1 ? history.back() : (window.location.href = '/dashboard')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {L('Back', 'رجوع')}
        </Button>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print ({paper})</Button>
        {r.whatsappTo ? (
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <a
              href={`https://wa.me/${r.whatsappTo}?text=${encodeURIComponent(r.text)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // Phase A: written to the student's contact log (staff only; ignored for parents).
                fetch('/api/contact-logs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ studentId: r.student.id, channel: 'WHATSAPP', reason: 'PAYMENT', summary: `Payment receipt sent on WhatsApp (${money(r.amount)}, invoice ${r.invoice.number}).`, auto: true }),
                }).catch(() => undefined)
              }}
            >
              <MessageCircle className="mr-2 h-4 w-4" /> {L('Send on WhatsApp', 'ابعت واتساب')}
            </a>
          </Button>
        ) : (
          <span className="self-center text-xs text-gray-500">{L('No parent phone for WhatsApp', 'مفيش تليفون ولي أمر للواتساب')}</span>
        )}
        <Button variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4" /> {L('Copy text', 'انسخ النص')}</Button>
      </div>

      <div
        className="mx-auto bg-white p-3 text-black shadow print:shadow-none"
        style={{ width: WIDTH[paper], fontFamily: thermal ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit', fontSize: paper === '58mm' ? '10px' : thermal ? '11px' : '13px' }}
      >
        <div className="text-center">
          <div className="font-bold" style={{ fontSize: thermal ? '15px' : '20px' }}>{r.company.companyName}</div>
          {r.company.companyAddress && <div>{r.company.companyAddress}</div>}
          {r.company.companyPhone && <div>{r.company.companyPhone}</div>}
          <div className="mt-1 font-bold">PAYMENT RECEIPT · إيصال استلام</div>
        </div>
        <hr className="my-2 border-dashed border-black" />
        {row('رقم الإيصال · Receipt', r.receiptNumber, true)}
        {row('التاريخ · Date', new Date(r.paidAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' }))}
        {row('الطالب · Student', r.student.name)}
        {row('رقم القيد · Reg. no', r.student.registrationNumber)}
        {r.invoice.group && row('الجروب · Group', r.invoice.group)}
        {r.invoice.course && row('الكورس · Course', `${r.invoice.course}${r.invoice.level ? ` — ${r.invoice.level}` : ''}`)}
        {row('الفاتورة · Invoice', `${r.invoice.number}`)}
        {row('عن · For', r.invoice.month)}
        <hr className="my-2 border-dashed border-black" />
        {r.invoice.discount > 0 && row('Price', money(r.invoice.subtotal))}
        {r.invoice.discount > 0 && row('Discount', `- ${money(r.invoice.discount)}`)}
        {row('إجمالي الفاتورة · Invoice total', money(r.invoice.total))}
        <div className="my-1 flex justify-between gap-2 border-y border-black py-1 font-bold" style={{ fontSize: thermal ? '14px' : '17px' }}>
          <span>المدفوع · PAID</span>
          <span>{money(r.amount)}</span>
        </div>
        {row('طريقة الدفع · Method', r.method)}
        {r.transactionId && row('Ref.', r.transactionId)}
        {row('المدفوع لحد دلوقتي · Paid so far', money(r.invoice.paidSoFar))}
        {row('الباقي · Remaining', money(r.invoice.remaining), true)}
        {row('استلم · Received by', r.receivedBy)}
        {r.status !== 'COMPLETED' && <div className="mt-1 text-center font-bold">STATUS: {r.status}</div>}
        <hr className="my-2 border-dashed border-black" />
        {r.company.receiptFooter && <div className="text-center">{r.company.receiptFooter}</div>}
      </div>
    </div>
  )
}
