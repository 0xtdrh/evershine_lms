'use client'

import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Hourglass, Loader2, UserPlus, ListPlus, X } from 'lucide-react'

// ── Types (match lib/waiting-list/build.ts) ─────────────────────────────────
interface Ref { id: string; name: string }
interface WStudent { id: string; name: string; registrationNumber: string; age: number | null; phone: string | null; campus: Ref; registeredAt: string }
interface Wish { id: string; course: Ref; level: Ref | null; notes: string | null; createdAt: string; daysWaiting: number | null }
interface WaitingData {
  byLevel: Array<{ course: Ref; level: Ref | null; wishes: number; finishedNext: number; upcomingStudents: number; upcomingGroups: number }>
  upcomingGroups: Array<{
    group: { id: string; label: string; campus: Ref; course: Ref | null; level: Ref | null; cycleNumber: number }
    students: Array<WStudent & { addedAt: string; daysWaiting: number | null }>
  }>
  notInGroup: Array<WStudent & { daysWaiting: number | null; wishes: Wish[] }>
  finished: Array<WStudent & {
    finishedGroup: { id: string; label: string; course: Ref | null; level: Ref | null; cycleNumber: number; completedAt: string | null }
    daysWaiting: number | null
    next: { kind: 'NEXT_MONTH' | 'NEXT_LEVEL'; course: Ref; level: Ref; cycleNumber: number } | null
    wishes: Wish[]
  }>
  wishes: Array<Wish & { student: WStudent }>
}
interface Course { id: string; name: string }
interface Level { id: string; subjectId: string; name: string; order: number }
interface GroupOption { id: string; label: string; campus: Ref; course: Ref | null; level: Ref | null; displayStatus: 'ACTIVE' | 'UPCOMING' | 'COMPLETED'; studentCount: number }

const days = (n: number | null) => (n == null ? '—' : n === 1 ? '1 day' : `${n} days`)
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB') : '—')
const courseLevel = (course: Ref | null, level: Ref | null) =>
  course ? `${course.name} — ${level ? level.name : 'level not decided'}` : '—'

function StudentCell({ s }: { s: WStudent }) {
  return (
    <div className="min-w-0">
      <p className="font-medium truncate">{s.name}</p>
      <p className="text-xs text-muted-foreground truncate">
        {s.registrationNumber}
        {s.age != null ? ` · ${s.age} yrs` : ''}
        {s.phone ? ` · ${s.phone}` : ''}
      </p>
    </div>
  )
}

