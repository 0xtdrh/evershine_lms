/**
 * Sequential human-readable numbers (registration numbers, employee IDs).
 *
 * WHY not `count + 1`: after any deletion (or with older rows in another
 * format) count + 1 can equal an EXISTING number, and creating the record then
 * fails with a unique-constraint error. We take the highest number already
 * used with the same prefix and add one. Callers still retry on a unique
 * conflict in case two records are created at the same moment.
 */

import { prisma } from '@/lib/prisma'

export function nextInSequence(existing: string[], prefix: string, pad: number): string {
  let max = 0
  for (const value of existing) {
    if (!value.startsWith(prefix)) continue
    const n = Number.parseInt(value.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`
}

/** Student registration number — fixed rule: TN/YYYY/NNNN (numbering restarts each year). */
export async function nextRegistrationNumber(year = new Date().getFullYear()): Promise<string> {
  const prefix = `TN/${year}/`
  const rows = await prisma.student.findMany({
    where: { registrationNumber: { startsWith: prefix } },
    select: { registrationNumber: true },
  })
  return nextInSequence(rows.map((r) => r.registrationNumber), prefix, 4)
}

/** Teacher employee ID, e.g. `TCH-007`. */
export async function nextTeacherEmployeeId(prefix: string, pad = 3): Promise<string> {
  const full = `${prefix}-`
  const rows = await prisma.teacher.findMany({ where: { employeeId: { startsWith: full } }, select: { employeeId: true } })
  return nextInSequence(rows.map((r) => r.employeeId), full, pad)
}

/** Accountant employee ID, e.g. `ACC-2026-0003`. */
export async function nextAccountantEmployeeId(year = new Date().getFullYear()): Promise<string> {
  const prefix = `ACC-${year}-`
  const rows = await prisma.accountant.findMany({ where: { employeeId: { startsWith: prefix } }, select: { employeeId: true } })
  return nextInSequence(rows.map((r) => r.employeeId), prefix, 4)
}

/** True for a Prisma unique-constraint error on the given field. */
export function isUniqueConflictOn(err: unknown, field: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } }
  if (e?.code !== 'P2002') return false
  const target = e.meta?.target
  return Array.isArray(target) ? target.some((t) => String(t).includes(field)) : String(target ?? '').includes(field)
}
