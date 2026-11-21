'use client'

import { AccessDenied } from '@/components/AccessDenied'
import { ApiError } from '@/lib/api-client'

/** A page's load error: "not allowed" shows the one Arabic refusal page (final test J04), anything else a short red line. */
export function ApiErrorView({ error }: { error: unknown }) {
  if (!error) return null
  if (error instanceof ApiError && (error.status === 403 || error.status === 401)) return <AccessDenied />
  return <p className="text-sm text-rose-600">{(error as Error).message}</p>
}
