/**
 * POST /api/fees/[id]/pay-online — start an online payment (Paymob) for the
 * remaining balance of an invoice. The student or their parent only.
 * Returns the Paymob checkout URL; the payment is recorded later by the
 * signed webhook (/api/webhooks/paymob), never by this call.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { canViewReceipt } from '@/lib/fees/receipt'
import { createPaymobCheckout, isPaymobConfigured } from '@/lib/payments/paymob'
import { getWalletSettings, paymobFee } from '@/lib/wallet/engine'
import { MINUTE, rateLimit } from '@/lib/rate-limit-db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!isPaymobConfigured()) return errorResponse('ONLINE_PAYMENT_OFF', 'Online payment is not available yet', 503)
  const { id: invoiceId } = await params

  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, studentId: true, totalAmount: true, paidAmount: true, status: true, challanNumber: true, month: true,
      student: { select: { firstName: true, lastName: true, guardians: { select: { firstName: true, lastName: true, phoneNumber: true, email: true }, take: 1 } } },
    },
  })
  if (!invoice) return errors.notFound('Invoice')
  if (!(await canViewReceipt({ id: session.user.id, role: session.user.role }, invoice.studentId))) return errors.forbidden()
  if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') return errors.conflict('This invoice is already paid or cancelled')
  const remaining = Math.round((Number(invoice.totalAmount) - Number(invoice.paidAmount)) * 100) / 100
  if (!(remaining > 0)) return errors.conflict('Nothing left to pay')
  // Phase B: the Paymob fee is paid by the parent, on top of the amount.
  const fee = paymobFee(remaining, await getWalletSettings())

  const limited = await rateLimit(`pay-online:user:${session.user.id}`, 5, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)

  const online = await prisma.onlinePayment.create({
    data: { invoiceId, studentId: invoice.studentId, amount: remaining, fee, createdById: session.user.id },
  })
  const origin = request.headers.get('origin') || process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin
  const g = invoice.student.guardians[0]
  try {
    const { checkoutUrl, providerOrderId } = await createPaymobCheckout({
      reference: online.id,
      amountEgp: Math.round((remaining + fee) * 100) / 100,
      description: `${invoice.challanNumber} ${invoice.month}`,
      customer: {
        firstName: g?.firstName ?? invoice.student.firstName,
        lastName: g?.lastName ?? invoice.student.lastName,
        phone: g?.phoneNumber ?? '',
        email: g?.email ?? null,
      },
      notificationUrl: `${origin}/api/webhooks/paymob`,
      redirectionUrl: `${origin}/dashboard/fees/${invoiceId}?online=1`,
    })
    await prisma.onlinePayment.update({ where: { id: online.id }, data: { providerOrderId } })
    return successResponse({ checkoutUrl, onlinePaymentId: online.id, amount: remaining, fee })
  } catch (err) {
    await prisma.onlinePayment.update({ where: { id: online.id }, data: { status: 'FAILED', note: err instanceof Error ? err.message : String(err) } })
    console.error('[PAY_ONLINE]', err)
    return errorResponse('ONLINE_PAYMENT_FAILED', 'Could not start the online payment. Please try again later.', 502)
  }
}
