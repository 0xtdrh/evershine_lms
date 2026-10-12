/**
 * P1 passport — pure rules (no database). docs/plan-learning-platform.md §4, owner decisions 2026-10-12.
 * - Passport number TN-PASS-YYYY-NNNN (YYYY = the year the student joined).
 * - Stamps: AUTO (a rule + threshold, given by the system), MANUAL (staff), EVENT (scan the card on the day).
 * - Track graduation (rule "B"): the admin chooses the courses a track needs (none chosen = every course of the track);
 *   a course is finished when its LAST level is passed.
 * Tests: tests/passport-rules.test.ts.
 */

import { z } from 'zod'

export const passportPrefix = (year: number) => `TN-PASS-${year}-`

export const STAMP_KINDS = ['AUTO', 'MANUAL', 'EVENT'] as const
export const STAMP_SHAPES = ['ROUND', 'SQUARE', 'HEX'] as const

/** Automatic rules: what the system checks. threshold = the number the admin types (when the rule uses one). */
export const AUTO_RULES: Record<string, { en: string; ar: string; threshold: boolean }> = {
  WELCOME: { en: 'Joined TechNova', ar: 'انضم لـ TechNova', threshold: false },
  LEVEL_PASSED: { en: 'Finished a level (one stamp per level, track colour)', ar: 'خلّص مستوى (ختم لكل مستوى بلون الـ Track)', threshold: false },
  TRACK_GRADUATE: { en: 'Graduated from a track (gold)', ar: 'اتخرّج من Track (دهبي)', threshold: false },
  SESSIONS: { en: 'Attended N sessions', ar: 'حضر N حصة', threshold: true },
  PERFECT_MONTH: { en: 'A month with no absence', ar: 'شهر من غير غياب', threshold: false },
  STARS: { en: 'Star of the session N times', ar: 'نجم الحصة N مرة', threshold: true },
  GALLERY: { en: 'N projects in the gallery', ar: 'N مشروع في المعرض', threshold: true },
  HOMEWORK_MONTH: { en: 'All the homework of a month on time', ar: 'كل واجبات الشهر في معادها', threshold: false },
  QUIZ_MASTER: { en: '90% or more in N quizzes', ar: '90% أو أكتر في N كويز', threshold: true },
  SKILL_MASTER: { en: '90% or more in a skill', ar: '90% أو أكتر في مهارة', threshold: false },
  ANNIVERSARY: { en: 'Years at TechNova (one stamp per year)', ar: 'سنين في TechNova (ختم لكل سنة)', threshold: false },
  AMBASSADOR: { en: 'Brought a friend who registered', ar: 'جاب صاحبه يسجّل', threshold: false },
  EARLY_RENEWAL: { en: 'Renewed before the month ended', ar: 'جدّد قبل الشهر ما يخلص', threshold: false },
  ALUMNI: { en: 'TechNova graduate (finished a track, no running group)', ar: 'خريج TechNova (خلّص Track ومالوش جروب شغال)', threshold: false },
}

export interface BuiltinStamp {
  code: string; nameEn: string; nameAr: string; kind: (typeof STAMP_KINDS)[number]; rule?: string; threshold?: number
  shape: (typeof STAMP_SHAPES)[number]; color: string; icon: string; repeatable?: boolean; givers?: string[]
}

const STAFF = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER']
const EVENT_STAFF = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'TEACHER']

