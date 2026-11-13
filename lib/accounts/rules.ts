/**
 * Six phases 1-A (2026-11-13): family accounts — what may be sent, and which courses suit a child (pure, tested).
 * A family signs up first (or staff make the account for an offline family), adds its children, then books courses.
 */

import { z } from 'zod'
import { normalizePhone } from '@/lib/site/request-rules'

export const MIN_SELF_AGE = 18

/** AppSetting `accounts.settings`. */
export const accountsSettingsSchema = z.object({
  /** anyone may make an account on the website */
  signupOpen: z.boolean().default(true),
  /** a course that does not suit the child's age: LOCK = shown with a lock, HIDE = not shown */
  unsuitable: z.enum(['LOCK', 'HIDE']).default('LOCK'),
  /** e-mail a code to confirm the account e-mail (works once a sending domain is ready) */
  emailCheck: z.boolean().default(false),
  /** a full track: ask "learned this before?" — yes = TechNova sets the level before placing the child */
  askExperience: z.boolean().default(true),
  /** days a staff setup link stays valid */
  linkDays: z.number().int().min(1).max(30).default(7),
})
export type AccountsSettings = z.infer<typeof accountsSettingsSchema>
export const DEFAULT_ACCOUNTS_SETTINGS: AccountsSettings = accountsSettingsSchema.parse({})

const name = z.string().trim().min(2).max(60)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const phone = z.string().trim().max(30).refine((v) => !!normalizePhone(v), 'Enter a valid mobile number · اكتب رقم موبايل صحيح')
const email = z.string().trim().toLowerCase().email().max(160)

export const memberSchema = z.object({
  firstName: name, lastName: name, dob: day, gender: z.enum(['MALE', 'FEMALE']),
  school: z.string().trim().max(120).optional().nullable(), experience: z.string().trim().max(300).optional().nullable(),
})
export type MemberInput = z.infer<typeof memberSchema>

export const signupAccountSchema = z
  .object({
    who: z.enum(['PARENT', 'SELF']),
    firstName: name, lastName: name, phone,
    email: email.optional().or(z.literal('')).nullable(),
    password: z.string().min(8).max(100),
    relationship: z.string().max(20).optional().nullable(),
    country: z.string().trim().min(2).max(60).default('Egypt'),
    city: z.string().trim().min(2).max(60),
    /** SELF: the account holder's own birthday + gender (becomes the first member) */
    dob: day.optional().nullable(),
    gender: z.enum(['MALE', 'FEMALE']).optional().nullable(),
    agree: z.literal(true),
    /** a partner's join code (from its link /join/p/<code> or typed) */
    partnerCode: z.string().trim().max(30).optional().nullable(),
    /** a friend's invite (referral) code TN-REF-… or phone */
    referral: z.string().trim().max(40).optional().nullable(),
    website: z.string().max(0).optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    if (v.who === 'SELF' && (!v.dob || !v.gender)) ctx.addIssue({ code: 'custom', path: ['dob'], message: 'Birthday and gender are needed · تاريخ الميلاد والنوع مطلوبين' })
    const digits = v.phone.replace(/\D/g, '')
    if (digits && v.password.replace(/\D/g, '') === digits) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Do not use your phone number as the password · متستخدمش رقم الموبايل كباسورد' })
  })
export type SignupAccountInput = z.infer<typeof signupAccountSchema>

/** Staff make an account for a family that came to the branch (no password: the family chooses it from a link). */
export const staffAccountSchema = z.object({
  who: z.enum(['PARENT', 'SELF']).default('PARENT'),
  firstName: name, lastName: name, phone,
  email: email.optional().or(z.literal('')).nullable(),
  relationship: z.string().max(20).optional().nullable(),
  country: z.string().trim().max(60).optional().nullable(),
  city: z.string().trim().max(60).optional().nullable(),
  members: z.array(memberSchema).max(8).default([]),
})
export type StaffAccountInput = z.infer<typeof staffAccountSchema>

/** Age in whole years on a Cairo day 'YYYY-MM-DD'. */
export function ageOn(dob: string | Date, today: string): number {
  const d = typeof dob === 'string' ? dob : dob.toISOString().slice(0, 10)
  const [y, m, dd] = d.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < dd) ? 1 : 0)
}

export type Fit = 'SUITABLE' | 'OPENED' | 'TOO_YOUNG' | 'TOO_OLD' | 'ENROLLED'
export const FIT_TEXT: Record<Fit, { en: string; ar: string }> = {
  SUITABLE: { en: 'Suits this age', ar: 'مناسب للسن' },
  OPENED: { en: 'Opened for you by TechNova', ar: 'اتفتحلك من TechNova' },
  TOO_YOUNG: { en: 'For an older age', ar: 'لسن أكبر' },
  TOO_OLD: { en: 'For a younger age', ar: 'لسن أصغر' },
  ENROLLED: { en: 'Already learning it', ar: 'بيتعلمه دلوقتي' },
}

export interface CourseRef { refType: 'TRACK' | 'COURSE'; refId: string; trackId: string | null; courseIds: string[]; minAge: number | null; maxAge: number | null }
export interface Unlock { refType: string; refId: string }

/** Does a course card suit this child? Enrolled > opened by staff > age. */
export function courseFit(c: CourseRef, age: number | null, unlocks: Unlock[], enrolledCourseIds: string[] = []): Fit {
  if (c.courseIds.some((id) => enrolledCourseIds.includes(id))) return 'ENROLLED'
  const opened = unlocks.some((u) =>
    (u.refType === 'TRACK' && (u.refId === c.trackId || (c.refType === 'TRACK' && u.refId === c.refId))) ||
    (u.refType === 'COURSE' && c.courseIds.includes(u.refId)))
  if (opened) return 'OPENED'
  if (age == null) return 'SUITABLE'
  if (c.minAge != null && age < c.minAge) return 'TOO_YOUNG'
  if (c.maxAge != null && age > c.maxAge) return 'TOO_OLD'
  return 'SUITABLE'
}
export const canBook = (f: Fit) => f === 'SUITABLE' || f === 'OPENED'

/** Order: open ones first (opened, suitable), then the rest; HIDE drops what cannot be booked (but keeps enrolled). */
export function arrangeCourses<T extends { fit: Fit; sortOrder?: number }>(rows: T[], mode: AccountsSettings['unsuitable']): T[] {
  const rank: Record<Fit, number> = { OPENED: 0, SUITABLE: 1, ENROLLED: 2, TOO_YOUNG: 3, TOO_OLD: 3 }
  return rows.filter((r) => mode === 'LOCK' || canBook(r.fit) || r.fit === 'ENROLLED').sort((a, b) => rank[a.fit] - rank[b.fit] || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

/** The login e-mail of a family account made without an e-mail (same rule as approving an admission). */
export const phoneLoginEmail = (normalizedPhone: string) => `guardian_${normalizedPhone}@technova.local`
