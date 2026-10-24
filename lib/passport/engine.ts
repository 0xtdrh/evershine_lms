/**
 * P1 passport (owner decisions 2026-10-12). Server-only. Pure rules: lib/passport/rules.ts.
 * - Every student gets a passport (number by join year) the first time it is opened or checked.
 * - Automatic stamps are checked when the passport is opened, after a level result and by the daily job; the first
 *   check of a student is silent (no flood of notifications for old achievements), later stamps notify the family.
 * - A graduated track also gets a graduation certificate (same TN-CERT numbering, hidden until revealed like the others).
 * - Printing (booklet, passport PDF, transcript) is staff only and logged with a copy number; families only look.
 */

import { canSeeStudent } from '@/lib/places/server'
import { randomBytes } from 'crypto'
import QRCode from 'qrcode'
import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { campusScope } from '@/lib/academic/api-helpers'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { studentAttendanceTimeline } from '@/lib/attendance/timeline'
import { nextInSequence } from '@/lib/ids/sequence'
import { generateCertificateNumber } from '@/lib/certificates/generate-number'
import { notifyFamilies } from '@/lib/notifications/events'
import { studentViewer } from '@/lib/students/access'
import { studentSkills } from '@/lib/reports/lms-summary'
import { groupLessons } from '@/lib/lms/engine'
import { groupAssignments } from '@/lib/assignments/engine'
import { homeworkStats } from '@/lib/lms/analytics-calc'
import { normalizeCardCode } from '@/lib/cards/rules'
import {
  BUILTIN_STAMPS, autoAwards, canGive, eventOpen, passportPrefix, shareExpiry, tracksGraduated, type Facts,
} from './rules'
import { cairoToday } from '@/lib/dates/cairo'

type User = { id: string; role: string; campusId?: string | null }
export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })
const DAY = 86_400_000

// ───────────────────────── settings ─────────────────────────

export interface PassportSettings {
  trackRequired: Record<string, string[]>
  trackColors: Record<string, string>
  shareDays: number
  bookletPrice: number | null
  companyStampUrl: string | null
  signatureUrl: string | null
  signatureName: string
}
const KEY = 'passport.settings'
export const PASSPORT_DEFAULTS: PassportSettings = { trackRequired: {}, trackColors: {}, shareDays: 30, bookletPrice: null, companyStampUrl: null, signatureUrl: null, signatureName: '' }
export const getPassportSettings = async (): Promise<PassportSettings> => ({ ...PASSPORT_DEFAULTS, ...(await getSetting<Partial<PassportSettings>>(KEY, {})) })
export const savePassportSettings = (v: PassportSettings, userId: string) => setSetting(KEY, v, userId)

// ───────────────────────── stamps library ─────────────────────────

/** Creates the ready-made stamps that are missing (never overwrites the admin's edits). */
export async function ensureBuiltinStamps() {
  if ((await prisma.passportStamp.count({ where: { code: { not: null } } })) >= BUILTIN_STAMPS.length) return
  const have = new Set((await prisma.passportStamp.findMany({ where: { code: { not: null } }, select: { code: true } })).map((s) => s.code))
  for (const [i, b] of BUILTIN_STAMPS.entries()) {
    if (have.has(b.code)) continue
    await prisma.passportStamp.create({
      data: { code: b.code, nameEn: b.nameEn, nameAr: b.nameAr, kind: b.kind, rule: b.rule ?? null, threshold: b.threshold ?? null, shape: b.shape, color: b.color, icon: b.icon, repeatable: !!b.repeatable, givers: (b.givers ?? []) as Prisma.InputJsonValue, order: i },
    }).catch(() => undefined)
  }
}

// ───────────────────────── passport ─────────────────────────

