'use client'

import { DataExchangeButtons } from '@/components/data/DataExchangeButtons'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchPaginatedApi, fetchApi } from '@/lib/api-client'
import { useSession } from 'next-auth/react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Search, DollarSign, ChevronLeft, ChevronRight, X, CreditCard, FileText, UploadCloud, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { AccessDenied } from '@/components/AccessDenied'
import { motion, AnimatePresence } from 'framer-motion'
import { fadeUp, staggerContainer } from '@/lib/animations'
import { EmptyState } from '@/components/shared/empty-state'
import { PaymentProofUploadModal } from '@/components/fees/PaymentProofUploadModal'
import { getCanonicalStudentClassSection, type EnrollmentRecord } from '@/lib/academic/record-formatters'
import { PaymentMethodSelect } from '@/components/fees/PaymentMethodSelect'
import { useAfterPayment } from '@/lib/fees/use-after-payment'
import { L, useI18n } from '@/lib/i18n/client'

interface FeeInvoice {
  id: string
  challanNumber: string
  month: string
  academicYear: string
  totalAmount: string | number
  paidAmount: string | number
  status: string
  proofStatus: string | null
  dueDate: string
  student: {
    id: string
    firstName: string
    lastName: string
    registrationNumber: string
    section?: string | null
    class?: { name?: string | null } | null
    enrollments?: EnrollmentRecord[]
  }
}

const STATUS_STYLES: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700 border-green-200',
  PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  ISSUED: 'bg-blue-100 text-blue-700 border-blue-200',
  OVERDUE: 'bg-red-100 text-red-700 border-red-200',
  CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
}

interface CollectPaymentModalProps {
  invoice: FeeInvoice | null
  onClose: () => void
}

