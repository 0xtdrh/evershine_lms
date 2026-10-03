/**
 * POST /api/guardian-portal/wallet/topups — a parent tops up a child's wallet (phase B).
 *  - multipart: file (JPG/PNG/PDF ≤ 4 MB), studentId, amount, remarks? → waits for approval
 *  - JSON { studentId, amount, mode: 'ONLINE' } → Paymob checkout (fee added on top)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errorResponse, errors, createdResponse, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { sanitizeCloudinaryError, uploadPaymentProofToCloudinary } from '@/lib/cloudinary'
import { createPaymobCheckout, isPaymobConfigured } from '@/lib/payments/paymob'
import { MINUTE, rateLimit } from '@/lib/rate-limit-db'
import { getWalletSettings, minimumTopUp, paymobFee, requestProofTopUp } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'
const MAX = 4 * 1024 * 1024

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const limited = await rateLimit(`wallet-topup:user:${session.user.id}`, 10, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const children = await getChildrenForGuardianUser(session.user.id)

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    let body: unknown
    try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
    const parsed = z.object({ studentId: z.string().min(1), amount: z.number().positive(), mode: z.literal('ONLINE') }).safeParse(body)
    if (!parsed.success) return errors.validation(parsed.error)
    const child = children.find((c) => c.id === parsed.data.studentId)
    if (!child) return errors.forbidden()
    if (!isPaymobConfigured()) return errorResponse('ONLINE_PAYMENT_OFF', 'Online payment is not available yet', 503)
    const amount = Math.round(parsed.data.amount! * 100) / 100
    const min = await minimumTopUp(child.id)
    if (amount + 0.001 < min) return errors.badRequest(`The minimum top-up is ${min} EGP`)
    const fee = paymobFee(amount, await getWalletSettings())
    const online = await prisma.onlinePayment.create({ data: { kind: 'TOPUP', invoiceId: null, studentId: child.id, amount, fee, createdById: session.user.id } })
    const origin = request.headers.get('origin') || process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin
    const g = await prisma.guardian.findUnique({ where: { userId: session.user.id }, select: { firstName: true, lastName: true, phoneNumber: true, email: true } })
    try {
      const { checkoutUrl, providerOrderId } = await createPaymobCheckout({
        reference: online.id,
        amountEgp: Math.round((amount + fee) * 100) / 100,
        description: `Wallet top-up ${child.firstName} ${child.lastName}`,
        customer: { firstName: g?.firstName ?? child.firstName, lastName: g?.lastName ?? child.lastName, phone: g?.phoneNumber ?? '', email: g?.email ?? null },
        notificationUrl: `${origin}/api/webhooks/paymob`,
        redirectionUrl: `${origin}/dashboard/my-children?wallet=1`,
      })
      await prisma.onlinePayment.update({ where: { id: online.id }, data: { providerOrderId } })
      return successResponse({ checkoutUrl, amount, fee })
    } catch (err) {
      await prisma.onlinePayment.update({ where: { id: online.id }, data: { status: 'FAILED', note: err instanceof Error ? err.message : String(err) } })
      console.error('[WALLET_TOPUP_ONLINE]', err)
      return errorResponse('ONLINE_PAYMENT_FAILED', 'Could not start the online payment. Please try again later.', 502)
    }
  }

  let form: FormData
  try { form = await request.formData() } catch { return errors.badRequest('Invalid form data') }
  const studentId = String(form.get('studentId') ?? '')
  const amount = Number(form.get('amount'))
  const remarks = form.get('remarks')
  const file = form.get('file')
  const child = children.find((c) => c.id === studentId)
  if (!child) return errors.forbidden()
  if (!Number.isFinite(amount) || amount <= 0) return errors.badRequest('Enter a valid amount')
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return errors.badRequest('Attach the transfer receipt')
  if (file.size > MAX) return errors.badRequest('The receipt is too large. Maximum 4 MB.')
  let proofUrl: string
  try {
    proofUrl = await uploadPaymentProofToCloudinary(Buffer.from(await file.arrayBuffer()), `topup-${studentId}-${Date.now()}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    if (message.startsWith('Invalid payment proof') || message.startsWith('Payment proof too large')) return errors.badRequest(message)
    console.error('[WALLET_TOPUP_PROOF]', sanitizeCloudinaryError(err))
    return errorResponse('PAYMENT_PROOF_UPLOAD_FAILED', 'The receipt could not be uploaded. Please try again.', 500)
  }
  const r = await requestProofTopUp({ studentId, amount, proofUrl, remarks: typeof remarks === 'string' ? remarks.slice(0, 500) : null, userId: session.user.id })
  if ('message' in r) return errors.badRequest(r.message)
  return createdResponse(r, 'Receipt sent. The wallet is topped up once it is checked.')
}