export async function ensurePassport(studentId: string) {
  const existing = await prisma.studentPassport.findUnique({ where: { studentId } })
  if (existing) return existing
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { admissionDate: true, createdAt: true } })
  if (!st) return null
  const year = (st.admissionDate ?? st.createdAt).getUTCFullYear()
  for (let i = 0; i < 5; i++) {
    const rows = await prisma.studentPassport.findMany({ where: { number: { startsWith: passportPrefix(year) } }, select: { number: true } })
    const number = nextInSequence(rows.map((r) => r.number), passportPrefix(year), 4)
    try {
      return await prisma.studentPassport.create({ data: { studentId, number } })
    } catch {
      const again = await prisma.studentPassport.findUnique({ where: { studentId } })
      if (again) return again
    }
  }
  return null
}

// ───────────────────────── facts ─────────────────────────

const pctOf = (s: number | null, m: number | null) => (s != null && m ? (s / m) * 100 : null)

async function collectFacts(studentId: string, settings: PassportSettings): Promise<Facts | null> {
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { admissionDate: true, createdAt: true } })
  if (!st) return null
  const [results, sessions, stars, gallery, referrals, renewals, active, attempts] = await Promise.all([
    prisma.studentLevelResult.findMany({
      where: { passed: true, studentEnrollment: { studentId } },
      select: { updatedAt: true, studentEnrollment: { select: { classSection: { select: { currentCycleNumber: true, level: { select: { id: true, name: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true, trackId: true } } } } } } } } },
    }),
    prisma.enrollmentAttendanceRecord.count({ where: { studentEnrollment: { studentId }, status: { in: ['PRESENT', 'LATE'] } } }),
    prisma.sessionReportStudent.count({ where: { studentId, star: true, report: { status: 'SENT' } } }),
    prisma.assignmentSubmission.count({ where: { studentId, galleryStatus: 'APPROVED' } }),
    prisma.referral.count({ where: { rewardStudentId: studentId, rewardedAt: { not: null } } }),
    prisma.renewalRequest.findMany({ where: { studentId, status: 'YES', respondedAt: { not: null } }, select: { respondedAt: true, discountAssignmentId: true, classSectionId: true } }),
    prisma.studentEnrollment.count({ where: { studentId, status: 'ACTIVE', classSection: { status: 'ACTIVE' } } }),
    prisma.quizAttempt.findMany({ where: { studentId, status: 'GRADED' }, select: { blockId: true, score: true, maxScore: true } }),
  ])
  // levels finished (passed in the level's last month, or a one-payment level)
  const levelsPassed = new Map<string, Facts['levelsPassed'][number]>()
  for (const r of results) {
    const g = r.studentEnrollment.classSection
    const l = g.level
    if (!l) continue
    const complete = l.pricingType === 'FULL_LEVEL' || g.currentCycleNumber >= l.numberOfMonths
    if (!complete || levelsPassed.has(l.id)) continue
    levelsPassed.set(l.id, { levelId: l.id, label: `${l.subject?.name ?? ''} · ${l.name}`, trackId: l.subject?.trackId ?? null, at: r.updatedAt })
  }
  const tracks = await prisma.track.findMany({ select: { id: true, name: true, courses: { select: { id: true, levels: { select: { id: true, order: true }, orderBy: { order: 'desc' }, take: 1 } } } } })
  const graduated = tracksGraduated(
    tracks.map((t) => ({ id: t.id, name: t.name, courses: t.courses.map((c) => ({ id: c.id, lastLevelId: c.levels[0]?.id ?? null })) })),
    settings.trackRequired, [...levelsPassed.values()],
  )
  const timeline = await studentAttendanceTimeline(studentId, { limit: 60 })
  const perfectMonths = timeline.groups.filter((g) => g.finished && g.perfect && g.sessions.length).map((g) => ({ groupId: g.classSectionId, label: `${g.course ?? g.group} · ${g.level ?? ''}` }))
  // homework: finished months of the last 120 days where every due homework was handed in on time
  const homeworkMonths: Facts['homeworkMonths'] = []
  const since = Date.now() - 120 * DAY
  for (const g of timeline.groups.filter((x) => x.finished && x.sessions.length && new Date(`${x.sessions[x.sessions.length - 1].date}T00:00:00Z`).getTime() >= since).slice(0, 8)) {
    const gl = await groupLessons(g.classSectionId).catch(() => null)
    if (!gl?.edition) continue
    const inMonth = new Set<string>(gl.sessions.filter((s) => s.number >= gl.range.from && s.number <= gl.range.to).map((s) => s.id as string))
    const due = (await groupAssignments(g.classSectionId, { lessons: gl })).filter((a) => inMonth.has(a.sessionId) && a.dueAt && a.dueAt <= new Date()).map((a) => ({ blockId: a.blockId, dueAt: a.dueAt! }))
    if (!due.length) continue
    const subs = await prisma.assignmentSubmission.findMany({ where: { classSectionId: g.classSectionId, studentId, blockId: { in: due.map((x) => x.blockId) } }, select: { blockId: true, studentId: true, status: true, late: true, submittedAt: true, gradedAt: true, gradedById: true, score: true, maxScore: true } })
    if (homeworkStats([studentId], due, subs).onTime === due.length) homeworkMonths.push({ groupId: g.classSectionId, label: `${g.course ?? g.group} · ${g.level ?? ''}` })
  }
  // quizzes with a best try of 90%+
  const best = new Map<string, number>()
  for (const a of attempts) { const p = pctOf(a.score, a.maxScore); if (p != null) best.set(a.blockId, Math.max(best.get(a.blockId) ?? 0, p)) }
  // best skill (any level the student studied)
  let bestSkillPercent: number | null = null
  const byCourse = new Map<string, string[]>()
  for (const g of timeline.groups) {
    const grp = await prisma.classSection.findUnique({ where: { id: g.classSectionId }, select: { level: { select: { subjectId: true } } } })
    const sub = grp?.level?.subjectId
    if (sub) byCourse.set(sub, [...(byCourse.get(sub) ?? []), g.classSectionId])
  }
  for (const [subjectId, groupIds] of byCourse) {
    const sk = await studentSkills(studentId, groupIds, subjectId).catch(() => null)
    for (const s of sk?.scores ?? []) if (s.percent != null && s.items >= 3) bestSkillPercent = Math.max(bestSkillPercent ?? 0, s.percent)
  }
  // early renewal: YES before the group's end (or with the early-renewal discount)
  let earlyRenewals = 0
  for (const r of renewals) {
    if (r.discountAssignmentId) { earlyRenewals++; continue }
    const g = await prisma.classSection.findUnique({ where: { id: r.classSectionId }, select: { expectedEndDate: true } })
    if (!g?.expectedEndDate || r.respondedAt! < g.expectedEndDate) earlyRenewals++
  }
  return {
    joinedAt: st.admissionDate ?? st.createdAt,
    levelsPassed: [...levelsPassed.values()],
    tracksGraduated: graduated,
    sessions, perfectMonths, stars, galleryProjects: gallery, homeworkMonths,
    quizzesAbove90: [...best.values()].filter((p) => p >= 90).length,
    bestSkillPercent, referrals, earlyRenewals, hasActiveGroup: active > 0,
  }
}

