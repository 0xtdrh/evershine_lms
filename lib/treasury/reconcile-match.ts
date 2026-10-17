/**
 * FIN-3 bank reconciliation — pure matching of bank statement lines with the system's movements of that account.
 * A line matches a movement with the same direction and amount (±0.01) within ±3 days; when several fit, the one
 * whose note holds the bank reference wins, then the closest date. Each movement is used once. No Prisma.
 */

export interface BankLine { row: number; date: string; amount: number; description: string; reference: string }
export interface SysMove { id: string; date: string; direction: 'IN' | 'OUT' | string; amount: number; note: string | null; reconciled: boolean }

const DAY = 86_400_000
const t = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime()

export function matchStatement(lines: BankLine[], moves: SysMove[], windowDays = 3) {
  const used = new Set<string>()
  const matched: { line: BankLine; move: SysMove }[] = []
  const bankOnly: BankLine[] = []
  for (const line of [...lines].sort((a, b) => t(a.date) - t(b.date))) {
    const dir = line.amount >= 0 ? 'IN' : 'OUT'
    const amt = Math.abs(line.amount)
    const cands = moves.filter((m) => !used.has(m.id) && m.direction === dir && Math.abs(m.amount - amt) < 0.01 && Math.abs(t(m.date) - t(line.date)) <= windowDays * DAY)
    if (!cands.length) { bankOnly.push(line); continue }
    const ref = line.reference.trim().toLowerCase()
    cands.sort((a, b) => {
      const ra = ref && (a.note ?? '').toLowerCase().includes(ref) ? 0 : 1
      const rb = ref && (b.note ?? '').toLowerCase().includes(ref) ? 0 : 1
      return ra - rb || Math.abs(t(a.date) - t(line.date)) - Math.abs(t(b.date) - t(line.date))
    })
    used.add(cands[0].id)
    matched.push({ line, move: cands[0] })
  }
  const systemOnly = moves.filter((m) => !used.has(m.id))
  return { matched, bankOnly, systemOnly }
}

/** Header words for the statement columns (English + Arabic, as banks in Egypt write them). */
export const STATEMENT_HEADERS = {
  date: ['date', 'value date', 'transaction date', 'التاريخ', 'تاريخ القيمة', 'تاريخ العملية'],
  amount: ['amount', 'المبلغ', 'القيمة'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'مدين', 'سحب', 'مسحوبات', 'خصم'],
  credit: ['credit', 'deposit', 'deposits', 'دائن', 'إيداع', 'ايداع', 'إيداعات', 'اضافة'],
  description: ['description', 'details', 'narrative', 'البيان', 'الوصف', 'التفاصيل'],
  reference: ['reference', 'ref', 'ref.', 'المرجع', 'رقم المرجع', 'رقم العملية'],
}

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim()

/** Which column holds what (index or -1). */
export function statementColumns(header: string[]) {
  const find = (words: string[]) => header.findIndex((h) => words.some((w) => norm(h) === norm(w) || norm(h).startsWith(`${norm(w)} `)))
  return { date: find(STATEMENT_HEADERS.date), amount: find(STATEMENT_HEADERS.amount), debit: find(STATEMENT_HEADERS.debit), credit: find(STATEMENT_HEADERS.credit), description: find(STATEMENT_HEADERS.description), reference: find(STATEMENT_HEADERS.reference) }
}
