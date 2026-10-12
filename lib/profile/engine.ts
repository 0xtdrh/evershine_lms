/**
 * P2 profile (the student as a person). Server-only. Pure rules: lib/profile/rules.ts.
 * Shows: TechNova map + next step, goals, skills, projects (gallery + uploads), "first times" album, instructor
 * quotes, inventor's diary, thank-you notes, experience, the yearly recap; plus the portfolio for older students.
 * Who: the student (own), the parent, the student's instructors and branch staff (studentViewer). Media are private
 * Cloudinary files shown through signed links.
 */

import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { generateAuthenticatedUploadSignature, curriculumMediaUrl, getBaseUploadFolder } from '@/lib/cloudinary'
import { studentViewer } from '@/lib/students/access'
import { canManageGroupLessons } from '@/lib/lms/engine'
import { studentSkills } from '@/lib/reports/lms-summary'
import { canManageStudent } from '@/lib/passport/engine'
import { notifyFamilies, notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import {
  PROFILE_DEFAULTS, PROFILE_UPLOAD_FORMATS, ageOn, buildMap, checkUpload, goalProgress, recapWeek,
  type GoalMetric, type ProfileSettings, type UploadMedia,
} from './rules'

type User = { id: string; role: string; campusId?: string | null }
export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })
const DAY = 86_400_000

const KEY = 'profile.settings'
export const getProfileSettings = async (): Promise<ProfileSettings> => ({ ...PROFILE_DEFAULTS, ...(await getSetting<Partial<ProfileSettings>>(KEY, {})) })
export const saveProfileSettings = (v: ProfileSettings, userId: string) => setSetting(KEY, v, userId)
export const profileFolder = (studentId: string) => `${getBaseUploadFolder()}/profile/${studentId}`

const mediaUrl = (m: unknown) => {
  const x = m as UploadMedia | null
  if (!x?.publicId) return null
  try { return { url: curriculumMediaUrl(x.publicId, x.resourceType, x.format), type: x.resourceType } } catch { return null }
}

// ───────────────────────── numbers the goals count ─────────────────────────

async function passedLevelIds(studentId: string): Promise<Set<string>> {
  const rows = await prisma.studentLevelResult.findMany({
    where: { passed: true, studentEnrollment: { studentId } },
    select: { studentEnrollment: { select: { classSection: { select: { currentCycleNumber: true, level: { select: { id: true, numberOfMonths: true, pricingType: true } } } } } } },
  })
  return new Set(rows.map((r) => r.studentEnrollment.classSection).filter((g) => g.level && (g.level.pricingType === 'FULL_LEVEL' || g.currentCycleNumber >= g.level.numberOfMonths)).map((g) => g.level!.id))
}

export async function metricValue(studentId: string, metric: GoalMetric): Promise<number> {
  if (metric === 'SESSIONS') return prisma.enrollmentAttendanceRecord.count({ where: { studentEnrollment: { studentId }, status: { in: ['PRESENT', 'LATE'] } } })
  if (metric === 'STAMPS') return prisma.studentStamp.count({ where: { studentId } })
  if (metric === 'HOMEWORK') return prisma.assignmentSubmission.count({ where: { studentId, status: { not: 'DRAFT' } } })
  if (metric === 'QUIZ90') {
    const atts = await prisma.quizAttempt.findMany({ where: { studentId, status: 'GRADED' }, select: { blockId: true, score: true, maxScore: true } })
    const best = new Map<string, number>()
    for (const a of atts) if (a.score != null && a.maxScore) best.set(a.blockId, Math.max(best.get(a.blockId) ?? 0, (a.score / a.maxScore) * 100))
    return [...best.values()].filter((p) => p >= 90).length
  }
  return 0
}

// ───────────────────────── the profile ─────────────────────────

