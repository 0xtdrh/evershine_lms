'use client'

import Link from 'next/link'
import { L } from '@/lib/i18n/client'

export interface LedgerRow { id: string; type: string; amount: number; note: string | null; createdAt: string; topUpId?: string | null; paymentId?: string | null }

const WALLET_TYPE_AR: Record<string, string> = {
  TOPUP: 'شحن', PAYMENT: 'دفع فاتورة', REFUND: 'رصيد من استرداد', WITHDRAW: 'سحب',
  TRANSFER_IN: 'من أخ / أخت', TRANSFER_OUT: 'لأخ / أخت', ADJUSTMENT: 'تسوية', REFERRAL: 'مكافأة ترشيح',
}
const WALLET_TYPE_EN: Record<string, string> = {
  TOPUP: 'Top-up', PAYMENT: 'Invoice payment', REFUND: 'Refund credit', WITHDRAW: 'Withdrawal',
  TRANSFER_IN: 'From a sibling', TRANSFER_OUT: 'To a sibling', ADJUSTMENT: 'Adjustment', REFERRAL: 'Referral reward',
}
/** Movement type in the screen language (2026-10-24: was English only). */
export const walletType = (t: string) => L(WALLET_TYPE_EN[t] ?? t, WALLET_TYPE_AR[t] ?? WALLET_TYPE_EN[t] ?? t)
/** Stored English notes ("Top-up TN-TOPUP-…", "Invoice payment TN-RCPT-…") in the screen language (2026-10-25). */
const noteText = (n: string) => L(n, n
  .replace(/^Top-up bonus/, 'مكافأة شحن').replace(/^Top-up /, 'شحن ').replace(/^Invoice payment/, 'دفع فاتورة')
  .replace(/^Referral reward:/, 'مكافأة ترشيح:').replace(/ joined /, ' اتسجل '))
/** @deprecated use walletType (kept for older imports) */
export const WALLET_TYPE = WALLET_TYPE_EN

/** Wallet movements with links to the top-up / payment receipts (phase B). */
export function WalletLedger({ rows, max = 10 }: { rows: LedgerRow[]; max?: number }) {
  if (!rows.length) return <p className="text-xs text-slate-500">{L('No movements yet.', 'لسه مفيش حركات.')}</p>
  return (
    <div className="space-y-1">
      {rows.slice(0, max).map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-slate-600">
            {new Date(t.createdAt).toLocaleDateString('en-GB')} · {walletType(t.type)}
            {t.note && <span className="text-slate-400"> · {noteText(t.note)}</span>}
            {t.type === 'TOPUP' && t.topUpId && <Link href={`/topups/${t.topUpId}`} className="ms-1 text-indigo-600 underline">{L('receipt', 'الإيصال')}</Link>}
            {t.type === 'PAYMENT' && t.paymentId && <Link href={`/receipts/${t.paymentId}`} className="ms-1 text-indigo-600 underline">{L('receipt', 'الإيصال')}</Link>}
          </span>
          <span className={`shrink-0 font-mono ${t.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