// ───────────────────────── awarding ─────────────────────────

async function graduationCertificate(studentId: string, trackId: string, trackName: string) {
  const tag = `TRACK_GRADUATION:${trackId}`
  if (await prisma.certificate.findFirst({ where: { studentId, remarks: tag } })) return
  const certificateNumber = await generateCertificateNumber()
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://evershine-lms-technova.vercel.app'
  const qrCodeUrl = await QRCode.toDataURL(`${base}/verify/${certificateNumber}`, { errorCorrectionLevel: 'H', type: 'image/png', width: 300, margin: 2 })
  const tpl = await prisma.certificateTemplate.findFirst({ where: { isDefault: true }, select: { id: true } })
  await prisma.certificate.create({
    data: { studentId, type: 'ACHIEVEMENT', title: `${trackName} — Track Graduation`, issuedBy: 'system', certificateNumber, qrCodeUrl, templateId: tpl?.id, remarks: tag, isRevealed: false },
  })
}

/** Checks every automatic stamp for one student; returns how many new stamps were given. */
export async function evaluateStamps(studentId: string): Promise<number> {
  await ensureBuiltinStamps()
  const passport = await ensurePassport(studentId)
  if (!passport) return 0
  const settings = await getPassportSettings()
  const facts = await collectFacts(studentId, settings)
  if (!facts) return 0
  const stamps = await prisma.passportStamp.findMany({ where: { kind: 'AUTO', active: true } })
  const have = new Set((await prisma.studentStamp.findMany({ where: { studentId }, select: { stampId: true, refKey: true } })).map((x) => `${x.stampId}|${x.refKey}`))
  const fresh: { name: string; label?: string }[] = []
  for (const s of stamps) {
    for (const a of autoAwards({ rule: s.rule, threshold: s.threshold, repeatable: s.repeatable }, facts, new Date(), settings.trackColors)) {
      if (have.has(`${s.id}|${a.refKey}`)) continue
      try {
        await prisma.studentStamp.create({ data: { stampId: s.id, studentId, refKey: a.refKey, label: a.label ?? null, color: a.color ?? null, source: 'AUTO' } })
        fresh.push({ name: s.nameEn, label: a.label })
      } catch { /* given at the same moment by another check */ }
    }
  }
  for (const t of facts.tracksGraduated) await graduationCertificate(studentId, t.trackId, t.name).catch((e) => console.error('[PASSPORT_GRAD_CERT]', e))
  if (!passport.evaluatedAt) await prisma.studentPassport.update({ where: { id: passport.id }, data: { evaluatedAt: new Date() } })
  else if (fresh.length) {
    await notifyFamilies([studentId], 'PASSPORT_STAMP', (st) => ({
      title: 'New stamp in the passport',
      titleAr: 'ختم جديد في الباسبور',
      message: `${st.firstName} got a new stamp: ${fresh.map((f) => (f.label ? `${f.name} (${f.label})` : f.name)).join(', ')}.`,
      messageAr: `${st.firstName} خد ختم جديد: ${fresh.map((f) => (f.label ? `${f.name} (${f.label})` : f.name)).join('، ')}.`,
      relatedId: studentId,
    }), { includeStudent: true })
  }
  return fresh.length
}

