/**
 * POST /api/public/account — six phases 1-A: a family makes its account on the website (no login; rate-limited).
 * The account is ready at once; the page then signs in with the phone + password. 409 ACCOUNT_EXISTS when the phone has one.
 */

import { NextRequest } from 'next/server'
import { createdResponse, errorResponse, errors } from '@/lib/api-response'
import { HOUR, rateLimit, requestIp } from '@/lib/rate-limit-db'
import { signupAccountSchema } from '@/lib/accounts/rules'
import { createAccount, getAccountsSettings, sendEmailCode } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { passwordProblem } from '@/lib/security/password-policy'

export async function POST(request: NextRequest) {
  const limited = await rateLimit(`account-signup:ip:${requestIp(request)}`, 5, HOUR)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const settings = await getAccountsSettings()
  if (!settings.signupOpen) return errorResponse('SIGNUP_CLOSED', 'Sign-up is closed for now · التسجيل مقفول دلوقتي', 403)
  const parsed = signupAccountSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  if (v.website) return createdResponse({ ok: true }, 'Created')
  const weak = passwordProblem('GUARDIAN', v.password)
  if (weak) return errors.badRequest(`${weak.en} · ${weak.ar}`)
  try {
    const r = await createAccount(v)
    let emailSent = false
    if (settings.emailCheck && v.email) emailSent = await sendEmailCode(r.userId, v.email).catch(() => false)
    return createdResponse({ ok: true, phone: r.phone, emailSent }, 'Created')
  } catch (e) {
    return accountError(e)
  }
}
