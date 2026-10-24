'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Clock, Loader2, Send } from 'lucide-react'
import { L } from '@/lib/i18n/client'
import { cairoToday } from '@/lib/dates/cairo'

interface Session { classSectionId: string; group: string; date: string; time: string; sessionNumber: number | null; totalSessions: number; past: boolean }
interface Excuse { id: string; group: string; sessionDate: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; decisionNote: string | null }
interface Data { sessions: Session[]; excuses: Excuse[] }

const BADGE: Record<Excuse['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
}
const LABEL = (st: Excuse['status']) => ({ PENDING: L('Waiting for approval', 'مستني الموافقة'), APPROVED: L('Accepted', 'اتقبل'), REJECTED: L('Not accepted', 'ماتقبلش'), CANCELLED: L('Withdrawn', 'اتسحب') })[st]
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'), { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })

/** Phase C: the parent sends an excuse for one session (before it, or a few days after). */
export function ChildExcusesCard({ studentId, childName }: { studentId: string; childName: string }) {
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const [reason, setReason] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['parent-excuses', studentId],
    queryFn: () => fetchApi<Data>(`/api/guardian-portal/excuses?studentId=${studentId}`),
    enabled: !!studentId,
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['parent-excuses', studentId] })
    qc.invalidateQueries({ queryKey: ['attendance-timeline', studentId] })
  }
  const send = useMutation({
    mutationFn: () => {
      const [classSectionId, sessionDate] = key.split('|')
      return fetchApi<{ status: string }>('/api/guardian-portal/excuses', { method: 'POST', body: JSON.stringify({ studentId, classSectionId, sessionDate, reason }) })
    },
    onSuccess: (r) => { notify.success(r?.status === 'APPROVED' ? L('Excuse accepted', 'العذر اتقبل') : L('Excuse sent — waiting for approval', 'العذر اتبعت — مستني الموافقة')); setKey(''); setReason(''); refresh() },
    onError: (e: Error) => notify.error(e.message || L('Could not send the excuse', 'العذر مااتبعتش')),
  })
  const withdraw = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/guardian-portal/excuses/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Excuse withdrawn', 'العذر اتسحب')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-5 w-5 text-rose-600" /> {L('Absence excuse', 'عذر غياب')}</CardTitle>
        <CardDescription>{L(`${childName.split(' ')[0]} can't come to a session? Choose the session and write the reason. The instructor sees it in the attendance sheet.`, `${childName.split(' ')[0]} مش هيقدر يحضر حصة؟ اختار الحصة واكتب السبب، والمدرب هيشوفه في كشف الحضور.`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="space-y-1">
              <Label>{L('Session', 'الحصة')}</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger><SelectValue placeholder={data?.sessions.length ? L('Choose the session', 'اختار الحصة') : L('No session can be excused now', 'مفيش حصة ينفع تعتذر عنها دلوقتي')} /></SelectTrigger>
                <SelectContent>
                  {(data?.sessions ?? []).map((s) => (
                    <SelectItem key={`${s.classSectionId}|${s.date}`} value={`${s.classSectionId}|${s.date}`}>
                      {fmt(s.date)}{s.time ? ` ${s.time}` : ''} · {s.group}{s.sessionNumber ? ` · ${L('session', 'حصة')} ${s.sessionNumber} ${L('of', 'من')} ${s.totalSessions}` : ''}{s.past ? L(' (past)', ' (فاتت)') : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{L('Reason', 'السبب')}</Label>
              <textarea className="min-h-[70px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('e.g. he has a cold', 'مثلاً: عنده برد')} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" disabled={!key || reason.trim().length < 2 || send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {L('Send excuse', 'ابعت العذر')}
              </Button>
            </div>
          </div>
        )}
        {(data?.excuses ?? []).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">{L('Sent', 'اتبعت')}</p>
            {data!.excuses.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 p-2.5 text-sm">
                <div>
                  <p className="font-medium">{fmt(e.sessionDate)} · {e.group}</p>
                  <p className="text-xs text-slate-600">{e.reason}</p>
                  {e.decisionNote && e.status === 'REJECTED' && <p className="text-xs text-rose-600">{e.decisionNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[e.status]}`}>{LABEL(e.status)}</span>
                  {(e.status === 'PENDING' || (e.status === 'APPROVED' && e.sessionDate > cairoToday())) && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={withdraw.isPending} onClick={() => withdraw.mutate(e.id)}>{L('Withdraw', 'اسحب')}</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
