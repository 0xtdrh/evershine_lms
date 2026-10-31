/**
 * a04 daily cash-close sheet → branded Excel (owner 2026-10-31: "أيوه ضيفه"). Same numbers as the printed sheet.
 * Totals: one row per account. One account: the summary, every movement in / out, then the count. Server-only.
 */

import { NextResponse } from 'next/server'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'
import { MOVEMENT_KIND_LABEL, type MovementKind } from './rules'
import type { AccountSheet } from './daily-sheet'

const STATE: Record<AccountSheet['state'], string> = {
  NOT_COUNTED: 'Not counted yet · لسه متجردش', PENDING: 'Waiting for approval · مستني الموافقة',
  APPROVED: 'Approved · اتوافق عليه', REJECTED: 'Rejected · اترفض',
}
const kind = (k: string) => (MOVEMENT_KIND_LABEL[k as MovementKind] ?? [k, k]).join(' · ')
const at = (d: Date | string | null) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

async function send(wb: Awaited<ReturnType<typeof createBrandedWorkbook>>, name: string) {
  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` },
  })
}

export async function sheetsExcel(date: string, sheets: AccountSheet[]) {
  const wb = await createBrandedWorkbook({
    title: `Daily cash-close — all accounts · كشف إقفال اليوم`, subtitle: date, sheetName: 'Cash close',
    columns: [
      { header: 'Account · الحساب', key: 'account', width: 28 }, { header: 'Branch · الفرع', key: 'campus', width: 20 },
      { header: 'Opening · أول اليوم', key: 'opening', width: 16 }, { header: 'In · دخل', key: 'in', width: 14 }, { header: 'Out · خرج', key: 'out', width: 14 },
      { header: 'Should be · المفروض', key: 'expected', width: 16 }, { header: 'Counted · المعدود', key: 'counted', width: 16 },
      { header: 'Difference · الفرق', key: 'difference', width: 14 }, { header: 'State · الحالة', key: 'state', width: 30 },
    ],
    rows: sheets.map((s) => ({
      account: s.account.name, campus: s.account.campus ?? 'Company · الشركة', opening: s.opening, in: s.totalIn, out: s.totalOut,
      expected: s.expected, counted: s.count?.counted ?? '', difference: s.difference ?? '', state: STATE[s.state],
    })),
  })
  return send(wb, `cash-close-${date}`)
}

export async function sheetExcel(s: AccountSheet) {
  type Row = { part: string; time: string; item: string; method: string; amount: number | string }
  const rows: Row[] = [
    { part: 'Summary · الملخص', time: '', item: `Opening (${s.openingSource === 'YESTERDAY_COUNT' ? "yesterday's approved count · جرد امبارح" : 'from the books · من الدفاتر'})`, method: '', amount: s.opening },
    { part: 'Summary · الملخص', time: '', item: 'Money in · دخل', method: '', amount: s.totalIn },
    { part: 'Summary · الملخص', time: '', item: 'Money out · خرج', method: '', amount: -s.totalOut },
    { part: 'Summary · الملخص', time: '', item: 'Should be in the box · المفروض', method: '', amount: s.expected },
  ]
  for (const g of s.inGroups) for (const m of g.lines) rows.push({ part: `In · دخل — ${kind(g.kind)}`, time: at(m.date), item: m.note ?? '', method: m.method ?? '', amount: m.amount })
  for (const g of s.outGroups) for (const m of g.lines) rows.push({ part: `Out · خرج — ${kind(g.kind)}`, time: at(m.date), item: m.note ?? '', method: m.method ?? '', amount: -m.amount })
  if (s.count) {
    rows.push(
      { part: 'Count · الجرد', time: at(s.count.countedAt), item: `Counted by · جرده: ${s.count.countedBy}`, method: '', amount: s.count.counted },
      { part: 'Count · الجرد', time: '', item: 'The books at the time of the count · الدفاتر وقت الجرد', method: '', amount: s.count.expected },
      { part: 'Count · الجرد', time: '', item: 'Difference · الفرق', method: '', amount: s.difference ?? 0 },
      { part: 'Count · الجرد', time: '', item: 'In − out after the count · بعد الجرد', method: '', amount: s.afterCount },
      { part: 'Count · الجرد', time: at(s.count.approvedAt), item: `Approved by · وافق عليه: ${s.count.approvedBy ?? '—'}`, method: '', amount: '' },
    )
  } else rows.push({ part: 'Count · الجرد', time: '', item: STATE.NOT_COUNTED, method: '', amount: '' })
  const wb = await createBrandedWorkbook({
    title: `Daily cash-close sheet · كشف إقفال اليوم`, subtitle: `${s.account.name}${s.account.campus ? ` · ${s.account.campus}` : ''} · ${s.date} · ${STATE[s.state]}`, sheetName: 'Cash close',
    columns: [
      { header: 'Part · الجزء', key: 'part', width: 30 }, { header: 'Time · الوقت', key: 'time', width: 16 },
      { header: 'Item · البيان', key: 'item', width: 44 }, { header: 'Method · الطريقة', key: 'method', width: 16 }, { header: 'Amount (EGP) · المبلغ', key: 'amount', width: 16 },
    ],
    rows,
  })
  return send(wb, `cash-close-${s.date}-${s.account.name.replace(/[^\w-]+/g, '_').slice(0, 30)}`)
}
