'use client'

/**
 * 2026-10-18 change log — who changed what and when, with the old and new value of each field. Filters by table,
 * record, action and date. Data: /api/audit-log (audit_logs:read; branch people see changes by people in their places).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FileClock, Loader2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Row { id: string; at: string; action: string; entityType: string; entityId: string | null; changes: unknown; who: string; whoRole: string | null }
interface Page { rows: Row[]; next: string | null; types: string[] }

const TYPE_AR: Record<string, string> = {
  Student: 'طالب', Guardian: 'ولي أمر', ClassSection: 'جروب', StudentEnrollment: 'تسجيل طالب في جروب', FeeInvoice: 'فاتورة', FeePayment: 'دفعة',
  Teacher: 'مدرب', Expense: 'مصروف', Campus: 'فرع', Level: 'مستوى', AcademicSubject: 'كورس', Track: 'تراك', User: 'حساب',
  DiscountAssignment: 'خصم لطالب / جروب', DiscountType: 'نوع خصم', Refund: 'استرداد', SalarySlip: 'قسيمة مرتب', MoneyAccount: 'خزنة / حساب',
  AccountRoute: 'ربط طريقة دفع بحساب', FeeType: 'رسوم إضافية', FeeRule: 'استثناء رسوم', Holiday: 'إجازة', PaymentMethod: 'طريقة دفع',
  PaymentAccount: 'حساب دفع للأهالي', AppSetting: 'إعداد', RolePermission: 'صلاحية دور', UserPermissionOverride: 'صلاحية شخص',
  LocationPermissionOverride: 'صلاحية مكان', Partner: 'شريك', PartnerDeal: 'اتفاق شريك', CurriculumEdition: 'نسخة منهج', Agreement: 'اتفاقية',
  GroupRule: 'قاعدة جروب', WalletTopUp: 'شحن محفظة', MoneyTransfer: 'تحويل بين الحسابات', CashCount: 'جرد خزنة', Budget: 'ميزانية', ExpenseCategoryDef: 'بند مصاريف',
}
const ACTION: Record<string, [string, string, string]> = {
  CREATE: ['Added', 'إضافة', 'bg-emerald-50 text-emerald-700 border-emerald-200'], UPDATE: ['Changed', 'تعديل', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  DELETE: ['Deleted', 'مسح', 'bg-rose-50 text-rose-700 border-rose-200'], UPDATE_MANY: ['Changed many', 'تعديل جماعي', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  DELETE_MANY: ['Deleted many', 'مسح جماعي', 'bg-rose-50 text-rose-700 border-rose-200'], CREATE_MANY: ['Added many', 'إضافة جماعية', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
}
/** Common field names in plain words (anything else shows as it is). */
const FIELD_AR: Record<string, string> = {
  firstName: 'الاسم الأول', lastName: 'اسم العيلة', fullNameEn: 'الاسم بالإنجليزي', fullNameAr: 'الاسم بالعربي', phoneNumber: 'التليفون', phone: 'التليفون',
  email: 'الإيميل', status: 'الحالة', enrollmentStatus: 'حالة الطالب', campusId: 'الفرع', classSectionId: 'الجروب', levelId: 'المستوى', amount: 'المبلغ',
  totalAmount: 'الإجمالي', paidAmount: 'المدفوع', discount: 'الخصم', dueDate: 'آخر ميعاد', isActive: 'شغال', role: 'الدور', scheduleSlots: 'الجدول',
  maxStudents: 'أقصى عدد', priceOverride: 'سعر خاص', monthlyPrice: 'السعر الشهري', fullLevelPrice: 'سعر المستوى', value: 'القيمة', title: 'العنوان',
  category: 'البند', categoryId: 'البند', date: 'التاريخ', paymentMethod: 'طريقة الدفع', notes: 'ملاحظات', withdrawalReason: 'سبب الانسحاب',
  allowed: 'مسموح', name: 'الاسم', key: 'المفتاح', address: 'العنوان', dateOfBirth: 'تاريخ الميلاد', refundedAmount: 'المسترد',
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Where to open the record, when there is a page for it. */
function linkOf(type: string, id: string | null) {
  if (!id) return null
  if (type === 'Student') return `/dashboard/students/${id}`
  if (type === 'ClassSection') return `/dashboard/groups?group=${id}`
  if (type === 'FeeInvoice') return `/dashboard/fees/${id}`
  if (type === 'Campus') return `/dashboard/campuses/${id}`
  if (type === 'Partner') return `/dashboard/partners/${id}`
  return null
}

export default function AuditPage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { can, ready, role } = useMyPermissions()
  const [type, setType] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [entityId, setEntityId] = useState('')
  const qs = new URLSearchParams({ ...(type && { type }), ...(action && { action }), ...(from && { from }), ...(to && { to }), ...(entityId.trim() && { entityId: entityId.trim() }) }).toString()
  const q = useInfiniteQuery({
    queryKey: ['audit-log', qs],
    queryFn: ({ pageParam }) => fetchApi<Page>(`/api/audit-log?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: ready && can('audit_logs', 'read'),
  })
  if (role && !ready) return null
  if (!can('audit_logs', 'read')) return <AccessDenied title={L('Change log', 'سجل التعديلات')} message={L("You don't have access to the change log.", 'مالكش صلاحية على سجل التعديلات.')} />
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? []
  const types = q.data?.pages[0]?.types ?? []
  const fmt = (iso: string) => new Date(iso).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FileClock className="h-7 w-7 text-indigo-600" /> {L('Change log', 'سجل التعديلات')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Who added, changed or deleted what, and when — with the old and the new value.', 'مين ضاف أو عدّل أو مسح إيه وإمتى — بالقيمة القديمة والجديدة.')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={type} onChange={(e) => setType(e.target.value)} aria-label={L('Table', 'النوع')}>
          <option value="">{L('Everything', 'كل الأنواع')}</option>
          {types.map((t) => <option key={t} value={t}>{ar ? TYPE_AR[t] ?? t : t}</option>)}
        </select>
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={action} onChange={(e) => setAction(e.target.value)} aria-label={L('Action', 'العملية')}>
          <option value="">{L('Any action', 'أي عملية')}</option>
          {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{ar ? v[1] : v[0]}</option>)}
        </select>
        <DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={L('From', 'من')} />
        <DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label={L('To', 'لحد')} />
        <Input className="h-9 w-56" placeholder={L('Record id (optional)', 'كود السجل (اختياري)')} value={entityId} onChange={(e) => setEntityId(e.target.value)} />
      </div>
      {q.isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {!q.isLoading && !rows.length && <p className="text-sm text-slate-500">{L('Nothing recorded for this filter.', 'مفيش حاجة متسجلة بالفلتر ده.')}</p>}
      <div className="space-y-2">
        {rows.map((r) => {
          const a = ACTION[r.action] ?? [r.action, r.action, 'bg-slate-50 text-slate-600 border-slate-200']
          const c = (r.changes ?? {}) as { changed?: Record<string, [unknown, unknown]>; after?: Record<string, unknown>; before?: Record<string, unknown>; count?: number; fields?: string[] }
          const href = linkOf(r.entityType, r.entityId)
          return (
            <Card key={r.id}>
              <CardContent className="space-y-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${a[2]}`}>{ar ? a[1] : a[0]}</span>
                  <span className="font-semibold text-slate-800">{ar ? TYPE_AR[r.entityType] ?? r.entityType : r.entityType}</span>
                  {href ? <Link href={href} className="text-xs text-indigo-600 hover:underline">{L('open', 'افتح')}</Link> : r.entityId ? <span className="font-mono text-[11px] text-slate-400">{r.entityId}</span> : null}
                  <span className="ms-auto text-xs text-slate-500">{r.who}{r.whoRole ? ` · ${r.whoRole}` : ''} · {fmt(r.at)}</span>
                </div>
                {c.changed && (
                  <ul className="space-y-0.5 text-xs">
                    {Object.entries(c.changed).map(([f, [o, n]]) => (
                      <li key={f} className="flex flex-wrap gap-1"><span className="font-semibold text-slate-600">{ar ? FIELD_AR[f] ?? f : f}:</span> <span className="text-rose-700 line-through">{show(o)}</span> <span>←</span> <span className="text-emerald-700">{show(n)}</span></li>
                    ))}
                  </ul>
                )}
                {c.count != null && <p className="text-xs text-slate-600">{L(`${c.count} rows`, `${c.count} سطر`)}{c.fields?.length ? ` · ${c.fields.map((f) => (ar ? FIELD_AR[f] ?? f : f)).join('، ')}` : ''}</p>}
                {(c.after || c.before) && !c.changed && (
                  <details className="text-xs text-slate-500"><summary className="cursor-pointer">{L('Details', 'التفاصيل')}</summary>
                    <ul className="mt-1 space-y-0.5">{Object.entries(c.after ?? c.before ?? {}).filter(([, v]) => v !== null && v !== '').slice(0, 30).map(([f, v]) => <li key={f}><span className="font-semibold">{ar ? FIELD_AR[f] ?? f : f}:</span> {show(v)}</li>)}</ul>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {q.hasNextPage && <Button variant="outline" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{q.isFetchingNextPage && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Show more', 'اعرض أكتر')}</Button>}
    </div>
  )
}
