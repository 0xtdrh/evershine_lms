/**
 * GET /api/payments/[id]/receipt — receipt of one payment (lib/fees/receipt.ts)
 * Staff with fee access, or the student / their parent.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { buildReceipt, canViewReceipt, receiptText } from '@/lib/fees/receipt'
import { whatsappNumber } from '@/lib/students/portal-password'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const receipt = await buildReceipt(id)
  if (!receipt) return errors.notFound('Payment')
  if (!(await canViewReceipt({ id: session.user.id, role: session.user.role }, receipt.student.id))) return errors.forbidden()
  return successResponse({
    ...receipt,
    text: receiptText(receipt),
    whatsappTo: receipt.parent ? whatsappNumber(receipt.parent.phone) : null,
  })
}
