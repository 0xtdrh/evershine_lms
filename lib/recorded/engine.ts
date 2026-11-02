/**
 * a02 M4 batch 1 — recorded courses: the catalogue, enrolling, renewing, whether access is open, progress and the certificate. Server-only.
 * Rules: lib/recorded/rules.ts. Paid periods are counted lazily (`syncAccess`): on the student's page, the staff list and the daily job.
 */

import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { canSeeStudent, loadPlaces, requestPlaces } from '@/lib/places/server'
import { allowsCampus, groupWhere } from '@/lib/places/rules'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { resolveBatchId } from '@/lib/batches/default-batch'
import { resolveShiftId } from '@/lib/shifts/default-shift'
import { isLevelOfferedIn } from '@/lib/delivery/catalog'
import { createCycleInvoice } from '@/lib/groups/sync-progress'
import { visibleTo } from '@/lib/curriculum/blocks'
import { generateCertificateNumber } from '@/lib/certificates/generate-number'
import { notifyFamilies } from '@/lib/notifications/events'
import { parseQuiz } from '@/lib/quizzes/engine'
import { quizScore } from '@/lib/quizzes/rules'
import { resolveEdition } from '@/lib/lms/engine'
import { getVideoSettings, unprotectedVideos } from '@/lib/videos/engine'
import { accessState, certificateReady, extendAccess, KIND_RECORDED, planOffer, progressPct, SECTION_RECORDED, type AccessPlan, type OpenMode } from './rules'

type Who = { id: string; role: string; campusId?: string | null }
export class RecordedError extends Error {
  constructor(message: string, public status = 400, public code: string | null = null) { super(message) }
}
const num = (v: unknown) => (v != null ? Number(v) : null)
const row = <T extends { subscriptionPrice: unknown; oneTimePrice: unknown }>(c: T) => ({ ...c, subscriptionPrice: num(c.subscriptionPrice), oneTimePrice: num(c.oneTimePrice) })

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────────────────

export async function listCourses() {
  const rows = await prisma.recordedCourse.findMany({ orderBy: { createdAt: 'desc' } })
  const levels = await prisma.level.findMany({ where: { id: { in: rows.map((r) => r.levelId) } }, select: { id: true, name: true, subject: { select: { name: true } } } })
  return Promise.all(rows.map(async (r) => {
    const l = levels.find((x) => x.id === r.levelId)
    return { ...row(r), level: l ? `${l.subject?.name ?? ''} — ${l.name}` : '', hasExam: await levelHasExam(r.levelId), unprotectedVideos: await unprotectedVideos(r.levelId) }
  }))
}

/** Is there a published final exam in this level's curriculum? (a course that requires one cannot give a certificate without it) */
async function levelHasExam(levelId: string) {
  const ed = await prisma.curriculumEdition.findFirst({ where: { levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: { id: true } })
  if (!ed) return false
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId: ed.id }, select: { id: true } })
  const blocks = await prisma.curriculumBlock.findMany({ where: { type: 'QUIZ', sessionId: { in: sessions.map((s) => s.id) } }, select: { data: true } })
  return blocks.some((b) => parseQuiz(b.data)?.kind === 'FINAL')
}

export interface CourseInput { levelId: string; subscriptionPrice?: number | null; subscriptionDays?: number | null; oneTimePrice?: number | null; openMode?: OpenMode; examRequired?: boolean; autoReveal?: boolean; isActive?: boolean; videoDevices?: number | null }

export async function saveCourse(i: CourseInput) {
  if (!(await prisma.level.findUnique({ where: { id: i.levelId }, select: { id: true } }))) throw new RecordedError('Level not found', 404)
  if (i.subscriptionPrice == null && i.oneTimePrice == null) throw new RecordedError('Write a subscription price or a one-time price · اكتب سعر اشتراك أو سعر شراء مرة واحدة')
  if (i.subscriptionPrice != null && !i.subscriptionDays) throw new RecordedError('Write how many days the subscription lasts · اكتب مدة الاشتراك بالأيام')
  const data = {
    subscriptionPrice: i.subscriptionPrice ?? null, subscriptionDays: i.subscriptionPrice != null ? i.subscriptionDays ?? null : null, oneTimePrice: i.oneTimePrice ?? null,
    openMode: i.openMode ?? 'ALL', examRequired: i.examRequired ?? true, autoReveal: i.autoReveal ?? false, isActive: i.isActive ?? true, videoDevices: i.videoDevices ?? null,
  }
  return row(await prisma.recordedCourse.upsert({ where: { levelId: i.levelId }, create: { levelId: i.levelId, ...data }, update: data }))
}