/** Daily job: students with activity in the last 2 days. */
export async function evaluateRecentStudents() {
  const since = new Date(Date.now() - 2 * DAY)
  const ids = new Set<string>()
  const [att, res, subs] = await Promise.all([
    prisma.enrollmentAttendanceRecord.findMany({ where: { createdAt: { gte: since } }, select: { studentEnrollment: { select: { studentId: true } } }, take: 3000 }),
    prisma.studentLevelResult.findMany({ where: { updatedAt: { gte: since } }, select: { studentEnrollment: { select: { studentId: true } } }, take: 1000 }),
    prisma.assignmentSubmission.findMany({ where: { updatedAt: { gte: since } }, select: { studentId: true }, take: 2000 }),
  ])
  att.forEach((a) => ids.add(a.studentEnrollment.studentId)); res.forEach((r) => ids.add(r.studentEnrollment.studentId)); subs.forEach((s) => ids.add(s.studentId))
  let given = 0
  for (const id of [...ids].slice(0, 400)) given += await evaluateStamps(id).catch(() => 0)
  return { students: ids.size, given }
}

/** Staff who may manage this student's passport (give stamps, print): admins, the branch, the student's instructors. */
export async function canManageStudent(user: User, studentId: string): Promise<boolean> {
  const role = user.role as Role
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'BRANCH_MANAGER' || role === 'SECRETARY') return canSeeStudent(user, studentId)
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    if (!t) return false
    return (await prisma.studentEnrollment.count({ where: { studentId, classSectionId: { in: await getTeacherClassSectionIds(t.id) } } })) > 0
  }
  return false
}

