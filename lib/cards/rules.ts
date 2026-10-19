/**
 * 2026-10-19 ID cards (student + staff) — pure rules. Agreed with the owner (5-E):
 * - front: photo, Arabic / English name, registration no., branch, track colour (the level is NOT printed — the QR
 *   tells staff); back: QR, emergency phone, valid until.
 * - the QR holds a link to /card/<code>: a stranger only sees "card valid / not valid"; signed-in staff see the person.
 * - a lost card gets a new code (the old one stops working everywhere: gate, attendance scan, passport stamps).
 * - a student who left → the card is not valid.
 * Tested in tests/cards-rules.test.ts.
 */

export interface CardSettings {
  /** how long a newly issued card is valid (months) */
  validityMonths: number
  /** print the emergency phone on the back */
  emergencyOnBack: boolean
  /** extra fee type charged when a lost card is replaced (null = free) */
  replacementFeeTypeId: string | null
  /** parents / students see the digital card in the portal */
  digitalForParents: boolean
  digitalForStudents: boolean
}

export const CARD_DEFAULTS: CardSettings = { validityMonths: 12, emergencyOnBack: true, replacementFeeTypeId: null, digitalForParents: true, digitalForStudents: true }

export const STUDENT_PREFIX = 'TN-QR-'
export const STAFF_PREFIX = 'TN-STF-'
export const DEFAULT_TRACK_COLOR = '#1d4ed8'

/** A scanned value (raw code or a /card/<code> link) → the code. */
export function normalizeCardCode(scanned: string): string {
  const t = (scanned ?? '').trim()
  const m = /\/card\/([^/?#\s]+)/i.exec(t)
  return m ? decodeURIComponent(m[1]) : t
}

export const isStudentCode = (c: string) => /^(tn|esa)-qr-/i.test(c)
export const isStaffCode = (c: string) => /^tn-stf-/i.test(c)

/** First student card code from the registration number (TN/2026/0001 → TN-QR-TN-2026-0001). */
export const firstStudentCode = (reg: string) => `${STUDENT_PREFIX}${reg.replace(/\//g, '-')}`

/** A replacement card: the next number after the current one (…-R2, …-R3); the old code stops working. */
export function nextCode(current: string | null | undefined, base: string): string {
  const cur = current || base
  const m = /^(.*)-R(\d+)$/.exec(cur)
  return m ? `${m[1]}-R${Number(m[2]) + 1}` : `${cur}-R2`
}

export const staffBaseCode = (employeeOrId: string) => `${STAFF_PREFIX}${employeeOrId.replace(/[^A-Za-z0-9-]/g, '-').toUpperCase()}`

export function validUntil(issuedAt: Date, months: number): Date {
  const d = new Date(issuedAt)
  d.setUTCMonth(d.getUTCMonth() + Math.max(1, months))
  return d
}

export type CardState = 'VALID' | 'EXPIRED' | 'LEFT' | 'UNKNOWN'

export function cardState(i: { found: boolean; active: boolean; expiresAt: Date | null; now: Date }): CardState {
  if (!i.found) return 'UNKNOWN'
  if (!i.active) return 'LEFT'
  if (i.expiresAt && i.expiresAt.getTime() < i.now.getTime()) return 'EXPIRED'
  return 'VALID'
}

/** A4 sheet: 2 columns × 5 rows of 85.6 × 54 mm cards. The backs come mirrored so a duplex print lines up. */
export const PER_SHEET = 10
export function sheets<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += PER_SHEET) out.push(items.slice(i, i + PER_SHEET))
  return out
}
export function mirroredBacks<T>(sheet: (T | null)[]): (T | null)[] {
  const padded = [...sheet, ...Array(Math.max(0, PER_SHEET - sheet.length)).fill(null)]
  const rows: (T | null)[][] = []
  for (let i = 0; i < PER_SHEET; i += 2) rows.push([padded[i + 1], padded[i]])
  return rows.flat()
}
