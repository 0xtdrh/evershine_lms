/**
 * GET  /api/treasury/reconcile — FIN-3: bank / e-wallet accounts with movements not matched with the bank yet.
 * POST multipart { accountId, file (.xlsx / .csv) } — compare the bank statement with the account (nothing is saved).
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { previewReconcile, readStatement, reconcileStatus } from '@/lib/treasury/reconcile'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await treasuryUser('approve')
  if ('error' in u) return u.error
  return successResponse(await reconcileStatus(u.user))
}

export async function POST(request: NextRequest) {
  const u = await treasuryUser('approve')
  if ('error' in u) return u.error
  let form: FormData
  try { form = await request.formData() } catch { return errors.badRequest('Send the statement file') }
  const file = form.get('file') as File | null
  const accountId = String(form.get('accountId') ?? '')
  if (!file || !accountId) return errors.badRequest('Choose the account and the statement file')
  if (file.size > 5 * 1024 * 1024) return errors.badRequest('The file is larger than 5 MB')
  const parsed = await readStatement(await file.arrayBuffer(), file.name)
  if (!parsed) return errors.badRequest('Could not read the file — save it as .xlsx or .csv')
  try { return successResponse({ ...(await previewReconcile(u.user, accountId, parsed.lines)), lines: parsed.lines.length, skipped: parsed.skipped }) } catch (e) { return treasuryError(e) }
}
