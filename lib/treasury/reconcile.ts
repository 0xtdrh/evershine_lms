/**
 * FIN-3 bank reconciliation — upload the bank's statement (Excel or CSV) for a bank / e-wallet account, match each line
 * with the system's movements of that account (lib/treasury/reconcile-match.ts), then confirm: the matched movements get
 * reconciledAt + the bank reference. Lines only in the bank (bank fees, a deposit not recorded) and movements only in
 * the system (not cleared yet / recorded on the wrong account) are listed for the staff to fix. Nothing else changes.
 * Permission: treasury approve. Server-only.
 */

import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { toDate, toNumber, type Cell } from '@/lib/data-exchange/parse'
import { syncMovements } from './sync'
import { TreasuryError, visibleAccountWhere } from './engine'
import { matchStatement, statementColumns, type BankLine } from './reconcile-match'

type Who = { id: string; role: string }
const num = (v: unknown) => Number(v ?? 0)
const DAY = 86_400_000

function cellText(v: ExcelJS.CellValue): Cell {
  if (v == null) return null
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'object' && 'result' in v) return (v.result as Cell) ?? null
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('')
  if (typeof v === 'object' && 'text' in v) return String(v.text)
  return String(v)
}

function csvRows(text: string): Cell[][] {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  return text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const out: string[] = []; let cur = ''; let q = false
    for (const ch of line) {
      if (ch === '"') q = !q
      else if (ch === sep && !q) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    out.push(cur.trim())
    return out
  })
}

/** The statement file → bank lines (+ the columns found). Money in = credit / positive, out = debit / negative. */
export async function readStatement(buf: ArrayBuffer, fileName: string): Promise<{ lines: BankLine[]; skipped: number } | null> {
  let rows: Cell[][] = []
  if (/\.csv$/i.test(fileName)) rows = csvRows(new TextDecoder('utf-8').decode(buf))
  else {
    const wb = new ExcelJS.Workbook()
    try { await wb.xlsx.load(buf) } catch { return null }
    const sheet = wb.worksheets.find((s) => s.state === 'visible')
    if (!sheet) return null
    sheet.eachRow({ includeEmpty: true }, (row, n) => { const c: Cell[] = []; for (let i = 1; i <= row.cellCount; i++) c.push(cellText(row.getCell(i).value)); rows[n - 1] = c })
    rows = Array.from(rows, (r) => r ?? [])
  }
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const col = statementColumns((rows[h] ?? []).map((c) => String(c ?? '')))
    if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) continue
    const lines: BankLine[] = []
    let skipped = 0
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] ?? []
      const date = toDate(r[col.date])
      let amount: number | null = null
      if (col.amount >= 0) amount = toNumber(r[col.amount])
      else {
        const cr = col.credit >= 0 ? toNumber(r[col.credit]) : null
        const dr = col.debit >= 0 ? toNumber(r[col.debit]) : null
        amount = cr ? Math.abs(cr) : dr ? -Math.abs(dr) : null
      }
      if (!date || !amount) { if (r.some((c) => c != null && String(c).trim())) skipped++; continue }
      lines.push({ row: i + 1, date, amount, description: col.description >= 0 ? String(r[col.description] ?? '').slice(0, 200) : '', reference: col.reference >= 0 ? String(r[col.reference] ?? '').slice(0, 100) : '' })
    }
    return { lines, skipped }
  }
  return { lines: [], skipped: 0 }
}

async function bankAccount(user: Who, accountId: string) {
  if (!checkPermission(user.role, 'treasury', 'approve')) throw new TreasuryError('You cannot reconcile accounts')
  const acc = await prisma.moneyAccount.findFirst({ where: { id: accountId, ...(await visibleAccountWhere(user)) } })
  if (!acc) throw new TreasuryError('Account not found in your places')
  return acc
}

/** Compare the statement with the account's movements (nothing is saved). */
export async function previewReconcile(user: Who, accountId: string, lines: BankLine[]) {
  await bankAccount(user, accountId)
  if (!lines.length) throw new TreasuryError('No lines with a date and an amount were found in the file')
  await syncMovements(true)
  const ts = lines.map((l) => new Date(`${l.date}T00:00:00.000Z`).getTime())
  const range = { gte: new Date(Math.min(...ts) - 3 * DAY), lt: new Date(Math.max(...ts) + 4 * DAY) }
  const rows = await prisma.moneyMovement.findMany({ where: { accountId, date: range }, orderBy: { date: 'asc' }, select: { id: true, date: true, direction: true, amount: true, note: true, kind: true, reconciledAt: true, bankRef: true } })
  const moves = rows.map((m) => ({ id: m.id, date: m.date.toISOString().slice(0, 10), direction: m.direction, amount: num(m.amount), note: m.note, reconciled: !!m.reconciledAt, kind: m.kind }))
  const r = matchStatement(lines, moves)
  const kind = new Map(moves.map((m) => [m.id, m.kind]))
  return {
    matched: r.matched.filter((x) => !x.move.reconciled).map((x) => ({ line: x.line, move: { ...x.move, kind: kind.get(x.move.id) } })),
    already: r.matched.filter((x) => x.move.reconciled).length,
    bankOnly: r.bankOnly,
    systemOnly: r.systemOnly.filter((m) => !m.reconciled).map((m) => ({ ...m, kind: kind.get(m.id) })),
  }
}

/** Mark the chosen movements as matched with the bank (only this account's, not already done). */
export async function confirmReconcile(user: Who, accountId: string, pairs: { moveId: string; bankRef?: string | null }[]) {
  await bankAccount(user, accountId)
  let n = 0
  for (const p of pairs.slice(0, 2000)) {
    const res = await prisma.moneyMovement.updateMany({ where: { id: p.moveId, accountId, reconciledAt: null }, data: { reconciledAt: new Date(), reconciledById: user.id, bankRef: p.bankRef?.slice(0, 100) || null } })
    n += res.count
  }
  return { reconciled: n }
}

export async function undoReconcile(user: Who, accountId: string, moveId: string) {
  await bankAccount(user, accountId)
  const res = await prisma.moneyMovement.updateMany({ where: { id: moveId, accountId }, data: { reconciledAt: null, reconciledById: null, bankRef: null } })
  return { undone: res.count }
}

/** Per bank / e-wallet account: movements not matched with the bank yet, and the last match. */
export async function reconcileStatus(user: Who) {
  const accounts = await prisma.moneyAccount.findMany({ where: { isActive: true, kind: { not: 'CASH' }, ...(await visibleAccountWhere(user)) }, select: { id: true, name: true, kind: true }, orderBy: { name: 'asc' } })
  return Promise.all(accounts.map(async (a) => {
    const [open, last] = await Promise.all([
      prisma.moneyMovement.groupBy({ by: ['direction'], where: { accountId: a.id, reconciledAt: null }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.moneyMovement.findFirst({ where: { accountId: a.id, reconciledAt: { not: null } }, orderBy: { reconciledAt: 'desc' }, select: { reconciledAt: true } }),
    ])
    return { ...a, open: open.reduce((s, g) => s + g._count._all, 0), openIn: num(open.find((g) => g.direction === 'IN')?._sum.amount), openOut: num(open.find((g) => g.direction === 'OUT')?._sum.amount), lastReconciledAt: last?.reconciledAt ?? null }
  }))
}