// ── enrolling and renewing ──────────────────────────────────────────────────────────────────────────────────

async function freeName(campusId: string, base: string) {
  let name = base
  for (let n = 2; await prisma.classSection.findFirst({ where: { campusId, className: name, sectionName: SECTION_RECORDED }, select: { id: true } }); n++) name = `${base.slice(0, 45)} #${n}`
  return name
}

export async function enrol(user: Who, i: { studentId: string; campusId: string; levelId: string; plan: AccessPlan }) {
  if (!allowsCampus(await loadPlaces(user as never), i.campusId)) throw new RecordedError('This place is not yours', 403)
  if (!(await canSeeStudent(user as never, i.studentId))) throw new RecordedError('This student is not in your places', 403)
  const course = await prisma.recordedCourse.findUnique({ where: { levelId: i.levelId } })
  if (!course?.isActive) throw new RecordedError('This level is not offered as a recorded course · المستوى ده مش متاح ككورس مسجل', 409, 'NOT_A_COURSE')
  if (!(await isLevelOfferedIn(i.levelId, i.campusId))) throw new RecordedError('This level is not offered in this place · المستوى ده مش متاح في المكان ده', 409, 'NOT_OFFERED')
  const offer = planOffer(row(course), i.plan)
  if (!offer) throw new RecordedError('This course does not offer that plan · الكورس مش متاح بالنظام ده', 409, 'NO_PLAN')
  if (offer.price > 0 && (await getVideoSettings()).blockUnprotectedPaid && (await unprotectedVideos(i.levelId)) > 0) throw new RecordedError('This paid course has videos that are not protected. Upload them again first · الكورس المدفوع ده فيه فيديوهات مش محمية. ارفعها تاني الأول', 409, 'UNPROTECTED_VIDEO')
  const same = await prisma.studentEnrollment.count({ where: { studentId: i.studentId, status: 'ACTIVE', classSection: { kind: KIND_RECORDED, levelId: i.levelId, status: 'ACTIVE' } } })
  if (same) throw new RecordedError('The student already has this course · الطالب مسجل في الكورس ده', 409, 'ALREADY')
  const [student, level, year] = await Promise.all([
    prisma.student.findUnique({ where: { id: i.studentId }, select: { firstName: true, lastName: true } }),
    prisma.level.findUnique({ where: { id: i.levelId }, select: { id: true, name: true, numberOfSessions: true, subject: { select: { name: true } } } }),
    getActiveAcademicYear(),
  ])
  if (!student) throw new RecordedError('Student not found', 404)
  if (!level) throw new RecordedError('Level not found', 404)
  if (!year) throw new RecordedError('No active academic year is set', 409)
  const free = offer.price <= 0
  const edition = await prisma.curriculumEdition.findFirst({ where: { levelId: i.levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: { id: true } })
  const lessons = edition ? await prisma.curriculumSession.count({ where: { editionId: edition.id } }) : 0
  const group = await prisma.classSection.create({
    data: {
      campusId: i.campusId, batchId: await resolveBatchId(i.campusId, null), shiftId: await resolveShiftId(null, []),
      className: await freeName(i.campusId, `${student.firstName} ${student.lastName} — ${level.name}`.slice(0, 50)), sectionName: SECTION_RECORDED,
      levelId: i.levelId, kind: KIND_RECORDED, maxStudents: 1, cycleSessions: Math.max(1, level.numberOfSessions, lessons), lessonUnlockMode: course.openMode, priceOverride: offer.price,
      requireFullPaymentToStart: true, accessPlan: i.plan, accessDays: offer.days, accessPeriod: 1, accessApplied: free ? 1 : 0,
      accessEndsAt: free && offer.days ? extendAccess(null, new Date(), offer.days) : null,
    },
  })
  await prisma.studentEnrollment.create({ data: { studentId: i.studentId, academicYearId: year.id, classSectionId: group.id, rollNumber: String(Math.floor(Math.random() * 9000) + 1000) } })
  if (!free) await bill(group.id, i.studentId, i.levelId, 1, offer.price, year.name, user.id, `${level.subject?.name ?? ''} — ${level.name} (recorded)`)
  return { groupId: group.id, price: offer.price, plan: i.plan }
}

const bill = (groupId: string, studentId: string, levelId: string, period: number, amount: number, academicYearName: string, issuedBy: string, label: string) =>
  createCycleInvoice({ studentId, classSectionId: groupId, levelId, cycleNumber: period, amount, academicYearName, issuedBy, label })

async function oneGroup(user: Who, groupId: string) {
  const g = await prisma.classSection.findFirst({ where: { id: groupId, kind: KIND_RECORDED, ...groupWhere(await loadPlaces(user as never)) }, include: { enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } }, level: { select: { id: true, name: true, subject: { select: { name: true } } } } } })
  if (!g) throw new RecordedError('Recorded course not found', 404)
  return g
}

