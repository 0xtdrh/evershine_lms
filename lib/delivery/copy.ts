/**
 * a02 (2026-10-31) "Copy for a partner": when a partner (or a branch / the online place) needs a DIFFERENT structure
 * (other number of sessions, months or price), make a copy of a level — or of a whole course with all its levels —
 * with its curriculum, offered only in those places. Optionally the original is closed there, so they see their own
 * version only. Server-only.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { copySessions } from '@/lib/curriculum/engine'
import { codeFromName, uniqueCode } from '@/lib/ids/auto-code'
import { setOfferedHere } from './catalog'

export interface CopyInput {
  kind: 'LEVEL' | 'COURSE'
  id: string
  campusIds: string[]
  name?: string | null
  /** LEVEL only: a different structure for the copy */
  numberOfSessions?: number | null
  numberOfMonths?: number | null
  price?: number | null
  closeOriginalThere: boolean
  userId: string
}

type Tx = Prisma.TransactionClient

/** Copies the newest published version of a level's MAIN curriculum (else its newest version) to another level. */
async function copyCurriculum(tx: Tx, fromLevelId: string, toLevelId: string, sameSessions: boolean, userId: string) {
  const src = (await tx.curriculumEdition.findFirst({ where: { levelId: fromLevelId, variantId: null, status: 'PUBLISHED' }, orderBy: { number: 'desc' } }))
    ?? (await tx.curriculumEdition.findFirst({ where: { levelId: fromLevelId, variantId: null }, orderBy: { number: 'desc' } }))
  if (!src) return false
  // same structure → it can be used at once; a different number of sessions → a draft to adjust first
  const status = sameSessions && src.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
  const ed = await tx.curriculumEdition.create({
    data: { levelId: toLevelId, number: 1, status, notes: `Copied from another level (version ${src.number})`, copiedFromId: src.id, createdById: userId, ...(status === 'PUBLISHED' && { publishedAt: new Date(), publishedById: userId }) },
  })
  await copySessions(tx, src.id, ed.id)
  return true
}

async function copyLevel(tx: Tx, levelId: string, toSubjectId: string, input: CopyInput, keepOrder: boolean) {
  const l = await tx.level.findUniqueOrThrow({ where: { id: levelId } })
  const order = keepOrder ? l.order : ((await tx.level.findFirst({ where: { subjectId: toSubjectId }, orderBy: { order: 'desc' }, select: { order: true } }))?.order ?? 0) + 1
  const sessions = input.kind === 'LEVEL' && input.numberOfSessions ? input.numberOfSessions : l.numberOfSessions
  const months = input.kind === 'LEVEL' && input.numberOfMonths ? input.numberOfMonths : l.numberOfMonths
  const price = input.kind === 'LEVEL' && input.price != null ? input.price : null
  const copy = await tx.level.create({
    data: {
      subjectId: toSubjectId, order, numberOfSessions: sessions, numberOfMonths: months, pricingType: l.pricingType,
      name: input.kind === 'LEVEL' && input.name ? input.name : l.name,
      monthlyPrice: l.pricingType === 'MONTHLY' ? price ?? l.monthlyPrice : l.monthlyPrice,
      fullLevelPrice: l.pricingType === 'FULL_LEVEL' ? price ?? l.fullLevelPrice : l.fullLevelPrice,
      lessonUnlockMode: l.lessonUnlockMode,
      allowedModes: (l.allowedModes ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
  const curriculumCopied = await copyCurriculum(tx, l.id, copy.id, sessions === l.numberOfSessions, input.userId)
  return { id: copy.id, curriculumCopied }
}

export async function copyForPlaces(input: CopyInput): Promise<{ ok: true; kind: 'LEVEL' | 'COURSE'; id: string } | { ok: false; message: string }> {
  const places = await prisma.campus.findMany({ where: { id: { in: input.campusIds } }, select: { id: true, name: true } })
  if (!places.length) return { ok: false, message: 'Choose at least one place · اختار مكان واحد على الأقل' }
  const label = places.map((p) => p.name).join(' / ')

  const out = await prisma.$transaction(async (tx) => {
    if (input.kind === 'LEVEL') {
      const l = await tx.level.findUnique({ where: { id: input.id }, select: { subjectId: true, name: true } })
      if (!l) return null
      const made = await copyLevel(tx, input.id, l.subjectId, { ...input, name: input.name || `${l.name} — ${label}` }, false)
      return { kind: 'LEVEL' as const, id: made.id }
    }
    const c = await tx.academicSubject.findUnique({ where: { id: input.id }, include: { levels: { where: { isActive: true }, orderBy: { order: 'asc' }, select: { id: true } } } })
    if (!c) return null
    const name = input.name || `${c.name} — ${label}`
    const taken = (await tx.academicSubject.findMany({ select: { code: true } })).map((x) => x.code)
    const course = await tx.academicSubject.create({
      data: { name, code: uniqueCode(codeFromName(name), taken), description: c.description, trackId: c.trackId, trackOrder: c.trackOrder, allowedModes: (c.allowedModes ?? undefined) as Prisma.InputJsonValue | undefined },
    })
    for (const lv of c.levels) await copyLevel(tx, lv.id, course.id, input, true)
    return { kind: 'COURSE' as const, id: course.id }
  }, { timeout: 60_000 })
  if (!out) return { ok: false, message: 'Not found · مش موجود' }

  // the copy is offered only in these places; the original is closed there when asked
  await prisma.offeredIn.createMany({ data: places.map((p) => ({ entityType: out.kind, entityId: out.id, campusId: p.id })) })
  if (input.closeOriginalThere) for (const p of places) await setOfferedHere(out.kind, input.id, p.id, false)
  return { ok: true, ...out }
}
