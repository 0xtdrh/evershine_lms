/** M1 partners — turns an engine outcome into an API response. */

import { errorResponse, successResponse } from '@/lib/api-response'

export function outcome<T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }, message?: string) {
  if (r.ok) return successResponse((r as { value: T }).value, message)
  const e = r as { code: string; message: string }
  return errorResponse(e.code, e.message, e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 400)
}
