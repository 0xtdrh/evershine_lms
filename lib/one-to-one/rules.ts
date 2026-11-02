/**
 * a02 M3 One-to-One (2026-11-01, owner) — pure rules (tests/one-to-one.test.ts).
 * A One-to-One is stored as a group of 1 (or 2 siblings in the same level, same session) so attendance, invoices, lessons,
 * refunds and pay are shared; it never shows on the Groups screens (`ClassSection.kind`).
 * Price list per level: MONTH (price of a month), PACKAGE (price of N sessions), SESSION (price of one session × how many
 * are booked). A row for the place wins over the "ALL" row. Siblings in one session pay `siblingPrice` each (empty = normal).
 */

export const PLANS = ['MONTH', 'PACKAGE', 'SESSION'] as const
export type Plan = (typeof PLANS)[number]
export const PLAN_LABEL: Record<Plan, { en: string; ar: string }> = {
  MONTH: { en: 'Month', ar: 'شهر' }, PACKAGE: { en: 'Package', ar: 'باقة' }, SESSION: { en: 'Per session', ar: 'بالحصة' },
}
export const KIND_ONE_TO_ONE = 'ONE_TO_ONE'
export const SECTION_NAME = '(1:1)'

export interface PriceRow { id?: string; levelId: string; scopeKey: string; plan: string; sessions: number; price: number; siblingPrice: number | null; minutes: number | null }

/** The row for this place, else the row for everywhere. SESSION rows hold the price of one session, whatever is booked. */
export function pickPrice(rows: PriceRow[], campusId: string, plan: Plan, sessions: number | null): PriceRow | null {
  const same = rows.filter((r) => r.plan === plan && (plan === 'SESSION' || sessions == null || r.sessions === sessions))
  return same.find((r) => r.scopeKey === campusId) ?? same.find((r) => r.scopeKey === 'ALL') ?? null
}

/** What one student pays for this booking, and how many sessions it holds. */
export function quote(row: PriceRow, booked: number | null, sibling: boolean): { amount: number; sessions: number } {
  const unit = sibling && row.siblingPrice != null ? row.siblingPrice : row.price
  if (row.plan === 'SESSION') {
    const n = Math.max(1, Math.round(booked ?? 1))
    return { amount: Math.round(unit * n * 100) / 100, sessions: n }
  }
  return { amount: unit, sessions: row.sessions }
}

/** "Ahmed Ali — Arduino 1" / siblings "Ahmed & Omar Ali — Arduino 1" (≤ 50 characters, the group's className). */
export function nameFor(students: { firstName: string; lastName: string }[], levelName: string): string {
  const [a, b] = students
  const who = !b ? `${a.firstName} ${a.lastName}` : a.lastName === b.lastName ? `${a.firstName} & ${b.firstName} ${a.lastName}` : `${a.firstName} & ${b.firstName}`
  return `${who} — ${levelName}`.trim().slice(0, 50)
}

/** A One-to-One finishes its level when its sessions so far reach the level's sessions (not by months). */
export function levelFinished(cycleNumber: number, perCycle: number, levelSessions: number): boolean {
  return cycleNumber * perCycle >= Math.max(1, levelSessions)
}
