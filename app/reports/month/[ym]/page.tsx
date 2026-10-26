'use client'

/**
 * a03 monthly financial report (2026-10-26) — printable, outside the dashboard. /reports/month/YYYY-MM?campusId=
 * A closed month shows the copy saved when it was closed; "live numbers" recomputes it now.
 */

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { FileSpreadsheet, Printer } from 'lucide-react'
import { cairoToday } from '@/lib/dates/cairo'
import { monthName } from '@/lib/month-close/rules'
import type { MonthReport } from '@/lib/month-close/report'

interface Out { report: MonthReport; frozen: boolean; lockedAt: string | null }
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${L('EGP', 'ج.م')}`
const BLUE = '#1B4F8A'

function Change({ now, before }: { now: number; before: number }) {
  if (!before) return null
  const pct = Math.round(((now - before) / Math.abs(before)) * 100)
  return <span className={`ms-1 text-[10px] ${pct >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 break-inside-avoid">
      <h2 className="mb-1 border-b pb-1 text-sm font-bold" style={{ color: BLUE }}>{title}</h2>
      {children}
    </section>
  )
}

function Lines({ rows }: { rows: { label: string; amount: number; count?: number; strong?: boolean }[] }) {
  return (
    <table className="w-full text-xs"><tbody>
      {rows.map((r, i) => (
        <tr key={i} className={`border-b ${r.strong ? 'font-bold' : ''}`}>
          <td className="p-1">{r.label}{r.count !== undefined ? <span className="text-gray-500"> ({r.count})</span> : null}</td>
          <td className="p-1 text-end">{money(r.amount)}</td>
        </tr>
      ))}
    </tbody></table>
  )
}