/** MANUAL stamp to some students (the role must be one of the stamp's givers). */
export async function giveStamp(user: User, stampId: string, studentIds: string[], note: string | null): Promise<Outcome<{ given: number }>> {
  const s = await prisma.passportStamp.findUnique({ where: { id: stampId } })
  if (!s || !s.active) return fail('NOT_FOUND', 'Stamp not found')
  if (s.kind !== 'MANUAL') return fail('INVALID', 'This stamp is not given by hand')
  if (!canGive(s.givers, user.role)) return fail('FORBIDDEN', 'Your role cannot give this stamp')
  let given = 0
  for (const id of [...new Set(studentIds)].slice(0, 200)) {
    if (!(await canManageStudent(user, id))) continue
    if (!(await ensurePassport(id))) continue
    const refKey = s.repeatable ? cairoToday() : ''
    try {
      await prisma.studentStamp.create({ data: { stampId, studentId: id, refKey, source: 'MANUAL', awardedById: user.id, note: note?.slice(0, 300) || null } })
      given++
      await notifyFamilies([id], 'PASSPORT_STAMP', (st) => ({ title: 'New stamp in the passport', titleAr: 'ختم جديد في الباسبور', message: `${st.firstName} got a new stamp: ${s.nameEn}.`, messageAr: `${st.firstName} خد ختم جديد: ${s.nameAr || s.nameEn}.`, relatedId: id }), { includeStudent: true })
    } catch { /* already has it */ }
  }
  return { ok: true, value: { given } }
}

/** EVENT stamp by scanning the student card (TN-QR / old ESA-QR) on the event day. */
export async function scanEventStamp(user: User, stampId: string, code: string): Promise<Outcome<{ student: string; already: boolean }>> {
  const s = await prisma.passportStamp.findUnique({ where: { id: stampId } })
  if (!s || !s.active) return fail('NOT_FOUND', 'Stamp not found')
  if (s.kind !== 'EVENT') return fail('INVALID', 'This is not an event stamp')
  if (!canGive(s.givers, user.role)) return fail('FORBIDDEN', 'Your role cannot give this stamp')
  if (!eventOpen(s, new Date())) return fail('CLOSED', 'This event stamp is not open today')
  const clean = normalizeCardCode(code)
  if (!/^(tn|esa)-qr-/i.test(clean)) return fail('INVALID', 'This is not a student card')
  const st = await prisma.student.findFirst({ where: { idCardQRCode: clean, isActive: true }, select: { id: true, firstName: true, lastName: true, campusId: true } })
  if (!st) return fail('NOT_FOUND', 'Student card not found')
  if (user.role !== 'TEACHER' && !(await canSeeStudent(user, st.id))) return fail('FORBIDDEN', 'This student is from another place')
  await ensurePassport(st.id)
  const refKey = s.repeatable ? (s.eventFrom ?? new Date()).toISOString().slice(0, 10) : ''
  let already = false
  try {
    await prisma.studentStamp.create({ data: { stampId, studentId: st.id, refKey, source: 'EVENT', awardedById: user.id } })
    await notifyFamilies([st.id], 'PASSPORT_STAMP', (x) => ({ title: 'New stamp in the passport', titleAr: 'ختم جديد في الباسبور', message: `${x.firstName} got a new stamp: ${s.nameEn}.`, messageAr: `${x.firstName} خد ختم جديد: ${s.nameAr || s.nameEn}.`, relatedId: st.id }), { includeStudent: true })
  } catch { already = true }
  return { ok: true, value: { student: `${st.firstName} ${st.lastName}`.trim(), already } }
}

