/**
 * Six phases, 1-a: how a track / course shows on the website's courses page (pure, tested).
 * Every section of a course page can be switched on or off for the whole company (settings) and changed per course
 * (`show: null` = follow the company setting). Contents are written per course in two languages.
 */

import { z } from 'zod'
import { SLUG_RE } from './campaigns'

export const SECTION_KEYS = ['price', 'levels', 'outcomes', 'sessions', 'preview', 'projects', 'requirements', 'instructor', 'certificate', 'nextLevel', 'faq'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABEL: Record<SectionKey, { en: string; ar: string }> = {
  price: { en: 'Price', ar: 'السعر' },
  levels: { en: 'Levels and duration', ar: 'المستويات والمدة' },
  outcomes: { en: 'After the course your child can…', ar: 'بعد الكورس ابنك هيقدر…' },
  sessions: { en: 'Session titles (from the curriculum)', ar: 'عناوين الحصص (من المنهج)' },
  preview: { en: 'Free preview lesson', ar: 'درس مجاني تتفرج عليه' },
  projects: { en: 'Student projects', ar: 'مشاريع الطلاب' },
  requirements: { en: 'What you need', ar: 'محتاج إيه' },
  instructor: { en: 'The instructor', ar: 'المدرب' },
  certificate: { en: 'The certificate', ar: 'الشهادة' },
  nextLevel: { en: 'What comes next', ar: 'الخطوة الجاية' },
  faq: { en: 'Questions', ar: 'أسئلة' },
}

/** Company defaults: which sections show when a course does not say. Session titles are off (they show the content). */
export const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  price: true, levels: true, outcomes: true, sessions: false, preview: true, projects: true, requirements: true,
  instructor: false, certificate: true, nextLevel: true, faq: true,
}

const bi = z.object({ en: z.string().trim().max(400).default(''), ar: z.string().trim().max(400).default('') })
const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links start with https:// · اللينك لازم يبدأ بـ https://')
const show = z.boolean().nullable().optional()

export const sectionsSchema = z.object({
  price: z.object({ show }).optional(),
  levels: z.object({ show }).optional(),
  outcomes: z.object({ show, items: z.array(bi).max(20).default([]) }).optional(),
  sessions: z.object({ show }).optional(),
  preview: z.object({ show, videoUrl: url.optional().nullable(), title: bi.optional() }).optional(),
  projects: z.object({ show }).optional(),
  requirements: z.object({ show, items: z.array(bi).max(20).default([]) }).optional(),
  instructor: z.object({ show, name: bi.optional(), bio: bi.optional(), photoUrl: url.optional().nullable() }).optional(),
  certificate: z.object({ show }).optional(),
  nextLevel: z.object({ show }).optional(),
  faq: z.object({ show, items: z.array(z.object({ q: bi, a: bi })).max(30).default([]) }).optional(),
})
export type Sections = z.infer<typeof sectionsSchema>

export const listingSchema = z.object({
  refType: z.enum(['TRACK', 'COURSE']),
  refId: z.string().min(1).max(40),
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'The link name: small English letters, numbers and - only · اسم اللينك: حروف إنجليزي صغيرة وأرقام و - بس'),
  show: z.boolean().optional(),
  soldAlone: z.boolean().optional(),
  sortOrder: z.number().int().min(-10000).max(10000).optional(),
  titleEn: z.string().trim().max(160).optional().nullable(), titleAr: z.string().trim().max(160).optional().nullable(),
  summaryEn: z.string().trim().max(4000).optional().nullable(), summaryAr: z.string().trim().max(4000).optional().nullable(),
  imageUrl: url.optional().nullable(), introVideoUrl: url.optional().nullable(),
  sections: sectionsSchema.optional(),
})
export type ListingInput = z.infer<typeof listingSchema>

/** Is this section on for this course? The course's own switch wins; otherwise the company default. */
export function sectionOn(key: SectionKey, sections: Sections | null | undefined, company: Partial<Record<SectionKey, boolean>> = DEFAULT_SECTIONS): boolean {
  const own = (sections?.[key] as { show?: boolean | null } | undefined)?.show
  if (own === true || own === false) return own
  return company[key] ?? DEFAULT_SECTIONS[key]
}

/** A course inside a track shows on its own only when it may be sold alone; tracks and standalone courses always may. */
export function listable(l: { refType: string; show: boolean; soldAlone: boolean }, inTrack: boolean): boolean {
  if (!l.show) return false
  return l.refType === 'TRACK' || !inTrack || l.soldAlone
}

/** A course fits a child of this age when the age is inside the range (an open end = no limit). */
export const fitsAge = (age: number, min?: number | null, max?: number | null) => (min == null || age >= min) && (max == null || age <= max)

/** Default link name from an English name. */
export const slugFrom = (name: string) => name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 58) || 'course'