export async function profileView(user: User, studentId: string) {
  const viewer = await studentViewer(user, studentId)
  if (!viewer) return null
  const settings = await getProfileSettings()
  const now = new Date()
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, dateOfBirth: true, admissionDate: true, profilePicture: true, campus: { select: { name: true } } } })
  if (!student) return null
  const age = ageOn(student.dateOfBirth, now)
  const older = age >= settings.olderAge
  const staffManage = viewer !== 'STUDENT' && viewer !== 'PARENT' && (await canManageStudent(user, studentId))

  const [tracks, passed, activeEnr, goals, moments, diary, thanks, myThanks, experience, uploads, gallery, quotes] = await Promise.all([
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true, minAge: true, maxAge: true, courses: { where: { isActive: true }, select: { id: true, name: true, trackOrder: true, levels: { select: { id: true, name: true, order: true } } } } } }),
    passedLevelIds(studentId),
    prisma.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE', classSection: { status: 'ACTIVE' } }, select: { classSectionId: true, classSection: { select: { levelId: true, className: true, sectionName: true } } } }),
    prisma.studentGoal.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } }),
    prisma.profileMoment.findMany({ where: { studentId }, orderBy: { takenAt: 'desc' } }),
    prisma.diaryEntry.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.thankNote.findMany({ where: { toStudentId: studentId, status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 30 }),
    viewer === 'STUDENT' ? prisma.thankNote.findMany({ where: { fromStudentId: studentId }, orderBy: { createdAt: 'desc' }, take: 20 }) : Promise.resolve([]),
    prisma.studentExperience.findMany({ where: { studentId }, orderBy: { fromDate: 'desc' } }),
    prisma.projectUpload.findMany({ where: { studentId, ...(staffManage || viewer === 'STUDENT' ? {} : { status: 'APPROVED' }) }, orderBy: { createdAt: 'desc' }, take: 40 }),
    prisma.assignmentSubmission.findMany({ where: { studentId, galleryStatus: 'APPROVED' }, orderBy: { galleryAt: 'desc' }, take: 20, select: { id: true, blockId: true, galleryAt: true } }),
    prisma.sessionReportStudent.findMany({ where: { studentId, report: { status: 'SENT' }, comment: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 10, select: { comment: true, report: { select: { sessionDate: true } } } }),
  ])
  const current = new Set(activeEnr.map((e) => e.classSection.levelId).filter((x): x is string => !!x))
  const map = buildMap(tracks.map((t) => ({ ...t, courses: t.courses.map((c) => ({ id: c.id, name: c.name, order: c.trackOrder, levels: c.levels })) })), passed, current, age)

  // goals with progress
  const metrics = new Map<string, number>()
  const goalRows = []
  for (const g of goals) {
    let cur: number | null = null
    if (g.kind === 'SYSTEM' && g.metric && g.metric !== 'LEVEL') {
      if (!metrics.has(g.metric)) metrics.set(g.metric, await metricValue(studentId, g.metric as GoalMetric))
      cur = metrics.get(g.metric)!
    }
    const pr = goalProgress(g, cur, g.levelId ? passed.has(g.levelId) : false)
    if (pr.done && !g.doneAt) await prisma.studentGoal.update({ where: { id: g.id }, data: { doneAt: now } }).catch(() => undefined)
    goalRows.push({ id: g.id, title: g.title, kind: g.kind, metric: g.metric, dueDate: g.dueDate, createdByRole: g.createdByRole, ...pr, doneAt: g.doneAt ?? (pr.done ? now : null) })
  }

  // skills per course (groups of that course)
  const groups = await prisma.studentEnrollment.findMany({ where: { studentId }, select: { classSectionId: true, classSection: { select: { level: { select: { subjectId: true, subject: { select: { name: true } } } } } } } })
  const byCourse = new Map<string, { name: string; ids: string[] }>()
  for (const g of groups) {
    const sub = g.classSection.level?.subjectId
    if (!sub) continue
    const x = byCourse.get(sub) ?? { name: g.classSection.level?.subject?.name ?? '', ids: [] }
    x.ids.push(g.classSectionId); byCourse.set(sub, x)
  }
  const skills = []
  for (const [subjectId, x] of byCourse) {
    const sk = await studentSkills(studentId, x.ids, subjectId).catch(() => null)
    if (sk?.scores.some((s) => s.percent != null)) skills.push({ course: x.name, ...sk })
  }

  const galleryTitles = gallery.length ? await prisma.curriculumBlock.findMany({ where: { id: { in: gallery.map((g) => g.blockId) } }, select: { id: true, titleEn: true, titleAr: true } }) : []
  const fromNames = thanks.length ? await prisma.student.findMany({ where: { id: { in: thanks.map((t) => t.fromStudentId) } }, select: { id: true, firstName: true } }) : []
  const classmates = viewer === 'STUDENT' && settings.thanksOn && activeEnr.length
    ? (await prisma.studentEnrollment.findMany({ where: { classSectionId: { in: activeEnr.map((e) => e.classSectionId) }, status: 'ACTIVE', studentId: { not: studentId } }, select: { classSectionId: true, student: { select: { id: true, firstName: true } } } }))
        .map((e) => ({ id: e.student.id, name: e.student.firstName, groupId: e.classSectionId }))
    : []
  const recapYears = recapWeek(student.admissionDate, now)

  return {
    viewer, age, older,
    student: { id: studentId, name: `${student.firstName} ${student.lastName}`.trim(), photo: student.profilePicture, campus: student.campus?.name ?? '', joinedAt: student.admissionDate },
    can: {
      goal: true,
      upload: settings.uploadsOn && (staffManage || (viewer === 'STUDENT' && older)),
      diary: settings.diaryOn && viewer === 'STUDENT' && older,
      thank: settings.thanksOn && viewer === 'STUDENT' && classmates.length > 0,
      moment: staffManage,
      experience: staffManage && ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(user.role),
      portfolio: (staffManage && user.role !== 'TEACHER') || (viewer === 'PARENT' && settings.parentPortfolio && older),
      interest: viewer === 'PARENT',
    },
    map, goals: goalRows, skills,
    projects: [
      ...gallery.map((g) => { const t = galleryTitles.find((x) => x.id === g.blockId); return { id: `g-${g.id}`, source: 'GALLERY', titleEn: t?.titleEn || 'Project', titleAr: t?.titleAr || t?.titleEn || 'مشروع', status: 'APPROVED', media: null as ReturnType<typeof mediaUrl>, at: g.galleryAt } }),
      ...uploads.map((u) => ({ id: u.id, source: 'UPLOAD', titleEn: u.title, titleAr: u.title, status: u.status, media: mediaUrl(u.media), at: u.createdAt, description: u.description })),
    ],
    moments: moments.map((m) => ({ id: m.id, title: m.title, note: m.note, takenAt: m.takenAt, media: mediaUrl(m.media) })),
    quotes: quotes.map((q) => ({ text: q.comment!, date: q.report.sessionDate })),
    diary: older ? diary.map((d) => ({ id: d.id, text: d.text, at: d.createdAt })) : [],
    thanks: thanks.map((t) => ({ id: t.id, from: fromNames.find((s) => s.id === t.fromStudentId)?.firstName ?? '', text: t.text, at: t.createdAt })),
    myThanks: myThanks.map((t) => ({ id: t.id, text: t.text, status: t.status, at: t.createdAt })),
    classmates,
    experience: experience.map((e) => ({ id: e.id, role: e.role, titleEn: e.titleEn, titleAr: e.titleAr, from: e.fromDate, to: e.toDate })),
    recap: recapYears ? { years: recapYears } : null,
    activeGroups: activeEnr.map((e) => ({ id: e.classSectionId, label: `${e.classSection.className} ${e.classSection.sectionName}`.trim() })),
  }
}

