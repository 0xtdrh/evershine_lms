'use client'

/** a02 M3 batch 2: One-to-One requests offered to this instructor: accept (books it) or decline (goes to the next instructor). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { UserCheck } from 'lucide-react'

interface Offer { id: string; level: string; place: string; slots: { dayOfWeek: number; time: string; mode?: string }[]; expiresAt: string | null; students: string[] }

const when = (d: string | null) => (d ? new Date(d).toLocaleString(L('en-GB', 'ar-EG-u-nu-latn'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '')

export default function OneToOneOffersPage() {
  useI18n()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['one-to-one-offers'], queryFn: () => fetchApi<Offer[]>('/api/teacher-portal/one-to-one-offers') })
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => fetchApi(`/api/teacher-portal/one-to-one-offers/${id}`, { method: 'POST', body: JSON.stringify({ accept }) }),
    onSuccess: (_r, v) => { notify.success(v.accept ? L('Accepted. It is on your schedule.', 'اتقبل، وبقى في جدولك.') : L('Declined', 'اترفض')); qc.invalidateQueries({ queryKey: ['one-to-one-offers'] }) },
    onError: (e: Error) => { notify.error(e.message); qc.invalidateQueries({ queryKey: ['one-to-one-offers'] }) },
  })
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><UserCheck className="h-5 w-5 text-indigo-600" /> {L('One-to-One requests', 'طلبات One-to-One')}</h1>
      {isLoading && <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>}
      {data && !data.length && <p className="py-10 text-center text-sm text-slate-500">{L('No requests waiting for you.', 'مفيش طلبات مستنياك.')}</p>}
      {(data ?? []).map((o) => (
        <Card key={o.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
          <div className="space-y-1">
            <p className="font-semibold">{o.students.join(' + ')} · {o.level}</p>
            <p className="text-slate-600">{o.place} · {o.slots.map((s) => `${dayName(s.dayOfWeek)} ${s.time} (${s.mode === 'ONLINE' ? L('online', 'أونلاين') : L('branch', 'فرع')})`).join('، ')}</p>
            {o.expiresAt && <p className="text-xs text-amber-700">{L('Answer by', 'رد قبل')} {when(o.expiresAt)}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={answer.isPending} onClick={() => answer.mutate({ id: o.id, accept: true })}>{L('Accept', 'موافق')}</Button>
            <Button size="sm" variant="outline" disabled={answer.isPending} onClick={() => answer.mutate({ id: o.id, accept: false })}>{L('Decline', 'مش هقدر')}</Button>
          </div>
        </CardContent></Card>
      ))}
    </div>
  )
}
