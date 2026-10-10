'use client'

/** LMS L4: question bank — questions of a course (and level), with difficulty; quizzes can draw random questions from it. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { QuestionEditor, TYPE_LABELS, blankQuestion, cleanQuestion, type Q } from '@/components/quizzes/QuestionEditor'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Library, Loader2, Plus, Trash2 } from 'lucide-react'

interface Tree { tree: { courses: { id: string; name: string; levels: { id: string; name: string }[] }[] }[] }
interface Row { id: string; type: string; textEn: string; textAr: string; points: number; difficulty: number; levelId: string | null; data: Record<string, unknown> }
const DIFF: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' }

export default function QuestionBankPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'curriculum', 'read')
  const canEdit = !!role && checkPermission(role, 'curriculum', 'update')
  const canDelete = !!role && checkPermission(role, 'curriculum', 'delete')
  const qc = useQueryClient()
  const { data: tree } = useQuery({ queryKey: ['curriculum-tree'], queryFn: () => fetchApi<Tree>('/api/curriculum/tree'), enabled: allowed })
  const courses = (tree?.tree ?? []).flatMap((t) => t.courses)
  const [subjectId, setSubjectId] = useState('')
  const [levelId, setLevelId] = useState('ALL')
  useEffect(() => { if (!subjectId && courses.length) setSubjectId(courses[0].id) }, [courses, subjectId])
  const course = courses.find((c) => c.id === subjectId)
  const key = ['questions', subjectId, levelId]
  const { data: rows, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<Row[]>(`/api/questions?subjectId=${subjectId}${levelId !== 'ALL' ? `&levelId=${levelId}` : ''}`), enabled: !!subjectId })
  const [edit, setEdit] = useState<{ id: string | null; q: Q; levelId: string | null; difficulty: number } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({ subjectId, levelId: edit!.levelId, difficulty: edit!.difficulty, question: cleanQuestion(edit!.q) })
      return edit!.id ? fetchApi(`/api/questions/${edit!.id}`, { method: 'PATCH', body }) : fetchApi('/api/questions', { method: 'POST', body })
    },
    onSuccess: () => { notify.success('Saved'); setEdit(null); qc.invalidateQueries({ queryKey: ['questions'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({ mutationFn: (id: string) => fetchApi(`/api/questions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['questions'] }) })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Question bank" message="You don't have access to the question bank." />
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Library className="h-7 w-7 text-sky-600" /> Question bank</h1>
          <p className="mt-1 text-sm text-slate-500">Questions per course and level. A quiz can take N random questions from here, so every student gets a different set.</p>
        </div>
        {canEdit && subjectId && <Button className="gap-1" onClick={() => setEdit({ id: null, q: blankQuestion(), levelId: levelId === 'ALL' ? null : levelId, difficulty: 2 })}><Plus className="h-4 w-4" /> Question</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={subjectId} onValueChange={(v) => { setSubjectId(v); setLevelId('ALL') }}><SelectTrigger className="h-9 w-64"><SelectValue placeholder="Course" /></SelectTrigger><SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        <Select value={levelId} onValueChange={setLevelId}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All levels</SelectItem>{(course?.levels ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="space-y-2">
          {(rows ?? []).map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-800">{r.textEn || r.textAr || '(no text)'}</span>
                  <span className="block text-xs text-slate-500">{TYPE_LABELS[r.type] ?? r.type} · {DIFF[r.difficulty]} · {r.points} pt · {course?.levels.find((l) => l.id === r.levelId)?.name ?? 'any level'}</span>
                </span>
                <span className="flex gap-1">
                  {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit({ id: r.id, q: { ...(blankQuestion(r.type)), ...(r.data as object), id: r.id, type: r.type, textEn: r.textEn, textAr: r.textAr, points: r.points } as Q, levelId: r.levelId, difficulty: r.difficulty })}>Edit</Button>}
                  {canDelete && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => { if (confirm('Remove this question from the bank? Finished tries keep their copy.')) del.mutate(r.id) }}><Trash2 className="h-4 w-4" /></Button>}
                </span>
              </CardContent>
            </Card>
          ))}
          {!rows?.length && <p className="text-sm text-slate-500">No questions yet.</p>}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.id ? 'Edit question' : 'New question'}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Select value={edit.levelId ?? 'ANY'} onValueChange={(v) => setEdit({ ...edit, levelId: v === 'ANY' ? null : v })}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ANY">Any level of the course</SelectItem>{(course?.levels ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
                <Select value={String(edit.difficulty)} onValueChange={(v) => setEdit({ ...edit, difficulty: Number(v) })}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3].map((d) => <SelectItem key={d} value={String(d)}>{DIFF[d]}</SelectItem>)}</SelectContent></Select>
              </div>
              <QuestionEditor q={edit.q} onChange={(q) => setEdit({ ...edit, q })} />
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
