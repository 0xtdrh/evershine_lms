/**
 * Phase C: family notifications about sessions — cancelled, substitute
 * instructor (no name, owner 2026-10-03), holiday. Never throws. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { cairoToday } from '@/lib/dates/cairo'
import { notifyFamilies } from './events'

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' })

async function groupStudents(classSectionId: string) {
  const [g, e] = await Promise.all([
    prisma.classSection.findUnique({ where: { id: classSectionId }, select: { className: true, sectionName: true, scheduleSlots: true } }),
    prisma.studentEnrollment.findMany({ where: { classSectionId, status: 'ACTIVE' }, select: { studentId: true } }),
  ])
  return { label: g ? `${g.className} ${g.sectionName}`.trim() : '', slots: cleanSlots(g?.scheduleSlots), ids: e.map((x) => x.studentId) }
}

export async function notifySessionCancelled(classSectionId: string, date: string, reason?: string | null) {
  try {
    if (date < cairoToday()) return
    const g = await groupStudents(classSectionId)
    await notifyFamilies(g.ids, 'SESSION_CANCELLED', (s) => ({
      title: 'Session cancelled',
      message: `${s.firstName}'s ${g.label} session on ${fmt(date)} is cancelled${reason ? ` (${reason})` : ''}. It will be made up — we will tell you the new date.`,
      relatedId: classSectionId,
    }))
  } catch (err) {
    console.error('[NOTIFY_SESSION_CANCELLED]', err)
  }
}

export async function notifySubstitute(classSectionId: string, date: string) {
  try {
    if (date < cairoToday()) return
    const g = await groupStudents(classSectionId)
    await notifyFamilies(g.ids, 'SESSION_SUBSTITUTE', (s) => ({
      title: 'Another instructor for one session',
      message: `${s.firstName}'s ${g.label} session on ${fmt(date)} will be given by another TechNova instructor. Same time, same place.`,
      relatedId: classSectionId,
    }))
  } catch (err) {
    console.error('[NOTIFY_SUBSTITUTE]', err)
  }
}

/** Families of groups (in that branch, or all for a company holiday) with a session on one of the days. */
export async function notifyHoliday(campusId: string | null, days: string[], name: string) {
  try {
    const upcoming = days.filter((d) => d >= cairoToday())
    if (!upcoming.length) return
    const groups = await prisma.classSection.findMany({
      where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, ...(campusId && { campusId }) },
      select: { id: true, className: true, sectionName: true, scheduleSlots: true },
    })
    for (const g of groups) {
      const slots = cleanSlots(g.scheduleSlots)
      const hit = upcoming.filter((d) => slots.some((s) => s.dayOfWeek === new Date(`${d}T00:00:00Z`).getUTCDay()))
      if (!hit.length) continue
      const ids = (await prisma.studentEnrollment.findMany({ where: { classSectionId: g.id, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId)
      const label = `${g.className} ${g.sectionName}`.trim()
      await notifyFamilies(ids, 'HOLIDAY', (s) => ({
        title: `Day off: ${name}`,
        message: `No ${label} session on ${hit.map(fmt).join(', ')}. ${s.firstName}'s session is postponed, not lost.`,
        relatedId: g.id,
      }))
    }
  } catch (err) {
    console.error('[NOTIFY_HOLIDAY]', err)
  }
}
