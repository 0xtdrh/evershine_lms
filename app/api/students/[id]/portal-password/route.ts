/**
 * POST /api/students/[id]/portal-password
 * body: { target: 'guardian', guardianId } | { target: 'student' }
 *
 * Issues a new TEMPORARY portal password for this student's parent or for the
 * student, and returns it ONCE (it is never stored in plain text). The account
 * must change it on first sign-in (mustChangePassword). Also clears any sign-in
 * lock on that account, so a locked-out parent can sign in right away.
 *
 * Permission: account_management:update (Permissions page), plus students:read.
 * Only portal accounts (STUDENT / GUARDIAN / PARENT) of THIS student can be
 * reset here, never a staff account.
 */

import { randomInt } from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { hash } from '@node-rs/argon2'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { accountKey, clearLoginFailures } from '@/lib/login-throttle'
import { generateTempPassword, portalMessage, whatsappNumber } from '@/lib/students/portal-password'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ARGON2_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4, outputLen: 32 }
const PORTAL_ROLES = new Set(['STUDENT', 'GUARDIAN', 'PARENT'])

const bodySchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('guardian'), guardianId: z.string().min(1) }),
  z.object({ target: z.literal('student') }),
])

function siteUrl(request: NextRequest): string {
  const origin = request.headers.get('origin')
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const env = process.env.AUTH_URL || process.env.NEXTAUTH_URL
  if (env) return env.replace(/\/+$/, '')
  return new URL(request.url).origin
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'account_management', 'update') || !checkPermission(role, 'students', 'read')) {
    return errors.forbidden()
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.badRequest('target must be "guardian" (with guardianId) or "student"')

  const { id: studentId } = await params
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phoneNumber: true,
      user: { select: { id: true, email: true, role: true, isActive: true } },
      guardians: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          user: { select: { id: true, email: true, role: true, isActive: true } },
        },
      },
    },
  })
  if (!student) return errors.notFound('Student')

  const studentName = `${student.firstName} ${student.lastName}`.trim()
  let account: { id: string; email: string; role: string; isActive: boolean } | null
  let loginId: string
  let sendTo: string | null
  let accountName: string

  if (parsed.data.target === 'guardian') {
    const guardianId = parsed.data.guardianId
    const guardian = student.guardians.find((g) => g.id === guardianId)
    if (!guardian) return errors.notFound('Parent of this student')
    account = guardian.user
    loginId = guardian.phoneNumber // parents sign in with their phone number
    sendTo = whatsappNumber(guardian.phoneNumber)
    accountName = `${guardian.firstName} ${guardian.lastName}`.trim()
  } else {
    account = student.user
    loginId = student.user?.email ?? ''
    // Young students rarely have their own phone: fall back to the first parent.
    sendTo = whatsappNumber(student.phoneNumber) ?? whatsappNumber(student.guardians[0]?.phoneNumber)
    accountName = studentName
  }

  if (!account) return errors.badRequest('This person has no portal account yet.')
  if (!PORTAL_ROLES.has(account.role)) {
    return errors.forbidden('Only student and parent portal accounts can be reset here.')
  }
  if (!account.isActive) {
    return errors.badRequest('This portal account is disabled. Enable it first (Credential Management).')
  }

  const password = generateTempPassword((max) => randomInt(max))
  const passwordHash = await hash(password, ARGON2_OPTIONS)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: account!.id },
      data: { passwordHash, mustChangePassword: true, sessionsRevokedAt: new Date() },
    })
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE',
        entityType: 'UserCredentials',
        entityId: account!.id,
        changes: { temporaryPassword: '[REDACTED]', target: parsed.data.target, studentId, via: 'student page' },
      },
    })
  })
  await clearLoginFailures(accountKey(account.email))

  const loginUrl = `${siteUrl(request)}/login`
  const res = successResponse({
    target: parsed.data.target,
    accountName,
    loginId,
    password,
    loginUrl,
    whatsappTo: sendTo,
    message: portalMessage({ target: parsed.data.target, studentName, loginId, password, loginUrl }),
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