/** Ready-made stamps (owner 2026-10-12); the admin can edit or switch any of them off. */
export const BUILTIN_STAMPS: BuiltinStamp[] = [
  { code: 'WELCOME', nameEn: 'Welcome to TechNova', nameAr: 'أهلاً بيك في TechNova', kind: 'AUTO', rule: 'WELCOME', shape: 'ROUND', color: '#0ea5e9', icon: '🛬' },
  { code: 'LEVEL_PASSED', nameEn: 'Level completed', nameAr: 'خلّص مستوى', kind: 'AUTO', rule: 'LEVEL_PASSED', shape: 'ROUND', color: '#4f46e5', icon: '🎯', repeatable: true },
  { code: 'TRACK_GRADUATE', nameEn: 'Track graduate', nameAr: 'خريج Track', kind: 'AUTO', rule: 'TRACK_GRADUATE', shape: 'HEX', color: '#d4a017', icon: '🏆', repeatable: true },
  { code: 'PERFECT_MONTH', nameEn: 'Perfect month', nameAr: 'شهر حضور كامل', kind: 'AUTO', rule: 'PERFECT_MONTH', shape: 'ROUND', color: '#16a34a', icon: '📅', repeatable: true },
  { code: 'SESSIONS_10', nameEn: '10 sessions', nameAr: '10 حصص', kind: 'AUTO', rule: 'SESSIONS', threshold: 10, shape: 'SQUARE', color: '#0891b2', icon: '🔟' },
  { code: 'SESSIONS_50', nameEn: '50 sessions', nameAr: '50 حصة', kind: 'AUTO', rule: 'SESSIONS', threshold: 50, shape: 'SQUARE', color: '#7c3aed', icon: '⭐' },
  { code: 'SESSIONS_100', nameEn: '100 sessions', nameAr: '100 حصة', kind: 'AUTO', rule: 'SESSIONS', threshold: 100, shape: 'SQUARE', color: '#db2777', icon: '💯' },
  { code: 'STARS_5', nameEn: 'Star of the session ×5', nameAr: 'نجم الحصة 5 مرات', kind: 'AUTO', rule: 'STARS', threshold: 5, shape: 'HEX', color: '#f59e0b', icon: '🌟' },
  { code: 'GALLERY_1', nameEn: 'Project in the gallery', nameAr: 'مشروع في المعرض', kind: 'AUTO', rule: 'GALLERY', threshold: 1, shape: 'SQUARE', color: '#ea580c', icon: '🖼️' },
  { code: 'HOMEWORK_MONTH', nameEn: 'Every homework on time', nameAr: 'كل الواجبات في معادها', kind: 'AUTO', rule: 'HOMEWORK_MONTH', shape: 'ROUND', color: '#65a30d', icon: '📚', repeatable: true },
  { code: 'QUIZ_MASTER', nameEn: 'Quiz master', nameAr: 'Quiz Master', kind: 'AUTO', rule: 'QUIZ_MASTER', threshold: 5, shape: 'HEX', color: '#2563eb', icon: '🧠' },
  { code: 'SKILL_MASTER', nameEn: 'Skill expert', nameAr: 'خبير مهارة', kind: 'AUTO', rule: 'SKILL_MASTER', shape: 'HEX', color: '#9333ea', icon: '💪' },
  { code: 'ANNIVERSARY', nameEn: 'Year at TechNova', nameAr: 'سنة في TechNova', kind: 'AUTO', rule: 'ANNIVERSARY', shape: 'ROUND', color: '#e11d48', icon: '🎂', repeatable: true },
  { code: 'AMBASSADOR', nameEn: 'Ambassador', nameAr: 'سفير', kind: 'AUTO', rule: 'AMBASSADOR', shape: 'ROUND', color: '#0d9488', icon: '🤝' },
  { code: 'EARLY_RENEWAL', nameEn: 'Renewed early', nameAr: 'جدّد بدري', kind: 'AUTO', rule: 'EARLY_RENEWAL', shape: 'SQUARE', color: '#0284c7', icon: '🔁' },
  { code: 'FIRST_ROBOT', nameEn: 'First robot that moved', nameAr: 'أول روبوت اتحرك', kind: 'MANUAL', shape: 'ROUND', color: '#475569', icon: '🛠️', givers: STAFF },
  { code: 'FIRST_CODE', nameEn: 'First code that ran', nameAr: 'أول كود اشتغل', kind: 'MANUAL', shape: 'ROUND', color: '#334155', icon: '💻', givers: STAFF },
  { code: 'HELPER', nameEn: 'Helped classmates', nameAr: 'ساعد زمايله', kind: 'MANUAL', shape: 'SQUARE', color: '#059669', icon: '🙋', givers: STAFF, repeatable: true },
  { code: 'CAPTAIN', nameEn: 'Team captain', nameAr: 'كابتن الفريق', kind: 'MANUAL', shape: 'HEX', color: '#b45309', icon: '👑', givers: STAFF, repeatable: true },
  { code: 'COMPETITION', nameEn: 'Competition', nameAr: 'مسابقة', kind: 'EVENT', shape: 'HEX', color: '#dc2626', icon: '🥇', givers: EVENT_STAFF, repeatable: true },
  { code: 'SUMMER_CAMP', nameEn: 'Summer camp', nameAr: 'معسكر صيفي', kind: 'EVENT', shape: 'ROUND', color: '#ca8a04', icon: '⛺', givers: EVENT_STAFF, repeatable: true },
  { code: 'WORKSHOP', nameEn: 'Workshop', nameAr: 'ورشة', kind: 'EVENT', shape: 'SQUARE', color: '#4338ca', icon: '🔧', givers: EVENT_STAFF, repeatable: true },
  { code: 'HACKATHON', nameEn: 'Hackathon', nameAr: 'هاكاثون', kind: 'EVENT', shape: 'HEX', color: '#7e22ce', icon: '🚀', givers: EVENT_STAFF, repeatable: true },
  { code: 'ALUMNI', nameEn: 'TechNova graduate', nameAr: 'خريج TechNova', kind: 'AUTO', rule: 'ALUMNI', shape: 'HEX', color: '#a16207', icon: '🎓' },
]

