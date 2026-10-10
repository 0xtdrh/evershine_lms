'use client'

/**
 * LMS L4: quizzes of a group for the people who run it — open / close (e.g. the final exam in the last session),
 * every student's score, review written-code answers, paper exam (typed score + scan), item analysis.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { CodeBlock } from '@/components/quizzes/CodeBlock'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BarChart3, FileUp, ListChecks, Loader2, Lock, LockOpen, Paperclip } from 'lucide-react'

interface GroupRow { id: string; label: string; course: string; level: string }
interface Quiz {
  blockId: string; sessionNumber: number; lessonOpen: boolean; titleEn: string | null; titleAr: string | null; kind: string; allowPaper: boolean
  needsOpen: boolean; open: boolean; closesAt: string | null; passMark: number; toReview: string[]
  results: { studentId: string; tries: number; paper: boolean; inProgress: boolean; waiting: boolean; reviewId: string | null; result: { score: number; max: number; percent: number } | null }[]
}
interface Data { quizzes: Quiz[]; students: { id: string; name: string }[] }

function Review({ attemptId, onDone }: { attemptId: string; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['quiz-review', attemptId], queryFn: () => fetchApi<{ studentName: string; questions: { id: string; type: string; textEn: string; points: number; code?: string; language?: string }[]; answers: Record<string, unknown>; detail: { id: string; points: number; correct: boolean; review?: boolean }[] | null; feedback: string | null }>(`/api/quizzes/review/${attemptId}`) })
  const [points, setPoints] = useState<Record<string, number>>({})
  const [feedback, setFeedback] = useState('')
  useEffect(() => { if (data) setFeedback(data.feedback ?? '') }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/quizzes/review/${attemptId}`, { method: 'POST', body: JSON.stringify({ points, feedback: feedback || null }) }),
    onSuccess: () => { notify.success('Saved'); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">{data.studentName}</p>
      {data.questions.map((q, i) => {
        const d = data.detail?.find((x) => x.id === q.id)
        const a = data.answers?.[q.id] as { code?: string; results?: { id: string; passed: boolean }[] } | string | undefined
        return (
          <div key={q.id} className={`space-y-1 rounded-lg border p-2 ${d?.review ? 'border-violet-300 bg-violet-50/40' : 'border-slate-100'}`}>
            <p className="text-xs text-slate-500">Q{i + 1} · {q.type} · {d?.points ?? 0}/{q.points}</p>
            <p>{q.textEn}</p>
            {q.type === 'WRITE_CODE' ? (
              <>
                <CodeBlock code={typeof a === 'object' && a?.code ? a.code : '(no code)'} language={q.language} />
                <p className="text-xs text-slate-500">Tests passed in the browser: {typeof a === 'object' ? (a?.results ?? []).filter((x) => x.passed).length : 0}</p>
                <label className="flex items-center gap-2 text-xs">Points <Input type="number" min={0} max={q.points} className="h-8 w-20" defaultValue={d?.points ?? 0} onChange={(e) => setPoints({ ...points, [q.id]: Number(e.target.value) })} /> / {q.points}</label>
              </>
            ) : <p className="text-xs text-slate-600">Answer: {typeof a === 'object' ? JSON.stringify(a) : String(a ?? '—')}</p>}
          </div>
        )
      })}
      <textarea className="min-h-[70px] w-full rounded-md border border-slate-200 bg-white p-2" placeholder="Feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="flex justify-end"><Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
    </div>
  )
}

function Paper({ groupId, quiz, students, onDone }: { groupId: string; quiz: Quiz; students: Data['students']; onDone: () => void }) {
  const [studentId, setStudentId] = useState('')
  const [score, setScore] = useState('')
  const [max, setMax] = useState('100')
  const [feedback, setFeedback] = useState('')
  const [files, setFiles] = useState<{ publicId: string; resourceType: 'image' | 'raw'; format?: string; originalName?: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(list).slice(0, 5)) {
        const s = await fetchApi<{ timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }>(`/api/groups/${groupId}/quizzes/scan-sign`, { method: 'POST' })
        const fd = new FormData()
        for (const [k, v] of Object.entries({ file: f, api_key: s.apiKey, timestamp: String(s.timestamp), signature: s.signature, folder: s.folder, allowed_formats: s.allowedFormats, type: s.type })) fd.append(k, v as Blob | string)
        const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd })
        const j = await res.json()
        if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
        setFiles((x) => [...x, { publicId: j.public_id, resourceType: j.resource_type === 'image' ? 'image' : 'raw', format: j.format, originalName: f.name }])
      }
    } catch (e) { notify.error((e as Error).message) } finally { setUploading(false) }
  }
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/quizzes/paper`, { method: 'POST', body: JSON.stringify({ blockId: quiz.blockId, studentId, score: Number(score), maxScore: Number(max), scanFiles: files, feedback: feedback || null }) }),
    onSuccess: () => { notify.success('Saved'); setStudentId(''); setScore(''); setFiles([]); setFeedback(''); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3 text-sm">
      <Select value={studentId} onValueChange={setStudentId}>
        <SelectTrigger><SelectValue placeholder="Student" /></SelectTrigger>
        <SelectContent>{students.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{quiz.results.find((r) => r.studentId === s.id)?.paper ? ' (has a paper result)' : ''}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex items-center gap-2">Score <Input type="number" className="h-9 w-24" value={score} onChange={(e) => setScore(e.target.value)} /> out of <Input type="number" className="h-9 w-24" value={max} onChange={(e) => setMax(e.target.value)} /></div>
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Scan of the paper (photo / PDF)<input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => upload(e.target.files)} /></label>
      {files.map((f) => <p key={f.publicId} className="flex items-center gap-1 text-xs"><Paperclip className="h-3 w-3" /> {f.originalName}</p>)}
      <textarea className="min-h-[60px] w-full rounded-md border border-slate-200 bg-white p-2" placeholder="Feedback (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="flex justify-end"><Button disabled={!studentId || score === '' || uploading || save.isPending} onClick={() => save.mutate()}>Save paper result</Button></div>
    </div>
  )
}

function Analysis({ groupId, blockId }: { groupId: string; blockId: string }) {
  const { data } = useQuery({ queryKey: ['quiz-analysis', groupId, blockId], queryFn: () => fetchApi<{ id: string; textEn: string; type: string; answered: number; percentCorrect: number | null; commonWrong: string | null }[]>(`/api/quizzes/analysis?b=${blockId}&g=${groupId}`) })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (!data.length) return <p className="text-sm text-slate-500">No finished tries yet.</p>
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-start text-slate-500"><th className="p-1 text-start">Question (hardest first)</th><th className="p-1">Answered</th><th className="p-1">Correct</th><th className="p-1 text-start">Most chosen wrong answer</th></tr></thead>
      <tbody>{data.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="p-1">{r.textEn || r.type}</td><td className="p-1 text-center">{r.answered}</td><td className={`p-1 text-center font-semibold ${(r.percentCorrect ?? 100) < 50 ? 'text-rose-600' : 'text-emerald-700'}`}>{r.percentCorrect ?? '—'}%</td><td className="p-1">{r.commonWrong ?? '—'}</td></tr>)}</tbody>
    </table>
  )
}

export default function QuizzesPage() {
  const { pick } = useI18n()
  const qc = useQueryClient()
  const { data: groups, error: gErr } = useQuery({ queryKey: ['hw-groups'], queryFn: () => fetchApi<GroupRow[]>('/api/assignments/groups') })
  const [groupId, setGroupId] = useState('')
  useEffect(() => { if (!groupId && groups?.length) setGroupId(groups[0].id) }, [groups, groupId])
  const key = ['group-quizzes', groupId]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<Data>(`/api/groups/${groupId}/quizzes`), enabled: !!groupId })
  const [review, setReview] = useState<string | null>(null)
  const [paper, setPaper] = useState<Quiz | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const win = useMutation({
    mutationFn: (b: { blockId: string; open: boolean; closesAt?: string | null }) => fetchApi(`/api/groups/${groupId}/quizzes`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => { notify.success('Saved'); refresh() }, onError: (e: Error) => notify.error(e.message),
  })
  if (gErr) return <p className="text-sm text-slate-500">You don&apos;t run quizzes.</p>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ListChecks className="h-7 w-7 text-sky-600" /> Quizzes</h1>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder="Choose a group" /></SelectTrigger>
          <SelectContent>{(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.label} · {g.course} {g.level}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {!groupId ? null : isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : !data.quizzes.length ? <p className="text-sm text-slate-500">This group&apos;s curriculum has no quizzes.</p> : data.quizzes.map((q) => (
        <Card key={q.blockId}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>S{q.sessionNumber} · {pick(q.titleEn, q.titleAr) || (q.kind === 'FINAL' ? 'End-of-level exam' : 'Quiz')} <span className={`ms-1 rounded-full border px-2 text-xs ${q.kind === 'FINAL' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>{q.kind === 'FINAL' ? 'final → MCQ' : 'session → task'}</span></span>
              <span className="flex flex-wrap gap-2">
                {q.needsOpen && (q.open
                  ? <Button size="sm" variant="outline" className="gap-1" onClick={() => win.mutate({ blockId: q.blockId, open: false })}><Lock className="h-4 w-4" /> Close</Button>
                  : <Button size="sm" className="gap-1" disabled={!q.lessonOpen} title={q.lessonOpen ? '' : 'The lesson is not open yet'} onClick={() => win.mutate({ blockId: q.blockId, open: true })}><LockOpen className="h-4 w-4" /> Open now</Button>)}
                {q.allowPaper && <Button size="sm" variant="outline" className="gap-1" onClick={() => setPaper(q)}><FileUp className="h-4 w-4" /> Paper exam</Button>}
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => setAnalysis(q.blockId)}><BarChart3 className="h-4 w-4" /> Analysis</Button>
              </span>
            </CardTitle>
            <p className="text-xs text-slate-500">{q.needsOpen ? (q.open ? 'Open — students can start' : 'Closed — open it in class') : 'Opens with its lesson'} · pass mark {q.passMark}%{q.toReview.length ? ` · ${q.toReview.length} to review` : ''}</p>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.students.map((s) => {
              const r = q.results.find((x) => x.studentId === s.id)
              return (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1">
                  <span>{s.name}</span>
                  <span className="flex items-center gap-2 text-xs">
                    {r?.inProgress && <span className="text-sky-700">in progress</span>}
                    {r?.paper && <span className="text-slate-500">paper</span>}
                    {r?.reviewId && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReview(r.reviewId)}>review code</Button>}
                    <span className={`font-semibold ${r?.result ? (r.result.percent >= q.passMark ? 'text-emerald-700' : 'text-amber-700') : 'text-slate-300'}`}>{r?.result ? `${r.result.score}/${r.result.max} (${r.result.percent}%)` : '—'}</span>
                    <span className="text-slate-400">{r?.tries ?? 0} tries</span>
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}
      <Dialog open={!!review} onOpenChange={(o) => { if (!o) setReview(null) }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Review</DialogTitle></DialogHeader>{review && <Review attemptId={review} onDone={() => { setReview(null); refresh() }} />}</DialogContent>
      </Dialog>
      <Dialog open={!!paper} onOpenChange={(o) => { if (!o) setPaper(null) }}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Paper exam result</DialogTitle></DialogHeader>{paper && data && <Paper groupId={groupId} quiz={paper} students={data.students} onDone={refresh} />}</DialogContent>
      </Dialog>
      <Dialog open={!!analysis} onOpenChange={(o) => { if (!o) setAnalysis(null) }}>
        <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Question analysis</DialogTitle></DialogHeader>{analysis && <Analysis groupId={groupId} blockId={analysis} />}</DialogContent>
      </Dialog>
    </div>
  )
}
