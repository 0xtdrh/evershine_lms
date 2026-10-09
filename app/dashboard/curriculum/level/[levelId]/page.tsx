'use client'

/** LMS L1: curriculum versions of one level — create / copy / import, review & publish, sessions list, course skills. */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Download, Loader2, MessageSquare, Plus, Trash2, Upload } from 'lucide-react'

interface Edition { id: string; number: number; status: string; notes: string | null; sessionCount: number; groupCount: number; publishedAt: string | null; createdAt: string }
interface Skill { id: string; nameEn: string; nameAr: string }
interface LevelData {
  level: { id: string; name: string; numberOfSessions: number; subject: { id: string; name: string; track: { name: string } | null } }
  editions: Edition[]; skills: Skill[]; can: { edit: boolean; approve: boolean; delete: boolean }
}
interface EditionData { edition: Edition; sessions: { id: string; number: number; titleEn: string; titleAr: string; durationMin: number | null; blockCount: number; openComments: number }[] }

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'border-sky-200 bg-sky-50 text-sky-700', IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700', ARCHIVED: 'border-slate-200 bg-slate-50 text-slate-500',
}

function NewEditionDialog({ data, onDone }: { data: LevelData; onDone: (id: string) => void }) {
  const [from, setFrom] = useState<string>(data.editions.find((e) => e.status === 'PUBLISHED')?.id ?? 'blank')
  const [notes, setNotes] = useState('')
  const create = useMutation({
    mutationFn: () => fetchApi<{ id: string }>(`/api/curriculum/levels/${data.level.id}`, { method: 'POST', body: JSON.stringify({ copyFromId: from === 'blank' ? null : from, notes: notes || null }) }),
    onSuccess: (r) => { notify.success('Draft created'); onDone(r.id) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1"><span className="text-xs text-slate-500">Start from</span>
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="blank">Empty ({data.level.numberOfSessions} empty sessions)</SelectItem>
            {data.editions.map((e) => <SelectItem key={e.id} value={e.id}>Copy of version {e.number} ({e.status.toLowerCase().replace('_', ' ')})</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1"><span className="text-xs text-slate-500">What changes in this version? (optional)</span><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="flex justify-end"><Button onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Create draft</Button></div>
    </div>
  )
}

function SkillsCard({ data }: { data: LevelData }) {
  const qc = useQueryClient()
  const [en, setEn] = useState('')
  const [ar, setAr] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['curriculum-level', data.level.id] })
  const add = useMutation({
    mutationFn: () => fetchApi('/api/curriculum/skills', { method: 'POST', body: JSON.stringify({ subjectId: data.level.subject.id, nameEn: en, nameAr: ar }) }),
    onSuccess: () => { setEn(''); setAr(''); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({ mutationFn: (id: string) => fetchApi(`/api/curriculum/skills/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e: Error) => notify.error(e.message) })
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Skills of {data.level.subject.name}</CardTitle><CardDescription>Tag lessons with skills; later they feed the skills chart in reports and the passport.</CardDescription></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1">
          {data.skills.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
              {s.nameEn}{s.nameAr ? ` · ${s.nameAr}` : ''}
              {data.can.delete && <button type="button" aria-label="Remove" onClick={() => del.mutate(s.id)}><Trash2 className="h-3 w-3" /></button>}
            </span>
          ))}
          {!data.skills.length && <span className="text-xs text-slate-400">No skills yet.</span>}
        </div>
        {data.can.edit && (
          <div className="flex flex-wrap gap-2">
            <Input className="h-8 w-40" placeholder="Skill (English)" value={en} onChange={(e) => setEn(e.target.value)} />
            <Input className="h-8 w-40" dir="rtl" placeholder="المهارة (عربي)" value={ar} onChange={(e) => setAr(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!en.trim() || add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /></Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function CurriculumLevelPage() {
  const { levelId } = useParams<{ levelId: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const { t, pick } = useI18n()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(search.get('edition'))
  const [newOpen, setNewOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['curriculum-level', levelId], queryFn: () => fetchApi<LevelData>(`/api/curriculum/levels/${levelId}`) })
  useEffect(() => {
    if (data && (!selected || !data.editions.some((e) => e.id === selected))) {
      setSelected(data.editions.find((e) => e.status === 'DRAFT' || e.status === 'IN_REVIEW')?.id ?? data.editions[0]?.id ?? null)
    }
  }, [data, selected])
  const { data: ed } = useQuery({ queryKey: ['curriculum-edition', selected], queryFn: () => fetchApi<EditionData>(`/api/curriculum/editions/${selected}`), enabled: !!selected })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['curriculum-level', levelId] }); qc.invalidateQueries({ queryKey: ['curriculum-edition'] }); qc.invalidateQueries({ queryKey: ['curriculum-tree'] }) }

  const act = useMutation({
    mutationFn: (action: string) => fetchApi(`/api/curriculum/editions/${selected}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
    onSuccess: () => { notify.success(t('common.saved')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => fetchApi(`/api/curriculum/editions/${selected}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success('Draft deleted'); setSelected(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const addSession = useMutation({
    mutationFn: () => fetchApi<{ id: string }>(`/api/curriculum/editions/${selected}`, { method: 'POST' }),
    onSuccess: (r) => router.push(`/dashboard/curriculum/session/${r.id}`),
    onError: (e: Error) => notify.error(e.message),
  })
  const importFile = useMutation({
    mutationFn: async (file: File) => fetchApi<{ id: string }>(`/api/curriculum/levels/${levelId}/import`, { method: 'POST', body: await file.text() }),
    onSuccess: (r) => { notify.success('Imported as a new draft'); setSelected(r.id); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <p className="text-sm text-slate-500">{(error as Error)?.message ?? 'Not found'}</p>
  const cur = ed?.edition
  const can = data.can
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/dashboard/curriculum" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"><ArrowLeft className="h-3 w-3 rtl:rotate-180" /> {t('cur.title')}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{data.level.subject.name} — {data.level.name}</h1>
        <p className="text-sm text-slate-500">{data.level.subject.track?.name ?? ''} · {data.level.numberOfSessions} sessions planned</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {data.editions.map((e) => (
          <button key={e.id} type="button" onClick={() => setSelected(e.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${selected === e.id ? 'border-indigo-400 bg-indigo-50 font-semibold' : 'border-slate-200 hover:bg-slate-50'}`}>
            v{e.number} <span className={`ms-1 rounded-full border px-1.5 text-[10px] ${STATUS_STYLE[e.status]}`}>{t(`cur.status.${e.status}` as 'cur.status.DRAFT')}</span>
          </button>
        ))}
        {can.edit && <Button size="sm" className="gap-1" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> {t('cur.newEdition')}</Button>}
        {can.edit && (
          <>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()} disabled={importFile.isPending}><Upload className="h-4 w-4" /> Import</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile.mutate(f); e.target.value = '' }} />
          </>
        )}
      </div>

      {!data.editions.length && <p className="text-sm text-slate-500">No curriculum for this level yet.{can.edit ? ' Create the first version.' : ''}</p>}

      {cur && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>Version {cur.number} <span className={`ms-1 rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[cur.status]}`}>{t(`cur.status.${cur.status}` as 'cur.status.DRAFT')}</span></span>
              <span className="flex flex-wrap gap-2">
                {can.edit && cur.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => act.mutate('submit')} disabled={act.isPending}>{t('cur.submitReview')}</Button>}
                {can.approve && (cur.status === 'IN_REVIEW' || cur.status === 'DRAFT') && <Button size="sm" onClick={() => { if (confirm('Publish this version? New groups of this level will use it.')) act.mutate('publish') }} disabled={act.isPending}>{t('cur.publish')}</Button>}
                {can.approve && cur.status === 'IN_REVIEW' && <Button size="sm" variant="outline" onClick={() => act.mutate('reject')} disabled={act.isPending}>Back to draft</Button>}
                {can.approve && cur.status === 'PUBLISHED' && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Archive this version? Groups already using it keep reading it.')) act.mutate('archive') }}>Archive</Button>}
                {can.edit && <Button size="sm" variant="ghost" className="gap-1" asChild><a href={`/api/curriculum/editions/${cur.id}/export`}><Download className="h-4 w-4" /> Export</a></Button>}
                {can.delete && cur.status === 'DRAFT' && <Button size="sm" variant="ghost" className="gap-1 text-rose-600" onClick={() => { if (confirm('Delete this draft and all its content?')) remove.mutate() }}><Trash2 className="h-4 w-4" /></Button>}
              </span>
            </CardTitle>
            <CardDescription>
              {cur.notes ? `${cur.notes} · ` : ''}{data.editions.find((e) => e.id === cur.id)?.groupCount ?? 0} group(s) pinned
              {cur.status !== 'DRAFT' && can.edit ? ' · To change it, create a new version (copy) — published versions are locked.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {ed.sessions.map((s) => (
              <Link key={s.id} href={`/dashboard/curriculum/session/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
                <span><span className="font-semibold text-slate-500">{s.number}.</span> {pick(s.titleEn, s.titleAr) || <span className="italic text-slate-400">no title yet</span>}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {s.openComments > 0 && <span className="inline-flex items-center gap-0.5 text-amber-600"><MessageSquare className="h-3 w-3" />{s.openComments}</span>}
                  {s.blockCount} item(s){s.durationMin ? ` · ${s.durationMin} min` : ''}
                </span>
              </Link>
            ))}
            {can.edit && cur.status === 'DRAFT' && <Button size="sm" variant="outline" className="mt-2 gap-1" onClick={() => addSession.mutate()} disabled={addSession.isPending}><Plus className="h-4 w-4" /> Add session</Button>}
          </CardContent>
        </Card>
      )}

      <SkillsCard data={data} />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t('cur.newEdition')}</DialogTitle></DialogHeader>
          {newOpen && <NewEditionDialog data={data} onDone={(id) => { setNewOpen(false); setSelected(id); refresh() }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
