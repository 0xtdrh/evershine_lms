/**
 * a02 M4 batch 1 (2026-11-02, owner) — recorded courses: pure rules (tests/recorded.test.ts).
 * A recorded course is a level's curriculum a student takes alone, with no instructor and no schedule. It is stored as a group of one
 * (`ClassSection.kind` RECORDED) so lessons, quizzes, invoices, wallet and refunds are shared; it never shows on the Groups screens.
 * SUBSCRIPTION: open for N days from when it is paid; when it ends the lessons lock and the progress stays. ONE_TIME: never locks.
 * A certificate needs every lesson done and, when the course asks for it, the final exam passed; it goes through the normal
 * certificate hide / reveal (hidden until staff reveal it, or revealed at once by the course's setting).
 */

export const KIND_RECORDED = 'RECORDED'
export const SECTION_RECORDED = '(REC)'
export const ACCESS_PLANS = ['SUBSCRIPTION', 'ONE_TIME'] as const
export type AccessPlan = (typeof ACCESS_PLANS)[number]
export const OPEN_MODES = ['ALL', 'PREVIOUS'] as const
export type OpenMode = (typeof OPEN_MODES)[number]
export type AccessState = 'OPEN' | 'NOT_PAID' | 'EXPIRED'

const DAY = 86_400_000

/** Can the student open the lessons now? `applied` = paid periods already counted. */
export function accessState(i: { plan: string | null; endsAt: Date | null; applied: number }, now: Date): AccessState {
  if (i.applied < 1) return 'NOT_PAID'
  if (i.plan === 'ONE_TIME') return 'OPEN'
  return i.endsAt && i.endsAt > now ? 'OPEN' : 'EXPIRED'
}

/** A newly paid period runs from the payment, or on from the current end when renewed early. */
export function extendAccess(endsAt: Date | null, paidAt: Date, days: number): Date {
  const from = endsAt && endsAt > paidAt ? endsAt : paidAt
  return new Date(from.getTime() + days * DAY)
}

export function lockMessage(state: AccessState): { en: string; ar: string } | null {
  if (state === 'NOT_PAID') return { en: 'Opens when the invoice is paid', ar: 'بيفتح لما الفاتورة تتدفع' }
  if (state === 'EXPIRED') return { en: 'The subscription ended; renew it to continue. Your progress is kept.', ar: 'الاشتراك خلص؛ جدّده علشان تكمل. تقدّمك محفوظ.' }
  return null
}

export function progressPct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

/** Is the student ready for the certificate? */
export function certificateReady(i: { done: number; total: number; examRequired: boolean; hasExam: boolean; examScore: number | null; passMark: number | null }): boolean {
  if (i.total <= 0 || i.done < i.total) return false
  if (!i.examRequired) return true
  return i.hasExam && i.examScore != null && i.examScore >= (i.passMark ?? 50)
}

/** The price and days this plan needs; a problem message when the course does not offer it. */
export function planOffer(c: { subscriptionPrice: number | null; subscriptionDays: number | null; oneTimePrice: number | null }, plan: AccessPlan): { price: number; days: number | null } | null {
  if (plan === 'ONE_TIME') return c.oneTimePrice == null ? null : { price: c.oneTimePrice, days: null }
  return c.subscriptionPrice == null || !c.subscriptionDays ? null : { price: c.subscriptionPrice, days: c.subscriptionDays }
}
