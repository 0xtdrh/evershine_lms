'use client'

/** LMS L3: rubric library — reusable grading tables (criteria × levels with points), for every course or one course. */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Copy, Loader2, Plus, Table2, Trash2 } from 'lucide-react'

interface Level { labelEn: string; labelAr: string; points: number; descEn: string; descAr: string }
interface Crit { id: string; titleEn: string; titleAr: string; levels: Level[] }
interface Rubric { id: string; nameEn: string; nameAr: string; subjectId: string | null; criteria: Crit[]; kidStars: boolean; maxPoints: number }
interface Tree { tree: { courses: { id: string; name: string }[] }[] }

const uid = () => Math.random().toString(36).slice(2, 10)
const LEVELS = (): Level[] => [
  { labelEn: 'Excellent', labelAr: 'ممتاز', points: 4, descEn: '', descAr: '' },
  { labelEn: 'Good', labelAr: 'كويس', points: 3, descEn: '', descAr: '' },
  { labelEn: 'Needs work', labelAr: 'محتاج تحسين', points: 2, descEn: '', descAr: '' },
  { labelEn: 'Not yet', labelAr: 'لسه', points: 1, descEn: '', descAr: '' },
]
const blank = () => ({ id: '', nameEn: '', nameAr: '', subjectId: null as string | null, kidStars: false, criteria: [{ id: uid(), titleEn: '', titleAr: '', levels: LEVELS() }] })

function Editor({ start, courses, onClose }: { start: ReturnType<typeof blank>; courses: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [r, setR] = useState(start)
  const setC = (i: number, p: Partial<Crit>) => setR({ ...r, criteria: r.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)) })
  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ nameEn: r.nameEn, nameAr: r.nameAr, subjectId: r.subjectId, kidStars: r.kidStars, criteria: r.criteria })
      return r.id ? fetchApi(`/api/rubrics/${r.id}`, { method: 'PATCH', body }) : fetchApi('/api/rubrics', { method: 'POST', body })
    },
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['rubrics'] }); onClose() },
    onError: (e: Error) => notify.error(e.message),
  })
  const max = r.criteria.reduce((s, c) => s + Math.max(0, ...c.levels.map((l) => l.points)), 0)
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Name (English)" value={r.nameEn} onChange={(e) => setR({ ...r, nameEn: e.target.value })} />
        <Input dir="rtl" placeholder="الاسم (عربي)" value={r.nameAr} onChange={(e) => setR({ ...r, nameAr: e.target.value })} />
        <Select value={r.subjectId ?? 'ALL'} onValueChange={(v) => setR({ ...r, subjectId: v === 'ALL' ? null : v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">Every course</SelectItem>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={r.kidStars} onChange={(e) => setR({ ...r, kidStars: e.target.checked })} /> Show as stars to young children</label>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {r.criteria.map((c, i) => (
              <tr key={c.id} className="align-top">
                <td className="w-48 border border-slate-200 p-1">
                  <Input className="h-8" placeholder="Criterion" value={c.titleEn} onChange={(e) => setC(i, { titleEn: e.target.value })} />
                  <Input className="mt-1 h-8" dir="rtl" placeholder="المعيار" value={c.titleAr} onChange={(e) => setC(i, { titleAr: e.target.value })} />
                  <button type="button" className="mt-1 text-rose-600" aria-label="Remove line" onClick={() => setR({ ...r, criteria: r.criteria.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></button>
                </td>
                {c.levels.map((l, k) => (
                  <td key={k} className="min-w-[150px] border border-slate-200 p-1">
                    <div className="flex gap-1"><Input className="h-7" value={l.labelEn} onChange={(e) => setC(i, { levels: c.levels.map((x, y) => (y === k ? { ...x, labelEn: e.target.value } : x)) })} /><Input type="number" className="h-7 w-14" value={l.points} onChange={(e) => setC(i, { levels: c.levels.map((x, y) => (y === k ? { ...x, points: Number(e.target.value) || 0 } : x)) })} /></div>
                    <textarea className="mt-1 h-14 w-full rounded border border-slate-200 p-1" placeholder="What it looks like" value={l.descEn} onChange={(e) => setC(i, { levels: c.levels.map((x, y) => (y === k ? { ...x, descEn: e.target.value } : x)) })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setR({ ...r, criteria: [...r.criteria, { id: uid(), titleEn: '', titleAr: '', levels: LEVELS() }] })}><Plus className="h-3 w-3" /> Line</Button>
        <span className="text-xs text-slate-500">Total: {max} points</span>
      </div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending || !r.nameEn.trim()} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save</Button></div>
    </div>
  )
}

export default function RubricsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'curriculum', 'read')
  const canEdit = !!role && checkPermission(role, 'curriculum', 'update')
  const canDelete = !!role && checkPermission(role, 'curriculum', 'delete')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['rubrics', 'all'], queryFn: () => fetchApi<Rubric[]>('/api/rubrics'), enabled: allowed })
  const { data: tree } = useQuery({ queryKey: ['curriculum-tree'], queryFn: () => fetchApi<Tree>('/api/curriculum/tree'), enabled: allowed })
  const courses = (tree?.tree ?? []).flatMap((t) => t.courses)
  const [edit, setEdit] = useState<ReturnType<typeof blank> | null>(null)
  const del = useMutation({ mutationFn: (id: string) => fetchApi(`/api/rubrics/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rubrics'] }) })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Rubrics" message="You don't have access to rubrics." />
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Table2 className="h-7 w-7 text-indigo-600" /> Rubrics</h1>
          <p className="mt-1 text-sm text-slate-500">Grading tables used in homework. Made once, picked when writing an assignment (the assignment keeps its own copy).</p>
        </div>
        {canEdit && <Button className="gap-1" onClick={() => setEdit(blank())}><Plus className="h-4 w-4" /> New rubric</Button>}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data ?? []).map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{r.nameEn} <span className="text-sm font-normal text-slate-400" dir="rtl">{r.nameAr}</span></CardTitle>
                <p className="text-xs text-slate-500">{courses.find((c) => c.id === r.subjectId)?.name ?? 'Every course'} · {r.criteria.length} lines · {r.maxPoints} points{r.kidStars ? ' · stars for kids' : ''}</p></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit({ ...r })}>Edit</Button>}
                {canEdit && <Button size="sm" variant="outline" className="gap-1" onClick={() => setEdit({ ...r, id: '', nameEn: `${r.nameEn} (copy)` })}><Copy className="h-3 w-3" /> Copy</Button>}
                {canDelete && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => { if (confirm('Remove this rubric from the library? Assignments that use it keep their copy.')) del.mutate(r.id) }}><Trash2 className="h-4 w-4" /></Button>}
              </CardContent>
            </Card>
          ))}
          {!data?.length && <p className="text-sm text-slate-500">No rubrics yet.</p>}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? 'Edit rubric' : 'New rubric'}</DialogTitle></DialogHeader>
          {edit && <Editor start={edit} courses={courses} onClose={() => setEdit(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
