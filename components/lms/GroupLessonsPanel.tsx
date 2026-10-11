'use client'

/**
 * LMS L2: the group's lessons inside the attendance screen — today's plan, open / lock each lesson, how lessons open,
 * group-only notes. Only the instructor, a confirmed substitute and managers get it; for anyone else (e.g. a
 * secretary) the API answers 403 and nothing is shown (owner 2026-10-09: secretaries see attendance only).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Markdown } from '@/components/curriculum/BlockView'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, Lock, LockOpen, Trash2 } from 'lucide-react'

interface Sess {
  id: string; number: number; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null
  open: boolean; current: boolean; inThisGroup: boolean; override: 'OPEN' | 'LOCKED' | null; scheduledAt: string | null; reason?: string
}
interface Data {
  edition: { id: string; number: number } | null; newerEdition?: { id: string; number: number } | null; mode: string; defaultMode: string; modeSource: 'GROUP' | 'LEVEL' | 'COMPANY'
  range: { from: number; to: number }; heldCount: number; sessions: Sess[]
  notes: { id: string; sessionNumber: number; body: string; url: string | null }[]
  portalOn: boolean; canChangeMode: boolean; modes: string[]
}

export const MODE_LABELS: Record<string, string> = {
  ALL: 'All lessons open at once', SCHEDULE: 'At the session time', ATTENDANCE: 'When attendance is recorded',
  MANUAL: 'The instructor opens each lesson', PREVIOUS: 'After the student finishes the previous lesson',
}
const MODE_AR: Record<string, string> = {
  ALL: 'كل الدروس مفتوحة مرة واحدة', SCHEDULE: 'في معاد الحصة', ATTENDANCE: 'أول ما الحضور يتسجل',
  MANUAL: 'المدرب يفتح كل درس', PREVIOUS: 'بعد ما الطالب يخلّص الدرس اللي قبله',
}
/** Way of opening lessons, in the page language. */
export const modeLabel = (m: string) => L(MODE_LABELS[m] ?? m, MODE_AR[m] ?? MODE_LABELS[m] ?? m)

