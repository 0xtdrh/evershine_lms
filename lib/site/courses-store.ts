/** Six phases, 1-a: course listings — admin list, save, settings and the public catalog (server only). */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { effectiveModes } from '@/lib/delivery/modes'
import { cyclePrice } from '@/lib/pricing/group-price'
import { groupSeats } from '@/lib/groups/capacity'
import { DEFAULT_SECTIONS, listable, sectionOn, sectionsSchema, type ListingInput, type SectionKey, type Sections } from './courses'

const SETTINGS_KEY = 'courses.page'
export interface CoursesPageSettings { sections: Record<SectionKey, boolean> }
export async function getCoursesSettings(): Promise<CoursesPageSettings> {
  const s = await getSetting<Partial<CoursesPageSettings>>(SETTINGS_KEY, { sections: DEFAULT_SECTIONS })
  return { sections: { ...DEFAULT_SECTIONS, ...(s.sections ?? {}) } }
}
export async function saveCoursesSettings(userId: string, sections: Partial<Record<SectionKey, boolean>>) {
  const clean = Object.fromEntries(Object.entries(sections).filter(([k, v]) => k in DEFAULT_SECTIONS && typeof v === 'boolean'))
  await setSetting(SETTINGS_KEY, { sections: { ...DEFAULT_SECTIONS, ...clean } }, userId)
}

/** Everything that can be listed: every active track and course, with its listing when there is one. */
export async function adminCatalog() {
  const [tracks, courses, listings] = await Promise.all([
    prisma.track.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, minAge: true, maxAge: true } }),
    prisma.academicSubject.findMany({ where: { isActive: true }, orderBy: [{ trackId: 'asc' }, { trackOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, trackId: true, track: { select: { name: true } } } }),
    prisma.courseListing.findMany(),
  ])
  const find = (t: string, id: string) => listings.find((l) => l.refType === t && l.refId === id) ?? null
  return [
    ...tracks.map((t) => ({ refType: 'TRACK' as const, refId: t.id, name: t.name, trackName: null as string | null, inTrack: false, ages: [t.minAge, t.maxAge] as [number | null, number | null], listing: find('TRACK', t.id) })),
    ...courses.map((c) => ({ refType: 'COURSE' as const, refId: c.id, name: c.name, trackName: c.track?.name ?? null, inTrack: !!c.trackId, ages: [null, null] as [number | null, number | null], listing: find('COURSE', c.id) })),
  ]
}

export async function slugUsed(slug: string, notRef?: { refType: string; refId: string }) {
  const hit = await prisma.courseListing.findUnique({ where: { slug }, select: { refType: true, refId: true } })
  return !!hit && !(notRef && hit.refType === notRef.refType && hit.refId === notRef.refId)
}

export async function saveListing(userId: string, v: ListingInput) {
  const data = {
    slug: v.slug, show: v.show ?? false, soldAlone: v.soldAlone ?? false, sortOrder: v.sortOrder ?? 0,
    titleEn: v.titleEn || null, titleAr: v.titleAr || null, summaryEn: v.summaryEn || null, summaryAr: v.summaryAr || null,
    imageUrl: v.imageUrl || null, introVideoUrl: v.introVideoUrl || null, sections: (v.sections ?? {}) as object, updatedById: userId,
  }
  return prisma.courseListing.upsert({ where: { refType_refId: { refType: v.refType, refId: v.refId } }, create: { refType: v.refType, refId: v.refId, ...data }, update: data })
}

// ── the public catalog ──────────────────────────────────────────────────────────────────────────────────────────

type LevelRow = { id: string; name: string; order: number; numberOfSessions: number; numberOfMonths: number; pricingType: string; monthlyPrice: number | null; fullLevelPrice: number | null; allowedModes: unknown }
export interface OnlineGroup { id: string; name: string; slots: { dayOfWeek: number; time: string }[]; free: number | null; startDate: string | null }
export interface PublicCourse {
  slug: string; refType: 'TRACK' | 'COURSE'; title: { en: string; ar: string }; summary: { en: string; ar: string }
  imageUrl: string | null; introVideoUrl: string | null; minAge: number | null; maxAge: number | null; trackName: string | null
  levels: { name: string; course: string; sessions: number; months: number }[]
  modes: { online: boolean; recorded: boolean; branch: boolean }
  price: { online: number | null; onlinePer: 'MONTH' | 'LEVEL'; recorded: number | null; recordedDays: number | null }
  sessionsTitles: { en: string; ar: string }[]
  onlineGroups: OnlineGroup[]
  nextLevel: { title: string; slug: string | null } | null
  sections: Sections; on: Record<SectionKey, boolean>; sortOrder: number
}

async function levelsOf(refType: 'TRACK' | 'COURSE', refId: string) {
  const courses = await prisma.academicSubject.findMany({
    where: refType === 'TRACK' ? { trackId: refId, isActive: true } : { id: refId },
    orderBy: [{ trackOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, allowedModes: true, trackId: true, trackOrder: true, track: { select: { name: true, minAge: true, maxAge: true, allowedModes: true } },
      levels: { where: { isActive: true }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, monthlyPrice: true, fullLevelPrice: true, allowedModes: true } } },
  })
  return courses
}

