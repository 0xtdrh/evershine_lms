/**
 * Demo data created by scripts/live-check.mjs, and its safe removal. Server-only.
 *
 * Demo records are recognisable ONLY by these markers, so removal never
 * touches real data:
 *  - students: lastName "DEMO-TEST"
 *  - parents (Guardian): phone starting 0109990
 *  - groups: className starting "DEMO "
 *  - discount types / payment accounts: name / label starting "DEMO "
 *  - staff accounts: email ending @demo.technova.local
 *  - curriculum versions: notes starting "DEMO "; course skills: English name starting "DEMO "
 * Removal runs in one transaction and checks every foreign key at the end
 * (any broken reference rolls everything back), like the test-data wipe.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

export const DEMO = {
  studentLastName: 'DEMO-TEST',
  phonePrefix: '0109990',
  groupPrefix: 'DEMO ',
  namePrefix: 'DEMO ',
  emailDomain: '@demo.technova.local',
} as const

type Tx = Prisma.TransactionClient | typeof prisma
const q = (n: string) => '`' + n.replace(/`/g, '``') + '`'

export interface DemoIds {
  students: string[]
  guardians: string[]
  invoices: string[]
  groups: string[]
  users: string[]
  types: string[]
  accounts: string[]
  assignments: string[]
  enrollments: string[]
  curricula: string[]
  skills: string[]
}

export async function findDemoIds(db: Tx = prisma): Promise<DemoIds> {
  const students = await db.student.findMany({ where: { lastName: DEMO.studentLastName }, select: { id: true, userId: true } })
  const guardians = await db.guardian.findMany({ where: { phoneNumber: { startsWith: DEMO.phonePrefix } }, select: { id: true, userId: true } })
  const staff = await db.user.findMany({ where: { email: { endsWith: DEMO.emailDomain } }, select: { id: true } })
  const groups = await db.classSection.findMany({ where: { className: { startsWith: DEMO.groupPrefix } }, select: { id: true } })
  const studentIds = students.map((s) => s.id)
  const groupIds = groups.map((g) => g.id)
  const invoices = await db.feeInvoice.findMany({
    where: { OR: [{ studentId: { in: studentIds } }, { classSectionId: { in: groupIds } }] },
    select: { id: true },
  })
  const types = await db.discountType.findMany({ where: { name: { startsWith: DEMO.namePrefix } }, select: { id: true } })
  const accounts = await db.paymentAccount.findMany({ where: { label: { startsWith: DEMO.namePrefix } }, select: { id: true } })
  const assignments = await db.discountAssignment.findMany({
    where: {
      OR: [
        { studentId: { in: studentIds } },
        { classSectionId: { in: groupIds } },
        { discountTypeId: { in: types.map((t) => t.id) } },
      ],
    },
    select: { id: true },
  })
  const enrollments = await db.studentEnrollment.findMany({
    where: { OR: [{ studentId: { in: studentIds } }, { classSectionId: { in: groupIds } }] },
    select: { id: true },
  })
  const curricula = await db.curriculumEdition.findMany({ where: { notes: { startsWith: DEMO.namePrefix } }, select: { id: true } })
  const skills = await db.courseSkill.findMany({ where: { nameEn: { startsWith: DEMO.namePrefix } }, select: { id: true } })
  return {
    students: studentIds,
    guardians: guardians.map((g) => g.id),
    invoices: invoices.map((i) => i.id),
    groups: groupIds,
    users: [...new Set([...students.map((s) => s.userId), ...guardians.map((g) => g.userId), ...staff.map((u) => u.id)].filter(Boolean))] as string[],
    types: types.map((t) => t.id),
    accounts: accounts.map((a) => a.id),
    assignments: assignments.map((a) => a.id),
    enrollments: enrollments.map((e) => e.id),
    curricula: curricula.map((c) => c.id),
    skills: skills.map((k) => k.id),
  }
}

export function demoCounts(ids: DemoIds) {
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.length]))
}

async function brokenReferences(db: Tx): Promise<string[]> {
  const fks = await db.$queryRawUnsafe<{ t: string; c: string; rt: string; rc: string }[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
  )
  const broken: string[] = []
  for (const fk of fks) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM ${q(fk.t)} x WHERE x.${q(fk.c)} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${q(fk.rt)} r WHERE r.${q(fk.rc)} = x.${q(fk.c)})`
    )
    if (Number(n) > 0) broken.push(`${fk.t}.${fk.c} -> ${fk.rt} (${n})`)
  }
  return broken
}

/** Deletes every demo record (and rows pointing to them). Returns rows deleted per table. */
export async function removeDemoData(): Promise<Record<string, number>> {
  return prisma.$transaction(
    async (tx) => {
      const ids = await findDemoIds(tx)
      const deleted: Record<string, number> = {}
      const del = async (table: string, column: string, values: string[]) => {
        if (!values.length) return
        const placeholders = values.map(() => '?').join(',')
        const n = await tx.$executeRawUnsafe(`DELETE FROM ${q(table)} WHERE ${q(column)} IN (${placeholders})`, ...values)
        if (n) deleted[table] = (deleted[table] ?? 0) + n
      }
      // Every column in the database that points at a demo record.
      const columns = await tx.$queryRawUnsafe<{ t: string; c: string }[]>(
        `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN
          ('studentId','invoiceId','feeInvoiceId','classSectionId','guardianId','discountTypeId','assignmentId','userId','studentEnrollmentId','enrollmentId')`
      )
      const byColumn: Record<string, string[]> = {
        studentId: ids.students,
        invoiceId: ids.invoices,
        feeInvoiceId: ids.invoices,
        classSectionId: ids.groups,
        guardianId: ids.guardians,
        discountTypeId: ids.types,
        assignmentId: ids.assignments,
        userId: ids.users,
        studentEnrollmentId: ids.enrollments,
        enrollmentId: ids.enrollments,
      }
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0')
      try {
        for (const { t, c } of columns) {
          if (t === 'FeeInvoice' && c === 'classSectionId') continue // handled by id below
          await del(t, c, byColumn[c] ?? [])
        }
        // Phase D: referrals point at students/parents through their own column names; complaint replies at complaints.
        await del('Referral', 'referredStudentId', ids.students)
        await del('Referral', 'referrerGuardianId', ids.guardians)
        await del('Complaint', 'complainantId', ids.users)
        await tx.$executeRawUnsafe('DELETE FROM `ComplaintReply` WHERE `complaintId` NOT IN (SELECT `id` FROM `Complaint`)')
        // LMS L1: demo curriculum versions with their sessions, content and comments; demo course skills.
        if (ids.curricula.length) {
          const sessionIds = (await tx.curriculumSession.findMany({ where: { editionId: { in: ids.curricula } }, select: { id: true } })).map((x) => x.id)
          await del('CurriculumBlock', 'sessionId', sessionIds)
          await del('CurriculumComment', 'sessionId', sessionIds)
          await del('CurriculumSession', 'id', sessionIds)
          await del('CurriculumEdition', 'id', ids.curricula)
        }
        await del('CourseSkill', 'id', ids.skills)
        // L3 batch 2: reactions left on demo projects that were just removed
        await tx.$executeRawUnsafe('DELETE FROM `GalleryReaction` WHERE `submissionId` NOT IN (SELECT `id` FROM `AssignmentSubmission`)')
        await del('_GuardianToStudent', 'A', ids.guardians)
        await del('_GuardianToStudent', 'B', ids.students)
        await del('StudentEnrollment', 'id', ids.enrollments)
        await del('FeeInvoice', 'id', ids.invoices)
        await del('DiscountAssignment', 'id', ids.assignments)
        await del('Student', 'id', ids.students)
        await del('Guardian', 'id', ids.guardians)
        await del('ClassSection', 'id', ids.groups)
        await del('DiscountType', 'id', ids.types)
        await del('PaymentAccount', 'id', ids.accounts)
        await del('User', 'id', ids.users)
      } finally {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1')
      }
      const broken = await brokenReferences(tx)
      if (broken.length) throw new Error(`Cancelled, nothing was deleted (broken references: ${broken.slice(0, 5).join('; ')})`)
      return deleted
    },
    { timeout: 50_000, maxWait: 10_000 }
  )
}
