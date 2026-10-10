'use client'

/**
 * LMS L4: a student's quiz — start / continue, server timer (closing the page does not stop it), every question type,
 * automatic saving, hand in; results per try (correct answers when allowed). Parents: results only. Bilingual.
 * Kid mode: one question per screen with big buttons.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Markdown } from '@/components/curriculum/BlockView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CodeBlock } from './CodeBlock'
import { CodeEditor, useCodeRunner } from '@/components/assignments/CodeRunner'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Clock, FileText, ListChecks, Loader2, Play, Send, XCircle } from 'lucide-react'

type Ans = unknown
interface PQ {
  id: string; type: string; textEn: string; textAr: string; points: number; code?: string; language?: string; starter?: string
  options: { id: string; textEn: string; textAr: string; code?: string }[]; items: { id: string; textEn: string; textAr: string }[]
  left: { id: string; text: string }[]; right: { id: string; text: string }[]; blanks: number; lines: number
  tests: { id: string; input: string; expected: string; points: number }[]
}
interface Attempt {
  id: string; attemptNo: number; status: string; paper: boolean; deadlineAt: string | null; serverNow: string; score: number | null; maxScore: number | null
  feedback: string | null; questions: PQ[]; answers: Record<string, Ans>; detail: { id: string; correct: boolean; points: number; max: number }[] | null
  key: Record<string, string> | null; scanFiles: { name: string; url: string }[]
}
interface Data {
  blockId: string; groupId: string; titleEn: string | null; titleAr: string | null; asParent: boolean; kidMode?: boolean
  quiz: { kind: string; instructionsEn: string; instructionsAr: string; timeLimitMin: number; questionCount: number; attempts: number; passMark: number }
  used: number; allowed: number; canStart: { ok: boolean; message?: string; resume?: boolean }; needsOpen: boolean; open: boolean
  result: { score: number; max: number; percent: number } | null; attempts: Attempt[]; active: Attempt | null
}

function QuestionInput({ q, value, onChange, disabled }: { q: PQ; value: Ans; onChange: (v: Ans) => void; disabled?: boolean }) {
  const { t, pick } = useI18n()
  const runner = useCodeRunner((q.language as 'python' | 'javascript') ?? 'python')
  const [running, setRunning] = useState(false)
  const opt = (o: PQ['options'][number]) => pick(o.textEn, o.textAr)
  switch (q.type) {
    case 'SINGLE': case 'ERROR_MEANING':
      return <div className="space-y-1">{q.options.map((o) => <label key={o.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2"><input type="radio" disabled={disabled} checked={value === o.id} onChange={() => onChange(o.id)} /> {opt(o)}</label>)}</div>
    case 'PICTURE':
      return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{q.options.map((o) => <button key={o.id} type="button" disabled={disabled} onClick={() => onChange(o.id)} className={`rounded-2xl border-2 p-4 text-3xl ${value === o.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>{opt(o)}</button>)}</div>
    case 'CHOOSE_CODE':
      return <div className="space-y-2">{q.options.map((o, i) => <label key={o.id} className={`block rounded-lg border-2 p-1 ${value === o.id ? 'border-indigo-500' : 'border-transparent'}`}><span className="flex items-center gap-2 text-xs"><input type="radio" disabled={disabled} checked={value === o.id} onChange={() => onChange(o.id)} /> {String.fromCharCode(65 + i)}</span><CodeBlock code={o.code ?? opt(o)} language={q.language} /></label>)}</div>
    case 'MULTI': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return <div className="space-y-1">{q.options.map((o) => <label key={o.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2"><input type="checkbox" disabled={disabled} checked={arr.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...arr, o.id] : arr.filter((x) => x !== o.id))} /> {opt(o)}</label>)}</div>
    }
    case 'TRUE_FALSE':
      return <div className="flex gap-2">{(['true', 'false'] as const).map((v) => <Button key={v} type="button" variant={value === v ? 'default' : 'outline'} disabled={disabled} onClick={() => onChange(v)}>{t(v === 'true' ? 'hw.true' : 'hw.false')}</Button>)}</div>
    case 'NUMBER': case 'SHORT': case 'CODE_VALUE':
      return <Input className="max-w-xs" dir={q.type === 'CODE_VALUE' ? 'ltr' : undefined} inputMode={q.type === 'NUMBER' ? 'decimal' : 'text'} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'CODE_OUTPUT':
      return <textarea dir="ltr" className="h-24 w-full rounded-md border border-slate-200 bg-white p-2 font-mono text-xs" placeholder={t('qz.writeOutput')} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'FIND_BUG':
      return <div className="space-y-1"><p className="text-xs text-slate-500">{t('qz.clickLine')}</p><CodeBlock code={q.code ?? ''} language={q.language} selectedLine={(value as number) ?? null} onLine={disabled ? undefined : (n) => onChange(n)} /></div>
    case 'FILL_BLANK': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-2">
          <CodeBlock code={q.code ?? ''} language={q.language} />
          <div className="flex flex-wrap gap-2">{Array.from({ length: q.blanks }, (_, i) => <Input key={i} dir="ltr" className="h-9 w-40 font-mono" placeholder={t('qz.blank', { n: i + 1 })} disabled={disabled} value={arr[i] ?? ''} onChange={(e) => { const c = [...arr]; c[i] = e.target.value; onChange(c) }} />)}</div>
        </div>
      )
    }
    case 'ORDER': case 'PARSONS': {
      const order = Array.isArray(value) && (value as string[]).length === q.items.length ? (value as string[]) : q.items.map((i) => i.id)
      const move = (i: number, d: number) => { const c = [...order]; [c[i], c[i + d]] = [c[i + d], c[i]]; onChange(c) }
      return (
        <div className="space-y-1">
          <p className="text-xs text-slate-500">{t('qz.order')}</p>
          {order.map((id, i) => {
            const it = q.items.find((x) => x.id === id)!
            return (
              <div key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
                <span className="w-5 text-xs text-slate-400">{i + 1}</span>
                <span className={`flex-1 ${q.type === 'PARSONS' ? 'whitespace-pre font-mono text-xs' : ''}`} dir={q.type === 'PARSONS' ? 'ltr' : undefined}>{pick(it.textEn, it.textAr)}</span>
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Up"><ArrowUp className="h-4 w-4" /></Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label="Down"><ArrowDown className="h-4 w-4" /></Button>
              </div>
            )
          })}
        </div>
      )
    }
    case 'MATCH': case 'MATCH_CODE': {
      const m = (value as Record<string, string>) ?? {}
      return (
        <div className="space-y-2">
          {q.left.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2">
              {q.type === 'MATCH_CODE' ? <div className="min-w-[200px] flex-1"><CodeBlock code={l.text} language={q.language} /></div> : <span className="min-w-[140px] flex-1 rounded-lg border border-slate-200 p-2 text-sm">{l.text}</span>}
              <span>↔</span>
              <select className="h-9 min-w-[160px] flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm" disabled={disabled} value={m[l.id] ?? ''} onChange={(e) => onChange({ ...m, [l.id]: e.target.value })}>
                <option value="">{t('qz.choose')}</option>
                {q.right.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
              </select>
            </div>
          ))}
        </div>
      )
    }
    case 'WRITE_CODE': {
      const v = (value as { code?: string; results?: { id: string; passed: boolean }[] }) ?? {}
      const code = v.code ?? q.starter ?? ''
      return (
        <div className="space-y-2">
          <CodeEditor value={code} onChange={(c) => onChange({ code: c, results: [] })} disabled={disabled} language={q.language ?? 'python'} />
          {q.tests.length > 0 && !disabled && (
            <Button type="button" size="sm" variant="outline" className="gap-1" disabled={running} onClick={async () => { setRunning(true); const r = await runner.runTests(code, q.tests); onChange({ code, results: r.map((x) => ({ id: x.id, passed: x.passed })) }); setRunning(false) }}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {t('code.runTests')}
            </Button>
          )}
          {!!v.results?.length && <div className="space-y-1">{q.tests.map((tc, i) => { const r = v.results!.find((x) => x.id === tc.id); return <p key={tc.id} dir="ltr" className="flex items-center gap-1 text-xs">{r?.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />} Test {i + 1}: expected {tc.expected}</p> })}</div>}
        </div>
      )
    }
    default:
      return null
  }
}

function QuestionCard({ q, n, total, value, onChange, disabled, result, keyText }: { q: PQ; n: number; total: number; value: Ans; onChange: (v: Ans) => void; disabled?: boolean; result?: { correct: boolean; points: number; max: number } | null; keyText?: string | null }) {
  const { t, pick } = useI18n()
  const showCode = q.code && !['FIND_BUG', 'FILL_BLANK'].includes(q.type)
  return (
    <div className={`space-y-2 rounded-2xl border bg-white p-4 ${result ? (result.correct ? 'border-emerald-200' : 'border-rose-200') : 'border-slate-200'}`}>
      <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{t('qz.question', { n, total })}</span>
        <span>{result ? `${result.points} / ${result.max}` : `(${q.points})`} {result && (result.correct ? <CheckCircle2 className="inline h-4 w-4 text-emerald-600" /> : <XCircle className="inline h-4 w-4 text-rose-600" />)}</span>
      </p>
      <p className="font-medium text-slate-800">{pick(q.textEn, q.textAr)}</p>
      {showCode && <CodeBlock code={q.code!} language={q.language} />}
      <QuestionInput q={q} value={value} onChange={onChange} disabled={disabled} />
      {keyText && !result?.correct && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800"><b>{t('qz.correctAnswer')}:</b> {keyText}</p>}
    </div>
  )
}

export function QuizPlayer({ groupId, blockId, studentId }: { groupId: string; blockId: string; studentId?: string | null }) {
  const { t, pick, dir } = useI18n()
  const qc = useQueryClient()
  const key = ['quiz', groupId, blockId, studentId ?? '']
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<Data>(`/api/quizzes/item?g=${groupId}&b=${blockId}${studentId ? `&s=${studentId}` : ''}`) })
  const [answers, setAnswers] = useState<Record<string, Ans>>({})
  const [left, setLeft] = useState<number | null>(null)
  const [step, setStep] = useState(0)
  const [openTry, setOpenTry] = useState<string | null>(null)
  const dirty = useRef(false)
  const active = data?.active ?? null
  const offset = useMemo(() => (active ? new Date(active.serverNow).getTime() - Date.now() : 0), [active])

  useEffect(() => { if (active) { setAnswers((active.answers as Record<string, Ans>) ?? {}); dirty.current = false; setStep(0) } }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: () => fetchApi('/api/quizzes/item', { method: 'POST', body: JSON.stringify({ groupId, blockId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => notify.error(e.message),
  })
  const fillOrders = (a: Record<string, Ans>) => {
    const out = { ...a }
    for (const q of active?.questions ?? []) if ((q.type === 'ORDER' || q.type === 'PARSONS') && !Array.isArray(out[q.id])) out[q.id] = q.items.map((i) => i.id)
    return out
  }
  const save = useMutation({
    mutationFn: (submit: boolean) => fetchApi<{ status: string; score: number | null }>(`/api/quizzes/attempts/${active!.id}`, { method: 'PUT', body: JSON.stringify({ answers: submit ? fillOrders(answers) : answers, submit }) }),
    onSuccess: (_r, submit) => { dirty.current = false; if (submit) { notify.success(t('hw.handedIn')); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['my-quizzes'] }); qc.invalidateQueries({ queryKey: ['lesson'] }) } },
    onError: (e: Error) => { notify.error(e.message); qc.invalidateQueries({ queryKey: key }) },
  })

  // autosave 2 s after a change
  useEffect(() => {
    if (!active || !dirty.current) return
    const tm = setTimeout(() => { if (dirty.current && !save.isPending) save.mutate(false) }, 2000)
    return () => clearTimeout(tm)
  }, [answers]) // eslint-disable-line react-hooks/exhaustive-deps

  // server-based countdown; hand in automatically at 0
  useEffect(() => {
    if (!active?.deadlineAt) { setLeft(null); return }
    const tick = () => {
      const ms = new Date(active.deadlineAt!).getTime() - (Date.now() + offset)
      setLeft(Math.max(0, Math.floor(ms / 1000)))
      if (ms <= 0 && !save.isPending) { clearInterval(iv); save.mutate(true) }
    }
    const iv = setInterval(tick, 1000)
    tick()
    return () => clearInterval(iv)
  }, [active?.id, active?.deadlineAt, offset]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <p className="text-sm text-slate-500">{(error as Error)?.message}</p>
  const z = data.quiz
  const kid = !!data.kidMode
  const setA = (id: string) => (v: Ans) => { dirty.current = true; setAnswers((p) => ({ ...p, [id]: v })) }
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  if (active && !data.asParent) {
    const qs = active.questions
    const shown = kid ? qs.slice(step, step + 1) : qs
    return (
      <div className={`space-y-3 ${kid ? 'text-lg' : ''}`} dir={dir} onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()}>
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur">
          <p className="font-semibold text-slate-800">{pick(data.titleEn, data.titleAr) || t(z.kind === 'FINAL' ? 'qz.final' : 'qz.quiz')} · {t('qz.attempt', { n: active.attemptNo })}</p>
          <span className="flex items-center gap-3 text-sm">
            {left !== null && <span className={`flex items-center gap-1 font-mono font-bold ${left < 60 ? 'text-rose-600' : 'text-slate-700'}`}><Clock className="h-4 w-4" /> {mmss(left)}</span>}
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Button size="sm" className="gap-1" disabled={save.isPending} onClick={() => { if (confirm(t('qz.confirmSubmit'))) save.mutate(true) }}><Send className="h-4 w-4" /> {t('qz.submit')}</Button>
          </span>
        </div>
        {shown.map((q) => <QuestionCard key={q.id} q={q} n={qs.indexOf(q) + 1} total={qs.length} value={answers[q.id]} onChange={setA(q.id)} />)}
        {kid && qs.length > 1 && (
          <div className="flex items-center justify-between">
            <Button size="lg" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)} className="gap-1"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /> {t('les.kidPrev')}</Button>
            <span className="text-sm text-slate-500">{step + 1} / {qs.length}</span>
            <Button size="lg" disabled={step >= qs.length - 1} onClick={() => setStep(step + 1)} className="gap-1">{t('les.kidNext')} <ArrowRight className="h-5 w-5 rtl:rotate-180" /></Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" dir={dir}>
      <div className="space-y-2 rounded-2xl border border-sky-100 bg-white p-4">
        <p className="flex items-center gap-2 text-lg font-bold text-slate-800"><ListChecks className="h-5 w-5 text-sky-600" /> {pick(data.titleEn, data.titleAr) || t(z.kind === 'FINAL' ? 'qz.final' : 'qz.quiz')}</p>
        <p className="text-xs text-slate-500">{z.kind === 'FINAL' ? t('qz.final') : t('qz.quiz')} · {z.questionCount} · {z.timeLimitMin ? t('qz.minutes', { n: z.timeLimitMin }) : t('qz.noLimit')} · {t('qz.tries', { used: data.used, allowed: data.allowed })}</p>
        {(z.instructionsEn || z.instructionsAr) && <Markdown text={pick(z.instructionsEn, z.instructionsAr)} />}
        {data.result && (
          <p className={`rounded-lg p-2 text-sm font-semibold ${data.result.percent >= z.passMark ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {t('qz.counts', { score: data.result.score, max: data.result.max, pct: data.result.percent })} · {data.result.percent >= z.passMark ? t('qz.passed') : t('qz.failed')}
          </p>
        )}
        {!data.asParent && (data.canStart.ok
          ? <Button className="gap-1" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {data.canStart.resume ? t('qz.resume') : t('qz.start')}</Button>
          : <p className="text-sm text-slate-500">{data.needsOpen && !data.open ? t('qz.notOpen') : data.canStart.message}</p>)}
      </div>
      {data.attempts.map((a) => (
        <div key={a.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-sm" onClick={() => setOpenTry(openTry === a.id ? null : a.id)}>
            <span className="font-semibold">{a.paper ? t('qz.paper') : t('qz.attempt', { n: a.attemptNo })}</span>
            <span>{a.status === 'SUBMITTED' ? t('qz.waiting') : `${a.score} / ${a.maxScore}`}</span>
          </button>
          {a.feedback && <p className="text-xs text-slate-600">💬 {a.feedback}</p>}
          {a.scanFiles.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 underline"><FileText className="h-3 w-3" /> {f.name}</a>)}
          {openTry === a.id && a.questions.map((q, i) => (
            <QuestionCard key={q.id} q={q} n={i + 1} total={a.questions.length} value={a.answers[q.id]} onChange={() => undefined} disabled result={a.detail?.find((d) => d.id === q.id) ?? null} keyText={a.key?.[q.id] ?? null} />
          ))}
        </div>
      ))}
    </div>
  )
}
