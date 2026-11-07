/**
 * Duplicate-student warning, server side (rules: ./duplicates.ts). Looks in EVERY branch on purpose (a child moving
 * branch is the usual duplicate); only name, registration number, branch and status are shown.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { duplicateLevel, LEVEL_ORDER, normName, normPhone, type DuplicateLevel, type NewStudent } from './duplicates'

export interface DuplicateCandidate { id: string; name: string; registrationNumber: string; campus: string | null; status: string; level: DuplicateLevel }

/** Same name written with or without hamza / ta marbuta / alef maqsura (MySQL REGEXP, whole name). */
function nameRegex(name: string) {
  const n = normName(name)
  if (!n) return null
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `^\\s*${esc.replace(/ا/g, '[اأإآٱ]').replace(/ه/g, '[هة]').replace(/ي/g, '[يىئ]').replace(/و/g, '[وؤ]').replace(/ /g, '\\s+')}\\s*$`
}

function phoneForms(p: string) {
  const n = normPhone(p)
  if (n.length < 8) return []
  return n.startsWith('01') && n.length === 11 ? [n, n.slice(1), `+2${n}`, `2${n}`, `002${n}`] : [n]
}

export async function findDuplicateStudents(n: NewStudent, opts: { exceptId?: string } = {}): Promise<DuplicateCandidate[]> {
  const rx = nameRegex(n.firstName)
  const phones = [...new Set(n.phones.flatMap((p) => phoneForms(String(p ?? ''))))]
  if (!rx) return []
  const byName = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM Student WHERE firstName REGEXP ${rx} LIMIT 300`)
  const byPhone = phones.length
    ? await prisma.student.findMany({
        where: { OR: [{ phoneNumber: { in: phones } }, { fatherPhoneNumber: { in: phones } }, { emergencyContact: { in: phones } }, { guardians: { some: { phoneNumber: { in: phones } } } }] },
        select: { id: true }, take: 300,
      })
    : []
  const ids = [...new Set([...byName, ...byPhone].map((x) => x.id))].filter((id) => id !== opts.exceptId)
  if (!ids.length) return []
  const rows = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, registrationNumber: true, dateOfBirth: true, phoneNumber: true, fatherPhoneNumber: true, emergencyContact: true, enrollmentStatus: true, campus: { select: { name: true } }, guardians: { select: { phoneNumber: true } } },
  })
  const out: DuplicateCandidate[] = []
  for (const r of rows) {
    const level = duplicateLevel(n, { firstName: r.firstName, lastName: r.lastName, dateOfBirth: r.dateOfBirth, phones: [r.phoneNumber, r.fatherPhoneNumber, r.emergencyContact, ...r.guardians.map((g) => g.phoneNumber)] })
    if (level) out.push({ id: r.id, name: `${r.firstName} ${r.lastName}`, registrationNumber: r.registrationNumber, campus: r.campus?.name ?? null, status: String(r.enrollmentStatus), level })
  }
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).slice(0, 5)
}

/** One line for an API refusal / an import row: "Possible duplicate of Ali Hassan (TN/2026/0012, Main branch)". */
export function duplicateMessage(c: DuplicateCandidate[]) {
  const list = c.map((x) => `${x.name} (${x.registrationNumber}${x.campus ? `, ${x.campus}` : ''})`).join('، ')
  return `This child may already be registered: ${list}. If it is another child, confirm and save again · الطفل ده ممكن يكون متسجل قبل كده: ${list}. لو طفل تاني أكّد واحفظ تاني`
}
