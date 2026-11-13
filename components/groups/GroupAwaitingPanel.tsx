'use client'

/**
 * Six phases E: students holding a seat in this group until they pay ("after payment" groups). They are not in attendance,
 * lessons or live sessions yet. Staff with group_entry:approve may let one in now, or remove them (seat freed).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Hourglass } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'

type Data = { policy: { entry: string; minPartPercent: number | null }; students: { studentId: string; name: string; registrationNumber: string; invoice: { number: string; total: number; paid: number; proofStatus: string | null } | null }[] }

export function GroupAwaitingPanel({ groupId, canApprove }: { groupId: string; canApprove: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['group-awaiting', groupId], queryFn: () => fetchApi<Data>(`/api/groups/${groupId}/awaiting`), retry: false })
  if (!data || (data.policy.entry !== 'AFTER_PAYMENT' && !data.students.length)) return null
  const act = async (studentId: string, action: 'OPEN' | 'REMOVE') => {
    if (action === 'REMOVE' && !confirm(L('Remove this student? The unpaid invoice is cancelled and the seat is freed.', 'تشيل الطالب ده؟ الفاتورة اللي مش مدفوعة هتتلغي والمكان هيفضى.'))) return
    try {
      await fetchApi(`/api/groups/${groupId}/awaiting`, { method: 'POST', body: JSON.stringify({ studentId, action }) })
      notify.success(L('Done', 'تم'))
      void qc.invalidateQueries({ queryKey: ['group-awaiting', groupId] }); void qc.invalidateQueries({ queryKey: ['group'] }); void qc.invalidateQueries()
    } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900"><Hourglass className="h-4 w-4" aria-hidden /> {L(`Waiting to pay (${data.students.length})`, `مستنيين الدفع (${data.students.length})`)}</p>
      <p className="mt-1 text-xs text-amber-800">{L('This group is joined after payment: these students hold a seat but are not in attendance, lessons or live sessions until they pay', 'الجروب ده الدخول فيه بعد الدفع: الطلاب دول مكانهم محجوز بس مش في الحضور ولا الدروس ولا اللايف لحد ما يدفعوا')}{data.policy.minPartPercent ? L(` (at least ${data.policy.minPartPercent}% in instalments).`, ` (على الأقل ${data.policy.minPartPercent}% في التقسيط).`) : '.'}</p>
      {data.students.length ? (
        <ul className="mt-2 space-y-1.5">
          {data.students.map((s) => (
            <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
              <span><b>{s.name}</b> <span className="text-xs text-slate-500" dir="ltr">{s.registrationNumber}</span>
                {s.invoice ? <span className="block text-xs text-slate-600">{L('Paid', 'مدفوع')} {s.invoice.paid} / {s.invoice.total}{s.invoice.proofStatus === 'PENDING' ? ` · ${L('receipt to check', 'إيصال للمراجعة')}` : ''}</span> : null}</span>
              {canApprove ? <span className="flex gap-1">
                <button type="button" onClick={() => void act(s.studentId, 'OPEN')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">{L('Let in without payment', 'دخّله من غير دفع')}</button>
                <button type="button" onClick={() => void act(s.studentId, 'REMOVE')} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">{L('Remove', 'شيله')}</button>
              </span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-xs text-slate-500">{L('Nobody is waiting.', 'مفيش حد مستني.')}</p>}
    </div>
  )
}
