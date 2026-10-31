/**
 * a02 M1 — allowed ways + where offered, for tracks / courses / levels (server). Pure rules: lib/delivery/modes.ts.
 * The catalog is small (dozens of rows), so lists are filtered in memory after one read of OfferedIn.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cleanModes, effectiveModes, isOffered, type CatalogKind, type Mode } from './modes'

type OfferedMap = Map<string, string[]>
const key = (kind: CatalogKind, id: string) => `${kind}:${id}`

export async function offeredMap(): Promise<OfferedMap> {
  const rows = await prisma.offeredIn.findMany({ select: { entityType: true, entityId: true, campusId: true } })
  const m: OfferedMap = new Map()
  for (const r of rows) {
    const k = `${r.entityType}:${r.entityId}`
    m.set(k, [...(m.get(k) ?? []), r.campusId])
  }
  return m
}

const placesOf = (m: OfferedMap, kind: CatalogKind, id: string | null | undefined) => (id ? m.get(key(kind, id)) ?? null : null)

export function trackOffered(m: OfferedMap, trackId: string, campusId: string | null) {
  return isOffered({ track: placesOf(m, 'TRACK', trackId) }, campusId)
}
export function courseOffered(m: OfferedMap, c: { id: string; trackId: string | null }, campusId: string | null) {
  return isOffered({ track: placesOf(m, 'TRACK', c.trackId), course: placesOf(m, 'COURSE', c.id) }, campusId)
}
export function levelOffered(m: OfferedMap, l: { id: string; subjectId: string; trackId: string | null }, campusId: string | null) {
  return isOffered({ track: placesOf(m, 'TRACK', l.trackId), course: placesOf(m, 'COURSE', l.subjectId), level: placesOf(m, 'LEVEL', l.id) }, campusId)
}

/** Is this level offered in this place? (groups POST / PATCH refuse a level that is not) */
export async function isLevelOfferedIn(levelId: string, campusId: string): Promise<boolean> {
  const l = await prisma.level.findUnique({ where: { id: levelId }, select: { id: true, subjectId: true, subject: { select: { trackId: true } } } })
  if (!l) return true
  return levelOffered(await offeredMap(), { id: l.id, subjectId: l.subjectId, trackId: l.subject.trackId }, campusId)
}

/** The allowed ways for a level (+ optional curriculum session), with where the rule comes from. */
export async function levelModes(levelId: string, sessionModes?: unknown) {
  const l = await prisma.level.findUnique({ where: { id: levelId }, select: { allowedModes: true, subject: { select: { allowedModes: true, track: { select: { allowedModes: true } } } } } })
  return effectiveModes({ session: sessionModes, level: l?.allowedModes, course: l?.subject.allowedModes, track: l?.subject.track?.allowedModes })
}

export interface CatalogDelivery {
  kind: CatalogKind
  id: string
  name: string
  allowedModes: Mode[] | null
  offeredIn: string[]
  /** what applies when this item sets nothing (from its course / track) */
  inherited: { modes: Mode[]; from: string }
  effective: { modes: Mode[]; from: string }
}

export async function getCatalogDelivery(kind: CatalogKind, id: string): Promise<CatalogDelivery | null> {
  let own: unknown, name = '', parent: { course?: unknown; track?: unknown } = {}
  if (kind === 'TRACK') {
    const t = await prisma.track.findUnique({ where: { id }, select: { name: true, allowedModes: true } })
    if (!t) return null
    own = t.allowedModes; name = t.name
  } else if (kind === 'COURSE') {
    const c = await prisma.academicSubject.findUnique({ where: { id }, select: { name: true, allowedModes: true, track: { select: { allowedModes: true } } } })
    if (!c) return null
    own = c.allowedModes; name = c.name; parent = { track: c.track?.allowedModes }
  } else {
    const l = await prisma.level.findUnique({ where: { id }, select: { name: true, allowedModes: true, subject: { select: { name: true, allowedModes: true, track: { select: { allowedModes: true } } } } } })
    if (!l) return null
    own = l.allowedModes; name = `${l.subject.name} — ${l.name}`; parent = { course: l.subject.allowedModes, track: l.subject.track?.allowedModes }
  }
  const offered = await prisma.offeredIn.findMany({ where: { entityType: kind, entityId: id }, select: { campusId: true } })
  return {
    kind, id, name,
    allowedModes: cleanModes(own),
    offeredIn: offered.map((o) => o.campusId),
    inherited: effectiveModes(parent),
    effective: effectiveModes({ ...parent, [kind === 'TRACK' ? 'track' : kind === 'COURSE' ? 'course' : 'level']: own }),
  }
}

/** Marks an item offered nowhere (rows exist, none matches a place). */
export const NOWHERE = 'NONE'

/**
 * From a place's page (branch / partner): offer this item here or not, keeping the other places as they are.
 * Everywhere + off → every other active place; limited + last place removed → NOWHERE.
 */
