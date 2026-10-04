'use client'

import Link from 'next/link'

export interface LedgerRow { id: string; type: string; amount: number; note: string | null; createdAt: string; topUpId?: string | null; paymentId?: string | null }

export const WALLET_TYPE: Record<string, string> = {
  TOPUP: 'Top-up', PAYMENT: 'Invoice payment', REFUND: 'Refund credit', WITHDRAW: 'Withdrawal',
  TRANSFER_IN: 'From a sibling', TRANSFER_OUT: 'To a sibling', ADJUSTMENT: 'Adjustment', REFERRAL: 'Referral reward',
}

/** Wallet movements with links to the top-up / payment receipts (phase B). */
export function WalletLedger({ rows, max = 10 }: { rows: LedgerRow[]; max?: number }) {
  if (!rows.length) return <p className="text-xs text-slate-500">No movements yet.</p>
  return (
    <div className="space-y-1">
      {rows.slice(0, max).map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-slate-600">
            {new Date(t.createdAt).toLocaleDateString('en-GB')} · {WALLET_TYPE[t.type] ?? t.type}
            {t.note && <span className="text-slate-400"> · {t.note}</span>}
            {t.type === 'TOPUP' && t.topUpId && <Link href={`/topups/${t.topUpId}`} className="ml-1 text-indigo-600 underline">receipt</Link>}
            {t.type === 'PAYMENT' && t.paymentId && <Link href={`/receipts/${t.paymentId}`} className="ml-1 text-indigo-600 underline">receipt</Link>}
          </span>
          <span className={`shrink-0 font-mono ${t.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
