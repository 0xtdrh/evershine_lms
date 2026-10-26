/**
 * a03: wraps a route handler so a write refused by the month-close guard answers 409 MONTH_LOCKED with the real
 * message (bilingual) instead of a bare 500. Used on every route that writes money rows:
 *   async function PATCH_(req, ctx) { … }
 *   export const PATCH = withMonthLock(PATCH_)
 * Routes that catch errors and return errors.internal() get the same answer through lib/api-response.ts.
 */

import { errors } from '@/lib/api-response'
import { isMonthLocked, takeRecentRefusal } from './refusal'

export function withMonthLock<A extends unknown[], R extends Response>(handler: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | Response> => {
    try {
      return await handler(...args)
    } catch (e) {
      if (isMonthLocked(e)) { takeRecentRefusal(); return errors.monthLocked(e.message) }
      throw e
    }
  }
}
