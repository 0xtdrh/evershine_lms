/**
 * POST /api/guardian-portal/family/email — six phases 1-A: confirm the account e-mail.
 * { action: 'send', email } e-mails a 6-digit code (3 per hour) · { action: 'check', code } confirms it.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { HOUR, rateLimit } from '@/lib/rate-limit-db'
import { prisma } from '@/lib/prisma'
import { checkEmailCode, getAccountsSettings, sendEmailCode } from '@/lib/accounts/engine'
import { familySession } from '@/lib/accounts/portal'

const schema = z.object({ action: z.enum(['send', 'check']), email: z.string().trim().toLowerCase().email().max(160).optional(), code: z.string().trim().regex(/^\d{6}$/).optional() })

export async function POST(request: NextRequest) {
  const f = await familySession()
  if (f.error) return f.error
  if (!(await getAccountsSettings()).emailCheck) return errorResponse('EMAIL_CHECK_OFF', 'E-mail confirmation is not switched on yet · تأكيد الإيميل لسه مش شغال', 403)
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const userId = f.session.user.id
  if (parsed.data.action === 'send') {
    const email = parsed.data.email ?? f.guardian.email
    if (!email) return errors.badRequest('Write your e-mail · اكتب الإيميل')
    const other = await prisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } })
    if (other) return errorResponse('EMAIL_USED', 'This e-mail is used by another account · الإيميل ده على حساب تاني', 409)
    const limited = await rateLimit(`email-code:${userId}`, 3, HOUR)
    if (!limited.ok) return errors.rateLimited(limited.resetAt)
    const sent = await sendEmailCode(userId, email)
    return sent ? successResponse({ sent: true }) : errorResponse('EMAIL_NOT_READY', 'E-mail sending is not ready yet · إرسال الإيميل لسه مش جاهز', 503)
  }
  if (!parsed.data.code) return errors.badRequest('Write the code · اكتب الكود')
  return (await checkEmailCode(userId, parsed.data.code)) ? successResponse({ ok: true }) : errors.badRequest('Wrong or expired code · الكود غلط أو انتهى')
}
