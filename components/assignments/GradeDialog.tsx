'use client'

/** LMS L3: grade one hand-in — the work, automatic question results (with a change + reason), points / stars / rubric, feedback. */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Markdown } from '@/components/curriculum/BlockView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckCircle2, FileText, Link2, Loader2, Mic, Square, Trash2, XCircle } from 'lucide-react'
import { TOOL_RULES } from '@/lib/assignments/tool-checks'

interface Opt { id: string; textEn: string; textAr: string }
interface Q { id: string; type: string; textEn: string; options: Opt[]; correct: (string | number)[]; tolerance?: number; points: number }
interface Crit { id: string; titleEn: string; levels: { labelEn: string; points: number; descEn: string }[] }
interface Data {
  student: { firstName: string; lastName: string; registrationNumber: string } | null
  titleEn: string | null
  assignment: { instructionsEn: string; kinds: string[]; questions: Q[]; scale: string; maxPoints: number; rubric: { criteria: Crit[]; kidStars: boolean } | null; maxScore: number; questionsMax: number; autoMax: number; manualMax: number
    code: { language: string; tests: { id: string; input: string; expected: string; points: number }[] } | null; toolCheck: { tool: keyof typeof TOOL_RULES; rules: { id: string; kind: string; value?: string | number | null; points: number }[] } | null } | null
  similar: { name: string; percent: number }[]
  submission: { code: string | null; codeResults: { id: string; passed: boolean; output: string }[] | null; toolResult: { ok: boolean; error?: string; source?: string; detail: { id: string; kind: string; ok: boolean; points: number }[] } | null; feedbackAudio: string | null; galleryStatus: string | null; status: string; attempt: number; text: string | null; links: string[] | null; files: { url: string; originalName?: string; resourceType: string }[]; answers: Record<string, unknown> | null; autoScore: number | null; autoDetail: unknown; score: number | null; rubricScores: Record<string, number> | null; feedback: string | null; late: boolean; latePenaltyPct: number | null; submittedAt: string | null; inClass: boolean; submittedByUserId: string | null }
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
  const [gallery, setGallery] = useState(false)
  const [audio, setAudio] = useState<{ publicId: string; resourceType: 'video' | 'raw'; format?: string } | null | undefined>(undefined)
  const [recording, setRecording] = useState<MediaRecorder | null>(null)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  useEffect(() => {
    if (!data) return
    const s = data.submission
    setFeedback(s.feedback ?? '')
    setGallery(s.galleryStatus === 'APPROVED')
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
        gallery, ...(audio !== undefined ? { feedbackAudio: audio } : {}),
      }),
    }),
    onSuccess: (_r, p) => { notify.success(p.action === 'return' ? 'Sent back for changes' : 'Graded'); onDone(!!p.next) },
    onError: (e: Error) => notify.error(e.message),
  })

  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setUploadingAudio(true)
        try {
          const sig = await fetchApi<{ timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }>(`/api/assignments/submissions/${submissionId}/audio`, { method: 'POST' })
          const fd = new FormData()
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
          for (const [k, v] of Object.entries({ file: new File([blob], `voice.${ext}`), api_key: sig.apiKey, timestamp: String(sig.timestamp), signature: sig.signature, folder: sig.folder, allowed_formats: sig.allowedFormats, type: sig.type })) fd.append(k, v as Blob | string)
          const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, { method: 'POST', body: fd })
          const j = await res.json()
          if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
          setAudio({ publicId: j.public_id, resourceType: j.resource_type === 'video' ? 'video' : 'raw', format: j.format })
          notify.success('Voice note ready — it is saved with the grade')
        } catch (e) { notify.error((e as Error).message) } finally { setUploadingAudio(false) }
      }
      rec.start()
      setRecording(rec)
      setTimeout(() => { if (rec.state === 'recording') rec.stop() }, 120_000) // 2 minutes max
    } catch { notify.error('Microphone not available') }
  }

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

      {data.similar.length > 0 && <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">Looks like: {data.similar.map((x) => `${x.name} (${x.percent}%)`).join(', ')} — check for copying.</p>}
      {s.code && (
        <div className="space-y-1">
          <pre dir="ltr" className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">{s.code}</pre>
          {a?.code?.tests.map((tc, i) => {
            const r2 = s.codeResults?.find((x) => x.id === tc.id)
            return <p key={tc.id} dir="ltr" className="flex items-center gap-1 text-xs">{r2?.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} Test {i + 1}: expected <b>{tc.expected}</b>{r2 && !r2.passed ? ` · got ${r2.output.slice(0, 80) || '—'}` : ''} ({tc.points}) <span className="text-slate-400">· ran in the student&apos;s browser</span></p>
          })}
        </div>
      )}
      {a?.toolCheck && (
        <div className="space-y-1 rounded-lg border border-slate-200 p-2 text-xs">
          <p className="font-semibold text-slate-500">Automatic project check{s.toolResult?.source ? ` · ${s.toolResult.source}` : ''}</p>
          {s.toolResult?.error && <p className="text-amber-700">{s.toolResult.error} — grade it yourself.</p>}
          {a.toolCheck.rules.map((rule) => {
            const d = s.toolResult?.detail.find((x) => x.id === rule.id)
            const def = TOOL_RULES[a.toolCheck!.tool]?.find((x) => x.kind === rule.kind)
            return <p key={rule.id} className="flex items-center gap-1">{d?.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} {def?.labelEn ?? rule.kind}{rule.value != null && rule.value !== '' ? ` (${rule.value})` : ''} — {d?.points ?? 0}/{rule.points}</p>
          })}
        </div>
      )}
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

      {!a?.questions.length && !!a?.autoMax && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          Automatic points / {a.autoMax} <Input type="number" className="h-8 w-20" value={auto} onChange={(e) => setAuto(e.target.value)} />
          {auto !== '' && Number(auto) !== s.autoScore && <Input className="h-8 flex-1" placeholder="Why the automatic score is changed (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </div>
      )}
      {!!a?.questions.length && (
        <div className="space-y-1 rounded-lg border border-slate-200 p-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Questions</p>
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
            Automatic points (all) / {a.autoMax} <Input type="number" className="h-8 w-20" value={auto} onChange={(e) => setAuto(e.target.value)} />
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
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {recording ? (
          <Button type="button" size="sm" variant="outline" className="gap-1 border-rose-300 text-rose-700" onClick={() => { recording.stop(); setRecording(null) }}><Square className="h-3 w-3" /> Stop recording</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="gap-1" disabled={uploadingAudio} onClick={record}>{uploadingAudio ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />} Voice note</Button>
        )}
        {(audio === undefined ? s.feedbackAudio : audio) && (
          <span className="flex items-center gap-1">
            {audio === undefined && s.feedbackAudio ? <audio controls src={s.feedbackAudio} className="h-8" /> : <span className="text-emerald-700">new voice note ✓</span>}
            <button type="button" aria-label="Remove voice note" onClick={() => setAudio(null)}><Trash2 className="h-3 w-3 text-slate-400" /></button>
          </span>
        )}
        <label className="flex items-center gap-1"><input type="checkbox" checked={gallery} onChange={(e) => setGallery(e.target.checked)} /> Show in the projects gallery ⭐</label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: 'return' })}>Send back for changes</Button>
        <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ action: 'grade', next: true })}>Grade &amp; next</Button>
        <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'grade' })}>{act.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Grade</Button>
      </div>
    </div>
  )
}
