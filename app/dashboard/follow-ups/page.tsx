'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CHANNEL_LABEL, REASON_LABEL } from '@/components/students/StudentContactLogCard'
import { Check, Loader2, PhoneCall } from 'lucide-react'

interface Row {
  id: string
  followUpAt: string
  channel: string
  reason: string
  summary: string
  createdAt: string
  by: string | null
  student: { id: string; name: string; registrationNumber: string } | null
  guardian: { name: string; phone: string } | null
}
interface Data { overdue: Row[]; today: Row[]; upcoming: Row[]; counts: { overdue: number; today: number; upcoming: number } }

const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '20')}`

/** Parent follow-ups: overdue, today and the next two weeks (phase A). */
export default function FollowUpsPage() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['follow-ups'], queryFn: () => fetchApi<Data>('/api/contact-logs/follow-ups') })
  const done = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/contact-logs/${id}`, { method: 'PATCH', body: JSON.stringify({ followUpDone: true }) }),
    onSuccess: () => { notify.success('Done'); qc.invalidateQueries({ queryKey: ['follow-ups'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const section = (title: string, rows: Row[], tone: string) => (
    <Card>
      <CardHeader className="pb-2"><CardTitle className={`text-sm ${tone}`}>{title} ({rows.length})</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length === 0 && <p className="text-slate-500">Nothing here.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-slate-800">
                {r.student ? <Link href={`/dashboard/students/${r.student.id}`} className="hover:underline">{r.student.name}</Link> : '—'}
                <span className="ml-1 text-xs text-slate-400">{r.student?.registrationNumber}</span>
              </p>
              <p className="text-xs text-slate-500">
                Follow-up {new Date(r.followUpAt).toLocaleDateString('en-GB')} · {CHANNEL_LABEL[r.channel] ?? r.channel} · {REASON_LABEL[r.reason] ?? r.reason}{r.by ? ` · by ${r.by}` : ''}
              </p>
              <p className="mt-0.5 text-slate-700">{r.summary}</p>
              {r.guardian && <p className="text-xs text-slate-500">{r.guardian.name} · {r.guardian.phone}</p>}
            </div>
            <div className="flex gap-1.5">
              {r.guardian && (
                <a href={wa(r.guardian.phone)} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs">WhatsApp</Button>
                </a>
              )}
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={done.isPending} onClick={() => done.mutate(r.id)}><Check className="h-3.5 w-3.5" /> Done</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><PhoneCall className="h-5 w-5 text-indigo-600" /> Follow-ups</h1>
        <p className="text-sm text-slate-500">Parents you said you would contact again. Log a new contact from the student page.</p>
      </div>
      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}
      {data && (
        <>
          {section('Overdue', data.overdue, 'text-rose-700')}
          {section('Today', data.today, 'text-indigo-700')}
          {section('Next two weeks', data.upcoming, 'text-slate-700')}
        </>
      )}
    </div>
  )
}
