/**
 * Portal (parent / student) login helpers. Server-only.
 *
 * WHY: guardian and student accounts are created with GUESSABLE credentials:
 *  - guardian: email guardian_<phone>@technova.local, password = the phone number
 *  - student:  email derived from the registration number (sequential), password
 *              `Student@<year>!` (same for everyone), `TN<last 4 digits>` or the
 *              registration number without slashes.
 * Anyone knowing a parent's phone or guessing a registration number could log
 * in. A "change your password on first login" rule does not help: the attacker
 * would simply change it. So a default password NEVER opens an account; staff
 * issue a temporary password (Credential Management), which sets
 * User.mustChangePassword, and the owner of the account must change it.
 */

import { prisma } from '@/lib/prisma'

/** Egyptian phone variants: 01012345678 / +201012345678 / 201012345678, spaces and dashes ignored. */
export function phoneVariants(input: string): string[] {
  const raw = input.replace(/[\s\-()]/g, '')
  const out = new Set<string>([raw])
  if (raw.startsWith('+20')) out.add('0' + raw.slice(3))
  if (raw.startsWith('0020')) out.add('0' + raw.slice(4))
  if (/^20\d{10}$/.test(raw)) out.add('0' + raw.slice(2))
  if (/^0\d{10}$/.test(raw)) {
    out.add('+20' + raw.slice(1))
    out.add('20' + raw.slice(1))
  }
  return [...out]
}

export function looksLikePhone(identifier: string) {
  return !identifier.includes('@') && /^[+\d][\d\s\-()]{6,}$/.test(identifier.trim())
}

/** Resolves a login identifier (email, or a guardian's phone number) to a user email. */
export async function resolveLoginEmail(identifier: string): Promise<string | null> {
  const value = identifier.trim()
  if (!looksLikePhone(value)) return value.toLowerCase()
  const guardian = await prisma.guardian.findFirst({
    where: { phoneNumber: { in: phoneVariants(value) } },
    select: { user: { select: { email: true } } },
  })
  return guardian?.user.email ?? null
}

/** True if `password` is one of the auto-generated default passwords of this account. */
export async function isDefaultPortalPassword(userId: string, role: string, password: string): Promise<boolean> {
  const typed = password.trim()
  if (role === 'GUARDIAN' || role === 'PARENT') {
    const guardian = await prisma.guardian.findUnique({ where: { userId }, select: { phoneNumber: true } })
    if (guardian && phoneVariants(guardian.phoneNumber).includes(typed.replace(/[\s\-()]/g, ''))) return true
    return false
  }
  if (role === 'STUDENT') {
    if (/^Student@\d{4}!$/.test(typed)) return true
    const student = await prisma.student.findUnique({ where: { userId }, select: { registrationNumber: true } })
    if (!student) return false
    const reg = student.registrationNumber
    const candidates = [reg.replace(/\//g, ''), `TN${reg.slice(-4)}`]
    return candidates.includes(typed)
  }
  return false
}