/** One more subscription period: a new invoice; the days are added when it is paid. */
export async function renew(user: Who, groupId: string) {
  const g = await oneGroup(user, groupId)
  if (g.accessPlan !== 'SUBSCRIPTION') throw new RecordedError('A one-time purchase does not need renewing · الشراء مرة واحدة مش محتاج تجديد', 409)
  await syncAccess(groupId)
  const now = await prisma.classSection.findUniqueOrThrow({ where: { id: groupId }, select: { accessPeriod: true, accessApplied: true } })
  if ((now.accessApplied ?? 0) < (now.accessPeriod ?? 1)) throw new RecordedError('The last invoice is not paid yet · آخر فاتورة لسه ما اتدفعتش', 409, 'NOT_PAID')
  const studentId = g.enrollments[0]?.studentId
  const course = await prisma.recordedCourse.findUnique({ where: { levelId: g.levelId! } })
  const price = num(course?.subscriptionPrice) ?? num(g.priceOverride) ?? 0
  const days = course?.subscriptionDays ?? g.accessDays
  if (!studentId || !days) throw new RecordedError('This course cannot be renewed', 409)
  const period = (now.accessPeriod ?? 1) + 1
  const year = await getActiveAcademicYear()
  await prisma.classSection.update({ where: { id: groupId }, data: { accessPeriod: period, accessDays: days, priceOverride: price, ...(price <= 0 && { accessApplied: period, accessEndsAt: extendAccess(g.accessEndsAt, new Date(), days) }) } })
  if (price > 0) await bill(groupId, studentId, g.levelId!, period, price, year?.name ?? String(new Date().getFullYear()), user.id, `${g.level?.subject?.name ?? ''} — ${g.level?.name ?? ''} (recorded, ${period})`)
  return { period, price }
}

/** Count the periods paid since last time: the days run from the payment. */
export async function syncAccess(groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, accessPeriod: true, accessApplied: true, accessEndsAt: true, accessDays: true, enrollments: { select: { studentId: true }, take: 1 } } })
  if (!g || g.kind !== KIND_RECORDED) return
  const studentId = g.enrollments[0]?.studentId
  let applied = g.accessApplied ?? 0
  const period = g.accessPeriod ?? 1
  if (!studentId || applied >= period) return
  let endsAt = g.accessEndsAt
  for (let p = applied + 1; p <= period; p++) {
    const inv = await prisma.feeInvoice.findFirst({ where: { classSectionId: groupId, studentId, cycleNumber: p, OR: [{ status: 'PAID' }, { totalAmount: { lte: 0 }, NOT: { status: 'CANCELLED' } }] }, select: { id: true, updatedAt: true, payments: { orderBy: { paymentDate: 'desc' }, take: 1, select: { paymentDate: true } } } })
    if (!inv) break
    applied = p
    if (g.accessDays) endsAt = extendAccess(endsAt, inv.payments[0]?.paymentDate ?? inv.updatedAt, g.accessDays)
  }
  if (applied !== (g.accessApplied ?? 0)) await prisma.classSection.update({ where: { id: groupId }, data: { accessApplied: applied, accessEndsAt: endsAt } })
}

