/** Six phases 1-C: a group's booking link /book/<groupId> — which course page books it, and how many came from it. */

import { prisma } from '@/lib/prisma'

/** The shown course page that holds this group's level: its course (sold alone) first, else its track. */
export async function listingForGroup(groupId: string): Promise<string | null> {
  const g = await prisma.classSection.findFirst({
    where: { id: groupId, status: 'ACTIVE', isActive: true, kind: 'GROUP' },
    select: { level: { select: { subjectId: true, subject: { select: { trackId: true } } } } },
  })
  if (!g?.level) return null
  const listings = await prisma.courseListing.findMany({
    where: { show: true, OR: [{ refType: 'COURSE', refId: g.level.subjectId }, ...(g.level.subject?.trackId ? [{ refType: 'TRACK', refId: g.level.subject.trackId }] : [])] },
    select: { slug: true, refType: true },
  })
  return (listings.find((l) => l.refType === 'COURSE') ?? listings[0])?.slug ?? null
}

export async function groupLinkStats(groupId: string) {
  const [slug, bookings, confirmed] = await Promise.all([
    listingForGroup(groupId),
    prisma.courseBooking.count({ where: { classSectionId: groupId, source: 'GROUP_LINK' } }),
    prisma.courseBooking.count({ where: { classSectionId: groupId, source: 'GROUP_LINK', status: 'CONFIRMED' } }),
  ])
  return { slug, path: `/book/${groupId}`, bookings, confirmed }
}
