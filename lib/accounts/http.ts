/** Six phases 1-A: shared answers of the family-account APIs. */

import { errorResponse, errors } from '@/lib/api-response'
import { AccountError } from './engine'

/** AccountError → a clear 4xx with its code (ACCOUNT_EXISTS / EMAIL_USED → 409); anything else → 500. */
export function accountError(e: unknown) {
  if (e instanceof AccountError) {
    const status = e.code === 'ACCOUNT_EXISTS' || e.code === 'EMAIL_USED' ? 409 : e.code === 'NOT_FOUND' ? 404 : 400
    return errorResponse(e.code, e.message, status)
  }
  console.error('[FAMILY_ACCOUNTS]', e)
  return errors.internal()
}
