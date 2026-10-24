'use client'

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { L, useI18n } from '@/lib/i18n/client'
import { DataExchangeButtons } from '@/components/data/DataExchangeButtons'
import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AccessDenied } from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { Download, Edit3, Trash2, TrendingUp } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { campusLabel } from '@/lib/places/label'

interface ExpenseRecord {
  id: string
  title: string
  description?: string | null
  amount: string | number
  category: string
  categoryId?: string | null
  date: string
  paymentSource?: string | null
  paymentReference?: string | null
  isApproved: boolean
  notes?: string | null
  accountant?: { firstName?: string; lastName?: string } | null
  recordedByUser?: { email?: string | null } | null
  recordedByUserId?: string | null
}

/** FIN-1: categories come from Settings (ExpenseCategoryDef) — the owner adds, renames and hides them. */
interface CategoryDef { id: string; key: string; nameEn: string; nameAr: string; isActive: boolean }

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Petty Cash', 'Online']

export default function AccountantExpensesPage() {
  const { data: session, status } = useSession()
  const ar = useI18n().locale === 'ar'
  const { data: categoryDefs = [] } = useQuery({ queryKey: ['expense-categories'], queryFn: () => fetchApi<CategoryDef[]>('/api/expense-categories?all=1') })
  const activeCategories = categoryDefs.filter((c) => c.isActive)
  /** an id, or an old built-in key → the category id */
  const catId = (v: string | null | undefined) => categoryDefs.find((c) => c.id === v || c.key === v)?.id ?? v ?? ''
  const catName = (e: { categoryId?: string | null; category: string }) => { const c = categoryDefs.find((d) => d.id === e.categoryId) ?? categoryDefs.find((d) => d.key === e.category); return c ? (ar ? c.nameAr : c.nameEn) : e.category }
  const role = (session?.user?.role as string) || ''
  // the page and its buttons follow the expense permissions (Permissions page / overrides), like the APIs
  const { can, ready: permsReady } = useMyPermissions()
  const canAccess = !['STUDENT', 'PARENT', 'GUARDIAN', 'TEACHER'].includes(role) && can('expenses', 'read')
  const canCreate = can('expenses', 'create'), canUpdate = can('expenses', 'update'), canDelete = can('expenses', 'delete'), canExport = can('expenses', 'export')

  const queryClient = useQueryClient()
  const userCampusId = (session?.user as any)?.campusId
  const isGlobalAccountant = !userCampusId && canAccess

  const { data: campusData } = useQuery({
    queryKey: ['campuses', 'paged'],
    queryFn: () => fetchPaginatedApi<{id: string, name: string}>('/api/campuses?limit=100'),
    enabled: isGlobalAccountant,
  })
  const campuses = campusData?.data ?? []

  const [form, setForm] = useState({
    title: '',
    description: '',
    amount: '',
    category: 'UTILITIES',
    date: new Date().toISOString().split('T')[0],
    paymentSource: '',
    paymentReference: '',
    notes: '',
    campusId: '',
  })
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    amount: '',
    category: 'UTILITIES',
    date: new Date().toISOString().split('T')[0],
    paymentSource: '',
    paymentReference: '',
    notes: '',
  })
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [filterCampusId, setFilterCampusId] = useState('ALL')

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '20' })
    if (categoryFilter && categoryFilter !== 'ALL') params.set('categoryId', categoryFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (filterCampusId && filterCampusId !== 'ALL') params.set('campusId', filterCampusId)
    return params.toString()
  }, [categoryFilter, startDate, endDate, filterCampusId])

  const exportQueryString = useMemo(() => {
    const params = new URLSearchParams()
    if (categoryFilter && categoryFilter !== 'ALL') params.set('categoryId', categoryFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (filterCampusId && filterCampusId !== 'ALL') params.set('campusId', filterCampusId)
    return params.toString()
  }, [categoryFilter, startDate, endDate, filterCampusId])

  const { data, isLoading } = useQuery({
    queryKey: ['accountant-expenses', queryString],
    queryFn: () => fetchPaginatedApi<ExpenseRecord>(`/api/accountant/expenses?${queryString}`),
    enabled: canAccess,
  })

  const expenses = useMemo(() => data?.data ?? [], [data?.data])
  const getRecorderName = (item: ExpenseRecord) => {
    const accountantName = [item.accountant?.firstName, item.accountant?.lastName].filter(Boolean).join(' ').trim()
    return accountantName || item.recordedByUser?.email || item.recordedByUserId || 'Admin'
  }
  const total = useMemo(() => expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenses])

  const { data: expenseColumnSupport, isLoading: isLoadingExpenseColumns, isError: expenseColumnSupportError } = useQuery({
    queryKey: ['expense-column-support'],
    queryFn: () => fetchApi<{ paymentSource: boolean; paymentReference: boolean }>('/api/accountant/expenses/columns'),
    enabled: canAccess,
    staleTime: 60_000,
    gcTime: 300_000,
  })

  const { mutateAsync: updateExpenseAsync, isPending: isUpdatingExpense } = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      fetchApi<void>(`/api/accountant/expenses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountant-expenses'] })
      notify.success(L('Expense updated successfully', 'المصروف اتعدّل'))
      setEditingExpense(null)
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to update expense.'
      notify.error(L('Update failed', 'التعديل ماتمّش'), { description: message })
    },
  })

  const { mutateAsync: deleteExpenseAsync, isPending: isDeletingExpense } = useMutation({
    mutationFn: async (id: string) =>
      fetchApi<void>(`/api/accountant/expenses/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountant-expenses'] })
      notify.success(L('Expense deleted successfully', 'المصروف اتمسح'))
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to delete expense.'
      notify.error(L('Deletion failed', 'المسح ماتمّش'), { description: message })
    },
  })

  const openEditModal = (expense: ExpenseRecord) => {
    setEditingExpense(expense)
    setEditForm({
      title: expense.title,
      description: expense.description ?? '',
      amount: String(expense.amount),
      category: catId(expense.categoryId ?? expense.category),
      date: expense.date,
      paymentSource: expense.paymentSource ?? '',
      paymentReference: expense.paymentReference ?? '',
      notes: expense.notes ?? '',
    })
  }

  const closeEditModal = () => {
    setEditingExpense(null)
  }

  const handleEditSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingExpense) return

    const payload: Record<string, unknown> = {
      title: editForm.title,
      description: editForm.description || undefined,
      amount: Number(editForm.amount),
      categoryId: catId(editForm.category),
      date: editForm.date,
      notes: editForm.notes || undefined,
    }

    if (expenseColumnSupport?.paymentSource) {
      payload.paymentSource = editForm.paymentSource || undefined
    }
    if (expenseColumnSupport?.paymentReference) {
      payload.paymentReference = editForm.paymentReference || undefined
    }

    await updateExpenseAsync({ id: editingExpense.id, payload })
  }

  const handleDelete = (id: string) => {
    if (confirm(L('Are you sure you want to delete this expense record?', 'متأكد إنك عايز تمسح المصروف ده؟'))) {
      deleteExpenseAsync(id)
    }
  }

  const paymentFieldsSupported = Boolean(
    !isLoadingExpenseColumns && !expenseColumnSupportError && expenseColumnSupport,
  )

  const showEditModal = Boolean(editingExpense)

  const showPaymentFields = paymentFieldsSupported
    ? expenseColumnSupport?.paymentSource || expenseColumnSupport?.paymentReference
    : false

  const exportExpenses = async () => {
    try {
      const exportUrl = `/api/accountant/expenses/export${exportQueryString ? `?${exportQueryString}` : ''}`
      const response = await fetch(exportUrl, { credentials: 'same-origin' })
      if (!response.ok) throw new Error('Unable to generate the expense export.')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `expenses-${new Date().toISOString().split('T')[0]}.xlsx`
      link.click()
      window.URL.revokeObjectURL(url)
      notify.success(L('Expense export downloaded', 'ملف المصاريف نزل'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The export could not be created.'
      notify.error(L('Unable to export expenses', 'التصدير ماتمّش'), { description: message })
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description || undefined,
        amount: Number(form.amount),
        categoryId: catId(form.category),
        date: form.date,
        notes: form.notes || undefined,
        campusId: form.campusId || undefined,
      }

      if (expenseColumnSupport?.paymentSource && form.paymentSource) {
        payload.paymentSource = form.paymentSource
      }
      if (expenseColumnSupport?.paymentReference && form.paymentReference) {
        payload.paymentReference = form.paymentReference
      }

      await fetchApi('/api/accountant/expenses', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    },
    onSuccess: () => {
      notify.success(L('Expense recorded successfully', 'المصروف اتسجل'))
      queryClient.invalidateQueries({ queryKey: ['accountant-expenses'] })
      queryClient.invalidateQueries({ queryKey: ['accountant-expenses-dashboard'] })
      setForm({ title: '', description: '', amount: '', category: 'UTILITIES', date: new Date().toISOString().split('T')[0], paymentSource: '', paymentReference: '', notes: '', campusId: '' })
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Please review the form values and try again.'
      notify.error(L('Unable to record expense', 'المصروف ماتسجلش'), { description: message })
    },
  })

  if (status === 'loading') return null
  if (!permsReady && !!role) return null
  if (!canAccess) {
    return (
      <AccessDenied
        title={L('Finance Workspace Access', 'المصاريف')}
        message="Only finance staff and admins can create and review expense records in this accounting workspace."
      />
    )
  }

  return (
    <>
      <Modal open={showEditModal} onClose={closeEditModal} title={L('Edit expense record', 'عدّل المصروف')} size="lg">
        {editingExpense && (
          <form className="space-y-4" onSubmit={handleEditSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-title">{L('Title', 'البيان')}</Label>
                <Input id="edit-title" value={editForm.title} onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-category">{L('Category', 'البند')}</Label>
                <Select value={catId(editForm.category)} onValueChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))}>
                  <SelectTrigger id="edit-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((c) => <SelectItem key={c.id} value={c.id}>{ar ? c.nameAr : c.nameEn}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-amount">{L('Amount (EGP)', 'المبلغ (ج.م)')}</Label>
                <Input id="edit-amount" type="number" min="0.01" step="0.01" value={editForm.amount} onChange={(e) => setEditForm((prev) => ({ ...prev, amount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-date">{L('Date', 'التاريخ')}</Label>
                <DateInput id="edit-date" value={editForm.date} onChange={(e) => setEditForm((prev) => ({ ...prev, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">{L('Description', 'الوصف')}</Label>
              <Textarea id="edit-description" value={editForm.description} onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))} />
            </div>
            {showPaymentFields ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-paymentSource">{L('Payment method', 'طريقة الدفع')}</Label>
                  <Select value={editForm.paymentSource} onValueChange={(value) => setEditForm((prev) => ({ ...prev, paymentSource: value }))}>
                    <SelectTrigger id="edit-paymentSource"><SelectValue placeholder={L('Select payment method', 'اختار طريقة الدفع')} /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-paymentReference">{L('Payment reference', 'رقم العملية')}</Label>
                  <Input id="edit-paymentReference" value={editForm.paymentReference} onChange={(e) => setEditForm((prev) => ({ ...prev, paymentReference: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {isLoadingExpenseColumns
                  ? L('Checking the payment fields…', 'بيتأكد من خانات الدفع…')
                  : expenseColumnSupportError
                  ? L('Payment fields could not be checked; they will not be saved.', 'ماقدرناش نتأكد من خانات الدفع، فمش هتتحفظ.')
                  : L('Payment fields are not available; they will not be saved.', 'خانات الدفع مش متاحة، فمش هتتحفظ.')}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-notes">{L('Notes', 'ملاحظات')}</Label>
              <Textarea id="edit-notes" value={editForm.notes} onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeEditModal} type="button">{L('Cancel', 'إلغاء')}</Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white" disabled={isUpdatingExpense}>
                {isUpdatingExpense ? L('Saving…', 'بيحفظ…') : L('Save changes', 'احفظ')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-teal-600">{L('Expenses', 'المصاريف')}</p>
          <h1 className="text-2xl font-black text-slate-900">{L('Record and review campus expenses', 'سجّل وراجع مصاريف الفرع')}</h1>
          <div className="mt-2 print:hidden"><DataExchangeButtons dataset="expenses" /></div>
          <p className="text-sm text-slate-500">{L('This path uses the manual proof-style workflow: account managers record expenses directly, and they appear immediately in finance reports with approval set to true by default.', 'المصروف اللي بتسجله بيظهر على طول في التقارير المالية (متوافق عليه تلقائي).')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="border-teal-200 text-teal-700 hover:bg-teal-50"
          >
            <a href="/dashboard/accountant/reports" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {L('Financial Reports', 'التقارير المالية')}
            </a>
          </Button>
        </div>
      </div>

      <Card className="border-teal-100 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{L('Expense ledger steps', 'خطوات المصاريف')}</CardTitle>
          <CardDescription>{L('Record expenses once, then reuse the same ledger for filtering, P&L, and Excel exports.', 'سجّل المصروف مرة واحدة، وهيظهر في الفلترة والأرباح والخسائر والـ Excel.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {[
            ['1', 'Choose campus', 'Global finance users select the campus; campus-scoped users are applied automatically.'],
            ['2', 'Record expense', 'Enter title, category, amount, date, payment method/reference, and notes.'],
            ['3', 'Review ledger', 'Filter by category and date range, then edit or soft-delete incorrect records.'],
            ['4', 'Export and report', 'Download Excel or generate P&L after income, expenses, and payroll are complete.'],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-xs font-black text-white">{step}</span>
              <p className="mt-3 text-sm font-bold text-slate-900">{title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className={`grid gap-6 ${canCreate ? 'lg:grid-cols-[420px_1fr]' : ''}`}>
        {canCreate && <Card>
          <CardHeader>
            <CardTitle>{L('New expense', 'مصروف جديد')}</CardTitle>
            <CardDescription>{L('Record a campus cost directly to the finance ledger.', 'سجّل مصروف للفرع.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{L('Title', 'البيان')}</Label>
              <Input id="title" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder={L('Utilities bill / stationery purchase', 'مثلاً: فاتورة كهربا / أدوات مكتبية')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">{L('Description', 'الوصف')}</Label>
              <Textarea id="description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder={L('Optional context for the finance report', 'تفاصيل اختيارية للتقرير')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">{L('Amount (EGP)', 'المبلغ (ج.م)')}</Label>
                <Input id="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))} placeholder="5000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">{L('Date', 'التاريخ')}</Label>
                <DateInput id="date" value={form.date} onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">{L('Category', 'البند')}</Label>
                <Select value={catId(form.category)} onValueChange={(value) => setForm((prev) => ({ ...prev, category: value }))}>
                  <SelectTrigger id="category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((c) => <SelectItem key={c.id} value={c.id}>{ar ? c.nameAr : c.nameEn}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isGlobalAccountant && (
                <div className="space-y-2">
                  <Label htmlFor="campusId">{L('Campus', 'الفرع')} <span className="text-red-500">*</span></Label>
                  <Select value={form.campusId} onValueChange={(value) => setForm((prev) => ({ ...prev, campusId: value }))}>
                    <SelectTrigger id="campusId"><SelectValue placeholder={L('Select a campus', 'اختار الفرع')} /></SelectTrigger>
                    <SelectContent>
                      {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {showPaymentFields ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="paymentSource">{L('Payment method', 'طريقة الدفع')}</Label>
                  <Select value={form.paymentSource} onValueChange={(value) => setForm((prev) => ({ ...prev, paymentSource: value }))}>
                    <SelectTrigger id="paymentSource"><SelectValue placeholder={L('Select payment method', 'اختار طريقة الدفع')} /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentReference">{L('Payment reference', 'رقم العملية')}</Label>
                  <Input
                    id="paymentReference"
                    value={form.paymentReference}
                    onChange={(e) => setForm((prev) => ({ ...prev, paymentReference: e.target.value }))}
                    placeholder={L('Cheque number / transaction ID', 'رقم الشيك / العملية')}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {isLoadingExpenseColumns
                  ? L('Checking the payment fields…', 'بيتأكد من خانات الدفع…')
                  : expenseColumnSupportError
                  ? L('Payment fields could not be checked; the expense is saved without them.', 'ماقدرناش نتأكد من خانات الدفع، والمصروف هيتسجل من غيرها.')
                  : L('Payment fields are not available; the expense is saved without method or reference.', 'خانات الدفع مش متاحة، والمصروف هيتسجل من غير الطريقة ورقم العملية.')}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="notes">{L('Notes', 'ملاحظات')}</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder={L('Optional remarks for the finance team', 'ملاحظات اختيارية للحسابات')} />
            </div>
            <Button
              onClick={() => mutation.mutate()}
              disabled={
                mutation.isPending ||
                !form.title ||
                !form.amount ||
                isLoadingExpenseColumns
              }
              className="w-full bg-teal-600 hover:bg-teal-700 text-white"
            >
              {mutation.isPending ? L('Saving…', 'بيحفظ…') : isLoadingExpenseColumns ? L('Checking…', 'بيتأكد…') : L('Record expense', 'سجّل المصروف')}
            </Button>
          </CardContent>
        </Card>}

        <Card>
          <CardHeader>
            <CardTitle>{L('Recent campus expenses', 'آخر مصاريف الفرع')}</CardTitle>
            <CardDescription>{L('Total recorded this month:', 'إجمالي الشهر ده:')} {formatCurrency(total)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 border-b border-slate-200 pb-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="filter-category">{L('Category', 'البند')}</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger id="filter-category"><SelectValue placeholder={L('All categories', 'كل البنود')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{L('All categories', 'كل البنود')}</SelectItem>
                    {activeCategories.map((c) => <SelectItem key={c.id} value={c.id}>{ar ? c.nameAr : c.nameEn}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="filter-start">{L('From', 'من')}</Label>
                <DateInput id="filter-start" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="filter-end">{L('To', 'إلى')}</Label>
                <DateInput id="filter-end" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Filter the ledger instantly; export the current view to Excel for finance reporting.</p>
              {canExport && <Button variant="outline" onClick={exportExpenses} className="gap-2 border-teal-200 text-teal-700 hover:bg-teal-50">
                <Download className="h-4 w-4" /> {L('Export Excel', 'صدّر Excel')}
              </Button>}
            </div>
          </CardContent>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-slate-500">{L('Loading expense ledger…', 'بيحمّل المصاريف…')}</p>
            ) : expenses.length === 0 ? (
              <p className="text-sm text-slate-500">{L('No expense records yet in this campus ledger.', 'لسه مفيش مصاريف متسجلة.')}</p>
            ) : (
              expenses.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">{item.title}</h3>
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-600">{catName(item)}</span>
                        {item.isApproved && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-emerald-700">{L('Approved', 'متوافق عليه')}</span>}
                      </div>
                      <p className="text-sm text-slate-500">{item.description || item.notes || 'No further notes.'}</p>
                      {(item.paymentSource || item.paymentReference) && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                          {item.paymentSource && <span className="rounded-full bg-slate-100 px-2 py-1">{L('Method:', 'الطريقة:')} {item.paymentSource}</span>}
                          {item.paymentReference && <span className="rounded-full bg-slate-100 px-2 py-1">{L('Ref:', 'رقم العملية:')} {item.paymentReference}</span>}
                        </div>
                      )}
                      <p className="text-xs text-slate-400">{L('Recorded on', 'اتسجل يوم')} {formatDate(item.date)} {L('by', 'بواسطة')} {getRecorderName(item)}</p>
                    </div>
                    <div className="flex flex-col items-start gap-3 text-right md:items-end">
                      <span className="text-sm font-semibold text-slate-900">{formatCurrency(item.amount)}</span>
                      <div className="flex flex-wrap gap-2">
                        {canUpdate && <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-slate-300 text-slate-700"
                          onClick={() => openEditModal(item)}
                        >
                          <Edit3 className="h-4 w-4" /> {L('Edit', 'عدّل')}
                        </Button>}
                        {canDelete && <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(item.id)}
                          disabled={isDeletingExpense}
                        >
                          <Trash2 className="h-4 w-4" /> {L('Delete', 'امسح')}
                        </Button>}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  )
}