// ───────────────────────── goals ─────────────────────────

async function mayEdit(user: User, studentId: string) {
  const v = await studentViewer(user, studentId)
  if (v === 'STUDENT' || v === 'PARENT') return true
  return !!v && (await canManageStudent(user, studentId))
}

export async function addGoal(user: User, studentId: string, g: { title: string; kind: 'SYSTEM' | 'FREE'; metric?: GoalMetric | null; target?: number | null; levelId?: string | null; dueDate?: string | null }): Promise<Outcome<{ id: string }>> {
  if (!(await mayEdit(user, studentId))) return fail('FORBIDDEN', 'Not allowed')
  if ((await prisma.studentGoal.count({ where: { studentId, doneAt: null } })) >= 10) return fail('LIMIT', 'Finish or remove a goal first (10 open goals at most)')
  const baseline = g.kind === 'SYSTEM' && g.metric && g.metric !== 'LEVEL' ? await metricValue(studentId, g.metric) : null
  const row = await prisma.studentGoal.create({
    data: { studentId, title: g.title, kind: g.kind, metric: g.kind === 'SYSTEM' ? g.metric ?? null : null, target: g.kind === 'SYSTEM' && g.metric !== 'LEVEL' ? g.target ?? null : null, baseline, levelId: g.metric === 'LEVEL' ? g.levelId ?? null : null, dueDate: g.dueDate ? new Date(g.dueDate) : null, createdById: user.id, createdByRole: user.role },
  })
  return { ok: true, value: { id: row.id } }
}

