/**
 * Partners part 1 (2026-10-16): sessions recorded without per-student attendance — classes without names (e.g. a
 * nursery class) mark "the session took place", and any group can record a session the partner cancelled.
 * Counted by the calendar, instructor per-session pay, cycle progress and partner statements.
 */

import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { findGroupInstructorOffering } from '@/lib/groups/instructor'
import { syncGroupProgress } from '@/lib/groups/sync-progress'

export const SESSION_LOG_STATUSES = ['HELD', 'CANCELLED_PARTNER', 'CANCELLED_TECHNOVA'] as const

export async function listSessionLogs(classSectionId: string) {
  return prisma.groupSessionLog.findMany({ where: { classSectionId }, orderBy: { sessionDate: 'desc' }, take: 200 })
}

export async function logSession(userId: string, classSectionId: string, input: { date: string; status: string; headcount?: number | null; note?: string | null }) {
  const group = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { id: true, unnamedHeadcount: true, status: true } })
  if (!group) return { ok: false as const, message: 'Group not found' }
  if (input.status === 'HELD' && group.unnamedHeadcount === null) return { ok: false as const, message: 'This group has names: record its sessions with attendance' }
  const sessionDate = new Date(`${input.date}T00:00:00.000Z`)
  if (Number.isNaN(sessionDate.getTime()) || sessionDate.getTime() > Date.now() + 86_400_000) return { ok: false as const, message: 'Choose a date that is not in the future' }
  const offering = await findGroupInstructorOffering(classSectionId, (await getActiveAcademicYear())?.id)
  const data = {
    status: input.status,
    headcount: input.status === 'HELD' ? (input.headcount ?? group.unnamedHeadcount) : null,
    taughtByTeacherId: input.status === 'HELD' ? (offering?.teacherId ?? null) : null,
    note: input.note?.trim() || null,
  }
  await prisma.groupSessionLog.upsert({
    where: { classSectionId_sessionDate: { classSectionId, sessionDate } },
    create: { classSectionId, sessionDate, ...data, createdById: userId },
    update: data,
  })
  if (input.status === 'HELD') await syncGroupProgress(classSectionId, userId)
  return { ok: true as const }
}

export async function deleteSessionLog(classSectionId: string, id: string) {
  const r = await prisma.groupSessionLog.deleteMany({ where: { id, classSectionId } })
  return r.count > 0
}