export async function publicCatalog(opts: { slug?: string } = {}): Promise<PublicCourse[]> {
  try {
    const [settings, listings, online] = await Promise.all([
      getCoursesSettings(),
      prisma.courseListing.findMany({ where: { show: true, ...(opts.slug ? { slug: opts.slug } : {}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.campus.findFirst({ where: { kind: 'ONLINE', isActive: true }, select: { id: true } }),
    ])
    const out: PublicCourse[] = []
    for (const l of listings) {
      const refType = l.refType as 'TRACK' | 'COURSE'
      const courses = await levelsOf(refType, l.refId)
      if (!courses.length) continue
      const first = courses[0]
      const inTrack = refType === 'COURSE' && !!first.trackId
      if (!listable(l, inTrack)) continue
      const track = refType === 'TRACK' ? await prisma.track.findUnique({ where: { id: l.refId }, select: { name: true, minAge: true, maxAge: true, allowedModes: true } }) : first.track
      const firstLevel = first.levels[0] as LevelRow | undefined
      const modes = firstLevel ? effectiveModes({ level: firstLevel.allowedModes, course: first.allowedModes, track: track?.allowedModes }).modes : []
      const sections = (sectionsSchema.safeParse(l.sections ?? {}).data ?? {}) as Sections
      const on = Object.fromEntries((Object.keys(DEFAULT_SECTIONS) as SectionKey[]).map((k) => [k, sectionOn(k, sections, settings.sections)])) as Record<SectionKey, boolean>

      // live online groups of the first level, in the Online place, with seats
      let onlineGroups: OnlineGroup[] = []
      let onlinePrice: number | null = null
      if (firstLevel && online && modes.includes('ONLINE')) {
        const groups = await prisma.classSection.findMany({
          where: { campusId: online.id, levelId: firstLevel.id, status: 'ACTIVE', isActive: true, kind: 'GROUP' },
          select: { id: true, className: true, sectionName: true, scheduleSlots: true, startDate: true }, take: 12,
        })
        onlineGroups = await Promise.all(groups.map(async (g) => {
          const seats = await groupSeats(g.id)
          const slots = Array.isArray(g.scheduleSlots) ? (g.scheduleSlots as { dayOfWeek: number; time: string }[]).filter((x) => typeof x?.dayOfWeek === 'number' && typeof x?.time === 'string').map((x) => ({ dayOfWeek: x.dayOfWeek, time: x.time })) : []
          return { id: g.id, name: [g.className, g.sectionName].filter(Boolean).join(' '), slots, free: seats.free, startDate: g.startDate ? g.startDate.toISOString().slice(0, 10) : null }
        }))
        onlinePrice = await cyclePrice(firstLevel, online.id)
      }
      const recorded = firstLevel && modes.includes('RECORDED') ? await prisma.recordedCourse.findFirst({ where: { levelId: firstLevel.id, isActive: true } }) : null

      // session titles of the first level (latest published curriculum) — only when the section is on
      let sessionsTitles: { en: string; ar: string }[] = []
      if (on.sessions && firstLevel) {
        const ed = await prisma.curriculumEdition.findFirst({ where: { levelId: firstLevel.id, status: 'PUBLISHED', variantId: null }, orderBy: { number: 'desc' }, select: { id: true } })
        if (ed) sessionsTitles = (await prisma.curriculumSession.findMany({ where: { editionId: ed.id }, orderBy: { number: 'asc' }, select: { titleEn: true, titleAr: true } })).map((x) => ({ en: x.titleEn || x.titleAr, ar: x.titleAr || x.titleEn })).filter((x) => x.en || x.ar)
      }

      // what comes next: the next course in the same track
      let nextLevel: PublicCourse['nextLevel'] = null
      if (refType === 'COURSE' && first.trackId) {
        const next = await prisma.academicSubject.findFirst({ where: { trackId: first.trackId, isActive: true, trackOrder: { gt: first.trackOrder ?? -1 } }, orderBy: { trackOrder: 'asc' }, select: { id: true, name: true } })
        if (next) {
          const nl = await prisma.courseListing.findUnique({ where: { refType_refId: { refType: 'COURSE', refId: next.id } }, select: { slug: true, show: true, soldAlone: true } })
          nextLevel = { title: next.name, slug: nl && nl.show && nl.soldAlone ? nl.slug : null }
        }
      }
      const name = refType === 'TRACK' ? track?.name ?? first.name : first.name
      out.push({
        slug: l.slug, refType,
        title: { en: l.titleEn || l.titleAr || name, ar: l.titleAr || l.titleEn || name },
        summary: { en: l.summaryEn || l.summaryAr || '', ar: l.summaryAr || l.summaryEn || '' },
        imageUrl: l.imageUrl, introVideoUrl: l.introVideoUrl,
        minAge: track?.minAge ?? null, maxAge: track?.maxAge ?? null, trackName: refType === 'COURSE' ? first.track?.name ?? null : null,
        levels: courses.flatMap((c) => c.levels.map((lv) => ({ name: lv.name, course: c.name, sessions: lv.numberOfSessions, months: lv.numberOfMonths }))),
        modes: { online: modes.includes('ONLINE') && (onlineGroups.length > 0 || false), recorded: !!recorded, branch: modes.includes('BRANCH') },
        price: {
          online: onlineGroups.length ? onlinePrice : null, onlinePer: firstLevel?.pricingType === 'MONTHLY' ? 'MONTH' : 'LEVEL',
          recorded: recorded ? Number(recorded.oneTimePrice ?? recorded.subscriptionPrice ?? 0) || null : null, recordedDays: recorded && !recorded.oneTimePrice ? recorded.subscriptionDays : null,
        },
        sessionsTitles, onlineGroups, nextLevel, sections, on, sortOrder: l.sortOrder,
      })
    }
    return out
  } catch (e) {
    console.error('[COURSES_CATALOG]', e)
    return []
  }
}
