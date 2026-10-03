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

interface Session { classSectionId: string; group: string; date: string; time: string; sessionNumber: number | null; totalSessions: number; past: boolean }
interface Excuse { id: string; group: string; sessionDate: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; decisionNote: string | null }
interface Data { sessions: Session[]; excuses: Excuse[] }

const BADGE: Record<Excuse['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
}
const LABEL: Record<Excuse['status'], string> = { PENDING: 'Waiting for approval', APPROVED: 'Accepted', REJECTED: 'Not accepted', CANCELLED: 'Withdrawn' }
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

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
    onSuccess: (r) => { notify.success(r?.status === 'APPROVED' ? 'Excuse accepted' : 'Excuse sent — waiting for approval'); setKey(''); setReason(''); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not send the excuse'),
  })
  const withdraw = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/guardian-portal/excuses/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success('Excuse withdrawn'); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-5 w-5 text-rose-600" /> Absence excuse</CardTitle>
        <CardDescription>{childName.split(' ')[0]} can&apos;t come to a session? Choose the session and write the reason. The instructor sees it in the attendance sheet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="space-y-1">
              <Label>Session</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger><SelectValue placeholder={data?.sessions.length ? 'Choose the session' : 'No session can be excused now'} /></SelectTrigger>
                <SelectContent>
                  {(data?.sessions ?? []).map((s) => (
                    <SelectItem key={`${s.classSectionId}|${s.date}`} value={`${s.classSectionId}|${s.date}`}>
                      {fmt(s.date)}{s.time ? ` ${s.time}` : ''} · {s.group}{s.sessionNumber ? ` · session ${s.sessionNumber} of ${s.totalSessions}` : ''}{s.past ? ' (past)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <textarea className="min-h-[70px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. he has a cold" />
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" disabled={!key || reason.trim().length < 2 || send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send excuse
              </Button>
            </div>
          </div>
        )}
        {(data?.excuses ?? []).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">Sent</p>
            {data!.excuses.map((e) => (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 p-2.5 text-sm">
                <div>
                  <p className="font-medium">{fmt(e.sessionDate)} · {e.group}</p>
                  <p className="text-xs text-slate-600">{e.reason}</p>
                  {e.decisionNote && e.status === 'REJECTED' && <p className="text-xs text-rose-600">{e.decisionNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[e.status]}`}>{LABEL[e.status]}</span>
                  {(e.status === 'PENDING' || (e.status === 'APPROVED' && e.sessionDate > new Date().toISOString().slice(0, 10))) && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={withdraw.isPending} onClick={() => withdraw.mutate(e.id)}>Withdraw</Button>
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