function View({ ym }: { ym: string }) {
  const ar = useI18n().locale === 'ar'
  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const campusId = sp?.get('campusId') || ''
  const [live, setLive] = useState(false)
  const qs = `ym=${ym}${campusId ? `&campusId=${campusId}` : ''}${live ? '&live=1' : ''}`
  const { data, error, isLoading } = useQuery({ queryKey: ['month-report', qs], queryFn: () => fetchApi<Out>(`/api/month-close/report?${qs}`) })
  const r = data?.report
  const lang = ar ? 'ar' : 'en'

  const excel = async () => {
    try {
      const res = await fetch(`/api/month-close/report?${qs}&format=xlsx`)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'Export failed')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = `monthly-report-${ym}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { notify.error((e as Error).message) }
  }

  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / PDF', 'اطبع / PDF')}</Button>
        <Button variant="outline" onClick={excel}><FileSpreadsheet className="me-2 h-4 w-4" />Excel</Button>
        {(data?.frozen || live) && (
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />{L('Live numbers (not the saved copy)', 'الأرقام الحالية (مش النسخة المحفوظة)')}</label>
        )}
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {isLoading && <p className="text-center text-sm text-gray-500">{L('Loading…', 'بيحمّل…')}</p>}
      {r && (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: BLUE }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: BLUE }}>{L('Monthly financial report', 'التقرير المالي الشهري')}</h1>
              <p className="text-xs text-gray-600">{monthName(r.ym, lang)} · {r.placeName ?? L('Whole company', 'الشركة كلها')}</p>
              <p className={`text-[11px] ${data.frozen ? 'text-emerald-700' : 'text-amber-700'}`}>
                {data.frozen ? `🔒 ${L('Month closed — saved copy of', 'الشهر مقفول — نسخة محفوظة يوم')} ${data.lockedAt?.slice(0, 10)}` : L('Month not closed — numbers can still change', 'الشهر مش مقفول — الأرقام لسه ممكن تتغير')}
              </p>
            </div>
          </div>

          <table className="mb-4 w-full text-center text-xs"><tbody><tr>
            <td className="border p-2"><b className="block text-base">{money(r.totals.netIncome)}</b>{L('net income', 'صافي الإيراد')}<Change now={r.totals.netIncome} before={r.previous.netIncome} /></td>
            <td className="border p-2"><b className="block text-base">{money(r.totals.totalCosts)}</b>{L('expenses + salaries', 'المصاريف + المرتبات')}<Change now={r.totals.totalCosts} before={r.previous.totalCosts} /></td>
            <td className="border p-2" style={{ background: '#eef3fb' }}><b className={`block text-base ${r.totals.profit < 0 ? 'text-rose-700' : ''}`}>{money(r.totals.profit)}</b>{L('profit', 'الربح')}<Change now={r.totals.profit} before={r.previous.profit} /></td>
          </tr></tbody></table>

          <Section title={L('Profit & loss', 'الأرباح والخسائر')}>
            <Lines rows={[
              { label: L('Payments received', 'الفلوس اللي اتحصّلت'), amount: r.totals.income },
              { label: L('− Refunds approved', '− المرتجعات'), amount: r.totals.refunds },
              { label: L('Net income', 'صافي الإيراد'), amount: r.totals.netIncome, strong: true },
              { label: L('− Expenses', '− المصاريف'), amount: r.totals.expenses },
              { label: L('− Salaries of the month', '− مرتبات الشهر'), amount: r.totals.salaries },
              { label: L('Profit', 'الربح'), amount: r.totals.profit, strong: true },
              { label: `${L('Profit of', 'ربح')} ${monthName(r.previous.ym, lang)}`, amount: r.previous.profit },
            ]} />
          </Section>

          <div className="grid gap-x-6 sm:grid-cols-2 print:grid-cols-2">
            <Section title={L('Income by payment method', 'الإيراد حسب طريقة الدفع')}>
              {r.incomeByMethod.length ? <Lines rows={r.incomeByMethod.map((x) => ({ label: x.en, amount: x.amount, count: x.count }))} /> : <p className="text-xs text-gray-500">—</p>}
            </Section>
            <Section title={L('Income by how it was paid', 'الإيراد حسب طريقة الوصول')}>
              {r.incomeBySource.length ? <Lines rows={r.incomeBySource.map((x) => ({ label: ar ? x.ar : x.en, amount: x.amount, count: x.count }))} /> : <p className="text-xs text-gray-500">—</p>}
            </Section>
            {r.incomeByBranch.length > 0 && (
              <Section title={L('Income by branch', 'الإيراد حسب الفرع')}><Lines rows={r.incomeByBranch.map((x) => ({ label: x.en, amount: x.amount, count: x.count }))} /></Section>
            )}
            <Section title={L('Refunds', 'المرتجعات')}>
              <Lines rows={[{ label: L('Cash back', 'كاش'), amount: r.refunds.cash }, { label: L('To the wallet', 'على المحفظة'), amount: r.refunds.wallet }]} />
            </Section>
            <Section title={L('Expenses by category', 'المصاريف حسب البند')}>
              {r.expensesByCategory.length ? <Lines rows={r.expensesByCategory.map((x) => ({ label: ar ? x.ar : x.en, amount: x.amount, count: x.count }))} /> : <p className="text-xs text-gray-500">—</p>}
              {r.budget && <p className="mt-1 text-xs">{L('Budget', 'الميزانية')}: <b>{money(r.budget.budget)}</b> · {L('spent', 'المصروف')}: <b className={r.budget.actual > r.budget.budget ? 'text-rose-700' : ''}>{money(r.budget.actual)}</b></p>}
            </Section>
            <Section title={L('Salaries of the month', 'مرتبات الشهر')}>
              <Lines rows={[{ label: L('Slips', 'قسايم'), amount: r.salaries.total, count: r.salaries.count }, { label: L('Paid', 'اتصرف'), amount: r.salaries.paid }, { label: L('Not paid yet', 'لسه متصرفش'), amount: r.salaries.unpaid }]} />
            </Section>
            <Section title={L('Invoices made this month', 'فواتير الشهر')}>
              <Lines rows={[
                { label: L('Invoices', 'الفواتير'), amount: r.invoices.total, count: r.invoices.count },
                { label: L('Discounts given', 'الخصومات'), amount: r.invoices.discount },
                { label: L('Collected so far', 'اتحصّل منها'), amount: r.invoices.collected },
                { label: L('Still owed', 'لسه مستحق'), amount: r.invoices.stillDue, strong: true },
              ]} />
              <p className="mt-1 text-[11px] text-gray-600">{L('Unpaid invoices are not income: they count when the money comes in.', 'الفواتير اللي متدفعتش مش إيراد: بتتحسب لما الفلوس تيجي.')}</p>
            </Section>
            <Section title={L('Owed by families', 'المستحق على الأهالي')}>
              <Lines rows={[{ label: L('All unpaid invoices due by the month end', 'كل الفواتير المستحقة لحد آخر الشهر ولسه متدفعتش'), amount: r.receivablesNow, strong: true }]} />
            </Section>
            <Section title={L('Wallets', 'المحافظ')}>
              <Lines rows={[
                { label: L('Top-ups', 'شحن'), amount: r.wallet.topUps },
                { label: L('Withdrawals', 'سحب'), amount: r.wallet.withdrawals },
                { label: L('Families\' money held (not income yet)', 'فلوس الأهالي اللي عندنا (لسه مش إيراد)'), amount: r.wallet.prepaidNow },
              ]} />
            </Section>
            {(r.partners.received > 0 || r.partners.paid > 0) && (
              <Section title={L('Partners (outside the profit above)', 'الشركاء (برا الربح اللي فوق)')}>
                <Lines rows={[{ label: L('Received from partners', 'استلمنا من الشركاء'), amount: r.partners.received }, { label: L('Paid to partners', 'دفعنا للشركاء'), amount: r.partners.paid }]} />
              </Section>
            )}
          </div>

          {r.accounts.length > 0 && (
            <Section title={L('Balances at the end of the month', 'الأرصدة آخر الشهر')}>
              <Lines rows={r.accounts.map((a) => ({ label: a.name, amount: a.balance }))} />
            </Section>
          )}
          <p className="mt-6 text-center text-xs text-gray-400">TechNova · {L('made', 'اتعمل')} {r.generatedAt.slice(0, 10)} · {L('printed', 'اتطبع')} {cairoToday()}</p>
        </div>
      )}
    </div>
  )
}

export default function MonthReportPage({ params }: { params: Promise<{ ym: string }> }) {
  const { ym } = use(params)
  return <I18nProvider><View ym={ym} /></I18nProvider>
}
