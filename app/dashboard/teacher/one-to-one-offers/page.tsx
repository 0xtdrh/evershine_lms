'use client'

/** a02 M3 batch 2: One-to-One requests offered to this instructor: accept (books it) or decline (goes to the next instructor). */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { UserCheck } from 'lucide-react'

interface Offer { id: string; level: string; place: string; slots: { dayOfWeek: number; time: string; mode?: string }[]; expiresAt: string | null; students: string[] }

const when = (d: string | null) => (d ? new Date(d).toLocaleString(L('en-GB', 'ar-EG-u-nu-latn'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '')

function MySessions() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['one-to-one-my-sessions'], queryFn: () => fetchApi<{ id: string; name: string; sessions: { date: string; time: string }[] }[]>('/api/teacher-portal/one-to-one-offers/sessions') })
  const [pick, setPick] = useState<Record<string, string>>({})
  const [why, setWhy] = useState<Record<string, string>>({})
  const go = useMutation({
    mutationFn: (g: string) => fetchApi('/api/teacher-portal/one-to-one-offers/sessions', { method: 'POST', body: JSON.stringify({ groupId: g, date: pick[g], reason: why[g] }) }),
    onSuccess: () => { notify.success(L('Sent. The family and the branch are told.', 'اتبعت، والأهل والفرع عرفوا.')); qc.invalidateQueries({ queryKey: ['one-to-one-my-sessions'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data?.length) return null
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">{L('Your One-to-Ones', 'الـ One-to-One بتوعك')}</h2>
      {data.map((g) => (
        <Card key={g.id}><CardContent className="space-y-2 pt-4 text-sm">
          <p className="font-semibold">{g.name}</p>
          <p className="text-slate-600">{g.sessions.map((s) => `${s.date} ${s.time}`).join('، ') || L('No coming sessions', 'مفيش حصص جاية')}</p>
          {g.sessions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" aria-label={L('Session', 'الحصة')} value={pick[g.id] ?? ''} onChange={(e) => setPick({ ...pick, [g.id]: e.target.value })}><option value="">{L('I cannot come on', 'مش هقدر أجي يوم')}</option>{g.sessions.map((s) => <option key={s.date} value={s.date}>{s.date} {s.time}</option>)}</select>
              <Input className="h-9 min-w-[12rem] flex-1" placeholder={L('Reason', 'السبب')} value={why[g.id] ?? ''} onChange={(e) => setWhy({ ...why, [g.id]: e.target.value })} />
              <Button size="sm" variant="outline" disabled={!pick[g.id] || (why[g.id] ?? '').trim().length < 2 || go.isPending} onClick={() => go.mutate(g.id)}>{L('Send the apology', 'ابعت الاعتذار')}</Button>
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  )
}

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
      <MySessions />
    </div>
  )
}
