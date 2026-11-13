/**
 * Six phases 1-B (2026-11-13): booking a course from the family account — pure rules (tested).
 * - confirm rule: AUTO (placed at once, confirmed when paid) or STAFF (staff approve first); most specific scope wins.
 * - a held seat expires when its first invoice is still unpaid after the hold (unless a payment receipt is being checked).
 */

import { z } from 'zod'

export const BOOKING_MODES = ['ONLINE', 'RECORDED', 'BRANCH'] as const
export type BookingMode = (typeof BOOKING_MODES)[number]
export const BOOKING_STATUSES = ['REVIEW', 'PLACEMENT', 'HOLD', 'CONFIRMED', 'WAITING', 'EXPIRED', 'CANCELLED', 'REJECTED'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export const OPEN_STATUSES: BookingStatus[] = ['REVIEW', 'PLACEMENT', 'HOLD', 'WAITING']

export const STATUS_TEXT: Record<BookingStatus, { en: string; ar: string }> = {
  REVIEW: { en: 'Waiting for TechNova to confirm', ar: 'مستني TechNova تأكد' },
  PLACEMENT: { en: 'Waiting for TechNova to set the level', ar: 'مستني TechNova تحدد المستوى' },
  HOLD: { en: 'Seat held — pay to confirm', ar: 'المكان محجوز — ادفع علشان يتأكد' },
  CONFIRMED: { en: 'Confirmed', ar: 'اتأكد' },
  WAITING: { en: 'On the waiting list', ar: 'في قايمة الانتظار' },
  EXPIRED: { en: 'Expired (not paid in time)', ar: 'انتهى (مادفعش في الميعاد)' },
  CANCELLED: { en: 'Cancelled', ar: 'اتلغى' },
  REJECTED: { en: 'Not accepted', ar: 'ماتقبلش' },
}

export const SCOPE_TYPES = ['COMPANY', 'CAMPUS', 'TRACK', 'COURSE', 'LEVEL', 'GROUP'] as const
export type ScopeType = (typeof SCOPE_TYPES)[number]
const RANK: Record<ScopeType, number> = { GROUP: 6, LEVEL: 5, COURSE: 4, TRACK: 3, CAMPUS: 2, COMPANY: 1 }
export const DEFAULT_HOLD_HOURS = 48

export interface Rule { scopeType: string; scopeId: string | null; confirm: string; holdHours: number | null }
export interface Where { campusId?: string | null; trackId?: string | null; courseId?: string | null; levelId?: string | null; groupId?: string | null }

/** The rule that applies (most specific scope that matches); none = AUTO, 48 hours. The hold comes from the most specific rule that sets one. */
export function resolveRule(rules: Rule[], w: Where): { confirm: 'AUTO' | 'STAFF'; holdHours: number } {
  const id: Record<ScopeType, string | null | undefined> = { COMPANY: null, CAMPUS: w.campusId, TRACK: w.trackId, COURSE: w.courseId, LEVEL: w.levelId, GROUP: w.groupId }
  const hits = rules
    .filter((r) => (SCOPE_TYPES as readonly string[]).includes(r.scopeType))
    .filter((r) => (r.scopeType === 'COMPANY' ? !r.scopeId : !!r.scopeId && r.scopeId === id[r.scopeType as ScopeType]))
    .sort((a, b) => RANK[b.scopeType as ScopeType] - RANK[a.scopeType as ScopeType])
  const confirm = hits[0]?.confirm === 'STAFF' ? 'STAFF' : 'AUTO'
  const holdHours = hits.find((h) => h.holdHours != null && h.holdHours > 0)?.holdHours ?? DEFAULT_HOLD_HOURS
  return { confirm, holdHours }
}

export const ruleSchema = z.object({
  scopeType: z.enum(SCOPE_TYPES),
  scopeId: z.string().max(40).nullable().optional(),
  confirm: z.enum(['AUTO', 'STAFF']),
  holdHours: z.number().int().min(1).max(24 * 14).nullable().optional(),
}).refine((r) => (r.scopeType === 'COMPANY') === !r.scopeId, { message: 'Choose what the rule is for · اختار القاعدة لإيه', path: ['scopeId'] })

export interface InvoiceState { totalAmount: number; paidAmount: number; status: string; proofStatus?: string | null }

/** The booking's first invoice counts as paid: fully paid, nothing to pay (free code), or part paid where instalments are allowed. */
export function invoicePaid(inv: InvoiceState | null, installmentsAllowed = false): boolean {
  if (!inv || inv.status === 'CANCELLED') return false
  if (inv.totalAmount <= 0 || inv.status === 'PAID' || inv.paidAmount >= inv.totalAmount) return true
  return installmentsAllowed && inv.paidAmount > 0
}

/** A held seat ends: past the hold, nothing paid, no receipt waiting to be checked. */
export function holdExpired(holdUntil: Date | string | null, inv: InvoiceState | null, now: Date): boolean {
  if (!holdUntil || new Date(holdUntil) > now) return false
  if (!inv) return true
  if (inv.paidAmount > 0) return false
  if (inv.proofStatus === 'PENDING') return false
  return true
}

export const bookSchema = z.object({
  person: z.string().min(3).max(60),
  slug: z.string().min(1).max(60),
  mode: z.enum(BOOKING_MODES),
  groupId: z.string().max(40).nullable().optional(),
  campusId: z.string().max(40).nullable().optional(),
  plan: z.enum(['SUBSCRIPTION', 'ONE_TIME']).nullable().optional(),
  code: z.string().trim().max(40).nullable().optional(),
  /** a track: did the child learn this before? BEFORE = TechNova sets the level first (placement) */
  experience: z.enum(['NEW', 'BEFORE']).nullable().optional(),
  /** the group of the booking link / QR the family came from */
  link: z.string().max(40).nullable().optional(),
  agree: z.literal(true),
})
export type BookInput = z.infer<typeof bookSchema>

/** Where an enrolment code may be used (scope + ids) — the course page, its track / course / level, or one group. */
export interface CodeTarget { listing: string | null; trackId?: string | null; courseIds?: string[]; levelId?: string | null; groupId?: string | null }
export function codeFitsTarget(scope: string, scopeIds: unknown, t: CodeTarget): boolean {
  const ids = Array.isArray(scopeIds) ? (scopeIds as unknown[]).map(String) : []
  switch (scope) {
    case 'ANY': return true
    case 'LISTING': return !!t.listing && ids.includes(t.listing)
    case 'TRACK': return !!t.trackId && ids.includes(t.trackId)
    case 'COURSE': return (t.courseIds ?? []).some((c) => ids.includes(c))
    case 'LEVEL': return !!t.levelId && ids.includes(t.levelId)
    case 'GROUP': return !!t.groupId && ids.includes(t.groupId)
    default: return false
  }
}
