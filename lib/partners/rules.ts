/**
 * M1 partners — pure rules (no database), tested in tests/partners-rules.test.ts.
 * docs/design-locations-and-partners.md §3 (م١) + §11.
 */

export const PARTNER_KINDS = ['SCHOOL', 'NURSERY', 'CENTER', 'ACADEMY', 'COMPANY', 'GOVERNMENT', 'NGO', 'OTHER'] as const
export type PartnerKind = (typeof PARTNER_KINDS)[number]

export const PARTNER_KIND_LABELS: Record<PartnerKind, { en: string; ar: string }> = {
  SCHOOL: { en: 'School', ar: 'مدرسة' },
  NURSERY: { en: 'Nursery', ar: 'حضانة' },
  CENTER: { en: 'Centre', ar: 'سنتر' },
  ACADEMY: { en: 'Academy', ar: 'أكاديمية' },
  COMPANY: { en: 'Company', ar: 'شركة' },
  GOVERNMENT: { en: 'Government body', ar: 'جهة حكومية' },
  NGO: { en: 'NGO / association', ar: 'جمعية' },
  OTHER: { en: 'Other', ar: 'غيره' },
}

export const CONTRACT_FILE_FORMATS = 'jpg,jpeg,png,webp,pdf'
export const CONTRACT_FILE_MAX_MB = 15

const DAY = 86_400_000
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

export type ContractState = 'NOT_STARTED' | 'ACTIVE' | 'ENDING_SOON' | 'ENDED' | 'OPEN_ENDED'

/** Where a contract stands today. "Ending soon" = inside its alert window. */
export function contractState(c: { startDate: Date; endDate: Date | null; alertDaysBefore: number }, now: Date): ContractState {
  const today = dayStart(now)
  if (dayStart(c.startDate) > today) return 'NOT_STARTED'
  if (!c.endDate) return 'OPEN_ENDED'
  const end = dayStart(c.endDate)
  if (end < today) return 'ENDED'
  return end - today <= Math.max(0, c.alertDaysBefore) * DAY ? 'ENDING_SOON' : 'ACTIVE'
}

/** Days left until the end (0 = ends today; negative = ended). null = no end date. */
export function daysLeft(endDate: Date | null, now: Date): number | null {
  return endDate ? Math.round((dayStart(endDate) - dayStart(now)) / DAY) : null
}

/**
 * Which alert the daily job should send now (each one once): BEFORE when the contract enters its alert window,
 * ENDED on / after its last day. null = nothing to send.
 */
export function contractAlertDue(
  c: { endDate: Date | null; alertDaysBefore: number; alertSentAt: Date | null; endedNoticeAt: Date | null },
  now: Date,
): 'BEFORE' | 'ENDED' | null {
  const left = daysLeft(c.endDate, now)
  if (left === null) return null
  if (left <= 0) return c.endedNoticeAt ? null : 'ENDED'
  if (left <= Math.max(0, c.alertDaysBefore) && !c.alertSentAt) return 'BEFORE'
  return null
}

/** A contract's dates make sense. */
export function contractProblem(c: { startDate: Date; endDate: Date | null; alertDaysBefore: number }): string | null {
  if (Number.isNaN(c.startDate.getTime())) return 'The start date is not valid'
  if (c.endDate && Number.isNaN(c.endDate.getTime())) return 'The end date is not valid'
  if (c.endDate && dayStart(c.endDate) < dayStart(c.startDate)) return 'The contract ends before it starts'
  if (c.alertDaysBefore < 0 || c.alertDaysBefore > 365) return 'The alert must be between 0 and 365 days before the end'
  return null
}

/** A short unique-ish place code from the partner and place names, e.g. "NOR-KAW". The server adds a number if taken. */
export function placeCode(partnerName: string, placeName: string): string {
  const part = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 4)
  const a = part(partnerName) || 'P'
  const b = part(placeName)
  return b ? `${a}-${b}` : a
}

/** The overrides a settings screen may store: known resource / action, allowed true/false. */
export const OVERRIDE_ACTIONS = ['create', 'read', 'update', 'delete', 'export', 'approve'] as const