export async function updateGoal(user: User, goalId: string, input: { progress?: number; remove?: boolean }): Promise<Outcome> {
  const g = await prisma.studentGoal.findUnique({ where: { id: goalId } })
  if (!g || !(await mayEdit(user, g.studentId))) return fail('NOT_FOUND', 'Goal not found')
  if (input.remove) { await prisma.studentGoal.delete({ where: { id: goalId } }); return { ok: true } }
  if (g.kind !== 'FREE' || input.progress == null) return fail('INVALID', 'Only a free goal is moved by hand')
  const p = Math.max(0, Math.min(100, Math.round(input.progress)))
  await prisma.studentGoal.update({ where: { id: goalId }, data: { progress: p, doneAt: p >= 100 ? g.doneAt ?? new Date() : null } })
  return { ok: true }
}

// ───────────────────────── diary, thanks, moments, experience ─────────────────────────

export async function addDiary(user: User, studentId: string, text: string): Promise<Outcome> {
  const s = await getProfileSettings()
  if ((await studentViewer(user, studentId)) !== 'STUDENT' || !s.diaryOn) return fail('FORBIDDEN', 'The diary is written by the student')
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { dateOfBirth: true } })
  if (!st || ageOn(st.dateOfBirth, new Date()) < s.olderAge) return fail('FORBIDDEN', `The diary is for students from ${s.olderAge}`)
  if ((await prisma.diaryEntry.count({ where: { studentId, createdAt: { gte: new Date(Date.now() - DAY) } } })) >= 5) return fail('LIMIT', 'Enough for today')
  await prisma.diaryEntry.create({ data: { studentId, text: text.trim().slice(0, 500) } })
  return { ok: true }
}

export async function sendThanks(user: User, fromStudentId: string, toStudentId: string, text: string): Promise<Outcome> {
  const s = await getProfileSettings()
  if (!s.thanksOn || (await studentViewer(user, fromStudentId)) !== 'STUDENT') return fail('FORBIDDEN', 'Thank-you notes are sent by students')
  if (fromStudentId === toStudentId) return fail('INVALID', 'Choose a classmate')
  const mine = await prisma.studentEnrollment.findMany({ where: { studentId: fromStudentId, status: 'ACTIVE' }, select: { classSectionId: true } })
  const shared = await prisma.studentEnrollment.findFirst({ where: { studentId: toStudentId, status: 'ACTIVE', classSectionId: { in: mine.map((m) => m.classSectionId) } }, select: { classSectionId: true } })
  if (!shared) return fail('INVALID', 'You can thank classmates of your groups')
  if ((await prisma.thankNote.count({ where: { fromStudentId, createdAt: { gte: new Date(Date.now() - 7 * DAY) } } })) >= 5) return fail('LIMIT', '5 thank-you notes a week')
  await prisma.thankNote.create({ data: { fromStudentId, toStudentId, classSectionId: shared.classSectionId, text: text.trim().slice(0, 300) } })
  return { ok: true }
}

