/**
 * POST /api/auth/forgot-password
 * Public endpoint for requesting a password reset email.
 */

import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import { errors, successResponse } from '@/lib/api-response'
import { z } from 'zod'
import { HOUR, MINUTE, rateLimit, requestIp } from '@/lib/rate-limit-db'

const requestSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['email'], message: 'Invalid JSON payload' }] } as never)
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return errors.validation(parsed.error)
  }

  const email = parsed.data.email.trim().toLowerCase()

  // Rate limits: stop email flooding and guessing (lib/rate-limit-db.ts).
  const byIp = await rateLimit(`forgot-password:ip:${requestIp(request)}`, 10, HOUR)
  if (!byIp.ok) return errors.rateLimited(byIp.resetAt)

  try {
    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
    })

    // Same answer either way (no hint whether the account exists); at most
    // 3 reset emails per address per hour.
    if (user && (await rateLimit(`forgot-password:email:${email}`, 3, HOUR)).ok) {
      const token = randomUUID()
      const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: token,
          resetTokenExpiry: expiry,
        },
      })

      await sendPasswordResetEmail(email, token).catch((err) => {
        console.error('[FORGOT_PASSWORD_EMAIL_ERROR]', err)
      })
    }

    return successResponse(
      { message: 'If the account exists, password reset instructions have been sent.' },
      { status: 200 }
    )
  } catch (err) {
    console.error('[FORGOT_PASSWORD_ERROR]', err)
    return errors.internal()
  }
}
