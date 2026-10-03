/**
 * POST /api/webhooks/paymob?hmac=… — Paymob "transaction processed" callback.
 * Public (Paymob calls it), but every call must carry a valid HMAC signature.
 *
 * - invalid signature                -> 401, nothing happens
 * - payment failed                   -> OnlinePayment FAILED
 * - success, amount/currency match   -> FeePayment through recordPayment (source ONLINE), receipt, PAID
 * - success but cannot be applied    -> REVIEW (money received; staff must check / refund in Paymob)
 * Safe to receive the same callback twice (transaction id is unique).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYMOB_METHOD, verifyPaymobHmac, type PaymobTransaction } from '@/lib/payments/paymob'
import { recordPayment } from '@/lib/fees/record-payment'
import { onlineTopUpPaid } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ok = (message: string) => NextResponse.json({ received: true, message })

export async function POST(request: NextRequest) {
  let body: { type?: string; obj?: PaymobTransaction } | null = null
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const t = body?.obj
  if (!t || typeof t !== 'object') return NextResponse.json({ error: 'Missing transaction' }, { status: 400 })
  if (!verifyPaymobHmac(t, new URL(request.url).searchParams.get('hmac'))) {
    console.warn('[PAYMOB_WEBHOOK] invalid HMAC')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const txnId = String(t.id)
  const already = await prisma.onlinePayment.findUnique({ where: { providerTxnId: txnId } })
  if (already) return ok('already processed')

  const reference = t.order?.merchant_order_id ?? null
  const online = await prisma.onlinePayment.findFirst({
    where: {
      OR: [
        ...(reference ? [{ id: String(reference) }] : []),
        ...(t.order?.id != null ? [{ providerOrderId: String(t.order.id) }] : []),
      ],
    },
  })
  if (!online) {
    console.warn('[PAYMOB_WEBHOOK] unknown payment', reference, t.order?.id)
    return ok('unknown payment')
  }
  if (online.status === 'PAID') return ok('already paid')

  if (!t.success || t.pending || t.is_voided || t.is_refunded) {
    await prisma.onlinePayment.update({
      where: { id: online.id },
      data: { status: t.pending ? 'PENDING' : 'FAILED', providerTxnId: t.pending ? null : txnId, note: t.pending ? 'Pending at Paymob' : 'Payment not completed' },
    })
    return ok('not successful')
  }

  // Phase B: the parent paid amount + Paymob fee.
  const expectedCents = Math.round((Number(online.amount) + Number(online.fee ?? 0)) * 100)
  if (Number(t.amount_cents) !== expectedCents || String(t.currency).toUpperCase() !== 'EGP') {
    await prisma.onlinePayment.update({
      where: { id: online.id },
      data: { status: 'REVIEW', providerTxnId: txnId, note: `Amount mismatch: paid ${t.amount_cents / 100} ${t.currency}, expected ${expectedCents / 100} EGP` },
    })
    return ok('needs review')
  }

  // Phase B: a wallet top-up (no invoice) — credit the wallet, then pay open invoices.
  if (online.kind === 'TOPUP' || !online.invoiceId) {
    await onlineTopUpPaid(online, txnId)
    return ok('wallet topped up')
  }

  const r = await recordPayment({
    invoiceId: online.invoiceId,
    amount: Number(online.amount),
    method: PAYMOB_METHOD,
    source: 'ONLINE',
    receivedBy: online.createdById,
    transactionId: txnId,
    remarks: 'Paid online (Paymob)',
  })
  if ('code' in r) {
    // Money was taken but the invoice changed meanwhile (e.g. paid in cash): staff must check.
    await prisma.onlinePayment.update({ where: { id: online.id }, data: { status: 'REVIEW', providerTxnId: txnId, note: r.message } })
    return ok('needs review')
  }
  await prisma.onlinePayment.update({ where: { id: online.id }, data: { status: 'PAID', providerTxnId: txnId, paymentId: r.payment.id } })
  return ok('paid')
}
