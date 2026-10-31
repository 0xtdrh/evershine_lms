/**
 * GET /api/groups/[id]/curriculum — a02 (2026-10-31): the curricula of the group's level, the one chosen for the group
 * (null = automatic) and the one it actually reads now, and whether it can still change (only before the first session).
 * Change it with PATCH /api/groups/[id] { curriculumVariantId }.
 */

import { requireSession } from '@/lib/academic/api-helpers'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { canSeeGroup } from '@/lib/places/server'
import { levelVariants, variantForGroup } from '@/lib/curriculum/variants'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()
  const g = await prisma.classSection.findUnique({ where: { id }, select: { levelId: true, campusId: true, startDate: true, curriculumVariantId: true, curriculumEditionId: true } })
  if (!g) return errors.notFound('Group')
  const options = g.levelId ? await levelVariants(g.levelId) : []
  const pinned = g.curriculumEditionId ? await prisma.curriculumEdition.findUnique({ where: { id: g.curriculumEditionId }, select: { variantId: true, number: true } }) : null
  const reads = pinned ? pinned.variantId : await variantForGroup(g)
  return successResponse({
    chosen: g.curriculumVariantId,
    reads: reads ? { id: reads, name: options.find((o) => o.id === reads)?.name ?? '' } : null,
    version: pinned?.number ?? null,
    canChange: !g.startDate,
    options: options.map((o) => ({ id: o.id, name: o.name })),
  })
}
