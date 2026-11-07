'use client'

/** Cancelled payments (recorded by mistake): requests to approve, history, settings. lib/payments/void.ts */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Ban } from 'lucide-react'

interface Row {
  id: string; paymentId: string; amount: number; receiptNumber: string | null; reason: string; status: string; createdAt: string; decidedAt: string | null; decisionNote: string | null
  student: { firstName: string; lastName: string; registrationNumber: string } | null
  payment: { paymentDate: string; paymentMethod: string; invoice: { challanNumber: string; month: string } } | null
  requestedBy: string | null; decidedBy: string | null; mine: boolean
}
const when = (d: string) => new Date(d).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })
const STATUS: Record<string, [string, string, string]> = { PENDING: ['Waiting', 'مستني', 'bg-amber-100 text-amber-800'], APPROVED: ['Cancelled', 'اتلغت', 'bg-rose-100 text-rose-800'], REJECTED: ['Refused (payment stays)', 'اترفض (الدفعة فضلت)', 'bg-slate-100 text-slate-700'] }

function List({ rows, canApprove }: { rows: Row[]; canApprove: boolean }) {
  const qc = useQueryClient()
  const [note, setNote] = useState<Record<string, string>>({})
  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'approve' | 'reject' }) => fetchApi(`/api/payment-voids/${v.id}`, { method: 'PATCH', body: JSON.stringify({ action: v.action, note: note[v.id] || null }) }),
    onSuccess: (_d, v) => { notify.success(v.action === 'approve' ? L('Payment cancelled', 'الدفعة اتلغت') : L('Done', 'تم')); qc.invalidateQueries({ queryKey: ['payment-voids'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-500">{L('Nothing here.', 'مفيش حاجة.')}</p>
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id}><CardContent className="space-y-2 pt-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{r.student ? `${r.student.firstName} ${r.student.lastName}` : '-'} <span className="text-xs text-slate-500" dir="ltr">{r.student?.registrationNumber}</span></p>
              <p className="text-xs text-slate-600"><Link className="text-indigo-700 underline" href={`/receipts/${r.paymentId}`} dir="ltr">{r.receiptNumber}</Link> · {r.amount.toLocaleString('en-US')} {L('EGP', 'ج.م')} · {r.payment?.paymentMethod} · {r.payment?.invoice.challanNumber} ({r.payment?.invoice.month})</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[r.status]?.[2] ?? ''}`}>{STATUS[r.status] ? L(STATUS[r.status][0], STATUS[r.status][1]) : r.status}</span>
          </div>
          <p className="rounded bg-slate-50 p-2 text-xs"><b>{L('Reason', 'السبب')}:</b> {r.reason}</p>
          <p className="text-xs text-slate-500">{L('Asked by', 'طلبه')} {r.requestedBy} · {when(r.createdAt)}{r.decidedBy && <> · {L('decided by', 'قرّر')} {r.decidedBy} · {r.decidedAt && when(r.decidedAt)}</>}{r.decisionNote && <> · {r.decisionNote}</>}</p>
          {r.status === 'PENDING' && (
            <div className="flex flex-wrap items-center gap-2">
              {canApprove && !r.mine && <Input className="h-8 max-w-xs text-xs" placeholder={L('Note (optional)', 'ملاحظة (اختياري)')} value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />}
              {canApprove && !r.mine && <Button size="sm" className="bg-rose-600 hover:bg-rose-700" disabled={decide.isPending} onClick={() => { if (window.confirm(L('Cancel this payment? The invoice will be due again.', 'تلغي الدفعة دي؟ الفاتورة هترجع مستحقة.'))) decide.mutate({ id: r.id, action: 'approve' }) }}>{L('Approve: cancel the payment', 'موافقة: الغي الدفعة')}</Button>}
              {canApprove && !r.mine && <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'reject' })}>{L('Refuse', 'رفض')}</Button>}
              {r.mine && <><span className="text-xs text-slate-500">{L('Another person must approve your request.', 'لازم حد تاني يوافق على طلبك.')}</span><Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: 'reject' })}>{L('Withdraw', 'اسحب الطلب')}</Button></>}
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['payment-voids', 'settings'], queryFn: () => fetchApi<{ enabled: boolean; maxDays: number }>('/api/payment-voids/settings') })
  const [f, setF] = useState<{ enabled: boolean; maxDays: number } | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])
  const save = useMutation({ mutationFn: () => fetchApi('/api/payment-voids/settings', { method: 'PUT', body: JSON.stringify(f) }), onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['payment-voids'] }) }, onError: (e: Error) => notify.error(e.message) })
  if (!f) return null
  return (
    <Card><CardContent className="space-y-3 pt-4 text-sm">
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {L('Payments recorded by mistake can be cancelled', 'مسموح إلغاء الدفعات اللي اتسجلت غلط')}</label>
      <label className="block space-y-1"><span className="block text-xs text-slate-500">{L('Up to this many days after the payment was recorded (after that: a refund)', 'لحد كام يوم بعد تسجيل الدفعة (بعدها: استرداد)')}</span>
        <Input type="number" min={1} max={60} className="h-9 w-24" value={f.maxDays} onChange={(e) => setF({ ...f, maxDays: Number(e.target.value) })} /></label>
      <p className="text-xs text-slate-500">{L('Online payments are never cancelled (the money reached the gateway): use a refund. A closed month cannot change.', 'الدفع الأونلاين عمره ما يتلغي (الفلوس وصلت فعلًا): اعمل استرداد. والشهر المقفول مفيش فيه تغيير.')}</p>
      <Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
    </CardContent></Card>
  )
}

export default function PaymentVoidsPage() {
  useI18n()
  const { can } = useMyPermissions()
  const [tab, setTab] = useUrlTab()
  const { data: pending } = useQuery({ queryKey: ['payment-voids', 'PENDING'], queryFn: () => fetchApi<Row[]>('/api/payment-voids') })
  const { data: all } = useQuery({ queryKey: ['payment-voids', 'ALL'], queryFn: () => fetchApi<Row[]>('/api/payment-voids?status=ALL'), enabled: tab === 'history' })
  const canApprove = can('payment_voids', 'approve')
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Ban className="h-5 w-5 text-rose-600" /> {L('Cancelled payments', 'إلغاء الدفعات')}</h1>
      <p className="text-xs text-slate-600">{L('A payment recorded by mistake is cancelled from its receipt ("Cancel this payment"), then another person approves here. Money that really came in and goes back is a refund, not a cancel.', 'الدفعة اللي اتسجلت غلط بتتلغي من الإيصال بتاعها («إلغاء الدفعة»)، وبعدين حد تاني يوافق هنا. لو الفلوس دخلت فعلًا وهترجع يبقى ده استرداد مش إلغاء.')}</p>
      <Tabs value={tab ?? 'requests'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="requests">{L('Waiting', 'مستني موافقة')} {pending?.length ? `(${pending.length})` : ''}</TabsTrigger>
          <TabsTrigger value="history">{L('All', 'الكل')}</TabsTrigger>
          {canApprove && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="requests"><List rows={pending ?? []} canApprove={canApprove} /></TabsContent>
        <TabsContent value="history"><List rows={all ?? []} canApprove={canApprove} /></TabsContent>
        {canApprove && <TabsContent value="settings"><SettingsTab /></TabsContent>}
      </Tabs>
    </div>
  )
}
