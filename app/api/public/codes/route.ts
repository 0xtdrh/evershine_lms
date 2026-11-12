/** POST /api/public/codes { code, listing?, phone? } — six phases 1-a: is this enrolment code good for this course? (no login, rate-limited) */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { codeBenefit, PROBLEM_TEXT } from '@/lib/site/codes'
import { lookupCode } from '@/lib/site/codes-store'
import { normalizePhone } from '@/lib/site/request-rules'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(`code-check:ip:${requestIp(request)}`, 20, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const b = (await request.json().catch(() => null)) as { code?: string; listing?: string; phone?: string } | null
  if (!b?.code) return errors.badRequest('code is required')
  const { code, row, res } = await lookupCode(b.code, b.listing ?? null, b.phone ? normalizePhone(b.phone) : null)
  if (!res.ok) return successResponse({ ok: false, code, problem: res.problem!, text: PROBLEM_TEXT[res.problem!] })
  return successResponse({ ok: true, code, kind: row!.kind, value: row!.value, text: { en: codeBenefit(row!.kind, row!.value, false), ar: codeBenefit(row!.kind, row!.value, true) } })
}
