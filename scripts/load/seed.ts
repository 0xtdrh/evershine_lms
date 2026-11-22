/**
 * LOAD TEST data (owner 22/11): fills a THROW-AWAY local copy with a launch-size school so we can measure.
 * Never run it against the real database: it refuses unless DATABASE_URL points at 127.0.0.1.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3430/technova npx tsx scripts/load/seed.ts [students=2000] [groups=150]
 *
 * It copies real rows of the restored copy as templates (so every required field is right) and marks everything
 * it makes with "LOAD" in a name / number, so it is easy to see. Rows: users, students, guardians (1–2 children each),
 * groups (with the template's instructor), enrolments, 3 monthly invoices per student (2 paid, 1 part-paid),
 * payments, and ~12 weeks of attendance (2 sessions a week).
 */

import { PrismaClient, Prisma } from '@prisma/client'

const url = process.env.DATABASE_URL ?? ''
if (!/@127\.0\.0\.1:|@localhost:/.test(url)) { console.error('Refusing: DATABASE_URL is not a local database.'); process.exit(1) }

const p = new PrismaClient()
const N_STUDENTS = Number(process.argv[2] ?? 2000)
const N_GROUPS = Number(process.argv[3] ?? 150)
const DAY = 86_400_000
const cuid = (() => { let i = 0; const base = Date.now().toString(36); return (pre: string) => `${pre}${base}${(i++).toString(36).padStart(6, '0')}` })()
const omit = <T extends Record<string, unknown>>(o: T, ...k: string[]) => Object.fromEntries(Object.entries(o).filter(([key]) => !k.includes(key)))

async function chunks<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size))
}

