'use client'

/**
 * LMS L3: grade homework — choose a group → students × assignments (handed in / late / graded), grade one by one or
 * "grade & next", set a group due date, tick "done in class", homework rules for this group (managers).
 * For instructors, substitutes, branch managers and admins (not secretaries).
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { GradeDialog } from '@/components/assignments/GradeDialog'
import { PolicyForm, LATE_LABEL, type Policy } from '@/components/assignments/PolicyForm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CheckCheck, ClipboardList, Clock, Loader2, Settings2 } from 'lucide-react'

interface GroupRow { id: string; label: string; course: string; level: string; toGrade: number }
interface Book {
  policy: Policy; groupPolicy: Policy | null; canChangePolicy: boolean
  assignments: { blockId: string; sessionNumber: number; titleEn: string | null; titleAr: string | null; dueAt: string | null; maxScore: number; finalProject: boolean; kinds: string[]; handedIn: number; toGrade: number }[]
  students: { id: string; name: string; reg: string }[]
  cells: { id: string; blockId: string; studentId: string; status: string; score: number | null; maxScore: number | null; late: boolean }[]
}

const CELL: Record<string, string> = { DRAFT: 'bg-sky-50 text-sky-700', SUBMITTED: 'bg-indigo-100 text-indigo-800 font-semibold', RETURNED: 'bg-amber-50 text-amber-800', GRADED: 'bg-emerald-50 text-emerald-800' }
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

export default function AssignmentsPage() {
  const { pick } = useI18n()
  const qc = useQueryClient()
  const search = useSearchParams()
  const { data: groups, error: gErr } = useQuery({ queryKey: ['hw-groups'], queryFn: () => fetchApi<GroupRow[]>('/api/assignments/groups') })
  const [groupId, setGroupId] = useState<string>(search.get('group') ?? '')
  useEffect(() => { if (!groupId && groups?.length) setGroupId(groups.find((g) => g.toGrade > 0)?.id ?? groups[0].id) }, [groups, groupId])
  const key = ['gradebook', groupId]
  const { data: book, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<Book>(`/api/groups/${groupId}/assignments`), enabled: !!groupId })
  const [grading, setGrading] = useState<string | null>(null)
  const [column, setColumn] = useState<string | null>(null)
  const [policyOpen, setPolicyOpen] = useState(false)
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['hw-groups'] }) }
  const patch = useMutation({
    mutationFn: (b: object) => fetchApi(`/api/groups/${groupId}/assignments`, { method: 'PATCH', body: JSON.stringify(b) }),
    onSuccess: () => { notify.success('Saved'); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const queue = useMemo(() => (book?.cells ?? []).filter((c) => c.status === 'SUBMITTED' && (!column || c.blockId === column)).map((c) => c.id), [book, column])
  const col = book?.assignments.find((a) => a.blockId === column)

  if (gErr) return <p className="text-sm text-slate-500">You don&apos;t grade homework.</p>
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardList className="h-7 w-7 text-violet-600" /> Grade homework</h1>
          <p className="mt-1 text-sm text-slate-500">Hand-ins of your groups. Purple = waiting to be graded.</p>
        </div>
        <Select value={groupId} onValueChange={(v) => { setGroupId(v); setColumn(null) }}>
          <SelectTrigger className="h-9 w-80"><SelectValue placeholder="Choose a group" /></SelectTrigger>
          <SelectContent>{(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.label} · {g.course} {g.level}{g.toGrade ? ` · ${g.toGrade} to grade` : ''}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!groupId ? null : isLoading || !book ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {queue.length > 0 && <Button className="gap-1" onClick={() => setGrading(queue[0])}><CheckCheck className="h-4 w-4" /> Grade {queue.length} waiting{col ? ` (${pick(col.titleEn, col.titleAr) || `session ${col.sessionNumber}`})` : ''}</Button>}
            {book.canChangePolicy && <Button variant="outline" className="gap-1" onClick={() => setPolicyOpen(true)}><Settings2 className="h-4 w-4" /> Homework rules for this group{book.groupPolicy ? ' (own)' : ''}</Button>}
            <span className="text-xs text-slate-500">Late: {LATE_LABEL[book.policy.late]}{book.policy.latePenaltyPct ? ` −${book.policy.latePenaltyPct}%` : ''} · hand in again: {book.policy.resubmit ? `up to ${book.policy.maxAttempts}` : 'no'}</span>
          </div>
          {!book.assignments.length ? <p className="text-sm text-slate-500">No homework open for this group yet (homework opens with its lesson).</p> : (
            <Card>
              <CardContent className="overflow-x-auto pt-4">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky start-0 bg-white p-2 text-start">Student</th>
                      {book.assignments.map((a) => (
                        <th key={a.blockId} className={`min-w-[110px] cursor-pointer border-b border-slate-200 p-2 text-start align-bottom ${column === a.blockId ? 'bg-violet-50' : ''}`} onClick={() => setColumn(column === a.blockId ? null : a.blockId)}>
                          <span className="block text-[10px] text-slate-400">S{a.sessionNumber}{a.finalProject ? ' · project' : ''}</span>
                          <span className="block font-semibold text-slate-700">{pick(a.titleEn, a.titleAr) || 'Homework'}</span>
                          <span className="block font-normal text-slate-400">{a.handedIn}/{book.students.length} in{a.toGrade ? ` · ${a.toGrade} to grade` : ''}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {book.students.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="sticky start-0 bg-white p-2 font-medium text-slate-700">{s.name}</td>
                        {book.assignments.map((a) => {
                          const c = book.cells.find((x) => x.studentId === s.id && x.blockId === a.blockId)
                          const label = !c || c.status === 'DRAFT' ? '—' : c.status === 'GRADED' ? `${c.score}/${c.maxScore}` : c.status === 'RETURNED' ? 'changes' : 'to grade'
                          return (
                            <td key={a.blockId} className="p-1">
                              <button type="button" disabled={!c || c.status === 'DRAFT'} onClick={() => c && setGrading(c.id)} className={`w-full rounded px-2 py-1 text-start ${c ? CELL[c.status] ?? '' : 'text-slate-300'}`}>
                                {label}{c?.late ? ' ⏰' : ''}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {col && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{pick(col.titleEn, col.titleAr) || 'Homework'} · session {col.sessionNumber}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" /> Due for this group
                  <Input type="datetime-local" className="h-8 w-56" defaultValue={toLocalInput(col.dueAt)} onBlur={(e) => patch.mutate({ blockId: col.blockId, dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </label>
                <Button size="sm" variant="outline" onClick={() => patch.mutate({ blockId: col.blockId, inClass: book.students.map((s) => s.id), fullMarks: false })}>Done in class — everyone</Button>
                <Button size="sm" variant="outline" onClick={() => patch.mutate({ blockId: col.blockId, inClass: book.students.map((s) => s.id), fullMarks: true })}>Done in class — full marks</Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!grading} onOpenChange={(o) => { if (!o) setGrading(null) }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Grade</DialogTitle></DialogHeader>
          {grading && <GradeDialog key={grading} submissionId={grading} onDone={(next) => {
            refresh()
            const rest = queue.filter((id) => id !== grading)
            setGrading(next && rest.length ? rest[0] : null)
          }} />}
        </DialogContent>
      </Dialog>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Homework rules for this group</DialogTitle></DialogHeader>
          {book && <PolicyForm value={book.groupPolicy ?? book.policy} onSave={(p) => { patch.mutate({ policy: p }); setPolicyOpen(false) }} onReset={book.groupPolicy ? () => { patch.mutate({ policy: null }); setPolicyOpen(false) } : undefined} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
