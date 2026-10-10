'use client'

/**
 * LMS L3: a student's homework — instructions, how it is graded, questions, written answer, links, files / photos,
 * automatic draft saving, hand in / hand in again, grade + feedback. Also used by a parent (read-only, or handing in
 * for a young child when allowed). Bilingual.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Markdown } from '@/components/curriculum/BlockView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CodeWork, useCodeRunner, type TestCase, type TestResult } from './CodeRunner'
import { TOOL_RULES, type ToolCheck } from '@/lib/assignments/tool-checks'
import { Camera, CheckCircle2, ClipboardList, FileText, Link2, Loader2, Paperclip, Send, Trash2, XCircle } from 'lucide-react'

type Ans = string | string[] | number | null
interface QView { id: string; type: string; textEn: string; textAr: string; options: { id: string; textEn: string; textAr: string }[]; points: number }
interface Crit { id: string; titleEn: string; titleAr: string; levels: { labelEn: string; labelAr: string; points: number; descEn: string; descAr: string }[] }
interface FileRef { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string; bytes?: number; originalName?: string; url?: string }
interface Data {
  blockId: string; groupId: string; titleEn: string | null; titleAr: string | null; asParent: boolean; parentMaySubmit: boolean
  assignment: { instructionsEn: string; instructionsAr: string; kinds: string[]; questions: QView[]; scale: string; maxPoints: number; rubric: { criteria: Crit[]; kidStars: boolean } | null; gradingMode: string; finalProject: boolean; maxScore: number
    code: { language: 'python' | 'javascript' | 'arduino'; starter: string; tests: TestCase[] } | null; toolCheck: ToolCheck | null; autoCheck: boolean }
  submission: null | { status: string; attempt: number; code: string | null; codeResults: TestResult[] | null; toolResult: { ok: boolean; error?: string; detail: { id: string; kind: string; ok: boolean }[] } | null; feedbackAudio: string | null; galleryStatus: string | null; text: string | null; links: string[] | null; files: FileRef[]; answers: Record<string, Ans> | null; score: number | null; maxScore: number | null; feedback: string | null; late: boolean; rubricScores: Record<string, number> | null; autoDetail: { id: string; correct: boolean }[] | { items?: { id: string; correct: boolean }[] } | null }
  dueAt: string | null; policy: { maxAttempts: number; resubmit: boolean }; canSubmit: { ok: boolean; late: boolean; message?: string }
  answerKey: Record<string, { correct: (string | number)[]; tolerance: number | null }> | null
  gradesHiddenUntil: string | null; answersAt: string | null
}

const STATUS_STYLE: Record<string, string> = {
  TODO: 'border-slate-200 bg-slate-50 text-slate-600', DRAFT: 'border-sky-200 bg-sky-50 text-sky-700', SUBMITTED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  RETURNED: 'border-amber-200 bg-amber-50 text-amber-800', GRADED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

async function uploadFile(file: File, studentId: string | null): Promise<FileRef> {
  if (file.size > 100 * 1024 * 1024) throw new Error('Max 100 MB')
  const s = await fetchApi<{ timestamp: number; signature: string; cloudName: string; apiKey: string; folder: string; allowedFormats: string; type: string }>('/api/assignments/sign', { method: 'POST', body: JSON.stringify(studentId ? { studentId } : {}) })
  const fd = new FormData()
  for (const [k, v] of Object.entries({ file, api_key: s.apiKey, timestamp: String(s.timestamp), signature: s.signature, folder: s.folder, allowed_formats: s.allowedFormats, type: s.type })) fd.append(k, v as Blob | string)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/auto/upload`, { method: 'POST', body: fd })
  const j = await res.json()
  if (!res.ok) throw new Error(j?.error?.message || 'Upload failed')
  return { publicId: j.public_id, resourceType: j.resource_type, format: j.format, bytes: j.bytes, originalName: file.name.slice(0, 200) }
}

export function AssignmentWork({ groupId, blockId, studentId, compact = false }: { groupId: string; blockId: string; studentId?: string | null; compact?: boolean }) {
  const { t, pick, locale } = useI18n()
  const qc = useQueryClient()
  const key = ['assignment', groupId, blockId, studentId ?? '']
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<Data>(`/api/assignments/item?g=${groupId}&b=${blockId}${studentId ? `&s=${studentId}` : ''}`) })
  const [text, setText] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [files, setFiles] = useState<FileRef[]>([])
  const [answers, setAnswers] = useState<Record<string, Ans>>({})
  const [code, setCode] = useState('')
  const [results, setResults] = useState<TestResult[] | null>(null)
  const runner = useCodeRunner(data?.assignment.code?.language ?? 'python')
  const [again, setAgain] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const dirty = useRef(false)

  useEffect(() => {
    if (!data) return
    const s = data.submission
    setText(s?.text ?? ''); setLinks(s?.links ?? []); setFiles(s?.files ?? []); setAnswers(s?.answers ?? {}); setCode(s?.code ?? data.assignment.code?.starter ?? ''); setResults(s?.codeResults ?? null); dirty.current = false
  }, [data])

  const status = data?.submission?.status ?? 'TODO'
  const mayAct = !!data && (!data.asParent || data.parentMaySubmit)
  const editable = mayAct && (status === 'TODO' || status === 'DRAFT' || status === 'RETURNED' || again) && (data?.canSubmit.ok || status === 'DRAFT' || status === 'TODO')
  const body = (submit: boolean, codeResults?: TestResult[] | null) => JSON.stringify({ groupId, blockId, studentId: studentId ?? null, text: text || null, links: links.filter(Boolean), files: files.map(({ url: _u, ...f }) => f), answers, code: data?.assignment.kinds.includes('CODE') ? code : undefined, codeResults: codeResults ?? undefined, submit })

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      // the author's code tests run in this browser right before handing in
      let res = results
      const c = data?.assignment.code
      if (submit && c && c.language !== 'arduino' && c.tests.length) { res = await runner.runTests(code, c.tests); setResults(res) }
      return fetchApi<{ status: string; score: number | null }>('/api/assignments/item', { method: 'PUT', body: body(submit, res) })
    },
    onSuccess: (r, submit) => {
      dirty.current = false
      if (submit) { notify.success(t('hw.handedIn')); setAgain(false); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['my-assignments'] }); qc.invalidateQueries({ queryKey: ['my-lessons'] }); qc.invalidateQueries({ queryKey: ['lesson'] }) }
      else setSavedAt(Date.now())
    },
    onError: (e: Error) => notify.error(e.message),
  })

  // automatic draft saving (3 s after the last change) — not over a hand-in that is waiting to be graded
  useEffect(() => {
    if (!editable || status === 'SUBMITTED' || status === 'GRADED' || !dirty.current) return
    const tm = setTimeout(() => { if (dirty.current && !save.isPending) save.mutate(false) }, 3000)
    return () => clearTimeout(tm)
  }, [text, links, files, answers, code]) // eslint-disable-line react-hooks/exhaustive-deps
  const touch = <T,>(fn: (v: T) => void) => (v: T) => { dirty.current = true; fn(v) }

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <p className="text-sm text-slate-500">{(error as Error)?.message}</p>
  const a = data.assignment
  const sub = data.submission
  const kinds = a.kinds
  const fileKinds = kinds.filter((k) => k === 'FILE' || k === 'PHOTO' || k === 'VIDEO')
  const accept = [kinds.includes('PHOTO') && 'image/*', kinds.includes('VIDEO') && 'video/*', kinds.includes('FILE') && '.pdf,.docx,.pptx,.xlsx,.txt,.zip,.sb3,.aia,.ino,.py,.stl,.mp3,.m4a,image/*'].filter(Boolean).join(',')
  const detail = Array.isArray(sub?.autoDetail) ? sub!.autoDetail : (sub?.autoDetail as { items?: { id: string; correct: boolean }[] } | null)?.items ?? []
  const okOf = (qid: string) => detail.find((d) => d.id === qid)?.correct
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const keyText = (q: QView) => {
    const k = data.answerKey?.[q.id]
    if (!k) return null
    if (q.type === 'SINGLE' || q.type === 'MULTI') return k.correct.map((id) => { const o = q.options.find((x) => x.id === id); return o ? pick(o.textEn, o.textAr) : String(id) }).join(' / ')
    if (q.type === 'TRUE_FALSE') return t(String(k.correct[0]) === 'true' ? 'hw.true' : 'hw.false')
    return k.correct.join(' / ') + (k.tolerance ? ` (±${k.tolerance})` : '')
  }

  const pickFiles = (capture?: boolean) => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.accept = capture ? 'image/*' : accept
    if (capture) input.setAttribute('capture', 'environment')
    input.onchange = async () => {
      const list = Array.from(input.files ?? []).slice(0, 10 - files.length)
      if (!list.length) return
      setUploading(true)
      try { const up: FileRef[] = []; for (const f of list) up.push(await uploadFile(f, studentId ?? null)); dirty.current = true; setFiles((x) => [...x, ...up]) } catch (e) { notify.error((e as Error).message) } finally { setUploading(false) }
    }
    input.click()
  }

  return (
    <div className={`space-y-3 ${compact ? '' : 'rounded-2xl border border-violet-100 bg-white p-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 font-semibold text-slate-800"><ClipboardList className="h-4 w-4 text-violet-600" /> {pick(data.titleEn, data.titleAr) || t('hw.homework')}{a.finalProject ? ` · ${t('hw.finalProject')}` : ''}</p>
        <span className="flex flex-wrap items-center gap-1 text-xs">
          <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE[status]}`}>{t(`hw.status.${status}` as 'hw.status.TODO')}</span>
          {sub?.late && <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">{t('hw.late')}</span>}
          {data.dueAt && <span className="text-slate-500">{t('hw.due', { date: new Date(data.dueAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })}</span>}
        </span>
      </div>

      {(a.instructionsEn || a.instructionsAr) && <Markdown text={pick(a.instructionsEn, a.instructionsAr)} />}

      {status === 'GRADED' && sub && sub.score === null && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">{data.gradesHiddenUntil ? t('hw.resultsOn', { date: fmt(data.gradesHiddenUntil) }) : t('hw.resultsLater')}</div>
      )}
      {data.answersAt && status !== 'TODO' && status !== 'DRAFT' && <p className="text-xs text-slate-500">{t('hw.answersOn', { date: fmt(data.answersAt) })}</p>}
      {status === 'GRADED' && sub && sub.score !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-bold text-emerald-800">{t('hw.score')}: {a.scale === 'STARS' && !a.questions.length ? '⭐'.repeat(Math.round(sub.score ?? 0)) || '—' : `${sub.score} / ${sub.maxScore}`}</p>
          {sub.feedback && <p className="mt-1 whitespace-pre-wrap text-emerald-900"><span className="font-semibold">{t('hw.feedback')}:</span> {sub.feedback}</p>}
        </div>
      )}
      {status === 'RETURNED' && sub?.feedback && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">{t('hw.feedback')}:</span> {sub.feedback}</div>}

      {a.rubric && (
        <details className="rounded-lg border border-slate-200 p-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-600">{t('hw.rubric')}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <tbody>
                {a.rubric.criteria.map((c) => (
                  <tr key={c.id}>
                    <td className="border border-slate-200 p-1 font-semibold">{pick(c.titleEn, c.titleAr)}</td>
                    {c.levels.map((l, i) => (
                      <td key={i} className={`border border-slate-200 p-1 ${sub?.rubricScores?.[c.id] === i && status === 'GRADED' ? 'bg-emerald-100 font-semibold' : ''}`}>
                        {a.rubric!.kidStars ? '⭐'.repeat(Math.max(1, c.levels.length - i)) : `${pick(l.labelEn, l.labelAr)} (${l.points})`}
                        {pick(l.descEn, l.descAr) && <span className="block text-slate-500">{pick(l.descEn, l.descAr)}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {a.questions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase text-slate-500">{t('hw.questions')}</p>
          {a.questions.map((q, i) => {
            const v = answers[q.id]
            const setA = touch((x: Ans) => setAnswers((p) => ({ ...p, [q.id]: x })))
            const ok = status === 'GRADED' ? okOf(q.id) : undefined
            return (
              <div key={q.id} className="space-y-1 rounded-lg border border-slate-100 p-2 text-sm">
                <p className="font-medium text-slate-800">{i + 1}. {pick(q.textEn, q.textAr)} <span className="text-xs font-normal text-slate-400">({q.points})</span>
                  {ok === true && <CheckCircle2 className="ms-1 inline h-4 w-4 text-emerald-600" />}{ok === false && <XCircle className="ms-1 inline h-4 w-4 text-rose-600" />}</p>
                {(q.type === 'SINGLE' || q.type === 'MULTI') && q.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <input type={q.type === 'SINGLE' ? 'radio' : 'checkbox'} name={`a-${q.id}`} disabled={!editable}
                      checked={q.type === 'SINGLE' ? v === o.id : Array.isArray(v) && v.includes(o.id)}
                      onChange={(e) => setA(q.type === 'SINGLE' ? o.id : e.target.checked ? [...(Array.isArray(v) ? v : []), o.id] : (Array.isArray(v) ? v : []).filter((x) => x !== o.id))} />
                    {pick(o.textEn, o.textAr)}
                  </label>
                ))}
                {q.type === 'TRUE_FALSE' && (['true', 'false'] as const).map((tf) => (
                  <label key={tf} className="me-4 inline-flex items-center gap-1"><input type="radio" name={`a-${q.id}`} disabled={!editable} checked={v === tf} onChange={() => setA(tf)} /> {t(tf === 'true' ? 'hw.true' : 'hw.false')}</label>
                ))}
                {keyText(q) && ok !== true && <p className="text-xs text-emerald-700">{t('hw.correctIs', { a: keyText(q)! })}</p>}
                {(q.type === 'NUMBER' || q.type === 'SHORT') && <Input className="h-9 max-w-xs" inputMode={q.type === 'NUMBER' ? 'decimal' : 'text'} disabled={!editable} value={(v as string | number | null) ?? ''} onChange={(e) => setA(e.target.value)} />}
              </div>
            )
          })}
        </div>
      )}

      {kinds.includes('CODE') && a.code && (
        <CodeWork language={a.code.language} code={code} onCode={(v) => { dirty.current = true; setCode(v) }} tests={a.code.tests} toolCheck={a.toolCheck} disabled={!editable} results={results} onResults={setResults} />
      )}
      {a.autoCheck && a.toolCheck && a.toolCheck.tool !== 'ARDUINO' && (
        <div className="rounded-lg border border-slate-200 p-2 text-xs">
          <p className="font-semibold text-slate-600">{t('hw.toolChecks')}</p>
          {a.toolCheck.rules.map((r) => {
            const res = sub?.toolResult?.detail.find((d) => d.id === r.id)
            const def = TOOL_RULES[a.toolCheck!.tool].find((x) => x.kind === r.kind)
            return <p key={r.id} className="flex items-center gap-1">{res ? (res.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />) : '•'} {def ? pick(def.labelEn, def.labelAr).replace('N', String(r.value ?? '')) : r.kind}{def?.param === 'text' ? `: ${r.value}` : ''} ({r.points})</p>
          })}
          {sub?.toolResult?.error && <p className="text-amber-700">{sub.toolResult.error}</p>}
        </div>
      )}
      {sub?.feedbackAudio && <div className="space-y-1"><p className="text-xs font-semibold text-slate-600">{t('hw.voiceFeedback')}</p><audio controls src={sub.feedbackAudio} className="w-full max-w-md" /></div>}
      {sub?.galleryStatus === 'APPROVED' && <p className="text-xs font-semibold text-amber-600">{t('hw.inGallery')}</p>}

      {kinds.includes('TEXT') && <textarea className="min-h-[120px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm" placeholder={t('hw.write')} disabled={!editable} value={text} onChange={(e) => touch(setText)(e.target.value)} />}

      {kinds.includes('LINK') && (
        <div className="space-y-1">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-400" />
              {editable ? <Input className="h-9" dir="ltr" placeholder="https://scratch.mit.edu/projects/…" value={l} onChange={(e) => touch(setLinks)(links.map((x, j) => (j === i ? e.target.value : x)))} />
                : <a href={l} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-indigo-600 underline">{l}</a>}
              {editable && <button type="button" aria-label="Remove" onClick={() => touch(setLinks)(links.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-slate-400" /></button>}
            </div>
          ))}
          {editable && links.length < 5 && <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setLinks([...links, ''])}><Link2 className="h-4 w-4" /> {t('hw.addLink')}</Button>}
        </div>
      )}

      {fileKinds.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={f.publicId} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                <FileText className="h-3 w-3" />
                {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="max-w-[160px] truncate text-indigo-600 underline">{f.originalName ?? `file ${i + 1}`}</a> : <span className="max-w-[160px] truncate">{f.originalName ?? `file ${i + 1}`}</span>}
                {editable && <button type="button" aria-label="Remove" onClick={() => { dirty.current = true; setFiles(files.filter((_, j) => j !== i)) }}><Trash2 className="h-3 w-3 text-slate-400" /></button>}
              </span>
            ))}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {kinds.includes('PHOTO') && <Button type="button" size="sm" variant="outline" className="gap-1" disabled={uploading} onClick={() => pickFiles(true)}><Camera className="h-4 w-4" /> {t('hw.takePhoto')}</Button>}
              <Button type="button" size="sm" variant="outline" className="gap-1" disabled={uploading} onClick={() => pickFiles(false)}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} {uploading ? t('hw.uploading') : t('hw.upload')}</Button>
            </div>
          )}
        </div>
      )}

      {kinds.length === 1 && kinds[0] === 'IN_CLASS' && !a.questions.length && <p className="text-sm text-slate-500">{t('hw.inClass')}</p>}
      {data.asParent && data.parentMaySubmit && editable && <p className="text-xs text-violet-700">{t('hw.parentHandIn')}</p>}
      {!data.canSubmit.ok && data.canSubmit.message && status !== 'GRADED' && <p className="text-xs text-rose-600">{data.canSubmit.message}</p>}

      {mayAct && !(kinds.length === 1 && kinds[0] === 'IN_CLASS' && !a.questions.length) && (
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <Button className="gap-1" disabled={save.isPending || uploading} onClick={() => save.mutate(true)}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {status === 'RETURNED' || again ? t('hw.resubmit') : t('hw.submit')}</Button>
              {savedAt && <span className="text-xs text-slate-400">{t('hw.autosaved')}</span>}
            </>
          ) : (status === 'SUBMITTED' || status === 'GRADED') && data.canSubmit.ok && data.policy.resubmit ? (
            <Button variant="outline" onClick={() => setAgain(true)}>{t('hw.resubmit')}</Button>
          ) : null}
          {sub && sub.attempt > 0 && <span className="text-xs text-slate-400">{t('hw.attempts', { n: sub.attempt, max: data.policy.maxAttempts })}</span>}
        </div>
      )}
    </div>
  )
}
