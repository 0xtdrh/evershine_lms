/**
 * a02 M1 batch 1b (2026-10-31) — several curricula per level (server). The rule that picks one: lib/delivery/variants.ts.
 * Every "newest published version" lookup for a group goes through here, so a group only ever moves within its own
 * curriculum. A curriculum with no published version yet falls back to the main one.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { cleanModes, MODES } from '@/lib/delivery/modes'
import { MAIN_VARIANT, groupMode, pickVariant } from '@/lib/delivery/variants'

export { MAIN_VARIANT }

export const levelVariants = (levelId: string) =>
  prisma.curriculumVariant.findMany({ where: { levelId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })

interface GroupRef { levelId: string | null; campusId: string; curriculumVariantId?: string | null }

/** The curriculum (variant id, null = main) a group reads. */
export async function variantForGroup(g: GroupRef): Promise<string | null> {
  if (!g.levelId) return null
  if (g.curriculumVariantId === MAIN_VARIANT) return null
  const [variants, campus] = await Promise.all([
    levelVariants(g.levelId),
    prisma.campus.findUnique({ where: { id: g.campusId }, select: { kind: true } }),
  ])
  if (!variants.length) return null
  return pickVariant(variants, { campusId: g.campusId, mode: groupMode(campus?.kind), chosen: g.curriculumVariantId })
}

/** Newest published version of one curriculum of a level (null = main); none published → the main one's. */
export async function latestPublished(levelId: string, variantId: string | null) {
  const own = await prisma.curriculumEdition.findFirst({ where: { levelId, variantId, status: 'PUBLISHED' }, orderBy: { number: 'desc' } })
  if (own || variantId === null) return own
  return prisma.curriculumEdition.findFirst({ where: { levelId, variantId: null, status: 'PUBLISHED' }, orderBy: { number: 'desc' } })
}

export async function latestForGroup(g: GroupRef) {
  if (!g.levelId) return null
  return latestPublished(g.levelId, await variantForGroup(g))
}

// ── managing the curricula of a level (Course Structure / curriculum page) ──

export interface VariantInput { name: string; modes?: string[] | null; campusIds?: string[] | null }

export const variantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  modes: z.array(z.enum(MODES)).nullish(),
  campusIds: z.array(z.string().min(1)).max(200).nullish(),
})

const jsonOrNull = (v: unknown[] | null | undefined) => (v && v.length ? (v as Prisma.InputJsonValue) : undefined)

export async function createVariant(levelId: string, input: VariantInput) {
  const level = await prisma.level.findUnique({ where: { id: levelId }, select: { id: true } })
  if (!level) return null
  const last = await prisma.curriculumVariant.findFirst({ where: { levelId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  return prisma.curriculumVariant.create({
    data: { levelId, name: input.name.trim(), modes: jsonOrNull(cleanModes(input.modes)), campusIds: jsonOrNull(input.campusIds), sortOrder: (last?.sortOrder ?? 0) + 1 },
  })
}

export async function updateVariant(id: string, input: Partial<VariantInput>) {
  return prisma.curriculumVariant.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.modes !== undefined && { modes: jsonOrNull(cleanModes(input.modes)) ?? Prisma.DbNull }),
      ...(input.campusIds !== undefined && { campusIds: jsonOrNull(input.campusIds) ?? Prisma.DbNull }),
    },
  })
}

/** A curriculum can be removed only while it has no version; groups that chose it go back to "automatic". */
export async function deleteVariant(id: string): Promise<{ ok: boolean; message?: string }> {
  const used = await prisma.curriculumEdition.count({ where: { variantId: id } })
  if (used) return { ok: false, message: `It has ${used} version(s) — archive them instead · ليه ${used} نسخة — مينفعش يتمسح` }
  await prisma.$transaction([
    prisma.classSection.updateMany({ where: { curriculumVariantId: id }, data: { curriculumVariantId: null } }),
    prisma.curriculumVariant.delete({ where: { id } }),
  ])
  return { ok: true }
}

/** From a place's page: which curriculum of a level this place uses (null = the automatic choice / main). */
export async function setPlaceVariant(levelId: string, campusId: string, variantId: string | null) {
  const variants = await levelVariants(levelId)
  if (variantId && !variants.some((v) => v.id === variantId)) return false
  await prisma.$transaction(async (tx) => {
    for (const v of variants) {
      const list = Array.isArray(v.campusIds) ? (v.campusIds as string[]) : []
      const want = v.id === variantId
      const has = list.includes(campusId)
      if (want === has) continue
      const next = want ? [...list, campusId] : list.filter((c) => c !== campusId)
      await tx.curriculumVariant.update({ where: { id: v.id }, data: { campusIds: next.length ? (next as Prisma.InputJsonValue) : Prisma.DbNull } })
    }
  })
  return true
}
