'use client'

/** Printable refund receipt (same paper size as payment receipts). */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Printer } from 'lucide-react'

interface RefundView {
  refundNumber: string | null
  status: string
  amount: number
  suggestedAmount: number
  method: 'CASH' | 'WALLET'
  payoutMethod: string | null
  reason: string | null
  approvedAt: string | null
  createdAt: string
  calc: { netPaid?: number; perSession?: number; sessionsCounted?: number; basis?: string; deduction?: number; adminFee?: number } | null
  student: { firstName: string; lastName: string; registrationNumber: string } | null
  invoice: { challanNumber: string; month: string } | null
  approvedBy: string | null
  company: { companyName: string; companyPhone: string; companyAddress: string; receiptPaper: '80mm' | '58mm' | 'A4' }
}

const WIDTH: Record<string, string> = { '80mm': '72mm', '58mm': '48mm', A4: '150mm' }
const money = (n: number | undefined) => `${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

export default function RefundReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: r, error, isLoading } = useQuery({ queryKey: ['refund', id], queryFn: () => fetchApi<RefundView>(`/api/refunds/${id}`), retry: false })
  if (isLoading) return <p className="p-6 text-sm text-gray-500">Loading…</p>
  if (error || !r) return <p className="p-6 text-sm text-red-600">{(error as Error)?.message || 'Refund not found'}</p>
  const paper = r.company.receiptPaper
  const thermal = paper !== 'A4'
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-2 ${strong ? 'font-bold' : ''}`}><span>{label}</span><span className="text-right">{value}</span></div>
  )
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: ${thermal ? `${paper} auto` : 'A4'}; margin: ${thermal ? '0' : '15mm'}; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-xl justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard/refunds'))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print ({paper})</Button>
      </div>
      <div className="mx-auto bg-white p-3 text-black shadow print:shadow-none" style={{ width: WIDTH[paper], fontFamily: thermal ? 'ui-monospace, Menlo, Consolas, monospace' : 'inherit', fontSize: paper === '58mm' ? '10px' : thermal ? '11px' : '13px' }}>
        <div className="text-center">
          <div className="font-bold" style={{ fontSize: thermal ? '15px' : '20px' }}>{r.company.companyName}</div>
          {r.company.companyAddress && <div>{r.company.companyAddress}</div>}
          {r.company.companyPhone && <div>{r.company.companyPhone}</div>}
          <div className="mt-1 font-bold">REFUND · إيصال استرداد</div>
        </div>
        <hr className="my-2 border-dashed border-black" />
        {row('Refund', r.refundNumber ?? 'pending', true)}
        {row('Status', r.status)}
        {row('Date', new Date(r.approvedAt ?? r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }))}
        {r.student && row('Student', `${r.student.firstName} ${r.student.lastName}`)}
        {r.student && row('Reg. no', r.student.registrationNumber)}
        {r.invoice && row('Invoice', `${r.invoice.challanNumber} (${r.invoice.month})`)}
        <hr className="my-2 border-dashed border-black" />
        {r.calc && row('Paid', money(r.calc.netPaid))}
        {r.calc && row(`Sessions ${r.calc.basis === 'HELD' ? 'held' : 'attended'} (${r.calc.sessionsCounted ?? 0})`, `- ${money(r.calc.deduction)}`)}
        {r.calc && row('Admin fee', `- ${money(r.calc.adminFee)}`)}
        <div className="my-1 flex justify-between gap-2 border-y border-black py-1 font-bold" style={{ fontSize: thermal ? '14px' : '17px' }}>
          <span>REFUNDED</span><span>{money(r.amount)}</span>
        </div>
        {row('As', r.method === 'WALLET' ? 'Credit in the student wallet' : `Money back (${r.payoutMethod ?? ''})`)}
        {r.reason && row('Reason', r.reason)}
        {r.approvedBy && row('Approved by', r.approvedBy)}
        <div className="mt-6 flex justify-between gap-4"><span>Signature: ________</span></div>
      </div>
    </div>
  )
}
