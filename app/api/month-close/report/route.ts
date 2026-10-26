/**
 * GET /api/month-close/report?ym=YYYY-MM&campusId=&live=1&format=xlsx — a03 monthly financial report for the company
 * (no campusId, needs every place) or one branch. A closed month returns the copy frozen when it was closed
 * (`frozen: true`) unless live=1. month_close:read or financial_reports:read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { reportFor } from '@/lib/month-close/engine'
import { monthCloseError, monthCloseUser, scopeParam } from '@/lib/month-close/http'
import { monthName } from '@/lib/month-close/rules'
import type { MonthReport } from '@/lib/month-close/report'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'

type Row = { section: string; item: string; itemAr: string; amount: number | string }

function excelRows(r: MonthReport): Row[] {
  const t = r.totals
  const rows: Row[] = [
    { section: 'Summary', item: 'Payments received', itemAr: 'الفلوس اللي اتحصّلت', amount: t.income },
    { section: 'Summary', item: 'Refunds approved', itemAr: 'المرتجعات', amount: -t.refunds },
    { section: 'Summary', item: 'Net income', itemAr: 'صافي الإيراد', amount: t.netIncome },
    { section: 'Summary', item: 'Expenses', itemAr: 'المصاريف', amount: -t.expenses },
    { section: 'Summary', item: 'Salaries of the month', itemAr: 'مرتبات الشهر', amount: -t.salaries },
    { section: 'Summary', item: 'Profit', itemAr: 'الربح', amount: t.profit },
    { section: 'Summary', item: `Profit ${r.previous.ym}`, itemAr: `ربح ${r.previous.ym}`, amount: r.previous.profit },
  ]
  for (const x of r.incomeByMethod) rows.push({ section: 'Income by method', item: x.en, itemAr: x.ar, amount: x.amount })
  for (const x of r.incomeBySource) rows.push({ section: 'Income by source', item: x.en, itemAr: x.ar, amount: x.amount })
  for (const x of r.incomeByBranch) rows.push({ section: 'Income by branch', item: x.en, itemAr: x.ar, amount: x.amount })
  rows.push({ section: 'Refunds', item: 'Cash back', itemAr: 'كاش', amount: r.refunds.cash }, { section: 'Refunds', item: 'To the wallet', itemAr: 'على المحفظة', amount: r.refunds.wallet })
  for (const x of r.expensesByCategory) rows.push({ section: 'Expenses', item: x.en, itemAr: x.ar, amount: x.amount })
  rows.push(
    { section: 'Salaries', item: 'Paid', itemAr: 'اتصرف', amount: r.salaries.paid },
    { section: 'Salaries', item: 'Not paid yet', itemAr: 'لسه متصرفش', amount: r.salaries.unpaid },
    { section: 'Invoices of the month', item: `Made (${r.invoices.count})`, itemAr: `اتعملت (${r.invoices.count})`, amount: r.invoices.total },
    { section: 'Invoices of the month', item: 'Discounts', itemAr: 'الخصومات', amount: r.invoices.discount },
    { section: 'Invoices of the month', item: 'Collected', itemAr: 'اتحصّل منها', amount: r.invoices.collected },
    { section: 'Invoices of the month', item: 'Still owed', itemAr: 'لسه مستحق', amount: r.invoices.stillDue },
    { section: 'Owed by families', item: 'All unpaid invoices due by the month end', itemAr: 'كل الفواتير المستحقة لحد آخر الشهر ولسه متدفعتش', amount: r.receivablesNow },
    { section: 'Wallets', item: 'Top-ups', itemAr: 'شحن', amount: r.wallet.topUps },
    { section: 'Wallets', item: 'Withdrawals', itemAr: 'سحب', amount: r.wallet.withdrawals },
    { section: 'Wallets', item: 'Prepaid by families (owed to them)', itemAr: 'رصيد المحافظ (فلوس الأهالي عندنا)', amount: r.wallet.prepaidNow },
    { section: 'Partners', item: 'Received', itemAr: 'استلمنا', amount: r.partners.received },
    { section: 'Partners', item: 'Paid', itemAr: 'دفعنا', amount: r.partners.paid },
  )
  if (r.budget) rows.push({ section: 'Budget', item: 'Budget', itemAr: 'الميزانية', amount: r.budget.budget }, { section: 'Budget', item: 'Spent', itemAr: 'المصروف', amount: r.budget.actual })
  for (const a of r.accounts) rows.push({ section: 'Balances at the month end', item: a.name, itemAr: a.name, amount: a.balance })
  return rows
}

export async function GET(request: NextRequest) {
  const u = await monthCloseUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  try {
    const out = await reportFor(u.user, sp.get('ym') ?? '', scopeParam(sp.get('campusId')), sp.get('live') === '1')
    if (sp.get('format') !== 'xlsx') return successResponse(out)
    const r = out.report
    const wb = await createBrandedWorkbook({
      title: `Monthly financial report — ${monthName(r.ym, 'en')}`,
      subtitle: `${r.placeName ?? 'Whole company'}${out.frozen ? ` · frozen at close (${out.lockedAt?.slice(0, 10)})` : ' · live'}`,
      sheetName: 'Monthly report',
      columns: [
        { header: 'Section', key: 'section', width: 24 }, { header: 'Item', key: 'item', width: 34 },
        { header: 'البند', key: 'itemAr', width: 34 }, { header: 'Amount (EGP)', key: 'amount', width: 16 },
      ],
      rows: excelRows(r),
    })
    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="monthly-report-${r.ym}.xlsx"`,
      },
    })
  } catch (e) { return monthCloseError(e) }
}