// ───────────────────────── views ─────────────────────────

type Viewer = 'STUDENT' | 'PARENT' | 'TEACHER' | 'STAFF'

/** The passport as one viewer may see it (families: no money, no phone; grades for family + staff only). */
export async function passportView(user: User, studentId: string) {
  const viewer = (await studentViewer(user, studentId)) as Viewer | null
  if (!viewer) return null
  await evaluateStamps(studentId).catch((e) => console.error('[PASSPORT_EVAL]', e))
  const [passport, student, stamps, available, certs, projects, settings] = await Promise.all([
    prisma.studentPassport.findUnique({ where: { studentId } }),
    prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, fullNameAr: true, registrationNumber: true, profilePicture: true, admissionDate: true, idCardQRCode: true, campus: { select: { name: true } }, enrollments: { where: { status: 'ACTIVE' }, select: { classSection: { select: { level: { select: { subject: { select: { trackId: true } } } } } } }, take: 1 } } }),
    prisma.studentStamp.findMany({ where: { studentId }, orderBy: { awardedAt: 'asc' }, include: { stamp: true } }),
    prisma.passportStamp.findMany({ where: { active: true, secret: false }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    prisma.certificate.findMany({ where: { studentId, status: 'VALID' }, orderBy: { issuedDate: 'asc' }, select: { id: true, title: true, certificateNumber: true, issuedDate: true, isRevealed: true } }),
    prisma.assignmentSubmission.findMany({ where: { studentId, galleryStatus: 'APPROVED' }, orderBy: { galleryAt: 'desc' }, take: 12, select: { id: true, blockId: true, galleryAt: true } }),
    getPassportSettings(),
  ])
  if (!passport || !student) return null
  const family = viewer === 'STUDENT' || viewer === 'PARENT'
  const trackId = student.enrollments[0]?.classSection.level?.subject?.trackId ?? null
  const projectTitles = projects.length ? await prisma.curriculumBlock.findMany({ where: { id: { in: projects.map((p) => p.blockId) } }, select: { id: true, titleEn: true, titleAr: true } }) : []
  const unseen = family ? stamps.filter((s) => !s.seenAt).map((s) => s.id) : []
  if (viewer === 'STUDENT' && unseen.length) await prisma.studentStamp.updateMany({ where: { id: { in: unseen } }, data: { seenAt: new Date() } })
  const shares = viewer === 'PARENT' ? await prisma.passportShare.findMany({ where: { studentId, createdById: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }) : []
  const prints = viewer === 'STAFF' || viewer === 'TEACHER' ? await prisma.passportPrint.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 20 }) : []
  const canManage = !family && (await canManageStudent(user, studentId))
  return {
    viewer, canManage, canPrint: canManage && viewer === 'STAFF',
    passport: { number: passport.number, issuedAt: passport.issuedAt },
    student: {
      id: studentId, name: `${student.firstName} ${student.lastName}`.trim(), nameAr: student.fullNameAr, reg: student.registrationNumber,
      photo: student.profilePicture, joinedAt: student.admissionDate, campus: student.campus?.name ?? '', cardCode: student.idCardQRCode,
    },
    cover: (trackId && settings.trackColors[trackId]) || '#1e3a8a',
    stamps: stamps.map((s) => ({
      id: s.id, stampId: s.stampId, nameEn: s.stamp.nameEn, nameAr: s.stamp.nameAr || s.stamp.nameEn, icon: s.stamp.icon, shape: s.stamp.shape,
      color: s.color || s.stamp.color, label: s.label, awardedAt: s.awardedAt, source: s.source, note: s.note, isNew: unseen.includes(s.id),
    })),
    manualStamps: canManage ? available.filter((s) => s.kind === 'MANUAL' && canGive(s.givers, user.role)).map((s) => ({ id: s.id, nameEn: s.nameEn, nameAr: s.nameAr, icon: s.icon })) : [],
    certificates: certs.map((c) => ({ id: c.id, title: c.title, number: c.isRevealed || !family ? c.certificateNumber : null, issuedAt: c.issuedDate, revealed: c.isRevealed })),
    projects: projects.map((p) => { const t = projectTitles.find((x) => x.id === p.blockId); return { id: p.id, titleEn: t?.titleEn || 'Project', titleAr: t?.titleAr || t?.titleEn || 'مشروع', at: p.galleryAt } }),
    shares: shares.map((s) => ({ id: s.id, token: s.token, expiresAt: s.expiresAt, showProjects: s.showProjects, showPhoto: s.showPhoto, views: s.views })),
    prints: prints.map((p) => ({ kind: p.kind, copyNo: p.copyNo, price: p.price, at: p.createdAt })),
    shareDays: settings.shareDays, bookletPrice: settings.bookletPrice,
  }
}

