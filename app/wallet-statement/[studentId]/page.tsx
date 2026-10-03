'use client'

/** Printable wallet account statement (phase B): opening balance, every movement, closing balance. */

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WALLET_TYPE } from '@/components/wallet/WalletLedger'
import { ArrowLeft, Printer } from 'lucide-react'

interface Statement {
  company: { companyName: string; companyPhone: string; companyAddress: string }
  student: { name: string; registrationNumber: string; campus: string }
  from: string; to: string; opening: number; closing: number
  totals: { in: number; out: number }
  lines: { date: string; type: string; amount: number; balance: number; document: string | null; detail: string | null }[]
}
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export default function WalletStatementPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(`${today.slice(0, 5)}01-01`)
  const [to, setTo] = useState(today)
  const { data: s, error, isLoading } = useQuery({
    queryKey: ['wallet-statement', studentId, from, to],
    queryFn: () => fetchApi<Statement>(`/api/students/${studentId}/wallet/statement?from=${from}&to=${to}`),
    retry: false,
  })
  if (error) return <div className="p-6 text-sm"><p className="mb-2 text-red-600">{(error as Error).message}</p><Link href="/login" className="text-blue-600 underline">Sign in</Link></div>
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-end justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <label className="text-xs">From<Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs">To<Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print / save as PDF</Button>
      </div>
      {isLoading || !s ? <p className="text-center text-sm text-gray-500">Loading…</p> : (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none">
          <div className="mb-3 flex items-start justify-between border-b border-black pb-2">
            <div>
              <div className="text-lg font-bold">{s.company.companyName}</div>
              <div className="text-xs">{s.company.companyAddress}{s.company.companyPhone ? ` · ${s.company.companyPhone}` : ''}</div>
            </div>
            <div className="text-right">
              <div className="font-bold">WALLET STATEMENT · كشف حساب المحفظة</div>
              <div className="text-xs">{s.from} → {s.to}</div>
            </div>
          </div>
          <p className="mb-2"><strong>{s.student.name}</strong> · {s.student.registrationNumber} · {s.student.campus}</p>
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-black text-left"><th className="py-1">Date</th><th>Movement</th><th>Document</th><th>Details</th><th className="text-right">In / out</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              <tr className="border-b border-gray-300"><td className="py-1" colSpan={5}>Opening balance</td><td className="text-right font-semibold">{money(s.opening)}</td></tr>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-b border-gray-200">
                  <td className="py-1">{new Date(l.date).toLocaleDateString('en-GB')}</td>
                  <td>{WALLET_TYPE[l.type] ?? l.type}</td>
                  <td className="font-mono">{l.document ?? '—'}</td>
                  <td>{l.detail ?? ''}</td>
                  <td className={`text-right font-mono ${l.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{l.amount >= 0 ? '+' : ''}{money(l.amount)}</td>
                  <td className="text-right font-mono">{money(l.balance)}</td>
                </tr>
              ))}
              <tr className="border-t border-black font-semibold"><td className="py-1" colSpan={4}>Totals · closing balance</td><td className="text-right">+{money(s.totals.in)} / −{money(s.totals.out)}</td><td className="text-right">{money(s.closing)} EGP</td></tr>
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-gray-500">Printed {new Date().toLocaleString('en-GB')}. Every payment passes through the wallet: a top-up and its invoice payment appear together.</p>
        </div>
      )}
    </div>
  )
}