/** What the system knows about a student (collected by the engine). */
export interface Facts {
  joinedAt: Date
  levelsPassed: { levelId: string; label: string; trackId: string | null; at: Date }[]
  tracksGraduated: { trackId: string; name: string; at: Date }[]
  sessions: number
  perfectMonths: { groupId: string; label: string }[]
  stars: number
  galleryProjects: number
  homeworkMonths: { groupId: string; label: string }[]
  quizzesAbove90: number
  bestSkillPercent: number | null
  referrals: number
  earlyRenewals: number
  hasActiveGroup: boolean
}

export interface Award { refKey: string; label?: string; color?: string }

/** Which awards an AUTO stamp gives for these facts (one per refKey). */
export function autoAwards(stamp: { rule: string | null; threshold: number | null; repeatable: boolean }, f: Facts, now: Date, trackColors: Record<string, string> = {}): Award[] {
  const n = stamp.threshold ?? 0
  const once = (ok: boolean): Award[] => (ok ? [{ refKey: '' }] : [])
  const many = (xs: Award[]) => (stamp.repeatable ? xs : xs.slice(0, 1).map((x) => ({ ...x, refKey: '' })))
  switch (stamp.rule) {
    case 'WELCOME': return [{ refKey: '' }]
    case 'LEVEL_PASSED': return many(f.levelsPassed.map((l) => ({ refKey: l.levelId, label: l.label, color: l.trackId ? trackColors[l.trackId] : undefined })))
    case 'TRACK_GRADUATE': return many(f.tracksGraduated.map((t) => ({ refKey: t.trackId, label: t.name })))
    case 'SESSIONS': return once(n > 0 && f.sessions >= n)
    case 'PERFECT_MONTH': return many(f.perfectMonths.map((m) => ({ refKey: m.groupId, label: m.label })))
    case 'STARS': return once(n > 0 && f.stars >= n)
    case 'GALLERY': return once(f.galleryProjects >= Math.max(1, n))
    case 'HOMEWORK_MONTH': return many(f.homeworkMonths.map((m) => ({ refKey: m.groupId, label: m.label })))
    case 'QUIZ_MASTER': return once(f.quizzesAbove90 >= Math.max(1, n))
    case 'SKILL_MASTER': return once((f.bestSkillPercent ?? 0) >= 90)
    case 'ANNIVERSARY': {
      const years = fullYears(f.joinedAt, now)
      const list: Award[] = Array.from({ length: years }, (_, i) => ({ refKey: `Y${i + 1}`, label: `${i + 1}` }))
      return stamp.repeatable ? list : once(years >= Math.max(1, n))
    }
    case 'AMBASSADOR': return once(f.referrals > 0)
    case 'EARLY_RENEWAL': return once(f.earlyRenewals > 0)
    case 'ALUMNI': return once(f.tracksGraduated.length > 0 && !f.hasActiveGroup)
    default: return []
  }
}