/** Instructor / managers approve or refuse a thank-you note or a student's upload. */
export async function decide(user: User, what: 'THANKS' | 'UPLOAD', id: string, approve: boolean): Promise<Outcome> {
  if (what === 'THANKS') {
    const t = await prisma.thankNote.findUnique({ where: { id } })
    if (!t || t.status !== 'PENDING') return fail('NOT_FOUND', 'Note not found')
    if (!(await canManageGroupLessons(user, t.classSectionId))) return fail('FORBIDDEN', 'Not your group')
    await prisma.thankNote.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date() } })
    if (approve) await notifyFamilies([t.toStudentId], 'PROFILE_UPDATE', (s) => ({ title: 'A thank-you note', message: `${s.firstName} got a thank-you note from a classmate.`, relatedId: t.toStudentId }), { includeStudent: true })
    return { ok: true }
  }
  const u = await prisma.projectUpload.findUnique({ where: { id } })
  if (!u || u.status !== 'PENDING') return fail('NOT_FOUND', 'Upload not found')
  if (!(u.classSectionId ? await canManageGroupLessons(user, u.classSectionId) : await canManageStudent(user, u.studentId)) || user.role === 'SECRETARY') return fail('FORBIDDEN', 'Not your student')
  await prisma.projectUpload.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date() } })
  return { ok: true }
}

export async function pendingApprovals(user: User) {
  const role = user.role as Role
  if (!['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'].includes(role)) return { thanks: [], uploads: [] }
  const [thanks, uploads] = await Promise.all([
    prisma.thankNote.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100 }),
    prisma.projectUpload.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 100 }),
  ])
  const okThanks = [], okUploads = []
  for (const t of thanks) if (await canManageGroupLessons(user, t.classSectionId)) okThanks.push(t)
  for (const u of uploads) if (u.classSectionId ? await canManageGroupLessons(user, u.classSectionId) : await canManageStudent(user, u.studentId)) okUploads.push(u)
  const ids = [...new Set([...okThanks.flatMap((t) => [t.fromStudentId, t.toStudentId]), ...okUploads.map((u) => u.studentId)])]
  const names = await prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
  const nm = (id: string) => { const s = names.find((x) => x.id === id); return s ? `${s.firstName} ${s.lastName}`.trim() : '' }
  return {
    thanks: okThanks.map((t) => ({ id: t.id, from: nm(t.fromStudentId), to: nm(t.toStudentId), text: t.text, at: t.createdAt })),
    uploads: okUploads.map((u) => ({ id: u.id, student: nm(u.studentId), title: u.title, description: u.description, media: mediaUrl(u.media), at: u.createdAt })),
  }
}

export async function addMoment(user: User, studentId: string, input: { title: string; note?: string | null; takenAt?: string | null; media?: UploadMedia | null }): Promise<Outcome> {
  if (!(await canManageStudent(user, studentId))) return fail('FORBIDDEN', 'Staff add album moments')
  if (input.media) { const c = checkUpload(input.media, profileFolder(studentId), await getProfileSettings()); if (!c.ok) return fail('INVALID', c.message!) }
  await prisma.profileMoment.create({ data: { studentId, title: input.title.slice(0, 160), note: input.note?.slice(0, 500) || null, takenAt: input.takenAt ? new Date(input.takenAt) : new Date(), media: (input.media ?? undefined) as unknown as Prisma.InputJsonValue | undefined, createdById: user.id } })
  await notifyFamilies([studentId], 'PROFILE_UPDATE', (s) => ({ title: 'New in the album', message: `${s.firstName}: ${input.title}`, relatedId: studentId }), { includeStudent: true })
  return { ok: true }
}