/** Access of one recorded course for the lessons (null = not a recorded course). */
export async function recordedAccess(groupId: string) {
  await syncAccess(groupId)
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, accessPlan: true, accessEndsAt: true, accessApplied: true } })
  if (!g || g.kind !== KIND_RECORDED) return null
  const applied = g.accessApplied ?? 0
  let state = accessState({ plan: g.accessPlan, endsAt: g.accessEndsAt, applied }, new Date())
  // the money of the current period went back: closed
  const inv = state === 'OPEN' && applied ? await prisma.feeInvoice.findFirst({ where: { classSectionId: groupId, cycleNumber: applied }, select: { paidAmount: true, refundedAmount: true } }) : null
  if (inv && Number(inv.paidAmount) > 0 && Number(inv.refundedAmount) >= Number(inv.paidAmount)) state = 'NOT_PAID'
  return { state, plan: g.accessPlan, endsAt: g.accessEndsAt, applied }
}

// ── progress and certificate ────────────────────────────────────────────────────────────────────────────────

/** Lessons done, the final exam, and the certificate of one student in one recorded course. */
export async function progressOf(studentId: string, groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { id: true, className: true, sectionName: true, campusId: true, status: true, startDate: true, currentCycleNumber: true, curriculumEditionId: true, curriculumVariantId: true, lessonUnlockMode: true, levelId: true, cycleSessions: true, level: { select: { id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, lessonUnlockMode: true, subject: { select: { name: true } } } } } })
  if (!g?.level) return null
  const edition = await resolveEdition(g as never)
  if (!edition) return { done: 0, total: 0, pct: 0, hasExam: false, examScore: null, passMark: null, certificate: null }
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId: edition.id }, select: { id: true } })
  const blocks = (await prisma.curriculumBlock.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, select: { id: true, type: true, audience: true, data: true } })).filter((b) => visibleTo(b.audience, 'STUDENT'))
  const doneRows = await prisma.lessonProgress.findMany({ where: { studentId, blockId: { in: blocks.map((b) => b.id) } }, select: { blockId: true } })
  const exam = blocks.map((b) => ({ id: b.id, quiz: b.type === 'QUIZ' ? parseQuiz(b.data) : null })).find((b) => b.quiz?.kind === 'FINAL')
  let examScore: number | null = null
  if (exam?.quiz) {
    const tries = await prisma.quizAttempt.findMany({ where: { blockId: exam.id, studentId, classSectionId: groupId, status: 'GRADED' }, select: { score: true, maxScore: true, createdAt: true } })
    examScore = quizScore(tries, exam.quiz.scoring)?.percent ?? null
  }
  // a quiz counts as done once graded (it may have timed out or been reviewed by staff)
  const quizIds = blocks.filter((b) => b.type === 'QUIZ').map((b) => b.id)
  const graded = quizIds.length ? await prisma.quizAttempt.findMany({ where: { studentId, classSectionId: groupId, blockId: { in: quizIds }, status: 'GRADED' }, select: { blockId: true } }) : []
  const done = new Set([...doneRows.map((r) => r.blockId), ...graded.map((r) => r.blockId)]).size
  const certificate = await prisma.certificate.findFirst({ where: { studentId, remarks: `RECORDED:${g.levelId}` }, select: { id: true, certificateNumber: true, isRevealed: true } })
  return { done, total: blocks.length, pct: progressPct(done, blocks.length), hasExam: !!exam, examScore, passMark: exam?.quiz?.passMark ?? null, certificate }
}

