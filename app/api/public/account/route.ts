/**
 * POST /api/public/account — six phases 1-A: a family makes its account on the website (no login; rate-limited).
 * The account is ready at once; the page then signs in with the phone + password. 409 ACCOUNT_EXISTS when the phone has one.
 */

import { NextRequest } from 'next/server'
import { createdResponse, errorResponse, errors } from '@/lib/api-response'
import { HOUR, countHit, rateLimit, rateLimitPeek, requestIp } from '@/lib/rate-limit-db'
import { signupAccountSchema } from '@/lib/accounts/rules'
import { createAccount, getAccountsSettings, sendEmailCode } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { passwordProblem } from '@/lib/security/password-policy'

export async function POST(request: NextRequest) {
  // Final test 14/11 (B05): typing mistakes used to count — 5 tries an hour per network, failed ones included, locked
  // families out after a few wrong phone numbers. Now: up to 30 tries an hour, and at most 5 accounts MADE an hour.
  const ip = requestIp(request)
  const tries = await rateLimit(`account-signup-try:ip:${ip}`, 30, HOUR)
  const made = await rateLimitPeek(`account-signup:ip:${ip}`, 5, HOUR)
  for (const l of [tries, made]) {
    if (!l.ok) {
      const mins = Math.max(1, Math.ceil((l.resetAt - Date.now()) / 60_000))
      return errorResponse('RATE_LIMITED', `Too many sign-ups from this network. Try again in ${mins} minute(s) · محاولات كتير من الشبكة دي. جرّب تاني بعد ${mins} دقيقة`, 429, [{ retryAfter: new Date(l.resetAt).toISOString() }])
    }
  }
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
    await countHit(`account-signup:ip:${ip}`)
    let emailSent = false
    if (settings.emailCheck && v.email) emailSent = await sendEmailCode(r.userId, v.email).catch(() => false)
    return createdResponse({ ok: true, phone: r.phone, emailSent }, 'Created')
  } catch (e) {
    return accountError(e)
  }
}
