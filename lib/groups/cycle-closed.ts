/**
 * Phase C: when a month (group) is closed by Advance cycle, tell the families:
 *  - the monthly report is ready (not for one-month levels: the level report covers them)
 *  - perfect attendance (no absence at all in the month)
 *  - please rate the month (parent survey)
 * Never throws. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cyclesInLevel } from './cycle-rules'
import { notifyFamilies } from '@/lib/notifications/events'
import { studentAttendanceTimeline } from '@/lib/attendance/timeline'

export async function onCycleClosed(classSectionId: string) {
  try {
    const g = await prisma.classSection.findUnique({
      where: { id: classSectionId },
      select: { className: true, sectionName: true, currentCycleNumber: true, level: { select: { name: true, numberOfMonths: true, numberOfSessions: true, pricingType: true, subject: { select: { name: true } } } } },
    })
    if (!g?.level) return
    const label = `${g.level.subject?.name ?? ''} ${g.level.name}`.trim()
    const enrollments = await prisma.studentEnrollment.findMany({ where: { classSectionId, status: 'ACTIVE' }, select: { studentId: true } })
    const ids = enrollments.map((e) => e.studentId)
    if (!ids.length) return

    if (cyclesInLevel(g.level) > 1) {
      await notifyFamilies(ids, 'REPORT_READY', (s) => ({
        title: 'Monthly report ready',
        message: `${s.firstName}'s report for ${label}, month ${g.currentCycleNumber}, is ready in the portal (Reports).`,
        relatedId: classSectionId,
      }))
    }

    const perfect: string[] = []
    for (const id of ids) {
      const t = await studentAttendanceTimeline(id, { groupIds: [classSectionId] })
      const row = t.groups[0]
      if (row && row.sessions.length && row.sessions.every((s) => s.status === 'PRESENT' || s.status === 'LATE')) perfect.push(id)
    }
    await notifyFamilies(perfect, 'PERFECT_ATTENDANCE', (s) => ({
      title: '★ Perfect attendance',
      message: `Well done ${s.firstName}! Not a single session missed in ${label}${cyclesInLevel(g.level!) > 1 ? `, month ${g.currentCycleNumber}` : ''}.`,
      relatedId: classSectionId,
    }), { includeStudent: true })

    await notifyFamilies(ids, 'FEEDBACK_REQUEST', (s) => ({
      title: 'How was this month?',
      message: `Please rate ${s.firstName}'s sessions, instructor and TechNova for ${label} — it takes 10 seconds (My Children → Your opinion).`,
      relatedId: classSectionId,
    }))
  } catch (err) {
    console.error('[CYCLE_CLOSED]', err)
  }
}