/** Gives the certificate once everything is done (runs after a lesson tick or a graded exam). Never breaks the student's action. */
export async function tryCertificate(studentId: string, groupId: string) {
  try {
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, levelId: true, level: { select: { name: true, subjectId: true, subject: { select: { name: true } } } } } })
    if (!g || g.kind !== KIND_RECORDED || !g.levelId) return false
    const course = await prisma.recordedCourse.findUnique({ where: { levelId: g.levelId } })
    const p = await progressOf(studentId, groupId)
    if (!course || !p || p.certificate) return false
    if (!certificateReady({ done: p.done, total: p.total, examRequired: course.examRequired, hasExam: p.hasExam, examScore: p.examScore, passMark: p.passMark })) return false
    const certificateNumber = await generateCertificateNumber()
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://evershine-lms-technova.vercel.app'
    const qrCodeUrl = await QRCode.toDataURL(`${base}/verify/${certificateNumber}`, { errorCorrectionLevel: 'H', type: 'image/png', width: 300, margin: 2 })
    const tpl = await prisma.certificateTemplate.findFirst({ where: { isDefault: true }, select: { id: true } })
    await prisma.certificate.create({
      data: {
        studentId, type: 'COMPLETION', title: `${g.level?.subject?.name ?? 'Course'} — ${g.level?.name ?? ''}`.trim(), issuedBy: 'system', certificateNumber, qrCodeUrl, templateId: tpl?.id,
        subjectId: g.level?.subjectId, remarks: `RECORDED:${g.levelId}`, isRevealed: course.autoReveal, ...(course.autoReveal && { revealedAt: new Date(), revealedBy: 'system' }),
      },
    })
    if (course.autoReveal) await notifyFamilies([studentId], 'CERTIFICATE_ISSUED', (s) => ({ title: 'Certificate ready', message: `${s.firstName} finished the course: the certificate is ready.`, titleAr: 'الشهادة جاهزة', messageAr: `${s.firstName} خلص الكورس: الشهادة جاهزة.`, relatedId: groupId }), { includeStudent: true })
    return true
  } catch (err) {
    console.error('[RECORDED_CERTIFICATE]', err)
    return false
  }
}

// ── lists and the daily job ─────────────────────────────────────────────────────────────────────────────────

export async function listEnrolled(user: Who, opts: { campusId?: string | null }) {
  const places = await requestPlaces(user as never, opts.campusId ?? null)
  const groups = await prisma.classSection.findMany({
    where: { kind: KIND_RECORDED, isActive: true, ...groupWhere(places) }, orderBy: { createdAt: 'desc' }, take: 500,
    select: { id: true, accessPlan: true, accessEndsAt: true, accessPeriod: true, accessApplied: true, priceOverride: true, campus: { select: { id: true, name: true } }, level: { select: { id: true, name: true, subject: { select: { name: true } } } }, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true, student: { select: { firstName: true, lastName: true } } } } },
  })
  return Promise.all(groups.map(async (g) => {
    const a = (await recordedAccess(g.id))!
    const e = g.enrollments[0]
    return {
      id: g.id, plan: g.accessPlan, price: num(g.priceOverride), endsAt: a.endsAt, state: a.state,
      campus: g.campus, level: g.level ? `${g.level.subject?.name ?? ''} — ${g.level.name}` : '', student: e ? { id: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`.trim() } : null,
      unpaidRenewal: a.applied < (g.accessPeriod ?? 1), progress: e ? await progressOf(e.studentId, g.id) : null,
    }
  }))
}

/** Daily: count payments and tell families a subscription ends in 3 days. */
export async function recordedDailyJob() {
  const groups = await prisma.classSection.findMany({ where: { kind: KIND_RECORDED, isActive: true }, select: { id: true } })
  for (const g of groups) await syncAccess(g.id)
  const from = new Date(Date.now() + 2 * 86_400_000), to = new Date(Date.now() + 3 * 86_400_000)
  const ending = await prisma.classSection.findMany({ where: { kind: KIND_RECORDED, isActive: true, accessPlan: 'SUBSCRIPTION', accessEndsAt: { gte: from, lt: to } }, select: { id: true, level: { select: { name: true } }, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } } })
  for (const g of ending) {
    await notifyFamilies(g.enrollments.map((e) => e.studentId), 'RECORDED_ENDING', (s) => ({ title: 'Subscription ends soon', message: `${s.firstName}: ${g.level?.name ?? ''} ends in 3 days. Renew it to keep watching.`, titleAr: 'الاشتراك قرب يخلص', messageAr: `${s.firstName}: ${g.level?.name ?? ''} بيخلص بعد 3 أيام. جدّد علشان يكمل.`, relatedId: g.id }))
  }
  return { synced: groups.length, ending: ending.length }
}