export default function WaitingListPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as string | undefined
  const queryClient = useQueryClient()

  const [campusFilter, setCampusFilter] = useState<string>('ALL')
  const [courseFilter, setCourseFilter] = useState<string>('ALL')

  const { data: campuses = [] } = useQuery<Ref[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses') })
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ['academic-subjects-for-config'], queryFn: () => fetchApi('/api/academic-subjects') })

  const params = new URLSearchParams()
  if (campusFilter !== 'ALL') params.set('campusId', campusFilter)
  if (courseFilter !== 'ALL') params.set('subjectId', courseFilter)
  const { data, isLoading, isError, error } = useQuery<WaitingData>({
    queryKey: ['waiting-list', campusFilter, courseFilter],
    queryFn: () => fetchApi(`/api/waiting-list?${params.toString()}`),
  })

  const { data: groups = [] } = useQuery<GroupOption[]>({ queryKey: ['groups'], queryFn: () => fetchApi('/api/groups') })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['waiting-list'] })
    queryClient.invalidateQueries({ queryKey: ['groups'] })
  }

  // ── Add to group ──────────────────────────────────────────────────────
  const [addTo, setAddTo] = useState<{ student: WStudent; preferLevelId?: string | null; preferCourseId?: string | null } | null>(null)
  const [groupId, setGroupId] = useState('')
  const groupChoices = useMemo(() => {
    if (!addTo) return []
    const open = groups.filter((g) => g.displayStatus !== 'COMPLETED' && g.campus.id === addTo.student.campus.id)
    const score = (g: GroupOption) =>
      (addTo.preferLevelId && g.level?.id === addTo.preferLevelId ? 2 : 0) +
      (addTo.preferCourseId && g.course?.id === addTo.preferCourseId ? 1 : 0)
    return [...open].sort((a, b) => score(b) - score(a) || a.label.localeCompare(b.label))
  }, [groups, addTo])
  const addToGroup = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/students`, { method: 'POST', body: JSON.stringify({ studentId: addTo!.student.id }) }),
    onSuccess: () => {
      notify.success('Student added to the group')
      setAddTo(null)
      setGroupId('')
      refresh()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not add the student'),
  })

  // ── Add wish ──────────────────────────────────────────────────────────
  const [wishFor, setWishFor] = useState<WStudent | null>(null)
  const [wishForm, setWishForm] = useState({ subjectId: '', levelId: 'NONE', notes: '' })
  const { data: wishLevels = [] } = useQuery<Level[]>({
    queryKey: ['levels', wishForm.subjectId],
    queryFn: () => fetchApi(`/api/levels?subjectId=${wishForm.subjectId}`),
    enabled: !!wishForm.subjectId,
  })
  const openWish = (s: WStudent, subjectId = '', levelId: string | null = null) => {
    setWishFor(s)
    setWishForm({ subjectId, levelId: levelId ?? 'NONE', notes: '' })
  }
  const addWish = useMutation({
    mutationFn: () =>
      fetchApi('/api/waiting-list/entries', {
        method: 'POST',
        body: JSON.stringify({
          studentId: wishFor!.id,
          subjectId: wishForm.subjectId,
          levelId: wishForm.levelId === 'NONE' ? null : wishForm.levelId,
          notes: wishForm.notes || undefined,
        }),
      }),
    onSuccess: () => {
      notify.success('Added to the waiting list')
      setWishFor(null)
      refresh()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not add to the waiting list'),
  })
  const cancelWish = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/waiting-list/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }),
    onSuccess: () => {
      notify.success('Removed from the waiting list')
      refresh()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not remove'),
  })

  // ── One course / level list ───────────────────────────────────────────
  const [bucket, setBucket] = useState<{ course: Ref; level: Ref | null } | null>(null)
  const bucketDetail = useMemo(() => {
    if (!bucket || !data) return null
    const sameLevel = (l: Ref | null) => (l?.id ?? null) === (bucket.level?.id ?? null)
    return {
      wishes: data.wishes.filter((w) => w.course.id === bucket.course.id && sameLevel(w.level)),
      finished: data.finished.filter((f) => f.next && f.next.course.id === bucket.course.id && sameLevel(f.next.level)),
      upcoming: data.upcomingGroups.filter((g) => g.group.course?.id === bucket.course.id && sameLevel(g.group.level)),
    }
  }, [bucket, data])

  const actions = (s: WStudent, opts: { courseId?: string | null; levelId?: string | null } = {}) => (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => { setAddTo({ student: s, preferCourseId: opts.courseId, preferLevelId: opts.levelId }); setGroupId('') }}>
        <UserPlus className="mr-1 h-4 w-4" /> Add to group
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openWish(s, opts.courseId ?? '', opts.levelId ?? null)}>
        <ListPlus className="mr-1 h-4 w-4" /> Waiting list
      </Button>
    </div>
  )

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Hourglass className="h-6 w-6" /> Waiting List
          </h1>
          <p className="text-sm text-muted-foreground">Students waiting for a group, per course and level.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role === 'SUPER_ADMIN' && (
            <Select value={campusFilter} onValueChange={setCampusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Branch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All branches</SelectItem>
                {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Course" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All courses</SelectItem>
              {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">{(error as Error)?.message ?? 'Could not load the waiting list'}</p>
      ) : (
        <Tabs defaultValue="levels">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="levels">By course &amp; level</TabsTrigger>
            <TabsTrigger value="upcoming">Group not started ({data.upcomingGroups.reduce((n, g) => n + g.students.length, 0)})</TabsTrigger>
            <TabsTrigger value="none">Not in a group ({data.notInGroup.length})</TabsTrigger>
            <TabsTrigger value="finished">Finished, didn&apos;t continue ({data.finished.length})</TabsTrigger>
            <TabsTrigger value="wishes">Recorded wishes ({data.wishes.length})</TabsTrigger>
          </TabsList>

          {/* ── By course & level ─────────────────────────────────── */}
          <TabsContent value="levels" className="mt-4">
            {data.byLevel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is waiting for a specific course/level yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.byLevel.map((b) => (
                  <button
                    key={`${b.course.id}:${b.level?.id ?? '-'}`}
                    className="rounded-lg border bg-card p-4 text-left transition hover:border-primary"
                    onClick={() => setBucket({ course: b.course, level: b.level })}
                  >
                    <p className="font-semibold">{b.course.name}</p>
                    <p className="text-sm text-muted-foreground">{b.level ? b.level.name : 'Level not decided'}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{b.wishes} want it</Badge>
                      <Badge variant="secondary">{b.finishedNext} should move up to it</Badge>
                      <Badge variant="outline">{b.upcomingStudents} in {b.upcomingGroups} group(s) not started</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Waiting for their group to start ──────────────────── */}
          <TabsContent value="upcoming" className="mt-4 space-y-4">
            {data.upcomingGroups.length === 0 && <p className="text-sm text-muted-foreground">No students are waiting for a group to start.</p>}
            {data.upcomingGroups.map(({ group, students }) => (
              <Card key={group.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{group.label}</CardTitle>
                  <CardDescription>
                    {courseLevel(group.course, group.level)} · Month {group.cycleNumber} · {group.campus.name} · {students.length} student(s)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="divide-y rounded-md border">
                    {students.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <StudentCell s={s} />
                        <span className="text-xs text-muted-foreground">added {fmtDate(s.addedAt)} · waiting {days(s.daysWaiting)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ── Not in a group ────────────────────────────────────── */}
          <TabsContent value="none" className="mt-4">
            <div className="divide-y rounded-md border">
              {data.notInGroup.length === 0 && <p className="p-3 text-sm text-muted-foreground">Every student is in a group.</p>}
              {data.notInGroup.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={s} />
                    <p className="text-xs text-muted-foreground">{s.campus.name} · registered {fmtDate(s.registeredAt)} · waiting {days(s.daysWaiting)}</p>
                    <div className="flex flex-wrap gap-1">
                      {s.wishes.length === 0 && <Badge variant="outline">No course recorded</Badge>}
                      {s.wishes.map((w) => <Badge key={w.id} variant="secondary">{courseLevel(w.course, w.level)}</Badge>)}
                    </div>
                  </div>
                  {actions(s, { courseId: s.wishes[0]?.course.id, levelId: s.wishes[0]?.level?.id })}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Finished, didn't continue ─────────────────────────── */}
          <TabsContent value="finished" className="mt-4">
            <div className="divide-y rounded-md border">
              {data.finished.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nobody finished a group without continuing.</p>}
              {data.finished.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={f} />
                    <p className="text-xs">
                      <span className="text-muted-foreground">Finished: </span>
                      {courseLevel(f.finishedGroup.course, f.finishedGroup.level)} · Month {f.finishedGroup.cycleNumber}
                      <span className="text-muted-foreground"> on {fmtDate(f.finishedGroup.completedAt)} ({days(f.daysWaiting)} ago)</span>
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">Should join next: </span>
                      {f.next ? (
                        <strong>{f.next.course.name} — {f.next.level.name}{f.next.kind === 'NEXT_MONTH' ? ` · Month ${f.next.cycleNumber}` : ''}</strong>
                      ) : (
                        <span>Track finished — nothing after this level</span>
                      )}
                    </p>
                  </div>
                  {actions(f, { courseId: f.next?.course.id, levelId: f.next?.level.id })}
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Recorded wishes ───────────────────────────────────── */}
          <TabsContent value="wishes" className="mt-4">
            <div className="divide-y rounded-md border">
              {data.wishes.length === 0 && <p className="p-3 text-sm text-muted-foreground">No wishes recorded yet. Use “Waiting list” on a student.</p>}
              {data.wishes.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={w.student} />
                    <p className="text-xs"><strong>{courseLevel(w.course, w.level)}</strong> · {w.student.campus.name} · waiting {days(w.daysWaiting)}</p>
                    {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setAddTo({ student: w.student, preferCourseId: w.course.id, preferLevelId: w.level?.id }); setGroupId('') }}>
                      <UserPlus className="mr-1 h-4 w-4" /> Add to group
                    </Button>
                    <Button size="sm" variant="ghost" disabled={cancelWish.isPending} onClick={() => cancelWish.mutate(w.id)}>
                      <X className="mr-1 h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* ── Course/level detail ─────────────────────────────────────── */}
      <Dialog open={!!bucket} onOpenChange={(o) => !o && setBucket(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{bucket ? courseLevel(bucket.course, bucket.level) : ''}</DialogTitle>
            <DialogDescription>Everyone waiting for this course / level.</DialogDescription>
          </DialogHeader>
          {bucketDetail && (
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="mb-2 font-semibold">Want it ({bucketDetail.wishes.length})</h3>
                {bucketDetail.wishes.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <StudentCell s={w.student} />
                    <span className="text-xs text-muted-foreground">{days(w.daysWaiting)}</span>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Finished the previous step, should move up ({bucketDetail.finished.length})</h3>
                {bucketDetail.finished.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <StudentCell s={f} />
                    <span className="text-xs text-muted-foreground">finished {fmtDate(f.finishedGroup.completedAt)}</span>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">In groups that have not started</h3>
                {bucketDetail.upcoming.map((g) => (
                  <div key={g.group.id} className="border-b py-2">
                    <p className="font-medium">{g.group.label} · {g.students.length} student(s)</p>
                    <p className="text-xs text-muted-foreground">{g.students.map((s) => s.name).join('، ')}</p>
                  </div>
                ))}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add to group dialog ─────────────────────────────────────── */}
      <Dialog open={!!addTo} onOpenChange={(o) => !o && setAddTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {addTo?.student.name} to a group</DialogTitle>
            <DialogDescription>Groups in {addTo?.student.campus.name} that are running or not started yet. Matching course/level first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue placeholder={groupChoices.length ? 'Choose a group' : 'No open groups in this branch'} /></SelectTrigger>
              <SelectContent>
                {groupChoices.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} — {courseLevel(g.course, g.level)} ({g.displayStatus === 'UPCOMING' ? 'not started' : 'running'}, {g.studentCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTo(null)}>Cancel</Button>
            <Button disabled={!groupId || addToGroup.isPending} onClick={() => addToGroup.mutate()}>
              {addToGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add wish dialog ─────────────────────────────────────────── */}
      <Dialog open={!!wishFor} onOpenChange={(o) => !o && setWishFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Waiting list: {wishFor?.name}</DialogTitle>
            <DialogDescription>Which course (and level, if known) is this student waiting for?</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Course</Label>
              <Select value={wishForm.subjectId} onValueChange={(v) => setWishForm({ ...wishForm, subjectId: v, levelId: 'NONE' })}>
                <SelectTrigger><SelectValue placeholder="Choose a course" /></SelectTrigger>
                <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Level</Label>
              <Select value={wishForm.levelId} onValueChange={(v) => setWishForm({ ...wishForm, levelId: v })} disabled={!wishForm.subjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Not decided yet</SelectItem>
                  {wishLevels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={wishForm.notes} onChange={(e) => setWishForm({ ...wishForm, notes: e.target.value })} placeholder="e.g. prefers evenings, placement test on Sunday" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWishFor(null)}>Cancel</Button>
            <Button disabled={!wishForm.subjectId || addWish.isPending} onClick={() => addWish.mutate()}>
              {addWish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
