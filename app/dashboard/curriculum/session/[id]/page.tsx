'use client'

/** LMS L1: one curriculum session — edit texts and content blocks (draft only), preview as instructor / student, review comments. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { BLOCK_TYPES, moveInOrder, type BlockType } from '@/lib/curriculum/blocks'
import { BlockView, Markdown, type Block } from '@/components/curriculum/BlockView'
import { BlockForm, TYPE_LABELS, blankData, type BlockDraft } from '@/components/curriculum/BlockForm'
import { cleanQuiz } from '@/components/quizzes/QuizForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Copy, Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

interface SessionData {
  edition: { id: string; number: number; status: string; levelId: string }
  level: { id: string; name: string; subjectId: string; subject: { name: string } } | null
  session: {
    id: string; number: number; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null
    materialsEn: string | null; materialsAr: string | null; instructorNotes: string | null; durationMin: number | null; skillIds: string[] | null
  }
  blocks: Block[]; prevId: string | null; nextId: string | null; editable: boolean
  comments: { id: string; body: string; resolved: boolean; authorName: string; createdAt: string }[]
  can: { edit: boolean; approve: boolean }
}
interface Skill { id: string; nameEn: string; nameAr: string }
type Mode = 'edit' | 'INSTRUCTOR' | 'STUDENT'

const area = 'min-h-[90px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm'

function Fields({ data, skills, onSaved }: { data: SessionData; skills: Skill[]; onSaved: () => void }) {
  const s = data.session
  const [f, setF] = useState({
    titleEn: s.titleEn, titleAr: s.titleAr, objectivesEn: s.objectivesEn ?? '', objectivesAr: s.objectivesAr ?? '',
    materialsEn: s.materialsEn ?? '', materialsAr: s.materialsAr ?? '', instructorNotes: s.instructorNotes ?? '',
    durationMin: s.durationMin ?? 0, skillIds: (s.skillIds ?? []) as string[],
  })
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/curriculum/sessions/${s.id}`, { method: 'PATCH', body: JSON.stringify({ ...f, durationMin: f.durationMin || null }) }),
    onSuccess: () => { notify.success('Saved'); onSaved() },
    onError: (e: Error) => notify.error(e.message),
  })
  const toggleSkill = (id: string) => setF({ ...f, skillIds: f.skillIds.includes(id) ? f.skillIds.filter((x) => x !== id) : [...f.skillIds, id] })
  return (
    <Card>
      <CardContent className="space-y-3 pt-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-xs text-slate-500">Title (English)</span><Input value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></label>
          <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">العنوان (عربي)</span><Input value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-slate-500">Objectives (English)</span><textarea className={area} value={f.objectivesEn} onChange={(e) => setF({ ...f, objectivesEn: e.target.value })} /></label>
          <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">الأهداف (عربي)</span><textarea className={area} value={f.objectivesAr} onChange={(e) => setF({ ...f, objectivesAr: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-slate-500">Materials / kits (English)</span><textarea className={area} value={f.materialsEn} onChange={(e) => setF({ ...f, materialsEn: e.target.value })} /></label>
          <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">الأدوات المطلوبة (عربي)</span><textarea className={area} value={f.materialsAr} onChange={(e) => setF({ ...f, materialsAr: e.target.value })} /></label>
        </div>
        <label className="block space-y-1"><span className="text-xs text-slate-500">Instructor notes (never shown to students / parents)</span><textarea className={area} value={f.instructorNotes} onChange={(e) => setF({ ...f, instructorNotes: e.target.value })} /></label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-500">Duration (minutes) <Input type="number" min={0} className="h-8 w-24" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) || 0 })} /></label>
          {skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-slate-500">Skills:</span>
              {skills.map((k) => (
                <button key={k.id} type="button" onClick={() => toggleSkill(k.id)} className={`rounded-full border px-2 py-0.5 ${f.skillIds.includes(k.id) ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500'}`}>{k.nameEn}</button>
              ))}
            </div>
          )}
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save session</Button>
      </CardContent>
    </Card>
  )
}

function ReadOnlyFields({ data, mode, skills }: { data: SessionData; mode: Mode; skills: Skill[] }) {
  const { pick, t } = useI18n()
  const s = data.session
  const obj = pick(s.objectivesEn, s.objectivesAr)
  const mat = pick(s.materialsEn, s.materialsAr)
  const tags = skills.filter((k) => (s.skillIds ?? []).includes(k.id))
  return (
    <div className="space-y-3">
      {obj && <div><p className="text-xs font-semibold uppercase text-slate-500">{t('cur.objectives')}</p><Markdown text={obj} /></div>}
      {mat && <div><p className="text-xs font-semibold uppercase text-slate-500">{t('cur.materials')}</p><Markdown text={mat} /></div>}
      {mode !== 'STUDENT' && s.instructorNotes && <div className="rounded-lg border border-amber-100 bg-amber-50 p-3"><p className="text-xs font-semibold uppercase text-amber-700">{t('cur.instructorNotes')}</p><Markdown text={s.instructorNotes} /></div>}
      {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((k) => <span key={k.id} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{pick(k.nameEn, k.nameAr)}</span>)}</div>}
    </div>
  )
}

function Comments({ data, onChange }: { data: SessionData; onChange: () => void }) {
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: () => fetchApi(`/api/curriculum/sessions/${data.session.id}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) }),
    onSuccess: () => { setText(''); onChange() },
    onError: (e: Error) => notify.error(e.message),
  })
  const resolve = useMutation({
    mutationFn: (c: { id: string; resolved: boolean }) => fetchApi(`/api/curriculum/comments/${c.id}`, { method: 'PATCH', body: JSON.stringify({ resolved: c.resolved }) }),
    onSuccess: onChange,
  })
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Review comments</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data.comments.map((c) => (
          <div key={c.id} className={`rounded-lg border p-2 ${c.resolved ? 'border-slate-100 opacity-60' : 'border-amber-200 bg-amber-50/40'}`}>
            <p className="whitespace-pre-wrap text-slate-700">{c.body}</p>
            <p className="mt-1 flex justify-between text-xs text-slate-400">
              <span>{c.authorName} · {new Date(c.createdAt).toLocaleString('en-GB')}</span>
              <button type="button" className="text-indigo-600" onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolved })}>{c.resolved ? 'Open again' : 'Mark solved'}</button>
            </p>
          </div>
        ))}
        {!data.comments.length && <p className="text-xs text-slate-400">No comments.</p>}
        <textarea className={area} placeholder="Write a comment for the author / reviewer…" value={text} onChange={(e) => setText(e.target.value)} />
        <Button size="sm" variant="outline" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>Add comment</Button>
      </CardContent>
    </Card>
  )
}

export default function CurriculumSessionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { t, pick } = useI18n()
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>('INSTRUCTOR')
  const [editing, setEditing] = useState<{ id: string | null; draft: BlockDraft } | null>(null)
  const viewAs = mode === 'STUDENT' ? 'STUDENT' : 'INSTRUCTOR'
  const key = ['curriculum-session', id, viewAs]
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => fetchApi<SessionData>(`/api/curriculum/sessions/${id}?as=${viewAs}`) })
  const { data: skills } = useQuery({
    queryKey: ['curriculum-skills', data?.level?.subjectId],
    queryFn: () => fetchApi<Skill[]>(`/api/curriculum/skills?subjectId=${data!.level!.subjectId}`),
    enabled: !!data?.level?.subjectId,
  })
  useEffect(() => { if (data?.editable && mode === 'INSTRUCTOR' && !editing) setMode('edit') }, [data?.editable]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ['curriculum-session', id] })

  const saveBlock = useMutation({
    mutationFn: (e: { id: string | null; draft: BlockDraft }) => {
      const { mediaUrl: _m, ...rawData } = e.draft.data as Record<string, unknown> & { mediaUrl?: string }
      const cleanData = e.draft.type === 'QUIZ' ? cleanQuiz(rawData) : rawData
      const body = JSON.stringify({ ...e.draft, titleEn: e.draft.titleEn || null, titleAr: e.draft.titleAr || null, data: cleanData, ...(e.id ? { type: undefined } : {}) })
      return e.id ? fetchApi(`/api/curriculum/blocks/${e.id}`, { method: 'PATCH', body }) : fetchApi(`/api/curriculum/sessions/${id}/blocks`, { method: 'POST', body })
    },
    onSuccess: () => { notify.success('Saved'); setEditing(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const delBlock = useMutation({ mutationFn: (bid: string) => fetchApi(`/api/curriculum/blocks/${bid}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e: Error) => notify.error(e.message) })
  const reorder = useMutation({
    mutationFn: (ids: string[]) => fetchApi(`/api/curriculum/sessions/${id}/blocks`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  const duplicate = useMutation({
    mutationFn: () => fetchApi<{ id: string }>(`/api/curriculum/sessions/${id}`, { method: 'POST' }),
    onSuccess: (r) => { notify.success('Session duplicated'); router.push(`/dashboard/curriculum/session/${r.id}`) },
    onError: (e: Error) => notify.error(e.message),
  })
  const removeSession = useMutation({
    mutationFn: () => fetchApi(`/api/curriculum/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success('Session removed'); router.push(`/dashboard/curriculum/level/${data!.edition.levelId}?edition=${data!.edition.id}`) },
    onError: (e: Error) => notify.error(e.message),
  })

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <p className="text-sm text-slate-500">{(error as Error)?.message ?? 'Not found'}</p>
  const s = data.session
  const isEdit = mode === 'edit' && data.editable
  const ids = data.blocks.map((b) => b.id)
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link href={`/dashboard/curriculum/level/${data.edition.levelId}?edition=${data.edition.id}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {data.level?.subject.name} — {data.level?.name} · v{data.edition.number} ({t(`cur.status.${data.edition.status}` as 'cur.status.DRAFT')})
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">{t('cur.session', { n: s.number })}{pick(s.titleEn, s.titleAr) ? ` — ${pick(s.titleEn, s.titleAr)}` : ''}</h1>
          <div className="flex items-center gap-1">
            {data.prevId && <Button size="sm" variant="ghost" asChild><Link href={`/dashboard/curriculum/session/${data.prevId}`}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Link></Button>}
            {data.nextId && <Button size="sm" variant="ghost" asChild><Link href={`/dashboard/curriculum/session/${data.nextId}`}><ChevronRight className="h-4 w-4 rtl:rotate-180" /></Link></Button>}
          </div>
        </div>
        {s.durationMin ? <p className="text-xs text-slate-500">{s.durationMin} min</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {data.editable && <Button size="sm" variant={mode === 'edit' ? 'default' : 'outline'} className="gap-1" onClick={() => setMode('edit')}><Pencil className="h-4 w-4" /> Edit</Button>}
        <Button size="sm" variant={mode === 'INSTRUCTOR' ? 'default' : 'outline'} className="gap-1" onClick={() => setMode('INSTRUCTOR')}><Eye className="h-4 w-4" /> Instructor view</Button>
        <Button size="sm" variant={mode === 'STUDENT' ? 'default' : 'outline'} className="gap-1" onClick={() => setMode('STUDENT')}><Eye className="h-4 w-4" /> {t('cur.preview')}</Button>
        {data.editable && <Button size="sm" variant="outline" className="gap-1" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}><Copy className="h-4 w-4" /> {t('cur.duplicate')}</Button>}
        {data.editable && <Button size="sm" variant="ghost" className="gap-1 text-rose-600" onClick={() => { if (confirm('Remove this session and its content? The next sessions are renumbered.')) removeSession.mutate() }}><Trash2 className="h-4 w-4" /> Remove session</Button>}
      </div>
      {!data.editable && data.can.edit && <p className="rounded bg-slate-50 p-2 text-xs text-slate-500">This version is {data.edition.status.toLowerCase().replace('_', ' ')} and locked. To change it, create a new version from the level page.</p>}

      {isEdit ? <Fields key={`${s.id}-${data.edition.status}`} data={data} skills={skills ?? []} onSaved={refresh} /> : <ReadOnlyFields data={data} mode={mode} skills={skills ?? []} />}

      <div className="space-y-3">
        {data.blocks.map((b, i) => (
          <div key={b.id} className={`rounded-xl border p-4 ${b.audience === 'INSTRUCTOR' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
            {mode !== 'STUDENT' && (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{TYPE_LABELS[b.type as BlockType] ?? b.type} · {t(`cur.audience.${b.audience}` as 'cur.audience.BOTH')}</span>
                {isEdit && (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === 0 || reorder.isPending} onClick={() => reorder.mutate(moveInOrder(ids, b.id, 'up'))} aria-label="Up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === ids.length - 1 || reorder.isPending} onClick={() => reorder.mutate(moveInOrder(ids, b.id, 'down'))} aria-label="Down"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing({ id: b.id, draft: { type: b.type as BlockType, audience: b.audience, titleEn: b.titleEn ?? '', titleAr: b.titleAr ?? '', data: b.data } })} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600" onClick={() => { if (confirm('Remove this content?')) delBlock.mutate(b.id) }} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                  </span>
                )}
              </div>
            )}
            <BlockView block={b} />
          </div>
        ))}
        {!data.blocks.length && <p className="text-sm text-slate-400">{t('common.none')}</p>}
      </div>

      {isEdit && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t('cur.addBlock')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {BLOCK_TYPES.map((ty) => (
              <Button key={ty} size="sm" variant="outline" className="gap-1" onClick={() => setEditing({ id: null, draft: { type: ty, audience: 'BOTH', titleEn: '', titleAr: '', data: blankData(ty) } })}>
                <Plus className="h-3 w-3" /> {TYPE_LABELS[ty]}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {(data.can.edit || data.can.approve) && mode !== 'STUDENT' && <Comments data={data} onChange={refresh} />}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `${editing.id ? 'Edit' : 'Add'}: ${TYPE_LABELS[editing.draft.type]}` : ''}</DialogTitle></DialogHeader>
          {editing && (
            <>
              <BlockForm value={editing.draft} onChange={(d) => setEditing({ ...editing, draft: d })} subjectId={data.level?.subjectId} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                <Button onClick={() => saveBlock.mutate(editing)} disabled={saveBlock.isPending}>{saveBlock.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t('common.save')}</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
