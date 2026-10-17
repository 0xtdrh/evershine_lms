/**
 * FIN-3 — pure money maths for the cash-flow and "where every pound went" reports. Works on money movements
 * (lib/treasury/sync.ts) so both reports agree with the account balances. Transfers between our own accounts are left
 * out (the money did not come in or go out of the company). No Prisma.
 */

export interface Move { date: Date | string; direction: string; amount: number; kind: string; category?: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100
const ym = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7)

/** The last `n` months ending with `last` (YYYY-MM), oldest first. */
export function monthsBack(last: string, n: number): string[] {
  const [y, m] = last.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

export interface FlowRow { month: string; in: number; out: number; net: number; running: number; byKind: Record<string, { in: number; out: number }> }

/** Money in / out per month (transfers left out) and the running total from `opening`. */
export function monthlyFlow(moves: Move[], months: string[], opening = 0): FlowRow[] {
  const rows = new Map(months.map((m) => [m, { month: m, in: 0, out: 0, net: 0, running: 0, byKind: {} as FlowRow['byKind'] }]))
  for (const mv of moves) {
    if (mv.kind === 'TRANSFER') continue
    const row = rows.get(ym(mv.date))
    if (!row) continue
    const k = (row.byKind[mv.kind] ??= { in: 0, out: 0 })
    if (mv.direction === 'IN') { row.in += mv.amount; k.in += mv.amount } else { row.out += mv.amount; k.out += mv.amount }
  }
  let run = opening
  return [...rows.values()].map((r) => {
    run += r.in - r.out
    for (const k of Object.values(r.byKind)) { k.in = r2(k.in); k.out = r2(k.out) }
    return { ...r, in: r2(r.in), out: r2(r.out), net: r2(r.in - r.out), running: r2(run) }
  })
}

export interface Forecast { expectedIn: number; overdue: number; expectedOut: number; balanceNow: number; balanceAfter: number; basisMonths: number }

/**
 * Next 30 days: money expected in = unpaid invoices due in that time (overdue ones are shown apart and NOT counted —
 * they may never come); money expected out = the average monthly out of the last full months (expenses, salaries,
 * refunds…). balanceAfter < 0 = a warning.
 */
export function forecastNext30(i: { dueSoon: number; overdue: number; pastOut: number[]; balanceNow: number }): Forecast {
  const used = i.pastOut.filter((x) => x > 0)
  const expectedOut = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0
  return { expectedIn: r2(i.dueSoon), overdue: r2(i.overdue), expectedOut: r2(expectedOut), balanceNow: r2(i.balanceNow), balanceAfter: r2(i.balanceNow + i.dueSoon - expectedOut), basisMonths: used.length }
}

export const IN_LINES = ['PAYMENT', 'TOPUP', 'PARTNER', 'ADJUST'] as const
export const OUT_LINES = ['EXPENSE', 'SALARY', 'REFUND', 'WITHDRAWAL', 'PARTNER', 'ADJUST'] as const

export interface Pound { key: string; category?: string; amount: number; pct: number }

/**
 * Where every pound of the period went: what came in (families' payments and top-ups, partners…) and what went out
 * (expenses per category, salaries, refunds, wallet withdrawals, partners), what was kept, and each line's share of
 * the money that came in.
 */
export function wherePound(moves: Move[]) {
  const ins = new Map<string, number>()
  const outs = new Map<string, number>()
  for (const mv of moves) {
    if (mv.kind === 'TRANSFER') continue
    if (mv.direction === 'IN') ins.set(mv.kind, (ins.get(mv.kind) ?? 0) + mv.amount)
    else {
      const key = mv.kind === 'EXPENSE' ? `EXPENSE:${mv.category || 'other'}` : mv.kind
      outs.set(key, (outs.get(key) ?? 0) + mv.amount)
    }
  }
  const totalIn = r2([...ins.values()].reduce((a, b) => a + b, 0))
  const totalOut = r2([...outs.values()].reduce((a, b) => a + b, 0))
  const pct = (n: number) => (totalIn > 0 ? Math.round((n / totalIn) * 1000) / 10 : 0)
  const line = ([key, amount]: [string, number]): Pound => key.startsWith('EXPENSE:')
    ? { key: 'EXPENSE', category: key.slice(8), amount: r2(amount), pct: pct(amount) }
    : { key, amount: r2(amount), pct: pct(amount) }
  return {
    in: [...ins.entries()].map(line).sort((a, b) => b.amount - a.amount),
    out: [...outs.entries()].map(line).sort((a, b) => b.amount - a.amount),
    totalIn, totalOut, kept: r2(totalIn - totalOut), keptPct: pct(totalIn - totalOut),
  }
}
