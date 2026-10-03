'use client'

/**
 * Printable wallet top-up receipt TN-TOPUP-… (phase B). Outside the dashboard
 * layout so it prints clean; paper size from Settings > Payments.
 */

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Copy, MessageCircle, Printer } from 'lucide-react'

interface TopUp {
  id: string; topUpNumber: string | null; status: string; amount: number; fee: number; method: string; source: string
  transactionId: string | null; createdAt: string; approvedAt: string | null; studentId: string
  student: { name: string; registrationNumber: string }
  parent: { name: string; phone: string } | null
  company: { companyName: string; companyPhone: string; companyAddress: string; receiptFooter: string; receiptPaper: '80mm' | '58mm' | 'A4' }
  text: string
  whatsappTo: string | null
}

const WIDTH: Record<string, string> = { '80mm': '72mm', '58mm': '48mm', A4: '150mm' }
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

export default function TopUpReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: r, error, isLoading } = useQuery({ queryKey: ['topup', id], queryFn: () => fetchApi<TopUp>(`/api/wallet/topups/${id}`), retry: false })
  if (isLoading) return <p className="p-6 text-sm text-gray-500">Loading…</p>
  if (error || !r) return <div className="p-6 text-sm"><p className="mb-2 text-red-600">{(error as Error)?.message || 'Receipt not found'}</p><Link href="/login" className="text-blue-600 underline">Sign in</Link></div>
  const paper = r.company.receiptPaper
  const thermal = paper !== 'A4'
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}><span>{label}</span><span className="text-right">{value}</span></div>
  )
  const logWhatsApp = () => {
    fetch('/api/contact-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: r.studentId, channel: 'WHATSAPP', reason: 'PAYMENT', summary: `Top-up receipt ${r.topUpNumber} sent on WhatsApp (${money(r.amount)}).`, auto: true }) }).catch(() => undefined)
  }
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: ${thermal ? `${paper} auto` : 'A4'}; margin: ${thermal ? '0' : '15mm'}; } body { background: #fff; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-xl flex-wrap justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print ({paper})</Button>
        {r.whatsappTo && (
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <a href={`https://wa.me/${r.whatsappTo}?text=${encodeURIComponent(r.text)}`} target="_blank" rel="noopener noreferrer" onClick={logWhatsApp}><MessageCircle className="mr-2 h-4 w-4" /> Send on WhatsApp</a>
          </Button>
        )}
        <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(r.text); notify.success('Copied') } catch { notify.error('Copy failed') } }}><Copy className="mr-2 h-4 w-4" /> Copy text</Button>
      </div>
      <div className="mx-auto bg-white p-3 text-black shadow print:shadow-none" style={{ width: WIDTH[paper], fontFamily: thermal ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit', fontSize: paper === '58mm' ? '10px' : thermal ? '11px' : '13px' }}>
        <div className="text-center">
          <div className="font-bold" style={{ fontSize: thermal ? '15px' : '20px' }}>{r.company.companyName}</div>
          {r.company.companyAddress && <div>{r.company.companyAddress}</div>}
          {r.company.companyPhone && <div>{r.company.companyPhone}</div>}
          <div className="mt-1 font-bold">WALLET TOP-UP · شحن المحفظة</div>
        </div>
        <hr className="my-2 border-dashed border-black" />
        {row('Receipt', r.topUpNumber ?? 'PENDING APPROVAL', true)}
        {row('Date', new Date(r.approvedAt ?? r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))}
        {row('Student', r.student.name)}
        {row('Reg. no', r.student.registrationNumber)}
        <div className="my-1 flex justify-between gap-2 border-y border-black py-1 font-bold" style={{ fontSize: thermal ? '14px' : '17px' }}><span>ADDED</span><span>{money(r.amount)}</span></div>
        {row('Method', r.method)}
        {r.fee > 0 && row('Online fee (paid by parent)', money(r.fee))}
        {r.transactionId && row('Ref.', r.transactionId)}
        {r.source === 'PAYMENT' && <div className="mt-1 text-center">Paid straight to an invoice (see the payment receipt).</div>}
        <hr className="my-2 border-dashed border-black" />
        <div className="text-center">The wallet pays the invoices automatically.</div>
        {r.company.receiptFooter && <div className="mt-1 text-center">{r.company.receiptFooter}</div>}
      </div>
    </div>
  )
}
