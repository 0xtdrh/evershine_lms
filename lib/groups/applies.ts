/**
 * Which parts of the group window apply to THIS group (owner 21/11: a detail that does not fit must not show at all —
 * "cancelled by the partner" only in a partner's place, online / hybrid only where allowed, videos only when the
 * curriculum has them, waiting-for-payment only with that policy or someone waiting, the start / minimum only before
 * the start, the months only from month 2). Pure decision + one loader (server only).
 */

import { prisma } from '@/lib/prisma'
import { effectiveModes } from '@/lib/delivery/modes'
import { policyForGroup } from './entry'

export interface GroupApplies {
  /** partner place (or the no-names class is already on): number of children + "cancelled by the partner / TechNova" */
  partnerPlace: boolean
  /** a session may be given another way (online / hybrid) */
  otherModes: boolean
  /** the curriculum of this level has videos (watch minutes panel) */
  videos: boolean
  /** "join after payment" policy, or students waiting to pay */
  awaiting: boolean
  awaitingCount: number
  /** the group has not started yet: expected start / minimum / start anyway / cancel */
  beforeStart: boolean
  minStudents: number | null
  /** month 2 or later: the months list */
  months: boolean
}

export interface AppliesFacts {
  campusKind: string | null
  unnamedHeadcount: number | null
  modesFrom: string
  modes: string[]
  slotModes: string[]
  deliveryMode: string | null
  videoBlocks: number
  entry: string
  awaitingCount: number
  startDate: Date | string | null
  cancelledAt: Date | string | null
  status: string
  minStudents: number | null
  currentCycleNumber: number
}

export function decideApplies(f: AppliesFacts): GroupApplies {
  const explicitOnline = f.modesFrom !== 'DEFAULT' && f.modes.includes('ONLINE')
  return {
    partnerPlace: f.campusKind === 'PARTNER' || f.unnamedHeadcount !== null,
    otherModes: f.campusKind === 'ONLINE' || explicitOnline || f.slotModes.some((m) => m && m !== 'BRANCH') || (!!f.deliveryMode && f.deliveryMode !== 'PHYSICAL'),
    videos: f.videoBlocks > 0,
    awaiting: f.entry === 'AFTER_PAYMENT' || f.awaitingCount > 0,
    awaitingCount: f.awaitingCount,
    beforeStart: f.status === 'ACTIVE' && !f.startDate && !f.cancelledAt,
    minStudents: f.minStudents,
    months: f.currentCycleNumber > 1,
  }
}

export async function groupApplies(groupId: string): Promise<GroupApplies> {
  const g = await prisma.classSection.findUnique({
    where: { id: groupId },
    select: {
      status: true, startDate: true, cancelledAt: true, currentCycleNumber: true, unnamedHeadcount: true, scheduleSlots: true, deliveryMode: true, levelId: true,
      campus: { select: { kind: true } },
      level: { select: { allowedModes: true, subject: { select: { allowedModes: true, track: { select: { allowedModes: true } } } } } },
    },
  })
  if (!g) throw new Error('Group not found')
  const { modes, from } = effectiveModes({ level: g.level?.allowedModes, course: g.level?.subject?.allowedModes, track: g.level?.subject?.track?.allowedModes })
  const slotModes = Array.isArray(g.scheduleSlots) ? (g.scheduleSlots as { mode?: string }[]).map((s) => String(s?.mode ?? 'BRANCH')) : []
  const [policy, awaitingCount, videoBlocks] = await Promise.all([
    policyForGroup(groupId).catch(() => null),
    prisma.studentEnrollment.count({ where: { classSectionId: groupId, status: 'AWAITING_PAYMENT' } }),
    g.levelId ? countVideos(g.levelId) : Promise.resolve(0),
  ])
  return decideApplies({
    campusKind: g.campus?.kind ?? null, unnamedHeadcount: g.unnamedHeadcount, modesFrom: from, modes: [...modes], slotModes,
    deliveryMode: g.deliveryMode ?? null, videoBlocks, entry: policy?.entry ?? 'NOW', awaitingCount,
    startDate: g.startDate, cancelledAt: g.cancelledAt, status: g.status, minStudents: policy?.minStudents ?? null, currentCycleNumber: g.currentCycleNumber,
  })
}

async function countVideos(levelId: string): Promise<number> {
  const editions = await prisma.curriculumEdition.findMany({ where: { levelId, status: 'PUBLISHED' }, select: { id: true } })
  if (!editions.length) return 0
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId: { in: editions.map((e) => e.id) } }, select: { id: true } })
  if (!sessions.length) return 0
  return prisma.curriculumBlock.count({ where: { sessionId: { in: sessions.map((s) => s.id) }, type: 'VIDEO' } })
}
