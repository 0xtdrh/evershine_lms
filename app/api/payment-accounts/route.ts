/**
 * GET /api/payment-accounts — where to send money (Settings > Payments).
 * Any signed-in user (parents see it on their invoices).
 */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getFinanceSettings, paymentAccountsSnapshot, publicPaymentAccounts } from '@/lib/fees/payment-settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const [accounts, snapshot, settings] = await Promise.all([publicPaymentAccounts(), paymentAccountsSnapshot(), getFinanceSettings()])
  // receiptAfterPayment: what the staff screen does after recording a payment.
  return successResponse({ accounts, snapshot, receiptAfterPayment: settings.receiptAfterPayment })
}
