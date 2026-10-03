'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Star } from 'lucide-react'

interface PendingSession { classSectionId: string; group: string; date: string }
interface PendingSurvey { classSectionId: string; group: string; course: string | null; level: string | null; kind: 'MONTHLY' | 'LEVEL' }
interface Child { studentId: string; name: string; young: boolean; sessions: PendingSession[]; surveys: PendingSurvey[] }

export const FACES = [
  { v: 4, f: '😀', l: 'Great' },
  { v: 3, f: '🙂', l: 'Good' },
  { v: 2, f: '😐', l: 'OK' },
  { v: 1, f: '🙁', l: 'Not good' },
]
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} of 5`}>
          <Star className={`h-6 w-6 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
        </button>
      ))}
    </div>
  )
}

function SurveyForm({ child, s, onDone }: { child: Child; s: PendingSurvey; onDone: () => void }) {
  const [r, setR] = useState({ sessionsRating: 0, teacherRating: 0, companyRating: 0 })
  const [comment, setComment] = useState('')
  const send = useMutation({
    mutationFn: () => fetchApi('/api/ratings/parent', { method: 'POST', body: JSON.stringify({ type: 'survey', studentId: child.studentId, classSectionId: s.classSectionId, ...r, comment: comment || null }) }),
    onSuccess: () => { notify.success('Thank you for your rating!'); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const q: [keyof typeof r, string][] = [['sessionsRating', 'How were the sessions?'], ['teacherRating', 'How is the instructor?'], ['companyRating', 'How is TechNova overall?']]
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-800">
        {child.name.split(' ')[0]} · {s.course ?? s.group}{s.level ? ` · ${s.level}` : ''} — {s.kind === 'LEVEL' ? 'end of the level' : 'end of the month'}
      </p>
      {q.map(([k, label]) => (
        <div key={k} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{label}</span>
          <Stars value={r[k]} onChange={(n) => setR({ ...r, [k]: n })} />
        </div>
      ))}
      <textarea className="min-h-[56px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm" maxLength={1000} placeholder="Anything you'd like to tell us? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex justify-end"><Button size="sm" disabled={!r.sessionsRating || !r.teacherRating || !r.companyRating || send.isPending} onClick={() => send.mutate()}>Send</Button></div>
    </div>
  )
}

/** Phase C: monthly / level survey, and session faces for young children. Hidden when there is nothing to answer. */
export function ParentRatingsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['parent-ratings'], queryFn: () => fetchApi<{ children: Child[] }>('/api/ratings/parent') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['parent-ratings'] })
  const face = useMutation({
    mutationFn: (p: { studentId: string; classSectionId: string; sessionDate: string; rating: number }) => fetchApi('/api/ratings/parent', { method: 'POST', body: JSON.stringify({ type: 'session', ...p }) }),
    onSuccess: () => { notify.success('Thank you!'); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const children = (data?.children ?? []).filter((c) => c.sessions.length || c.surveys.length)
  if (!children.length) return null
  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Your opinion</CardTitle>
        <CardDescription>A few taps help us improve. Only the management sees names.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {children.map((c) => (
          <div key={c.studentId} className="space-y-3">
            {c.sessions.map((s) => (
              <div key={`${s.classSectionId}|${s.date}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                <span>How was {c.name.split(' ')[0]}&apos;s session on {fmt(s.date)} ({s.group})?</span>
                <div className="flex gap-1">
                  {FACES.map((x) => (
                    <button key={x.v} type="button" title={x.l} className="rounded-lg px-1.5 text-2xl hover:bg-slate-100" disabled={face.isPending}
                      onClick={() => face.mutate({ studentId: c.studentId, classSectionId: s.classSectionId, sessionDate: s.date, rating: x.v })}>{x.f}</button>
                  ))}
                </div>
              </div>
            ))}
            {c.surveys.map((s) => <SurveyForm key={s.classSectionId} child={c} s={s} onDone={refresh} />)}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
