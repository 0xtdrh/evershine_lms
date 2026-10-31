/**
 * a04 daily cash-close sheet (2026-10-31, owner decisions 2026-10-26) — pure maths (tests/daily-sheet.test.ts).
 * One account (a cash box first, any account works) on one Cairo day:
 *   opening   = the APPROVED count of the day before (what was really in the box), else the computed balance at the
 *               start of the day (opening balance + in − out before it);
 *   in / out  = every movement of the day, grouped by kind (payments, top-ups, transfers, expenses, refunds…);
 *   expected  = opening + in − out;
 *   counted   = the count of that day (if any) → difference = counted − expected; no count = "not counted yet".
 * The count-difference movement of the day before's count is left out when the opening already is that count
 * (it would be counted twice).
 */

import type { MovementKind } from './rules'

export interface SheetMovement { id: string; direction: 'IN' | 'OUT' | string; amount: number; date: Date | string; kind: string; method: string | null; note: string | null; cashCountId?: string | null }
export interface SheetCount { id: string; counted: number; expected: number; difference: number; status: string; countedBy: string; countedAt: Date | string; approvedBy: string | null; approvedAt: Date | string | null; note: string | null }
export type OpeningSource = 'YESTERDAY_COUNT' | 'COMPUTED'

export interface SheetGroup { kind: MovementKind | string; count: number; amount: number; lines: SheetMovement[] }
export interface DailySheet {
  opening: number
  openingSource: OpeningSource
  inGroups: SheetGroup[]
  outGroups: SheetGroup[]
  totalIn: number
  totalOut: number
  expected: number
  count: SheetCount | null
  /** the count's own difference (counted − what the books said AT THE TIME of the count; that is what was approved).
   *  null = not counted yet */
  difference: number | null
  /** money in − out after the count was made (same day): counted + this = what should be there at the end of the day */
  afterCount: number
  state: 'NOT_COUNTED' | 'PENDING' | 'APPROVED' | 'REJECTED'
}

const r2 = (n: number) => Math.round(n * 100) / 100
const ORDER: string[] = ['PAYMENT', 'TOPUP', 'PARTNER', 'TRANSFER', 'ADJUST', 'EXPENSE', 'SALARY', 'REFUND', 'WITHDRAWAL']

function group(rows: SheetMovement[]): SheetGroup[] {
  const by = new Map<string, SheetGroup>()
  for (const m of rows) {
    const g = by.get(m.kind) ?? { kind: m.kind, count: 0, amount: 0, lines: [] }
    g.count++; g.amount = r2(g.amount + m.amount); g.lines.push(m)
    by.set(m.kind, g)
  }
  for (const g of by.values()) g.lines.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  return [...by.values()].sort((a, b) => (ORDER.indexOf(a.kind) + 99) % 99 - (ORDER.indexOf(b.kind) + 99) % 99)
}

/**
 * @param computedOpening balance at the start of the day from the books
 * @param yesterdayCount the approved count of the day before (null = none)
 * @param dayMovements every movement of the account on the day
 * @param count the latest count made on the day (any status; null = none)
 */
export function buildSheet(i: { computedOpening: number; yesterdayCount: { id: string; counted: number } | null; dayMovements: SheetMovement[]; count: SheetCount | null }): DailySheet {
  const fromCount = !!i.yesterdayCount
  const opening = r2(fromCount ? i.yesterdayCount!.counted : i.computedOpening)
  // left out: the difference posted by the day before's count (already inside the opening) and by THIS day's count
  // (it is the result of the count, not money of the day)
  const own = (m: SheetMovement, c: { id: string } | null) => !!c && m.kind === 'ADJUST' && m.cashCountId === c.id
  const rows = i.dayMovements.filter((m) => !(fromCount && own(m, i.yesterdayCount)) && !own(m, i.count))
  const ins = rows.filter((m) => m.direction === 'IN')
  const outs = rows.filter((m) => m.direction !== 'IN')
  const totalIn = r2(ins.reduce((a, m) => a + m.amount, 0))
  const totalOut = r2(outs.reduce((a, m) => a + m.amount, 0))
  const expected = r2(opening + totalIn - totalOut)
  return {
    opening, openingSource: fromCount ? 'YESTERDAY_COUNT' : 'COMPUTED',
    inGroups: group(ins), outGroups: group(outs), totalIn, totalOut, expected,
    count: i.count, difference: i.count ? r2(i.count.difference) : null,
    afterCount: i.count ? r2(rows.filter((m) => new Date(m.date).getTime() > new Date(i.count!.countedAt).getTime()).reduce((a, m) => a + (m.direction === 'IN' ? m.amount : -m.amount), 0)) : 0,
    state: !i.count ? 'NOT_COUNTED' : (i.count.status as DailySheet['state']),
  }
}

/** Totals row of several accounts (the summary page). */
export function sheetTotals(sheets: DailySheet[]) {
  const sum = (f: (s: DailySheet) => number) => r2(sheets.reduce((a, s) => a + f(s), 0))
  return {
    opening: sum((s) => s.opening), totalIn: sum((s) => s.totalIn), totalOut: sum((s) => s.totalOut), expected: sum((s) => s.expected),
    counted: sum((s) => s.count?.counted ?? 0), difference: sum((s) => s.difference ?? 0),
    notCounted: sheets.filter((s) => s.state === 'NOT_COUNTED').length,
  }
}