export function fullYears(from: Date, to: Date): number {
  let y = to.getUTCFullYear() - from.getUTCFullYear()
  const m = to.getUTCMonth() - from.getUTCMonth()
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) y--
  return Math.max(0, y)
}

/**
 * Track graduation (rule B): every required course finished (its last level passed). Required = the admin's choice,
 * or every course of the track when nothing is chosen. A track with no levels never graduates anyone.
 */
export function tracksGraduated(
  tracks: { id: string; name: string; courses: { id: string; lastLevelId: string | null }[] }[],
  required: Record<string, string[]>,
  passed: { levelId: string; at: Date }[],
): { trackId: string; name: string; at: Date }[] {
  const at = new Map(passed.map((p) => [p.levelId, p.at]))
  const out: { trackId: string; name: string; at: Date }[] = []
  for (const t of tracks) {
    const chosen = (required[t.id] ?? []).filter((id) => t.courses.some((c) => c.id === id))
    const need = (chosen.length ? t.courses.filter((c) => chosen.includes(c.id)) : t.courses).filter((c) => c.lastLevelId)
    if (!need.length) continue
    if (need.every((c) => at.has(c.lastLevelId!))) {
      out.push({ trackId: t.id, name: t.name, at: new Date(Math.max(...need.map((c) => at.get(c.lastLevelId!)!.getTime()))) })
    }
  }
  return out
}

/** May this role give a MANUAL / EVENT stamp? */
export const canGive = (givers: unknown, role: string) => Array.isArray(givers) && givers.includes(role)

/** EVENT stamps work only between their dates (no dates = always). */
export function eventOpen(s: { eventFrom: Date | null; eventTo: Date | null }, now: Date) {
  if (s.eventFrom && now < s.eventFrom) return false
  if (s.eventTo && now > new Date(s.eventTo.getTime() + 86_400_000 - 1)) return false
  return true
}

export const stampSchema = z.object({
  nameEn: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().max(80).default(''),
  descriptionEn: z.string().trim().max(300).nullish(),
  descriptionAr: z.string().trim().max(300).nullish(),
  kind: z.enum(STAMP_KINDS),
  rule: z.string().max(30).nullish(),
  threshold: z.number().int().min(0).max(100000).nullish(),
  shape: z.enum(STAMP_SHAPES).default('ROUND'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4f46e5'),
  icon: z.string().max(16).default(''),
  imagePublicId: z.string().max(300).nullish(),
  givers: z.array(z.enum(['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'TEACHER'])).max(5).default([]),
  repeatable: z.boolean().default(false),
  secret: z.boolean().default(false),
  active: z.boolean().default(true),
  eventFrom: z.string().nullish(),
  eventTo: z.string().nullish(),
}).refine((s) => s.kind !== 'AUTO' || (!!s.rule && s.rule in AUTO_RULES), 'Choose the rule of the automatic stamp')
  .refine((s) => s.kind !== 'AUTO' || !AUTO_RULES[s.rule ?? '']?.threshold || (s.threshold ?? 0) > 0, 'Type the number for this rule')
  .refine((s) => s.kind === 'AUTO' || s.givers.length > 0, 'Choose who can give this stamp')

/** Share link: random token; expiry in days. */
export const shareExpiry = (now: Date, days: number) => new Date(now.getTime() + Math.max(1, Math.min(days, 365)) * 86_400_000)