async function main() {
  const t0 = Date.now()
  const tplStudent = await p.student.findFirst({ where: { isActive: true } })
  const tplGuardian = await p.guardian.findFirst()
  const tplEnrol = await p.studentEnrollment.findFirst({ where: { status: 'ACTIVE', classSection: { kind: 'GROUP', levelId: { not: null } } } })
  const tplInvoice = await p.feeInvoice.findFirst({ where: { classSectionId: { not: null }, status: 'PAID' } })
  const tplPayment = await p.feePayment.findFirst({ where: { status: 'COMPLETED' } })
  const tplGroups = await p.classSection.findMany({ where: { status: 'ACTIVE', kind: 'GROUP', levelId: { not: null }, isActive: true }, include: { subjectOfferings: true } })
  if (!tplStudent || !tplGuardian || !tplEnrol || !tplInvoice || !tplPayment || !tplGroups.length) throw new Error('The restored copy needs at least one student, guardian, enrolment, paid invoice, payment and active group.')
  const tplStudentUser = await p.user.findUniqueOrThrow({ where: { id: tplStudent.userId } })
  const tplGuardianUser = await p.user.findUniqueOrThrow({ where: { id: tplGuardian.userId } })
  const markerTeacher = tplGroups.flatMap((g) => g.subjectOfferings).find((o) => o.teacherId)?.teacherId
  if (!markerTeacher) throw new Error('No group with an instructor to copy.')

  // ---- groups
  const groups = Array.from({ length: N_GROUPS }, (_, i) => {
    const t = tplGroups[i % tplGroups.length]
    return { ...omit(t, 'subjectOfferings', 'createdAt', 'updatedAt'), id: cuid('lg'), className: `LOAD ${String(i + 1).padStart(3, '0')}`, sectionName: 'L',
      startDate: new Date(Date.now() - 84 * DAY), currentCycleStartDate: new Date(Date.now() - 28 * DAY), currentCycleNumber: 3, maxStudents: 16 } as Prisma.ClassSectionCreateManyInput
  })
  await chunks(groups, 200, (part) => p.classSection.createMany({ data: part }))
  const offerings = groups.flatMap((g, i) => tplGroups[i % tplGroups.length].subjectOfferings.map((o) => ({ ...omit(o, 'createdAt'), id: cuid('lo'), classSectionId: g.id as string, teacherId: o.teacherId ?? markerTeacher }) as Prisma.SubjectOfferingCreateManyInput))
  await chunks(offerings, 500, (part) => p.subjectOffering.createMany({ data: part }))
  console.log(`groups ${groups.length}, offerings ${offerings.length}`)

  // ---- users + students
  const users: Prisma.UserCreateManyInput[] = []
  const students: Prisma.StudentCreateManyInput[] = []
  for (let i = 0; i < N_STUDENTS; i++) {
    const g = groups[i % groups.length]
    const uid = cuid('lu')
    users.push({ ...omit(tplStudentUser, 'createdAt', 'updatedAt', 'cardCode', 'resetToken', 'sessionsRevokedAt'), id: uid, email: `load.s${i}@load.local`, displayName: `LOAD Student ${i}` } as Prisma.UserCreateManyInput)
    students.push({ ...omit(tplStudent, 'createdAt', 'updatedAt', 'admissionNumber'), id: cuid('ls'), userId: uid, registrationNumber: `LOAD/${String(i).padStart(5, '0')}`,
      firstName: `Load${i}`, lastName: 'Student', campusId: g.campusId as string, batchId: g.batchId as string } as Prisma.StudentCreateManyInput)
  }
  // guardians: one per 1–2 students (every third family has two children)
  const guardians: { row: Prisma.GuardianCreateManyInput; kids: string[] }[] = []
  for (let i = 0, k = 0; i < students.length; k++) {
    const take = k % 3 === 0 ? 2 : 1
    const uid = cuid('lu')
    users.push({ ...omit(tplGuardianUser, 'createdAt', 'updatedAt', 'cardCode', 'resetToken', 'sessionsRevokedAt'), id: uid, email: `load.p${k}@load.local`, displayName: `LOAD Parent ${k}` } as Prisma.UserCreateManyInput)
    guardians.push({ row: { ...omit(tplGuardian, 'createdAt', 'updatedAt', 'referralCode'), id: cuid('lp'), userId: uid, phoneNumber: `019${String(k).padStart(8, '0')}`, firstName: `LoadParent${k}` } as Prisma.GuardianCreateManyInput, kids: students.slice(i, i + take).map((s) => s.id as string) })
    i += take
  }
  await chunks(users, 1000, (part) => p.user.createMany({ data: part }))
  await chunks(students, 1000, (part) => p.student.createMany({ data: part }))
  await chunks(guardians.map((g) => g.row), 1000, (part) => p.guardian.createMany({ data: part }))
  // link guardians ↔ students (implicit m-n table _GuardianToStudent: A = Guardian.id, B = Student.id)
  const links = guardians.flatMap((g) => g.kids.map((s) => [g.row.id as string, s]))
  await chunks(links, 1000, (part) => p.$executeRawUnsafe(`INSERT INTO _GuardianToStudent (A, B) VALUES ${part.map(() => '(?, ?)').join(',')}`, ...part.flat()))
  console.log(`users ${users.length}, students ${students.length}, guardians ${guardians.length}`)

  // ---- enrolments
  const enrols: Prisma.StudentEnrollmentCreateManyInput[] = students.map((s, i) => ({
    ...omit(tplEnrol, 'createdAt', 'updatedAt', 'withdrawalReason', 'withdrawnAt'), id: cuid('le'), studentId: s.id as string, classSectionId: groups[i % groups.length].id as string,
    rollNumber: `L${i}`, status: 'ACTIVE',
  }) as Prisma.StudentEnrollmentCreateManyInput)
  await chunks(enrols, 1000, (part) => p.studentEnrollment.createMany({ data: part }))

  // ---- invoices (cycles 1, 2 paid; 3 part-paid) + payments
  const invoices: Prisma.FeeInvoiceCreateManyInput[] = []
  const payments: Prisma.FeePaymentCreateManyInput[] = []
  let n = 0
  for (const [i, s] of students.entries()) {
    const g = groups[i % groups.length]
    for (const c of [1, 2, 3]) {
      const id = cuid('li')
      const paid = c < 3 ? 850 : 600
      const created = new Date(Date.now() - (3 - c) * 28 * DAY - 27 * DAY)
      invoices.push({ ...omit(tplInvoice, 'createdAt', 'updatedAt', 'proofUrl', 'proofStatus', 'proofRemarks', 'refundedAmount'), id, studentId: s.id as string, classSectionId: g.id as string,
        challanNumber: `LOAD-INV-${String(n++).padStart(6, '0')}`, cycleNumber: c, totalAmount: 850, paidAmount: paid, discount: 0, status: c < 3 ? 'PAID' : 'PARTIALLY_PAID',
        dueDate: new Date(created.getTime() + 7 * DAY), createdAt: created } as Prisma.FeeInvoiceCreateManyInput)
      payments.push({ ...omit(tplPayment, 'createdAt', 'updatedAt'), id: cuid('lf'), invoiceId: id, studentId: s.id as string, amount: paid, paymentDate: new Date(created.getTime() + 3 * DAY),
        receiptNumber: `LOAD-R-${String(n).padStart(7, '0')}` } as unknown as Prisma.FeePaymentCreateManyInput)
    }
  }
  await chunks(invoices, 1000, (part) => p.feeInvoice.createMany({ data: part }))
  await chunks(payments, 1000, (part) => p.feePayment.createMany({ data: part }))
  console.log(`invoices ${invoices.length}, payments ${payments.length}`)

  // ---- attendance: 12 weeks × 2 sessions
  const dates = Array.from({ length: 24 }, (_, k) => { const d = new Date(Date.now() - (84 - Math.floor(k / 2) * 7 - (k % 2) * 3) * DAY); d.setUTCHours(0, 0, 0, 0); return d })
  const att: Prisma.EnrollmentAttendanceRecordCreateManyInput[] = []
  for (const [i, e] of enrols.entries()) {
    for (const [k, d] of dates.entries()) {
      const r = (i * 7 + k * 13) % 20
      att.push({ id: cuid('la'), studentEnrollmentId: e.id as string, attendanceDate: d, status: r < 16 ? 'PRESENT' : r < 18 ? 'LATE' : 'ABSENT', markedByTeacherId: markerTeacher, taughtByTeacherId: markerTeacher })
    }
  }
  await chunks(att, 2000, (part) => p.enrollmentAttendanceRecord.createMany({ data: part }))
  console.log(`attendance ${att.length}`)
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())
