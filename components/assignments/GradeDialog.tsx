'use client'

/** LMS L3: grade one hand-in — the work, automatic question results (with a change + reason), points / stars / rubric, feedback. */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Markdown } from '@/components/curriculum/BlockView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle2, FileText, Link2, Loader2, XCircle } from 'lucide-react'

interface Opt { id: string; textEn: string; textAr: string }
interface Q { id: string; type: string; textEn: string; options: Opt[]; correct: (string | number)[]; tolerance?: number; points: number }
interface Crit { id: string; titleEn: string; levels: { labelEn: string; points: number; descEn: string }[] }
interface Data {
  student: { firstName: string; lastName: string; registrationNumber: string } | null
  titleEn: string | null
  assignment: { instructionsEn: string; kinds: string[]; questions: Q[]; scale: string; maxPoints: number; rubric: { criteria: Crit[]; kidStars: boolean } | null; maxScore: number; questionsMax: number; manualMax: number } | null
  submission: { status: string; attempt: number; text: string | null; links: string[] | null; files: { url: string; originalName?: string; resourceType: string }[]; answers: Record<string, unknown> | null; autoScore: number | null; autoDetail: unknown; score: number | null; rubricScores: Record<string, number> | null; feedback: string | null; late: boolean; latePenaltyPct: number | null; submittedAt: string | null; inClass: boolean; submittedByUserId: string | null }
}

const answerText = (q: Q, a: unknown) => {
  if (a === undefined || a === null || a === '') return '—'
  if (q.type === 'SINGLE' || q.type === 'MULTI') return (Array.isArray(a) ? a : [a]).map((id) => q.options.find((o) => o.id === id)?.textEn ?? id).join(', ')
  return String(a)
}
const correctText = (q: Q) => (q.type === 'SINGLE' || q.type === 'MULTI' ? q.correct.map((id) => q.options.find((o) => o.id === id)?.textEn ?? id).join(', ') : q.correct.join(' | ') + (q.tolerance ? ` (±${q.tolerance})` : ''))