export async function addExperience(user: User, studentId: string, input: { role: string; titleEn?: string | null; titleAr?: string | null; from: string; to?: string | null }): Promise<Outcome> {
  if (!['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(user.role) || !(await canManageStudent(user, studentId))) return fail('FORBIDDEN', 'Managers record experience')
  await prisma.studentExperience.create({ data: { studentId, role: input.role, titleEn: input.titleEn || null, titleAr: input.titleAr || null, fromDate: new Date(input.from), toDate: input.to ? new Date(input.to) : null, createdById: user.id } })
  return { ok: true }
}

export async function removeExperience(user: User, id: string): Promise<Outcome> {
  const e = await prisma.studentExperience.findUnique({ where: { id } })
  if (!e || !['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER'].includes(user.role) || !(await canManageStudent(user, e.studentId))) return fail('NOT_FOUND', 'Not found')
  await prisma.studentExperience.delete({ where: { id } })
  return { ok: true }
}

// ───────────────────────── uploads ─────────────────────────

async function uploader(user: User, studentId: string): Promise<'STAFF' | 'STUDENT' | null> {
  const s = await getProfileSettings()
  if (!s.uploadsOn) return null
  if (user.role !== 'SECRETARY' && (await canManageStudent(user, studentId))) return 'STAFF'
  if ((await studentViewer(user, studentId)) !== 'STUDENT') return null
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { dateOfBirth: true } })
  return st && ageOn(st.dateOfBirth, new Date()) >= s.olderAge ? 'STUDENT' : null
}

export async function uploadSignature(user: User, studentId: string, forMoment = false): Promise<Outcome<ReturnType<typeof generateAuthenticatedUploadSignature>>> {
  const who = forMoment ? ((await canManageStudent(user, studentId)) ? 'STAFF' : null) : await uploader(user, studentId)
  if (!who) return fail('FORBIDDEN', 'Not allowed to upload here')
  return { ok: true, value: generateAuthenticatedUploadSignature(profileFolder(studentId), PROFILE_UPLOAD_FORMATS) }
}

export async function addUpload(user: User, studentId: string, input: { title: string; description?: string | null; groupId?: string | null; media: UploadMedia }): Promise<Outcome<{ status: string }>> {
  const who = await uploader(user, studentId)
  if (!who) return fail('FORBIDDEN', 'Not allowed to upload here')
  const c = checkUpload(input.media, profileFolder(studentId), await getProfileSettings())
  if (!c.ok) return fail('INVALID', c.message!)
  const groupId = input.groupId && (await prisma.studentEnrollment.count({ where: { studentId, classSectionId: input.groupId } })) ? input.groupId : (await prisma.studentEnrollment.findFirst({ where: { studentId, status: 'ACTIVE' }, select: { classSectionId: true } }))?.classSectionId ?? null
  const status = who === 'STAFF' ? 'APPROVED' : 'PENDING'
  await prisma.projectUpload.create({ data: { studentId, classSectionId: groupId, title: input.title.slice(0, 160), description: input.description?.slice(0, 500) || null, media: input.media as unknown as Prisma.InputJsonValue, uploaderRole: user.role, uploadedById: user.id, status, ...(status === 'APPROVED' ? { decidedById: user.id, decidedAt: new Date() } : {}) } })
  return { ok: true, value: { status } }
}

// ───────────────────────── interest in a level (map) ─────────────────────────

export async function levelInterest(user: User, studentId: string, levelId: string): Promise<Outcome> {
  if ((await studentViewer(user, studentId)) !== 'PARENT') return fail('FORBIDDEN', 'Only the parent books')
  const l = await prisma.level.findUnique({ where: { id: levelId }, select: { id: true, name: true, subjectId: true } })
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true, firstName: true, lastName: true } })
  if (!l || !st) return fail('NOT_FOUND', 'Level not found')
  const exists = await prisma.waitingListEntry.findFirst({ where: { studentId, levelId, status: 'WAITING' } })
  if (!exists) await prisma.waitingListEntry.create({ data: { studentId, subjectId: l.subjectId, levelId, campusId: st.campusId, notes: 'Parent asked from the TechNova map (profile).', createdById: user.id } })
  try {
    await notifyUsers(await usersWithPermission('renewals', 'update', st.campusId), 'NEXT_LEVEL_WISH', { title: 'Level wanted', message: `${st.firstName} ${st.lastName}: the parent wants ${l.name} (TechNova map). See the waiting list.`, relatedId: studentId })
  } catch { /* never break */ }
  return { ok: true }
}

