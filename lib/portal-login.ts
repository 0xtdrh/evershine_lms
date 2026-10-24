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
/**
 * A student's registration number typed as a login (2026-10-24, owner: the generated email is hard to remember):
 * TN/2026/0001, TN-2026-0001, tn.2026.0001, TN20260001 → "TN/2026/0001". Null when it is not one.
 */
export function registrationFromLogin(identifier: string): string | null {
  const m = identifier.trim().match(/^tn[\s/\-._]?(\d{4})[\s/\-._]?(\d{1,6})$/i)
  return m ? `TN/${m[1]}/${m[2].padStart(4, '0')}` : null
}

/**
 * Easy student login name (2026-10-24, owner): English first name (letters only, lower case) + the 4-digit number of
 * the registration number — Youssef, TN/2026/0001 → "youssef0001". Null when the first name has no English letters.
 */
export function studentLoginName(firstName: string, registrationNumber: string): string | null {
  const name = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const num = registrationNumber.split('/').pop() ?? ''
  return name && /^\d+$/.test(num) ? `${name}${num}` : null
}

/** "youssef0001" → { name: 'youssef', num: '0001' } (letters then 4–6 digits). */
export function loginNameParts(identifier: string): { name: string; num: string } | null {
  const m = identifier.trim().toLowerCase().match(/^([a-z]+)(\d{4,6})$/)
  return m ? { name: m[1], num: m[2] } : null
}

export async function resolveLoginEmail(identifier: string): Promise<string | null> {
  const value = identifier.trim()
  const reg = registrationFromLogin(value)
  if (reg) {
    const student = await prisma.student.findFirst({ where: { registrationNumber: reg }, select: { user: { select: { email: true } } } })
    return student?.user?.email ?? null
  }
  const easy = loginNameParts(value)
  if (easy) {
    // same number in different years → only when exactly ONE student matches the name; otherwise the full number is needed
    const rows = await prisma.student.findMany({ where: { registrationNumber: { endsWith: `/${easy.num}` } }, select: { firstName: true, registrationNumber: true, user: { select: { email: true } } } })
    const hits = rows.filter((r) => studentLoginName(r.firstName, r.registrationNumber) === value.toLowerCase())
    return hits.length === 1 ? hits[0].user?.email ?? null : null
  }
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
