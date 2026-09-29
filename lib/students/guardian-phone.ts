/**
 * Changing a parent's phone number. Server-only.
 *
 * Rule (owner, 2026-09-29): the parent's LOGIN number is always their current
 * phone number. Guardian.phoneNumber is both the parent's identity (unique) and
 * what the login page resolves (lib/portal-login.ts), so updating it here moves
 * the login with it. The auto-generated account email
 * guardian_<phone>@technova.local is renamed too, to avoid confusion.
 */

import { prisma } from '@/lib/prisma'
import { phoneVariants } from '@/lib/portal-login'

/** Same normalisation as when the guardian was created (lib/students/guardian-link.ts). */
export function normalizeGuardianPhone(phone: string) {
  return phone.replace(/[\s\-()]/g, '')
}

export type GuardianPhoneChange =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID' | 'TAKEN'; message: string }

export async function changeGuardianPhone(guardianId: string, newPhoneRaw: string, actorUserId: string): Promise<GuardianPhoneChange> {
  const newPhone = normalizeGuardianPhone(newPhoneRaw)
  if (!/^\+?\d{8,15}$/.test(newPhone)) {
    return { ok: false, reason: 'INVALID', message: 'Enter a valid phone number' }
  }

  const guardian = await prisma.guardian.findUnique({
    where: { id: guardianId },
    select: { id: true, phoneNumber: true, userId: true, firstName: true, user: { select: { email: true } } },
  })
  if (!guardian) return { ok: false, reason: 'NOT_FOUND', message: 'Parent not found' }
  if (guardian.phoneNumber === newPhone) return { ok: true, changed: false }

  // One phone number = one parent (never two accounts with the same login number).
  const taken = await prisma.guardian.findFirst({
    where: { phoneNumber: { in: phoneVariants(newPhone) }, id: { not: guardianId } },
    select: { firstName: true, lastName: true },
  })
  if (taken) {
    return {
      ok: false,
      reason: 'TAKEN',
      message: `${newPhone} already belongs to another parent (${taken.firstName} ${taken.lastName}). Link that parent instead.`,
    }
  }

  const oldSynthetic = `guardian_${guardian.phoneNumber}@technova.local`
  const newSynthetic = `guardian_${newPhone}@technova.local`
  const renameEmail =
    guardian.user.email === oldSynthetic &&
    !(await prisma.user.findUnique({ where: { email: newSynthetic }, select: { id: true } }))

  await prisma.$transaction([
    prisma.guardian.update({ where: { id: guardianId }, data: { phoneNumber: newPhone } }),
    ...(renameEmail ? [prisma.user.update({ where: { id: guardian.userId }, data: { email: newSynthetic } })] : []),
    prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'UPDATE',
        entityType: 'GuardianPhone',
        entityId: guardianId,
        changes: { from: guardian.phoneNumber, to: newPhone, loginEmailRenamed: renameEmail },
      },
    }),
  ])
  return { ok: true, changed: true }
}

/**
 * After a student's contact numbers are edited: any parent LINKED to this
 * student whose phone was the OLD number follows to the new number.
 * Returns human-readable warnings for numbers that could not be moved.
 */
export async function syncGuardianPhonesAfterStudentEdit(
  studentId: string,
  changes: Array<{ from: string | null | undefined; to: string | null | undefined }>,
  actorUserId: string
): Promise<string[]> {
  const real = changes.filter((c) => c.from && c.to && normalizeGuardianPhone(c.from) !== normalizeGuardianPhone(c.to))
  if (!real.length) return []

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { guardians: { select: { id: true, phoneNumber: true } } },
  })
  const warnings: string[] = []
  for (const change of real) {
    const oldVariants = phoneVariants(normalizeGuardianPhone(change.from!))
    for (const g of student?.guardians ?? []) {
      if (!oldVariants.includes(g.phoneNumber)) continue
      const result = await changeGuardianPhone(g.id, change.to!, actorUserId)
      if ('message' in result) warnings.push(result.message)
    }
  }
  return warnings
}