// ───────────────────────── yearly recap + portfolio ─────────────────────────

export async function recap(user: User, studentId: string) {
  if (!(await studentViewer(user, studentId))) return null
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, admissionDate: true } })
  if (!st) return null
  const since = new Date(Date.now() - 365 * DAY)
  const [sessions, stamps, certs, gallery, uploads, quotes] = await Promise.all([
    prisma.enrollmentAttendanceRecord.count({ where: { studentEnrollment: { studentId }, status: { in: ['PRESENT', 'LATE'] }, attendanceDate: { gte: since } } }),
    prisma.studentStamp.findMany({ where: { studentId, awardedAt: { gte: since } }, include: { stamp: true }, orderBy: { awardedAt: 'asc' } }),
    prisma.certificate.count({ where: { studentId, issuedDate: { gte: since }, status: 'VALID' } }),
    prisma.assignmentSubmission.count({ where: { studentId, galleryStatus: 'APPROVED', galleryAt: { gte: since } } }),
    prisma.projectUpload.count({ where: { studentId, status: 'APPROVED', createdAt: { gte: since } } }),
    prisma.sessionReportStudent.findMany({ where: { studentId, report: { status: 'SENT', sessionDate: { gte: since } }, comment: { not: null } }, take: 3, orderBy: { updatedAt: 'desc' }, select: { comment: true } }),
  ])
  return {
    name: st.firstName, years: Math.max(1, new Date().getUTCFullYear() - st.admissionDate.getUTCFullYear()),
    sessions, hours: Math.round(sessions * 1.5), projects: gallery + uploads, certificates: certs,
    stamps: stamps.map((s) => ({ nameEn: s.stamp.nameEn, nameAr: s.stamp.nameAr || s.stamp.nameEn, icon: s.stamp.icon, shape: s.stamp.shape, color: s.color || s.stamp.color, label: s.label, awardedAt: s.awardedAt })),
    quotes: quotes.map((q) => q.comment!),
  }
}

/** Daily: families whose child's join anniversary is today get the "year at TechNova" message (once a year). */
export async function anniversaryRecaps(now = new Date()) {
  const students = await prisma.student.findMany({ where: { isActive: true }, select: { id: true, admissionDate: true } })
  const today = students.filter((s) => s.admissionDate.getUTCMonth() === now.getUTCMonth() && s.admissionDate.getUTCDate() === now.getUTCDate() && s.admissionDate.getUTCFullYear() < now.getUTCFullYear())
  let sent = 0
  for (const s of today.slice(0, 500)) {
    const tag = `${s.id}:${now.getUTCFullYear()}`
    if (await prisma.notification.findFirst({ where: { type: 'PROFILE_RECAP', relatedId: tag }, select: { id: true } })) continue
    sent += await notifyFamilies([s.id], 'PROFILE_RECAP', (x) => ({ title: 'A year at TechNova 🎉', message: `${x.firstName} has another year at TechNova — open the profile to see the year in numbers.`, relatedId: tag }), { includeStudent: true })
  }
  return { students: today.length, sent }
}

export async function portfolioData(user: User, studentId: string) {
  const v = await profileView(user, studentId)
  if (!v || !v.can.portfolio) return null
  const [certs, stampCount] = await Promise.all([
    prisma.certificate.findMany({ where: { studentId, status: 'VALID', isRevealed: true }, select: { title: true, certificateNumber: true, issuedDate: true } }),
    prisma.studentStamp.count({ where: { studentId } }),
  ])
  return { ...v, certificates: certs, stampCount }
}