function CollectPaymentModal({ invoice, onClose }: CollectPaymentModalProps) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [transactionId, setTransactionId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [loading, setLoading] = useState(false)
  const afterPayment = useAfterPayment()

  if (!invoice) return null

  const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payAmount = parseFloat(amount)
    if (!payAmount || payAmount <= 0) {
      notify.error(L('Enter a valid payment amount', 'اكتب مبلغ صحيح'))
      return
    }
    if (payAmount > remaining) {
      notify.error(`Amount exceeds remaining balance of EGP ${remaining.toLocaleString()}`)
      return
    }

    setLoading(true)
    try {
      const res = await fetchApi<{ id: string; receiptNumber?: string }>(`/api/fees/${invoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: payAmount,
          paymentMethod: method,
          transactionId: transactionId || undefined,
          remarks: remarks || undefined,
        }),
      })
      notify.success(L('Payment recorded successfully', 'الدفع اتسجل'))
      queryClient.invalidateQueries({ queryKey: ['fees'] })
      onClose()
      afterPayment(res?.id, res?.receiptNumber) // open / print the receipt (Settings > Payments)
    } catch (err: any) {
      notify.error(L('Failed to record payment', 'الدفع ماتسجلش'), { description: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={!!invoice} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-green-600" />
            {L('Collect Payment', 'تحصيل')}
          </DialogTitle>
          <DialogDescription>
            {L('Challan:', 'الفاتورة:')} <span className="font-mono font-medium">{invoice.challanNumber}</span>
            <br />
            {L('Student:', 'الطالب:')} <span className="font-medium">{invoice.student.firstName} {invoice.student.lastName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-3">
              <p className="text-xs text-blue-600 font-medium">{L('Total Due', 'المطلوب')}</p>
              <p className="text-lg font-bold text-blue-800">EGP {Number(invoice.totalAmount).toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-3">
              <p className="text-xs text-green-600 font-medium">{L('Remaining', 'الباقي')}</p>
              <p className="text-lg font-bold text-green-800">EGP {remaining.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{L('Payment Amount (EGP)', 'المبلغ (ج.م)')}</Label>
            <Input
              type="number"
              placeholder={`Max: ${remaining}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              max={remaining}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>{L('Payment Method', 'طريقة الدفع')}</Label>
            <PaymentMethodSelect value={method} onValueChange={setMethod} />
          </div>
          {method !== 'Cash' && (
            <div className="space-y-1.5">
              <Label>{L('Transaction / Reference ID', 'رقم العملية')}</Label>
              <Input
                placeholder={L('Bank transaction reference', 'رقم العملية البنكية')}
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{L('Remarks (optional)', 'ملاحظات (اختياري)')}</Label>
            <Input
              placeholder={L('Any notes...', 'أي ملاحظات…')}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {L('Cancel', 'إلغاء')}
            </Button>
            <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
              {loading ? L('Recording...', 'بيتسجل…') : L('Record payment (top up & pay)', 'سجّل الدفع')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_AR: Record<string, string> = { ISSUED: 'صادرة', PARTIALLY_PAID: 'مدفوعة جزئيًا', PAID: 'مدفوعة', OVERDUE: 'متأخرة', CANCELLED: 'ملغية' }

export default function FeesManagementPage() {
  const { data: session, status } = useSession()
  useI18n() // re-render on a language switch
  const role = (session?.user?.role as string) || ''
  const isAdmin = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(role)
  const ALLOWED_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT', 'STUDENT', 'PARENT', 'GUARDIAN']
  const canViewFees = ALLOWED_ROLES.includes(role)

  const searchParams = useSearchParams()
  const filterStudentId = searchParams.get('studentId') ?? ''

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [proofStatusFilter, setProofStatusFilter] = useState('')
  const [collectInvoice, setCollectInvoice] = useState<FeeInvoice | null>(null)
  const [uploadInvoice, setUploadInvoice] = useState<FeeInvoice | null>(null)
  const limit = 20

  useEffect(() => {
    if (!canViewFees || !filterStudentId) return
    fetchApi<{ firstName: string; lastName: string; registrationNumber: string }>(
      `/api/students/${filterStudentId}`
    )
      .then((raw) => {
        const s = (raw as { data?: { firstName: string; lastName: string; registrationNumber: string } }).data ?? raw
        if (s?.registrationNumber) setSearch(s.registrationNumber)
      })
      .catch(() => {})
  }, [canViewFees, filterStudentId])

  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('limit', String(limit))
  if (statusFilter) params.set('status', statusFilter)
  if (proofStatusFilter) params.set('proofStatus', proofStatusFilter)
  if (filterStudentId) params.set('studentId', filterStudentId)

  const { data, isLoading } = useQuery({
    queryKey: ['fees', page, statusFilter, filterStudentId],
    queryFn: () => fetchPaginatedApi<FeeInvoice>(`/api/fees?${params.toString()}`),
    staleTime: 30_000,
    enabled: canViewFees,
  })

  const invoices = data?.data ?? []
  const pagination = data?.pagination

  // Client-side search (student name / challan)
  const filtered = search
    ? invoices.filter((f) =>
        f.challanNumber.toLowerCase().includes(search.toLowerCase()) ||
        `${f.student.firstName} ${f.student.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
        f.student.registrationNumber.toLowerCase().includes(search.toLowerCase())
      )
    : invoices

  // Route guard: teachers have no fee management workflow
  if (status === 'loading') return null
  if (!canViewFees) {
    return (
      <AccessDenied
        title={L('Invoices', 'الفواتير')}
        message={L('You do not have access to invoices.', 'مالكش صلاحية على الفواتير.')}
      />
    )
  }

  return (
    <motion.div 
      initial="initial"
      animate="animate"
      variants={staggerContainer}
      className="space-y-6 max-w-7xl mx-auto"
    >
      {/* Collect payment modal */}
      <CollectPaymentModal invoice={collectInvoice} onClose={() => setCollectInvoice(null)} />
      
      {/* Upload proof modal (Students/Guardians) */}
      <PaymentProofUploadModal
        open={!!uploadInvoice}
        onOpenChange={(open) => { if (!open) setUploadInvoice(null) }}
        invoice={uploadInvoice}
        uploadEndpoint={uploadInvoice ? `/api/fees/${uploadInvoice.id}/proof` : ''}
        successMessage={L('Payment proof submitted!', 'إيصال الدفع اتبعت!')}
        successQueryKeys={[['fees']]}
      />

      {/* Header */}
      <motion.div variants={fadeUp(0.1)} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl shadow-soft-lg border border-slate-200/60">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <div className="p-2 bg-green-100 rounded-lg text-green-600">
              <DollarSign className="w-6 h-6" />
            </div>
            {isAdmin ? L('Invoices', 'الفواتير') : L('My invoices', 'فواتيري')}
          </h1>
          <div className="mt-2 print:hidden"><DataExchangeButtons dataset="invoices" /></div>
          <p className="text-sm text-slate-500 mt-1 font-medium ml-11">
            {pagination ? `${pagination.total.toLocaleString()} ${L('invoices', 'فاتورة')}` : L('Loading…', 'بيحمّل…')}
          </p>
          {filterStudentId && (
            <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mt-2 ml-11 w-fit">
              {L('Showing invoices for one student —', 'فواتير طالب واحد —')}{' '}
              <Link href={`/dashboard/students/${filterStudentId}`} className="underline font-medium">
                {L('view profile', 'افتح ملفه')}
              </Link>
            </p>
          )}
        </div>
        {isAdmin && (
          <Link href="/dashboard/fees/generate">
            <Button className="gap-2 bg-green-600 hover:bg-green-700 transition-colors shadow-md hover:shadow-lg">
              <Plus className="w-4 h-4" />
              {L('Generate invoice', 'عمل فاتورة')}
            </Button>
          </Link>
        )}
      </motion.div>

      <motion.div variants={fadeUp(0.2)} className="bg-white rounded-2xl border border-slate-200/60 shadow-soft-md overflow-hidden flex flex-col">
        {/* Search + filter bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="search"
              placeholder={L('Invoice no., student name or reg. no.', 'رقم الفاتورة أو اسم الطالب أو رقم التسجيل')}
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isAdmin && (
            <Button 
              variant={proofStatusFilter === 'PENDING' ? 'default' : 'outline'}
              className={proofStatusFilter === 'PENDING' ? 'bg-amber-500 hover:bg-amber-600' : 'text-amber-600 border-amber-300'}
              onClick={() => {
                setProofStatusFilter(proofStatusFilter === 'PENDING' ? '' : 'PENDING')
                setPage(1)
              }}
            >
              {L('Pending proofs', 'إيصالات مستنية')}
            </Button>
          )}
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'ALL' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={L('All statuses', 'كل الحالات')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{L('All statuses', 'كل الحالات')}</SelectItem>
              {['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => <SelectItem key={s} value={s}>{L(s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), STATUS_AR[s])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="relative w-full overflow-x-auto min-h-[400px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>{L('Invoice no.', 'رقم الفاتورة')}</TableHead>
                <TableHead>{L('Student', 'الطالب')}</TableHead>
                <TableHead>{L('Month', 'الشهر')}</TableHead>
                <TableHead>{L('Total', 'الإجمالي')}</TableHead>
                <TableHead>{L('Paid', 'المدفوع')}</TableHead>
                <TableHead>{L('Balance', 'الباقي')}</TableHead>
                <TableHead>{L('Due date', 'ميعاد الدفع')}</TableHead>
                <TableHead>{L('Status', 'الحالة')}</TableHead>
                <TableHead className="text-end">{L('Actions', 'إجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-64">
                    <EmptyState 
                      icon={FileText}
                      title={L('No invoices found', 'مفيش فواتير')}
                      description={search || statusFilter ? L('Try changing the filters.', 'جرّب تغيّر الفلاتر.') : L('No invoices yet.', 'لسه مفيش فواتير.')}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((fee) => {
                  const total = Number(fee.totalAmount)
                  const paid = Number(fee.paidAmount)
                  const balance = total - paid
                  const isOverdue = new Date(fee.dueDate) < new Date() && fee.status !== 'PAID'
                  return (
                    <TableRow key={fee.id} className="hover:bg-slate-50/80 transition-colors group">
                      <TableCell className="font-mono text-xs text-slate-600">{fee.challanNumber}</TableCell>
                      <TableCell>
                        <Link href={`/dashboard/students/${fee.student.id}`} className="hover:underline">
                          <p className="font-medium text-sm text-gray-900">
                            {fee.student.firstName} {fee.student.lastName}
                          </p>
                          <p className="text-xs text-gray-400">{fee.student.registrationNumber} · {getCanonicalStudentClassSection({ ...fee.student, activeEnrollments: fee.student.enrollments })}</p>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{fee.month}</TableCell>
                      <TableCell className="text-sm font-medium">{L('EGP', 'ج.م')} {total.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-green-700">{L('EGP', 'ج.م')} {paid.toLocaleString()}</TableCell>
                      <TableCell className={`text-sm font-medium ${balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {balance > 0 ? `${L('EGP', 'ج.م')} ${balance.toLocaleString()}` : '—'}
                      </TableCell>
                      <TableCell className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {new Date(fee.dueDate).toLocaleDateString(L('en-GB', 'ar-EG'), { day: 'numeric', month: 'short', year: 'numeric' })}
                        {isOverdue && ' ⚠'}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium border ${STATUS_STYLES[fee.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {L(fee.status.replace('_', ' '), STATUS_AR[fee.status] ?? fee.status)}
                        </span>
                        {fee.proofStatus === 'PENDING' && (
                          <span className="ml-1 inline-flex text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 font-bold whitespace-nowrap">
                            {L('PROOF PENDING', 'الإيصال بيتراجع')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isAdmin && fee.status !== 'PAID' && fee.status !== 'CANCELLED' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50 h-7 text-xs"
                              onClick={() => setCollectInvoice(fee)}
                            >
                              <DollarSign className="w-3 h-3" />
                              {L('Collect', 'تحصيل')}
                            </Button>
                          )}
                          {!isAdmin && fee.status !== 'PAID' && fee.status !== 'CANCELLED' && fee.proofStatus !== 'PENDING' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 h-7 text-xs font-bold"
                              onClick={() => setUploadInvoice(fee)}
                            >
                              <UploadCloud className="w-3 h-3" />
                              {L('Pay', 'ادفع')}
                            </Button>
                          )}
                          {!isAdmin && fee.proofStatus === 'PENDING' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              className="gap-1.5 border-amber-300 text-amber-600 bg-amber-50 h-7 text-[10px] font-bold"
                            >
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {L('Pending', 'مستني')}
                            </Button>
                          )}
                          <Link href={`/dashboard/fees/${fee.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500">
                              {L('View', 'عرض')}
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-sm text-slate-500 font-medium">
              {((page - 1) * limit) + 1}–{Math.min(page * limit, pagination.total)} {L('of', 'من')} {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="h-8 w-8 p-0 border-slate-200">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-semibold px-2">{page} / {pagination.totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages} className="h-8 w-8 p-0 border-slate-200">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