export function GradeDialog({ submissionId, onDone }: { submissionId: string; onDone: (next: boolean) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['submission', submissionId], queryFn: () => fetchApi<Data>(`/api/assignments/submissions/${submissionId}`) })
  const [points, setPoints] = useState<string>('')
  const [stars, setStars] = useState<number | null>(null)
  const [picks, setPicks] = useState<Record<string, number>>({})
  const [auto, setAuto] = useState<string>('')
  const [reason, setReason] = useState('')
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    if (!data) return
    const s = data.submission
    setFeedback(s.feedback ?? '')
    setPicks(s.rubricScores ?? {})
    setAuto(s.autoScore != null ? String(s.autoScore) : '')
    const manualNow = s.score != null ? s.score / (1 - (s.latePenaltyPct ?? 0) / 100) - (s.autoScore ?? 0) : null
    if (data.assignment?.scale === 'STARS') setStars(manualNow != null ? Math.round(manualNow) : null)
    else if (data.assignment?.scale === 'POINTS') setPoints(manualNow != null ? String(Math.round(manualNow * 100) / 100) : '')
  }, [data])

  const act = useMutation({
    mutationFn: (p: { action: 'grade' | 'return'; next?: boolean }) => fetchApi(`/api/assignments/submissions/${submissionId}`, {
      method: 'POST',
      body: JSON.stringify({
        action: p.action, feedback: feedback || null,
        points: points === '' ? null : Number(points), stars, rubricPicks: picks,
        autoOverride: auto === '' || Number(auto) === data?.submission.autoScore ? null : Number(auto), overrideReason: reason || null,
      }),
    }),
    onSuccess: (_r, p) => { notify.success(p.action === 'return' ? 'Sent back for changes' : 'Graded'); onDone(!!p.next) },
    onError: (e: Error) => notify.error(e.message),
  })

  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const a = data.assignment
  const s = data.submission
  const detail = (Array.isArray(s.autoDetail) ? s.autoDetail : (s.autoDetail as { items?: unknown[] } | null)?.items ?? []) as { id: string; correct: boolean; points: number }[]
  const hasManual = !!a && a.manualMax > 0
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">{data.student?.firstName} {data.student?.lastName} <span className="text-xs font-normal text-slate-400">{data.student?.registrationNumber}</span></p>
        <span className="text-xs text-slate-500">try {s.attempt}{s.submittedAt ? ` · ${new Date(s.submittedAt).toLocaleString('en-GB')}` : ''}{s.late ? ` · late${s.latePenaltyPct ? ` (−${s.latePenaltyPct}%)` : ''}` : ''}{s.inClass ? ' · done in class' : ''}</span>
      </div>
      {a?.instructionsEn && <details className="text-xs"><summary className="cursor-pointer text-slate-500">Instructions</summary><Markdown text={a.instructionsEn} /></details>}

      {s.text && <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3">{s.text}</div>}
      {!!s.links?.length && <div className="space-y-1">{s.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-indigo-600 underline"><Link2 className="h-4 w-4" /> {l}</a>)}</div>}
      {!!s.files?.length && (
        <div className="flex flex-wrap gap-2">
          {s.files.map((f, i) => f.resourceType === 'image'
            // eslint-disable-next-line @next/next/no-img-element
            ? <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"><img src={f.url} alt={f.originalName ?? ''} className="h-28 rounded-lg border border-slate-200 object-cover" /></a>
            : <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-indigo-600"><FileText className="h-4 w-4" /> {f.originalName ?? `file ${i + 1}`}</a>)}
        </div>
      )}

      {!!a?.questions.length && (
        <div className="space-y-1 rounded-lg border border-slate-200 p-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Questions (automatic: {s.autoScore ?? 0} / {a.questionsMax})</p>
          {a.questions.map((q, i) => {
            const d = detail.find((x) => x.id === q.id)
            return (
              <div key={q.id} className="flex items-start gap-2 text-xs">
                {d?.correct ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
                <span>{i + 1}. {q.textEn} — <b>{answerText(q, s.answers?.[q.id])}</b>{!d?.correct && <span className="text-slate-500"> (correct: {correctText(q)})</span>}</span>
              </div>
            )
          })}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            Question points <Input type="number" className="h-8 w-20" value={auto} onChange={(e) => setAuto(e.target.value)} />
            {auto !== '' && Number(auto) !== s.autoScore && <Input className="h-8 flex-1" placeholder="Why the automatic score is changed (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>
        </div>
      )}

      {hasManual && a!.scale === 'POINTS' && <label className="flex items-center gap-2">Points <Input type="number" min={0} max={a!.maxPoints} className="h-9 w-24" value={points} onChange={(e) => setPoints(e.target.value)} /> / {a!.maxPoints}</label>}
      {hasManual && a!.scale === 'STARS' && (
        <div className="flex items-center gap-1">{[0, 1, 2, 3].map((n) => <button key={n} type="button" onClick={() => setStars(n)} className={`rounded-lg border px-3 py-1 text-lg ${stars === n ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>{n === 0 ? '0' : '⭐'.repeat(n)}</button>)}</div>
      )}
      {hasManual && a!.scale === 'RUBRIC' && a!.rubric && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {a!.rubric.criteria.map((c) => (
                <tr key={c.id}>
                  <td className="border border-slate-200 p-1 font-semibold">{c.titleEn}</td>
                  {c.levels.map((l, i) => (
                    <td key={i} className={`cursor-pointer border border-slate-200 p-1 ${picks[c.id] === i ? 'bg-indigo-100 font-semibold' : 'hover:bg-slate-50'}`} onClick={() => setPicks({ ...picks, [c.id]: i })}>
                      {l.labelEn} ({l.points}){l.descEn && <span className="block text-slate-500">{l.descEn}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <textarea className="min-h-[90px] w-full rounded-md border border-slate-200 bg-white p-2" placeholder="Feedback for the student and the parent" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: 'return' })}>Send back for changes</Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: 'grade', next: true })}>Grade &amp; next</Button>
        <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'grade' })}>{act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Grade</Button>
      </div>
    </div>
  )
}
