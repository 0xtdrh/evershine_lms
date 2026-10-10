'use client'

/**
 * LMS L2: one open lesson for a student. Student view only, the student's name as a watermark, no right-click /
 * copy / print, a tick per item. Kid mode (young students): one item per screen, big buttons, read-aloud for text.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { BlockView, Markdown, type Block } from '@/components/curriculum/BlockView'
import { AssignmentWork } from '@/components/assignments/AssignmentWork'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight, Check, Loader2, MessageSquareText, PartyPopper, Volume2 } from 'lucide-react'

interface Lesson {
  group: { id: string; label: string; courseName: string; levelName: string }
  session: { id: string; number: number; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null; materialsEn: string | null; materialsAr: string | null; durationMin: number | null }
  blocks: Block[]; done: string[]; notes: { id: string; body: string; url: string | null }[]
  prevId: string | null; nextId: string | null; watermark: string | null; kidMode: boolean
}

const stop = (e: React.SyntheticEvent) => e.preventDefault()

function speak(text: string, lang: string) {
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>[\]()-]/g, ' '))
    u.lang = lang === 'ar' ? 'ar-EG' : 'en-US'
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  } catch { /* not supported */ }
}

export default function LessonPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const groupId = useSearchParams().get('g') ?? ''
  const { t, pick, dir, locale } = useI18n()
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const key = ['lesson', sessionId, groupId]
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<Lesson>(`/api/lessons/${sessionId}?g=${groupId}`), enabled: !!groupId })
  useEffect(() => { setStep(0) }, [sessionId])
  useEffect(() => () => { try { window.speechSynthesis.cancel() } catch { /* ignore */ } }, [])
  useEffect(() => {
    // save / print / copy shortcuts are switched off on lesson pages (content protection)
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'u'].includes(e.key.toLowerCase())) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tick = useMutation({
    mutationFn: (b: { blockId: string; done: boolean }) => fetchApi('/api/lessons/progress', { method: 'POST', body: JSON.stringify({ groupId, ...b }) }),
    onMutate: (b) => qc.setQueryData<Lesson>(key, (old) => old && { ...old, done: b.done ? [...old.done, b.blockId] : old.done.filter((x) => x !== b.blockId) }),
    onError: (e: Error) => { notify.error(e.message); qc.invalidateQueries({ queryKey: key }) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['my-lessons'] }),
  })

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <div className="space-y-3"><p className="text-sm text-slate-500">{(error as Error)?.message ?? t('common.error')}</p><Link href="/dashboard/my-lessons" className="text-sm text-indigo-600">{t('les.back')}</Link></div>

  const s = data.session
  const kid = data.kidMode
  const allDone = data.blocks.length > 0 && data.blocks.every((b) => data.done.includes(b.id))
  const shown = kid ? data.blocks.slice(step, step + 1) : data.blocks
  const textOf = (b: Block) => pick(b.data.textEn as string, b.data.textAr as string)

  return (
    <div
      className={`select-none space-y-5 print:hidden ${kid ? 'text-lg' : ''}`}
      dir={dir}
      onContextMenu={stop} onCopy={stop} onCut={stop} onDragStart={stop}
    >
      <div className="space-y-1">
        <Link href="/dashboard/my-lessons" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {t('les.back')}</Link>
        <h1 className={`font-bold text-slate-900 ${kid ? 'text-3xl' : 'text-2xl'}`}>{pick(s.titleEn, s.titleAr) || t('cur.session', { n: s.number })}</h1>
        <p className="text-sm text-slate-500">{data.group.courseName} — {data.group.levelName} · {t('cur.session', { n: s.number })}{s.durationMin ? ` · ${s.durationMin} min` : ''}</p>
      </div>

      {!kid && (pick(s.objectivesEn, s.objectivesAr) || pick(s.materialsEn, s.materialsAr)) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pick(s.objectivesEn, s.objectivesAr) && <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3"><p className="text-xs font-semibold uppercase text-indigo-700">{t('cur.objectives')}</p><Markdown text={pick(s.objectivesEn, s.objectivesAr)} /></div>}
          {pick(s.materialsEn, s.materialsAr) && <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-semibold uppercase text-slate-500">{t('cur.materials')}</p><Markdown text={pick(s.materialsEn, s.materialsAr)} /></div>}
        </div>
      )}

      {data.notes.map((n) => (
        <div key={n.id} className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="text-xs font-semibold">{t('les.groupNote')}</p><p className="whitespace-pre-wrap">{n.body}</p>{n.url && <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">{n.url}</a>}</div>
        </div>
      ))}

      <div className="space-y-3">
        {shown.map((b) => {
          const isDone = data.done.includes(b.id)
          // L3: homework is handed in (that marks it done), not ticked
          if (b.type === 'ASSIGNMENT') return <AssignmentWork key={b.id} groupId={groupId} blockId={b.id} />
          // L4: a quiz opens on its own page (timer, one try at a time)
          if (b.type === 'QUIZ') return (
            <div key={b.id} className="space-y-2 rounded-2xl border border-sky-100 bg-white p-4">
              <BlockView block={b} />
              <Button asChild size={kid ? 'lg' : 'sm'}><Link href={`/dashboard/my-quizzes/${b.id}?g=${groupId}`}>{t('qz.start')}</Link></Button>
            </div>
          )
          return (
            <div key={b.id} className={`rounded-2xl border bg-white ${kid ? 'p-6' : 'p-4'} ${isDone ? 'border-emerald-200' : 'border-slate-200'}`}>
              <BlockView block={b} watermark={data.watermark} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                {b.type === 'TEXT' && textOf(b) ? (
                  <Button variant="outline" size={kid ? 'lg' : 'sm'} className="gap-1" onClick={() => speak(textOf(b), locale)}><Volume2 className="h-4 w-4" /> {t('les.listen')}</Button>
                ) : <span />}
                <Button size={kid ? 'lg' : 'sm'} variant={isDone ? 'outline' : 'default'} className={`gap-1 ${isDone ? 'border-emerald-300 text-emerald-700' : ''}`} onClick={() => tick.mutate({ blockId: b.id, done: !isDone })}>
                  <Check className="h-4 w-4" /> {isDone ? t('les.done') : t('les.markDone')}
                </Button>
              </div>
            </div>
          )
        })}
        {!data.blocks.length && <p className="text-sm text-slate-500">{t('common.none')}</p>}
      </div>

      {kid && data.blocks.length > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Button size="lg" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)} className="gap-1"><ArrowLeft className="h-5 w-5 rtl:rotate-180" /> {t('les.kidPrev')}</Button>
          <span className="text-sm text-slate-500">{step + 1} / {data.blocks.length}</span>
          <Button size="lg" disabled={step >= data.blocks.length - 1} onClick={() => setStep(step + 1)} className="gap-1">{t('les.kidNext')} <ArrowRight className="h-5 w-5 rtl:rotate-180" /></Button>
        </div>
      )}

      {allDone && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-700"><PartyPopper className="h-5 w-5" /> {t('les.allDone')}</p>}

      <div className="flex flex-wrap justify-between gap-2">
        {data.prevId ? <Button variant="outline" asChild><Link href={`/dashboard/my-lessons/${data.prevId}?g=${groupId}`}><ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />{t('les.prev')}</Link></Button> : <span />}
        {data.nextId && <Button variant="outline" asChild><Link href={`/dashboard/my-lessons/${data.nextId}?g=${groupId}`}>{t('les.next')}<ArrowRight className="ms-1 h-4 w-4 rtl:rotate-180" /></Link></Button>}
      </div>
    </div>
  )
}