export function GroupLessonsPanel({ groupId }: { groupId: string }) {
  const { pick } = useI18n()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const key = ['group-lessons', groupId]
  const { data, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<Data>(`/api/groups/${groupId}/lessons`), enabled: !!groupId, retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const act = useMutation({
    mutationFn: (b: object) => fetchApi(`/api/groups/${groupId}/lessons`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  const addNote = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/lessons/notes`, { method: 'POST', body: JSON.stringify({ sessionNumber: noteFor, body: note, url: url || null }) }),
    onSuccess: () => { setNote(''); setUrl(''); setNoteFor(null); notify.success(L('Note added', 'الملاحظة اتضافت')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const delNote = useMutation({ mutationFn: (id: string) => fetchApi(`/api/groups/${groupId}/lessons/notes?noteId=${id}`, { method: 'DELETE' }), onSuccess: refresh })

  if (error || !data) return null // not allowed (e.g. secretary) or still loading
  if (!data.edition) {
    return <Card><CardContent className="pt-4 text-sm text-slate-500"><BookOpen className="me-1 inline h-4 w-4" /> {L('No published curriculum for this level yet.', 'لسه مفيش منهج منشور للمستوى ده.')}</CardContent></Card>
  }
  const mine = data.sessions.filter((s) => s.inThisGroup)
  const today = data.sessions.find((s) => s.number === Math.min(data.range.to, data.range.from + data.heldCount)) ?? mine[mine.length - 1]
  const list = expanded ? data.sessions : mine
  return (
    <Card className="border-indigo-100">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-indigo-600" /> {L('Lesson plan', 'خطة الحصة')} <span className="text-xs font-normal text-slate-400">{L('curriculum', 'المنهج')} v{data.edition.number} · {L('sessions', 'الحصص')} {data.range.from}–{data.range.to}</span></span>
          {data.canChangeMode ? (
            <Select value={data.modeSource === 'GROUP' ? data.mode : 'DEFAULT'} onValueChange={(m) => act.mutate({ mode: m === 'DEFAULT' ? null : m })}>
              <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">{L('Default', 'الافتراضي')}: {modeLabel(data.defaultMode)}</SelectItem>
                {data.modes.map((m) => <SelectItem key={m} value={m}>{modeLabel(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : <span className="text-xs font-normal text-slate-500">{modeLabel(data.mode)}</span>}
        </CardTitle>
        {data.newerEdition && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
            <span>{L(`A newer curriculum (v${data.newerEdition.number}) is published. This group still uses v${data.edition.number}.`, `فيه نسخة منهج أحدث (v${data.newerEdition.number}) اتنشرت. الجروب ده لسه على v${data.edition.number}.`)}</span>
            {data.canChangeMode && (
              <Button size="sm" className="h-7 text-xs" disabled={act.isPending} onClick={() => { if (confirm(L(`Move this group to version ${data.newerEdition!.number}? Students' ticks move to the matching items; open/lock and notes stay.`, `تنقل الجروب للنسخة ${data.newerEdition!.number}؟ علامات «خلصت» بتنتقل، والفتح/القفل والملاحظات بيفضلوا.`))) act.mutate({ useLatest: true }) }}>
                {L('Move group to', 'انقل الجروب لـ')} v{data.newerEdition.number}
              </Button>
            )}
          </div>
        )}
        {!data.portalOn && <p className="text-xs text-amber-700">{L("Students don't see lessons yet — the LMS is switched off in Platform.", 'الطلبة لسه مش شايفين الدروس — المنصة متقفلة من Platform.')}</p>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {today && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
            <p className="text-xs font-semibold uppercase text-indigo-700">{L('Next / current lesson · session', 'الدرس الجاي / الحالي · الحصة')} {today.number}</p>
            <p className="font-semibold text-slate-800">{pick(today.titleEn, today.titleAr)}</p>
            {pick(today.objectivesEn, today.objectivesAr) && <Markdown text={pick(today.objectivesEn, today.objectivesAr)} />}
            <Link href={`/dashboard/curriculum/session/${today.id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 underline"><ExternalLink className="h-3 w-3" /> {L('Full plan (instructor notes, content)', 'الخطة كاملة (ملاحظات المدرب والمحتوى)')}</Link>
          </div>
        )}
        <div className="space-y-1">
          {list.map((s) => (
            <div key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1.5 ${s.inThisGroup ? 'border-slate-200' : 'border-slate-100 opacity-70'}`}>
              <span className="min-w-0">
                <span className="font-semibold text-slate-500">{s.number}.</span> {pick(s.titleEn, s.titleAr)}
                <span className={`ms-2 rounded-full border px-1.5 text-[10px] ${s.open ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{s.open ? L('open', 'مفتوح') : L('locked', 'مقفول')}{s.override ? L(' (by hand)', ' (يدوي)') : ''}</span>
                {data.notes.filter((n) => n.sessionNumber === s.number).map((n) => (
                  <span key={n.id} className="mt-1 flex items-start gap-1 text-xs text-amber-800">📝 {n.body}{n.url ? ` (${n.url})` : ''} <button type="button" aria-label="Remove note" onClick={() => delNote.mutate(n.id)}><Trash2 className="h-3 w-3" /></button></span>
                ))}
              </span>
              <span className="flex items-center gap-1">
                {!s.open && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => act.mutate({ sessionNumber: s.number, action: 'open' })}><LockOpen className="h-3 w-3" /> {L('Open', 'افتح')}</Button>}
                {s.open && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => act.mutate({ sessionNumber: s.number, action: 'lock' })}><Lock className="h-3 w-3" /> {L('Lock', 'اقفل')}</Button>}
                {s.override && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => act.mutate({ sessionNumber: s.number, action: 'auto' })}>{L('Automatic', 'تلقائي')}</Button>}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNoteFor(noteFor === s.number ? null : s.number)}>{L('+ Note', '+ ملاحظة')}</Button>
              </span>
              {noteFor === s.number && (
                <div className="flex w-full flex-wrap gap-2">
                  <Input className="h-8 flex-1" placeholder={L('Note for this group only (students see it in the lesson)', 'ملاحظة للجروب ده بس (الطلبة بيشوفوها في الدرس)')} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Input className="h-8 w-56" placeholder={L('https://… (optional)', 'https://… (اختياري)')} value={url} onChange={(e) => setUrl(e.target.value)} />
                  <Button size="sm" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>{L('Add', 'إضافة')}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {data.sessions.length > mine.length && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-indigo-600" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} {expanded ? L('Only this month', 'الشهر ده بس') : L('Whole level', 'المستوى كله')}
          </button>
        )}
      </CardContent>
    </Card>
  )
}