// ───────────────────────── share links (parent only) ─────────────────────────

export async function createShare(user: User, studentId: string, opts: { showProjects: boolean; showPhoto: boolean; showSkills?: boolean; days?: number }): Promise<Outcome<{ token: string; expiresAt: Date }>> {
  if ((await studentViewer(user, studentId)) !== 'PARENT') return fail('FORBIDDEN', 'Only the parent can share the passport')
  await ensurePassport(studentId)
  const live = await prisma.passportShare.count({ where: { studentId, revokedAt: null, expiresAt: { gt: new Date() } } })
  if (live >= 10) return fail('LIMIT', 'Too many open links — remove one first')
  const settings = await getPassportSettings()
  const token = randomBytes(24).toString('base64url')
  const expiresAt = shareExpiry(new Date(), opts.days ?? settings.shareDays)
  await prisma.passportShare.create({ data: { studentId, token, showProjects: !!opts.showProjects, showPhoto: !!opts.showPhoto, showSkills: !!opts.showSkills, createdById: user.id, expiresAt } })
  return { ok: true, value: { token, expiresAt } }
}

export async function revokeShare(user: User, shareId: string): Promise<Outcome> {
  const s = await prisma.passportShare.findUnique({ where: { id: shareId } })
  if (!s || s.createdById !== user.id) return fail('NOT_FOUND', 'Link not found')
  await prisma.passportShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } })
  return { ok: true }
}

