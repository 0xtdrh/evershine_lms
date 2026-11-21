'use client'

import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { fetchPaginatedApi } from '@/lib/api-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Wallet, ReceiptText, CalendarDays, TrendingUp, Download, Banknote, CreditCard, BarChart2, FileText } from 'lucide-react'
import { notify } from '@/lib/notify'
import { cairoToday } from '@/lib/dates/cairo'
import { L, useI18n } from '@/lib/i18n/client'

interface ExpenseRecord {
  id: string
  title: string
  category: string
  amount: string | number
  date: string
  isApproved: boolean
  notes?: string | null
  accountant?: { firstName?: string; lastName?: string }
}

export default function AccountantDashboardPage() {
  useI18n() // re-render on a language switch
  const { data: session, status } = useSession()
  const role = (session?.user?.role as string) || ''

  const canAccess = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(role)

  const { data, isLoading } = useQuery({
    queryKey: ['accountant-expenses-dashboard'],
    queryFn: () => fetchPaginatedApi<ExpenseRecord>('/api/accountant/expenses?limit=8'),
    enabled: canAccess,
  })

  const { data: leaveSummary, isLoading: isLoadingLeaveSummary } = useQuery({
    queryKey: ['accountant-leave-summary'],
    queryFn: () => fetchPaginatedApi<{ id: string }>('/api/leaves?limit=1'),
    enabled: canAccess,
  })

  const leaveCount = leaveSummary?.pagination.total ?? 0
  const expenses = useMemo(() => data?.data ?? [], [data?.data])

  const exportSummary = async () => {
    try {
      const response = await fetch('/api/accountant/expenses/export', { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Unable to generate the expense export.')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `accountant-expenses-${cairoToday()}.xlsx`
      link.click()
      window.URL.revokeObjectURL(url)
      notify.success(L('Expense report downloaded', 'تقرير المصاريف اتنزّل'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The export could not be created.'
      notify.error(L('Unable to export expenses', 'تصدير المصاريف ماحصلش'), { description: message })
    }
  }

  const summary = useMemo(() => {
    const currentMonth = new Date()
    const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)

    const total = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const thisMonth = expenses.filter((item) => new Date(item.date) >= monthStart).reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const approved = expenses.filter((item) => item.isApproved).length
    const categories = new Set(expenses.map((item) => item.category)).size

    return { total, thisMonth, approved, categories }
  }, [expenses])

  if (status === 'loading') return null
  if (!canAccess) {
    return (
      <AccessDenied
        title={L('Finance Workspace Access', 'صلاحية الحسابات')}
        message="Only finance staff and admins can open the accounting workspace."
      />
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">{L('Accounting Hub', 'ملخص الحسابات')}</p>
          <h1 className="text-2xl font-black text-slate-900">{L('Finance workspace overview', 'نظرة عامة على الحسابات')}</h1>
          <p className="text-sm text-slate-500">{L('This dedicated finance workspace keeps campus expenses, payroll, and reporting aligned for approved finance staff.', 'هنا المصاريف والمرتبات والتقارير في مكان واحد لفريق الحسابات.')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={exportSummary} className="gap-2 border-teal-200 text-teal-700 hover:bg-teal-50">
            <Download className="h-4 w-4" /> {L('Export report', 'تصدير تقرير')}
          </Button>
          <Button asChild variant="secondary" className="gap-2 border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100">
            <Link href="/dashboard/accountant/reports">
              <BarChart2 className="h-4 w-4" /> {L('Financial Reports', 'التقارير المالية')}
            </Link>
          </Button>
          <Button asChild className="bg-teal-600 hover:bg-teal-700 text-white">
            <Link href="/dashboard/accountant/expenses">{L('Record an expense', 'سجّل مصروف')}</Link>
          </Button>
        </div>
      </div>

      <Card className="border-teal-100 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{L('Finance workflow', 'ترتيب الشغل المالي')}</CardTitle>
          <CardDescription>{L('Use this order to keep income, expense, payroll, and reserve records consistent.', 'مشي بالترتيب ده علشان الدخل والمصاريف والمرتبات يفضلوا مظبوطين.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            ['1', 'Issue and verify fees', 'Create student invoices, review payment proofs, then export paid and defaulter lists.'],
            ['2', 'Record costs', 'Add campus expenses with payment method/reference and keep salary slips marked paid when released.'],
            ['3', 'Generate P&L', 'Choose the period and campus, then create the audited P&L snapshot from posted transactions.'],
            ['4', 'Review reserve', 'SuperAdmin reviews cumulative reserve balance and allocation history from the reserve ledger.'],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-xs font-black text-white">{step}</span>
              <p className="mt-3 text-sm font-bold text-slate-900">{title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">{L('Total expenses', 'إجمالي المصاريف')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black">{formatCurrency(summary.total)}</span>
              <Wallet className="h-5 w-5 text-teal-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">{L('This month', 'الشهر ده')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black">{formatCurrency(summary.thisMonth)}</span>
              <CalendarDays className="h-5 w-5 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">{L('Approved entries', 'مدخلات معتمدة')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black">{summary.approved}</span>
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-500">{L('Categories used', 'البنود المستخدمة')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black">{summary.categories}</span>
              <ReceiptText className="h-5 w-5 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-100 bg-amber-50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm text-slate-500">{L('Leave request queue', 'طلبات الإجازات')}</CardTitle>
          <CardDescription>{L('Review the leave dashboard for all staff and student requests.', 'راجع طلبات الإجازات.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-3xl font-black text-slate-900">{isLoadingLeaveSummary ? 'Loading…' : leaveCount}</p>
            <p className="text-sm text-slate-600">{L('Total leave requests pending or in review.', 'طلبات الإجازات المستنية أو تحت المراجعة.')}</p>
          </div>
          <Button asChild className="bg-amber-600 text-white hover:bg-amber-700">
            <Link href="/dashboard/leaves">{L('Open Leaves Hub', 'افتح الإجازات')}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-teal-100 bg-teal-50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{L('Profit & Loss reporting', 'الأرباح والخسائر')}</CardTitle>
          <CardDescription>{L('Jump to period statements, reserve fund allocations, and exports from one place.', 'الكشوف والاحتياطي والتصدير من مكان واحد.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-600 max-w-2xl">
              {L('Generate P&L snapshots, review gross margin performance, and track reserve fund contributions for your campus or institution.', 'اعمل كشف الأرباح والخسائر وتابع الاحتياطي لفرعك أو للشركة.')}
            </p>
          </div>
          <Button asChild className="bg-teal-700 text-white hover:bg-teal-800 gap-2">
            <Link href="/dashboard/accountant/reports" className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4" /> {L('Open Financial Reports', 'افتح التقارير المالية')}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{L('Account manager finance blueprint', 'دليل الحسابات')}</CardTitle>
          <CardDescription>{L('Open the new frontend design guide for pricing, payments, proofs, and payroll workflows.', 'دليل الأسعار والدفع والإيصالات والمرتبات.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-600 max-w-2xl">
              {L('This page makes the accountant finance spec visible in the LMS UI and links finance staff directly to the new implementation guide.', 'الدليل ده بيشرح شغل الحسابات خطوة بخطوة.')}
            </p>
          </div>
          <Button asChild className="bg-teal-600 text-white hover:bg-teal-700 gap-2">
            <Link href="/dashboard/accountant/design-docs" className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> {L('Open Finance Blueprint', 'افتح الدليل')}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-teal-100 bg-gradient-to-br from-teal-50 via-white to-emerald-50">
        <CardHeader>
          <CardTitle className="text-base">{L('Finance essentials', 'أهم شغل الحسابات')}</CardTitle>
          <CardDescription>{L('Jump straight to the core finance workflows used by account managers, admins, and finance staff.', 'روابط سريعة للشغل اليومي.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Button asChild variant="outline" className="h-auto justify-start gap-3 border-teal-200 bg-white p-4 text-left hover:bg-teal-50">
            <Link href="/dashboard/accountant/fees">
              <CreditCard className="h-4 w-4 text-teal-600" />
              <span>
                <span className="block font-semibold text-slate-900">{L('Fee collection', 'التحصيل')}</span>
                <span className="text-xs text-slate-500">{L('Invoice, payment, and proof review workflow', 'الفواتير والدفع ومراجعة الإيصالات')}</span>
              </span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start gap-3 border-amber-200 bg-white p-4 text-left hover:bg-amber-50">
            <Link href="/dashboard/accountant/expenses">
              <ReceiptText className="h-4 w-4 text-amber-600" />
              <span>
                <span className="block font-semibold text-slate-900">{L('Expense ledger', 'مصاريف التشغيل')}</span>
                <span className="text-xs text-slate-500">{L('Capture campus expenses and export reports', 'سجّل المصاريف وصدّر التقارير')}</span>
              </span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start gap-3 border-indigo-200 bg-white p-4 text-left hover:bg-indigo-50">
            <Link href="/dashboard/accountant/salary-slips">
              <Banknote className="h-4 w-4 text-indigo-600" />
              <span>
                <span className="block font-semibold text-slate-900">{L('Payroll slips', 'كشوف المرتبات')}</span>
                <span className="text-xs text-slate-500">{L('Generate and distribute staff salary records', 'اعمل كشوف مرتبات الموظفين')}</span>
              </span>
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-auto justify-start gap-3 border-emerald-200 bg-white p-4 text-left hover:bg-emerald-50">
            <Link href="/dashboard/accountant/reports">
              <ReceiptText className="h-4 w-4 text-emerald-600" />
              <span>
                <span className="block font-semibold text-slate-900">{L('Financial reports', 'التقارير المالية')}</span>
                <span className="text-xs text-slate-500">{L('Unified ledger, profit & loss, reserve allocations', 'الدفتر والأرباح والخسائر والاحتياطي')}</span>
              </span>
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{L('Recent expense activity', 'آخر المصاريف')}</CardTitle>
          <CardDescription>{L('Latest campus expense records are immediately available to finance reports.', 'آخر المصاريف اللي اتسجلت.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading recent records…</p>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-slate-500">{L('No expenses recorded yet for this campus.', 'لسه مفيش مصاريف اتسجلت.')}</p>
          ) : (
            expenses.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{item.title}</h3>
                    <Badge variant="secondary">{item.category}</Badge>
                    {item.isApproved && <Badge className="bg-emerald-100 text-emerald-700">{L('Approved', 'معتمد')}</Badge>}
                  </div>
                  <p className="text-sm text-slate-500">{item.notes || 'No additional notes provided.'}</p>
                  <p className="text-xs text-slate-400">Recorded on {formatDate(item.date)} by {item.accountant?.firstName || 'Accountant'} {item.accountant?.lastName || ''}</p>
                </div>
                <div className="text-right text-sm font-semibold text-slate-900">{formatCurrency(item.amount)}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