export async function setOfferedHere(kind: CatalogKind, id: string, campusId: string, on: boolean) {
  const rows = (await prisma.offeredIn.findMany({ where: { entityType: kind, entityId: id }, select: { campusId: true } })).map((r) => r.campusId)
  let next: string[] | null = null
  if (on) {
    if (rows.length && !rows.includes(campusId)) next = [...rows.filter((c) => c !== NOWHERE), campusId]
  } else if (!rows.length) {
    const others = (await prisma.campus.findMany({ where: { isActive: true, id: { not: campusId } }, select: { id: true } })).map((c) => c.id)
    next = others.length ? others : [NOWHERE]
  } else if (rows.includes(campusId)) {
    const left = rows.filter((c) => c !== campusId)
    next = left.length ? left : [NOWHERE]
  }
  if (!next) return
  const list = next
  await prisma.$transaction(async (tx) => {
    await tx.offeredIn.deleteMany({ where: { entityType: kind, entityId: id } })
    await tx.offeredIn.createMany({ data: list.map((c) => ({ entityType: kind, entityId: id, campusId: c })) })
  })
}

export interface PlaceCatalogItem {
  kind: CatalogKind; id: string; name: string; scope: 'EVERYWHERE' | 'HERE' | 'NOT_HERE'; offered: boolean; children: PlaceCatalogItem[]
  /** levels: the other curricula of the level, and the one set for this place (null = main / automatic) */
  curricula?: { id: string; name: string }[]; curriculumHere?: string | null
}

/** The whole catalog as seen from one place: tracks → courses → levels, plus standalone courses. */
export async function placeCatalog(campusId: string): Promise<PlaceCatalogItem[]> {
  const [m, tracks, courses, levels, variants] = await Promise.all([
    offeredMap(),
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ where: { isActive: true }, select: { id: true, name: true, trackId: true }, orderBy: { name: 'asc' } }),
    prisma.level.findMany({ where: { isActive: true }, select: { id: true, name: true, subjectId: true }, orderBy: { order: 'asc' } }),
    prisma.curriculumVariant.findMany({ select: { id: true, name: true, levelId: true, campusIds: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ])
  const scope = (kind: CatalogKind, id: string): PlaceCatalogItem['scope'] => {
    const list = m.get(key(kind, id))
    return !list ? 'EVERYWHERE' : list.includes(campusId) ? 'HERE' : 'NOT_HERE'
  }
  const levelItems = (c: { id: string; trackId: string | null }) => levels.filter((l) => l.subjectId === c.id).map((l) => ({
    kind: 'LEVEL' as const, id: l.id, name: l.name, scope: scope('LEVEL', l.id),
    offered: levelOffered(m, { id: l.id, subjectId: c.id, trackId: c.trackId }, campusId), children: [],
    curricula: variants.filter((v) => v.levelId === l.id).map((v) => ({ id: v.id, name: v.name })),
    curriculumHere: variants.find((v) => v.levelId === l.id && Array.isArray(v.campusIds) && (v.campusIds as string[]).includes(campusId))?.id ?? null,
  }))
  const courseItem = (c: { id: string; name: string; trackId: string | null }): PlaceCatalogItem => ({
    kind: 'COURSE', id: c.id, name: c.name, scope: scope('COURSE', c.id), offered: courseOffered(m, c, campusId), children: levelItems(c),
  })
  return [
    ...tracks.map((t) => ({ kind: 'TRACK' as const, id: t.id, name: t.name, scope: scope('TRACK', t.id), offered: trackOffered(m, t.id, campusId), children: courses.filter((c) => c.trackId === t.id).map(courseItem) })),
    // standalone courses, and courses whose track was stopped (they would show nowhere otherwise)
    ...courses.filter((c) => !c.trackId || !tracks.some((t) => t.id === c.trackId)).map(courseItem),
  ]
}

export async function saveCatalogDelivery(kind: CatalogKind, id: string, input: { allowedModes: string[] | null; offeredIn: string[] }) {
  const cleaned = cleanModes(input.allowedModes)
  // nothing ticked = take it from above (stored as SQL NULL)
  const allowedModes = cleaned ? (cleaned as Prisma.InputJsonValue) : Prisma.DbNull
  const campusIds = [...new Set(input.offeredIn)]
  const known = campusIds.length ? (await prisma.campus.findMany({ where: { id: { in: campusIds } }, select: { id: true } })).map((c) => c.id) : []
  await prisma.$transaction(async (tx) => {
    if (kind === 'TRACK') await tx.track.update({ where: { id }, data: { allowedModes } })
    else if (kind === 'COURSE') await tx.academicSubject.update({ where: { id }, data: { allowedModes } })
    else await tx.level.update({ where: { id }, data: { allowedModes } })
    await tx.offeredIn.deleteMany({ where: { entityType: kind, entityId: id } })
    if (known.length) await tx.offeredIn.createMany({ data: known.map((campusId) => ({ entityType: kind, entityId: id, campusId })) })
  })
  return getCatalogDelivery(kind, id)
}