/** Public page of a share link: identity, stamps, certificates (+ projects / photo when the parent chose). */
export async function publicShare(token: string) {
  const s = await prisma.passportShare.findUnique({ where: { token } })
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null
  await prisma.passportShare.update({ where: { id: s.id }, data: { views: { increment: 1 } } })
  const [passport, student, stamps, certs, projects] = await Promise.all([
    prisma.studentPassport.findUnique({ where: { studentId: s.studentId } }),
    prisma.student.findUnique({ where: { id: s.studentId }, select: { firstName: true, lastName: true, profilePicture: true, admissionDate: true, campus: { select: { name: true } } } }),
    prisma.studentStamp.findMany({ where: { studentId: s.studentId }, orderBy: { awardedAt: 'asc' }, include: { stamp: true } }),
    prisma.certificate.findMany({ where: { studentId: s.studentId, status: 'VALID', isRevealed: true }, select: { title: true, certificateNumber: true, issuedDate: true } }),
    s.showProjects ? prisma.assignmentSubmission.findMany({ where: { studentId: s.studentId, galleryStatus: 'APPROVED' }, take: 12, select: { blockId: true } }) : Promise.resolve([]),
  ])
  if (!passport || !student) return null
  const titles = projects.length ? await prisma.curriculumBlock.findMany({ where: { id: { in: projects.map((p) => p.blockId) } }, select: { titleEn: true, titleAr: true } }) : []
  // P2: the parent may add the skills chart (per course)
  let skills: { course: string; scores: { nameEn: string; nameAr: string; percent: number | null }[] }[] | null = null
  if (s.showSkills) {
    skills = []
    const groups = await prisma.studentEnrollment.findMany({ where: { studentId: s.studentId }, select: { classSectionId: true, classSection: { select: { level: { select: { subjectId: true, subject: { select: { name: true } } } } } } } })
    const byCourse = new Map<string, { name: string; ids: string[] }>()
    for (const g of groups) { const sub = g.classSection.level?.subjectId; if (!sub) continue; const x = byCourse.get(sub) ?? { name: g.classSection.level?.subject?.name ?? '', ids: [] }; x.ids.push(g.classSectionId); byCourse.set(sub, x) }
    for (const [subjectId, x] of byCourse) {
      const sk = await studentSkills(s.studentId, x.ids, subjectId).catch(() => null)
      const measured = (sk?.scores ?? []).filter((k) => k.percent != null)
      if (measured.length) skills.push({ course: x.name, scores: measured.map((k) => ({ nameEn: k.nameEn, nameAr: k.nameAr, percent: k.percent })) })
    }
  }
  return {
    skills,
    number: passport.number, name: `${student.firstName} ${student.lastName}`.trim(), campus: student.campus?.name ?? '', joinedAt: student.admissionDate,
    photo: s.showPhoto ? student.profilePicture : null, expiresAt: s.expiresAt,
    stamps: stamps.map((x) => ({ nameEn: x.stamp.nameEn, nameAr: x.stamp.nameAr || x.stamp.nameEn, icon: x.stamp.icon, shape: x.stamp.shape, color: x.color || x.stamp.color, label: x.label, awardedAt: x.awardedAt })),
    certificates: certs.map((c) => ({ title: c.title, number: c.certificateNumber, issuedAt: c.issuedDate })),
    projects: s.showProjects ? titles.map((t) => ({ titleEn: t.titleEn || 'Project', titleAr: t.titleAr || t.titleEn || 'مشروع' })) : null,
  }
}

// ───────────────────────── printing (staff only) ─────────────────────────

export const PRINT_KINDS = ['BOOKLET', 'PASSPORT_PDF', 'TRANSCRIPT'] as const

export async function logPrint(user: User, studentId: string, kind: (typeof PRINT_KINDS)[number]): Promise<Outcome<{ copyNo: number; price: number | null }>> {
  if (user.role === 'TEACHER' || !(await canManageStudent(user, studentId))) return fail('FORBIDDEN', 'Only branch staff print the passport')
  await ensurePassport(studentId)
  const copyNo = (await prisma.passportPrint.count({ where: { studentId, kind } })) + 1
  const price = kind === 'BOOKLET' ? (await getPassportSettings()).bookletPrice : null
  await prisma.passportPrint.create({ data: { studentId, kind, copyNo, price, printedById: user.id } })
  return { ok: true, value: { copyNo, price } }
}

/** Data for the printable booklet / passport / transcript (staff only). */
export async function printData(user: User, studentId: string) {
  if (user.role === 'TEACHER' || !(await canManageStudent(user, studentId))) return null
  const view = await passportView(user, studentId)
  if (!view) return null
  const results = await prisma.studentLevelResult.findMany({
    where: { studentEnrollment: { studentId }, passed: { not: null } },
    orderBy: { updatedAt: 'asc' },
    select: { finalScore: true, passed: true, updatedAt: true, subject: { select: { name: true } }, studentEnrollment: { select: { classSection: { select: { level: { select: { name: true } } } } } } },
  })
  const settings = await getPassportSettings()
  return {
    ...view,
    transcript: results.map((r) => ({ course: r.subject?.name ?? '', level: r.studentEnrollment.classSection.level?.name ?? '', finalScore: r.finalScore, passed: r.passed, date: r.updatedAt })),
    companyStamp: settings.companyStampUrl, signature: settings.signatureUrl, signatureName: settings.signatureName,
  }
}
