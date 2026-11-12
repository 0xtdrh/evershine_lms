/**
 * GET  /api/account/setup/[token] — six phases 1-A: is this password link still good? (first name only)
 * POST /api/account/setup/[token] { password } — the family chooses its password (link used once). No login; rate-limited.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { setupLinkInfo, useSetupLink } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { passwordProblem } from '@/lib/security/password-policy'

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`account-setup:ip:${requestIp(request)}`, 30, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const info = await setupLinkInfo((await params).token)
  if (!info) return errors.notFound('Link')
  return successResponse({ firstName: info.firstName, phoneEnd: info.phone.slice(-3), expiresAt: info.expiresAt })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = await rateLimit(`account-setup:ip:${requestIp(request)}`, 30, 10 * MINUTE)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const body = (await request.json().catch(() => null)) as { password?: string } | null
  const password = String(body?.password ?? '')
  const weak = passwordProblem('GUARDIAN', password)
  if (weak) return errors.badRequest(`${weak.en} · ${weak.ar}`)
  const { token } = await params
  const info = await setupLinkInfo(token)
  if (info && password.replace(/\D/g, '') === info.phone.replace(/\D/g, '')) return errors.badRequest('Do not use your phone number as the password · متستخدمش رقم الموبايل كباسورد')
  try {
    const r = await useSetupLink(token, password)
    return successResponse({ ok: true, phone: r.phone })
  } catch (e) {
    return accountError(e)
  }
}
