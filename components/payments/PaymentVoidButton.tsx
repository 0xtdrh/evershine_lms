'use client'

/**
 * "Cancel this payment" (recorded by mistake) on the receipt. Shown only to people with payment_voids:create
 * (the check API answers 403 for everyone else, so nothing shows). Another person approves on /dashboard/payment-voids.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Ban } from 'lucide-react'

interface Check { possible: boolean; problem: { en: string; ar: string } | null; pendingId: string | null }

export function PaymentVoidButton({ paymentId }: { paymentId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const { data } = useQuery({ queryKey: ['void-check', paymentId], queryFn: () => fetchApi<Check>(`/api/payment-voids/check?paymentId=${paymentId}`), retry: false })
  const ask = useMutation({
    mutationFn: () => fetchApi('/api/payment-voids', { method: 'POST', body: JSON.stringify({ paymentId, reason }) }),
    onSuccess: () => { notify.success(L('Sent for approval', 'الطلب اتبعت للموافقة'), { description: L('Another person must approve it.', 'لازم حد تاني يوافق عليه.') }); setOpen(false); qc.invalidateQueries({ queryKey: ['void-check', paymentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return null
  if (data.pendingId) return <Link href="/dashboard/payment-voids" className="self-center rounded-md bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">{L('Cancel request waiting for approval', 'طلب إلغاء مستني موافقة')}</Link>
  if (!data.possible) return data.problem ? <span className="self-center text-xs text-gray-500">{L(data.problem.en, data.problem.ar)}</span> : null
  if (!open) return <Button variant="outline" className="border-rose-300 text-rose-700" onClick={() => setOpen(true)}><Ban className="mr-2 h-4 w-4" /> {L('Cancel this payment (mistake)', 'إلغاء الدفعة (اتسجلت غلط)')}</Button>
  return (
    <div className="w-full max-w-xl space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
      <p className="font-semibold text-rose-800">{L('Cancel this payment', 'إلغاء الدفعة دي')}</p>
      <p className="text-xs text-rose-700">{L('Only for a payment recorded by mistake (wrong amount, wrong student, saved twice). Money that really came in and goes back = a refund.', 'بس لدفعة اتسجلت غلط (مبلغ غلط، طالب غلط، اتسجلت مرتين). لو الفلوس دخلت فعلًا وهترجع = استرداد.')}</p>
      <textarea className="w-full rounded border border-rose-200 bg-white p-2 text-sm" rows={2} maxLength={1000} placeholder={L('Reason (required)', 'السبب (لازم)')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" className="bg-rose-600 hover:bg-rose-700" disabled={ask.isPending || reason.trim().length < 5} onClick={() => ask.mutate()}>{L('Send for approval', 'ابعت للموافقة')}</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>{L('Back', 'رجوع')}</Button>
      </div>
    </div>
  )
}
