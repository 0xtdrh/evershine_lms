/**
 * The inventor's journey, server side (rules: ./journey.ts). One call per profile view: the details behind every
 * station of the map, the title, the stars, what is left, the timeline and the islands still in the fog.
 * Never money. Results show only once final (passed set), as everywhere else.
 */

import { prisma } from '@/lib/prisma'
import { inventorTitle, levelStars, percent, timeline, whatIsLeft, type TimelineEvent } from './journey'

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')

export interface JourneyTrack { id: string; name: string; minAge: number | null; maxAge: number | null; courses: { id: string; name: string; levels: { id: string; name: string }[] }[] }

export async function journeyData(o: { studentId: string; joinedAt: Date | null; age: number | null; tracks: JourneyTrack[]; passed: Set<string>; current: Set<string>; nextLevelId: string | null }) {
  const enr = await prisma.studentEnrollment.findMany({
    where: { studentId: o.studentId, classSection: { levelId: { not: null } } },
    select: { id: true, classSectionId: true, classSection: { select: { levelId: true } } },
  })
  const enrIds = enr.map((e) => e.id)
  const gIds = [...new Set(enr.map((e) => e.classSectionId))]
  const touched = [...new Set(enr.map((e) => e.classSection.levelId!))]
  const levelIds = [...new Set([...touched, ...(o.nextLevelId ? [o.nextLevelId] : [])])]

  const [levels, records, results, subs, dues, quizzes, gallery, offerings, stamps] = await Promise.all([
    prisma.level.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true, numberOfSessions: true, numberOfMonths: true, subject: { select: { name: true } } } }),
    prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollmentId: { in: enrIds } }, select: { status: true, attendanceDate: true, studentEnrollmentId: true } }),
    prisma.studentLevelResult.findMany({ where: { studentEnrollmentId: { in: enrIds } }, select: { id: true, finalScore: true, passed: true, computedAt: true, studentEnrollmentId: true } }),
    prisma.assignmentSubmission.findMany({ where: { studentId: o.studentId, classSectionId: { in: gIds }, status: { not: 'DRAFT' } }, select: { classSectionId: true } }),
    prisma.assignmentDue.findMany({ where: { classSectionId: { in: gIds } }, select: { classSectionId: true } }),
    prisma.quizAttempt.findMany({ where: { studentId: o.studentId, classSectionId: { in: gIds }, status: 'GRADED' }, select: { classSectionId: true, score: true, maxScore: true } }),
    prisma.assignmentSubmission.findMany({ where: { studentId: o.studentId, classSectionId: { in: gIds }, galleryStatus: 'APPROVED' }, select: { classSectionId: true, galleryAt: true } }),
    prisma.subjectOffering.findMany({ where: { classSectionId: { in: gIds }, teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { classSectionId: true, teacher: { select: { firstName: true, lastName: true } } } }),
    prisma.studentStamp.findMany({ where: { studentId: o.studentId }, orderBy: { awardedAt: 'desc' }, take: 20, select: { awardedAt: true, label: true, stamp: { select: { nameEn: true, nameAr: true } } } }),
  ])
  // For the parent's summary: the last session report sent about this student.
  const lastRep = await prisma.sessionReportStudent.findFirst({ where: { studentId: o.studentId, report: { status: 'SENT' } }, orderBy: { report: { sessionDate: 'desc' } }, select: { reportId: true, report: { select: { sessionDate: true } } } })
  const certs = results.length ? await prisma.certificate.findMany({ where: { levelResultId: { in: results.map((r) => r.id) } }, select: { levelResultId: true, isRevealed: true, revealedAt: true, createdAt: true } }) : []

  const events: TimelineEvent[] = []
  // Joined = the earliest of the account date and the first session attended (old students are often added later).
  const firstRecord = records.reduce<Date | null>((a, r) => (!a || r.attendanceDate < a ? r.attendanceDate : a), null)
  const joined = [o.joinedAt, firstRecord].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]
  if (joined) events.push({ at: joined.toISOString(), kind: 'JOINED', en: 'Joined TechNova', ar: 'انضم لـ TechNova' })

  const details = levels.map((l) => {
    const myEnr = enr.filter((e) => e.classSection.levelId === l.id)
    const ids = new Set(myEnr.map((e) => e.id))
    const groups = new Set(myEnr.map((e) => e.classSectionId))
    const recs = records.filter((r) => ids.has(r.studentEnrollmentId)).sort((a, b) => a.attendanceDate.getTime() - b.attendanceDate.getTime())
    const attended = recs.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
    const res = results.filter((r) => ids.has(r.studentEnrollmentId)).sort((a, b) => (b.computedAt?.getTime() ?? 0) - (a.computedAt?.getTime() ?? 0))[0] ?? null
    const final = !!res && res.passed != null
    const cert = res ? certs.find((c) => c.levelResultId === res.id) : undefined
    const handed = subs.filter((s) => groups.has(s.classSectionId)).length
    const set = dues.filter((d) => groups.has(d.classSectionId)).length
    const qz = quizzes.filter((q) => groups.has(q.classSectionId) && q.maxScore)
    const quizPct = qz.length ? Math.round(qz.reduce((a, q) => a + (q.score ?? 0) / (q.maxScore as number), 0) / qz.length * 100) : null
    const teacher = offerings.find((x) => groups.has(x.classSectionId))?.teacher
    const state = o.passed.has(l.id) ? 'DONE' : o.current.has(l.id) ? 'CURRENT' : l.id === o.nextLevelId ? 'NEXT' : 'LATER'
    const label = `${l.subject?.name ?? ''} · ${l.name}`
    if (recs[0]) events.push({ at: recs[0].attendanceDate.toISOString(), kind: 'LEVEL_STARTED', en: `Started ${label}`, ar: `بدأ ${label}` })
    if (state === 'DONE' && res?.computedAt) events.push({ at: res.computedAt.toISOString(), kind: 'LEVEL_DONE', en: `Finished ${label}`, ar: `خلّص ${label}` })
    if (cert?.isRevealed) events.push({ at: (cert.revealedAt ?? cert.createdAt).toISOString(), kind: 'CERTIFICATE', en: `Certificate: ${label}`, ar: `شهادة ${label}` })
    return {
      levelId: l.id, course: l.subject?.name ?? '', name: l.name, state,
      stars: final && state === 'DONE' ? levelStars({ finalScore: res!.finalScore, passed: res!.passed }) : 0, // stars only once the whole level is finished
      finalScore: final && res!.finalScore != null ? Math.round(res!.finalScore) : null,
      attendancePct: percent(attended, recs.length),
      homework: { handed, set },
      quizPct,
      projects: gallery.filter((g) => groups.has(g.classSectionId)).length,
      certificate: cert ? (cert.isRevealed ? 'READY' : 'EARNED') : null,
      startedAt: ymd(recs[0]?.attendanceDate), endedAt: state === 'DONE' ? ymd(recs[recs.length - 1]?.attendanceDate) : '',
      teacher: teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : null,
      left: state === 'CURRENT' ? whatIsLeft({ totalSessions: l.numberOfSessions, heldSessions: recs.length, homeworkSet: set, homeworkHanded: handed, resultFinal: final }) : null,
      plan: { sessions: l.numberOfSessions, months: l.numberOfMonths },
    }
  })

  const firstProject = gallery.filter((g) => g.galleryAt).sort((a, b) => a.galleryAt!.getTime() - b.galleryAt!.getTime())[0]
  if (firstProject?.galleryAt) events.push({ at: firstProject.galleryAt.toISOString(), kind: 'PROJECT', en: 'First project in the gallery', ar: 'أول مشروع في المعرض' })
  for (const s of stamps) events.push({ at: s.awardedAt.toISOString(), kind: 'STAMP', en: `Stamp: ${s.label || s.stamp.nameEn}`, ar: `ختم: ${s.label || s.stamp.nameAr || s.stamp.nameEn}` })

  const touchedTracks = new Set(o.tracks.filter((t) => t.courses.some((c) => c.levels.some((l) => o.passed.has(l.id) || o.current.has(l.id)))).map((t) => t.id))
  const fits = (t: JourneyTrack) => o.age == null || ((t.minAge == null || o.age >= t.minAge) && (t.maxAge == null || o.age <= t.maxAge))
  const discover = o.tracks.filter((t) => !touchedTracks.has(t.id) && fits(t) && t.courses.some((c) => c.levels.length)).slice(0, 2)
    .map((t) => ({ id: t.id, name: t.name, firstLevelId: t.courses.find((c) => c.levels.length)?.levels[0]?.id ?? null, courses: t.courses.filter((c) => c.levels.length).map((c) => c.name).slice(0, 4), levels: t.courses.reduce((a, c) => a + c.levels.length, 0), ages: [t.minAge, t.maxAge] }))

  const done = details.filter((d) => d.state === 'DONE')
  return {
    title: inventorTitle(o.passed.size),
    stars: done.reduce((a, d) => a + d.stars, 0),
    levelsDone: o.passed.size,
    levels: details,
    timeline: timeline(events),
    discover,
    lastReport: lastRep ? { id: lastRep.reportId, date: ymd(lastRep.report.sessionDate) } : null,
  }
}
