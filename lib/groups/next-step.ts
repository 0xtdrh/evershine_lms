/**
 * What comes after a group's current cycle:
 *  - another month of the same level (MONTHLY levels, not the last month), or
 *  - the next level of the same course, or
 *  - the first level of the next course in the track, or
 *  - nothing (the track is finished).
 *
 * Shared by POST /api/groups/[id]/advance-cycle and the waiting list
 * ("finished and did not continue" -> which level should they join next).
 */

import { prisma } from '@/lib/prisma'

export interface CurrentLevel {
  id: string
  subjectId: string
  order: number
  numberOfMonths: number
  pricingType: 'MONTHLY' | 'FULL_LEVEL'
  subject: { trackId: string | null; trackOrder: number | null }
}

const levelWithSubject = { subject: true } as const

export async function getNextStep(level: CurrentLevel, cycleNumber: number) {
  const isLastMonthOfLevel = level.pricingType === 'FULL_LEVEL' || cycleNumber >= level.numberOfMonths

  if (!isLastMonthOfLevel) {
    const same = await prisma.level.findUnique({ where: { id: level.id }, include: levelWithSubject })
    return same ? { kind: 'NEXT_MONTH' as const, level: same, cycleNumber: cycleNumber + 1 } : null
  }

  let next = await prisma.level.findFirst({
    where: { subjectId: level.subjectId, order: level.order + 1 },
    include: levelWithSubject,
  })
  if (!next && level.subject.trackId && level.subject.trackOrder != null) {
    const nextCourse = await prisma.academicSubject.findFirst({
      where: { trackId: level.subject.trackId, trackOrder: level.subject.trackOrder + 1 },
    })
    if (nextCourse) {
      next = await prisma.level.findFirst({
        where: { subjectId: nextCourse.id },
        orderBy: { order: 'asc' },
        include: levelWithSubject,
      })
    }
  }
  return next ? { kind: 'NEXT_LEVEL' as const, level: next, cycleNumber: 1 } : null
}
