'use client'

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { DataExchangeButtons } from '@/components/data/DataExchangeButtons'
import { useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { FullGroupDialog } from '@/components/groups/FullGroupDialog'
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
import { L, useI18n } from '@/lib/i18n/client'
import { campusLabel } from '@/lib/places/label'

// ── Types (match lib/waiting-list/build.ts) ─────────────────────────────────
interface Ref { id: string; name: string }
interface WStudent { id: string; name: string; registrationNumber: string; age: number | null; phone: string | null; campus: Ref; registeredAt: string }
interface Wish { id: string; course: Ref; level: Ref | null; notes: string | null; createdAt: string; daysWaiting: number | null; group?: { id: string; label: string } | null }
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
interface GroupOption { id: string; label: string; campus: Ref; course: Ref | null; level: Ref | null; displayStatus: 'ACTIVE' | 'UPCOMING' | 'COMPLETED'; studentCount: number; maxStudents?: number | null }

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
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const role = session?.user?.role as string | undefined
  const { can } = useMyPermissions()
  const canAddToGroup = can('class_sections', 'update') // POST /api/groups/[id]/students
  const canWish = can('waiting_list', 'create')
  const canCancelWish = can('waiting_list', 'update')
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
      notify.success(L('Student added to the group', 'الطالب اتضاف للجروب'))
      setAddTo(null)
      setGroupId('')
      refresh()
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'GROUP_FULL') {
        setFullTarget({ groupId, studentId: addTo!.student.id, message: err.message })
        return
      }
      notify.error(err.message || 'Could not add the student')
    },
  })
  const [fullTarget, setFullTarget] = useState<{ groupId: string; studentId: string; message: string } | null>(null)

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
      notify.success(L('Added to the waiting list', 'اتضاف لقايمة الانتظار'))
      setWishFor(null)
      refresh()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not add to the waiting list'),
  })
  const cancelWish = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/waiting-list/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }),
    onSuccess: () => {
      notify.success(L('Removed from the waiting list', 'اتشال من قايمة الانتظار'))
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
      {canAddToGroup && <Button size="sm" variant="outline" onClick={() => { setAddTo({ student: s, preferCourseId: opts.courseId, preferLevelId: opts.levelId }); setGroupId('') }}>
        <UserPlus className="mr-1 h-4 w-4" /> {L('Add to group', 'ضيف لجروب')}
      </Button>}
      {canWish && <Button size="sm" variant="ghost" onClick={() => openWish(s, opts.courseId ?? '', opts.levelId ?? null)}>
        <ListPlus className="mr-1 h-4 w-4" /> {L('Waiting list', 'قايمة الانتظار')}
      </Button>}
    </div>
  )

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Hourglass className="h-6 w-6" /> {L('Waiting List', 'قايمة الانتظار')}
          </h1>
          <div className="mt-2 print:hidden"><DataExchangeButtons dataset="waitingList" /></div>
          <p className="text-sm text-muted-foreground">{L('Students waiting for a group, per course and level.', 'الطلاب المستنيين جروب، لكل كورس ومستوى.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role === 'SUPER_ADMIN' && (
            <Select value={campusFilter} onValueChange={setCampusFilter}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder={L('Branch', 'الفرع')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{L('All branches', 'كل الفروع')}</SelectItem>
                {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{campusLabel(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder={L('Course', 'الكورس')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{L('All courses', 'كل الكورسات')}</SelectItem>
              {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {L('Loading…', 'بيحمّل…')}</p>
      ) : isError || !data ? (
        <p className="text-sm text-red-600">{(error as Error)?.message ?? 'Could not load the waiting list'}</p>
      ) : (
        <Tabs defaultValue="levels">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="levels">By course &amp; level</TabsTrigger>
            <TabsTrigger value="upcoming">{L('Group not started (', 'جروب لسه مابدأش (')}{data.upcomingGroups.reduce((n, g) => n + g.students.length, 0)})</TabsTrigger>
            <TabsTrigger value="none">{L('Not in a group (', 'مش في جروب (')}{data.notInGroup.length})</TabsTrigger>
            <TabsTrigger value="finished">Finished, didn&apos;t continue ({data.finished.length})</TabsTrigger>
            <TabsTrigger value="wishes">{L('Recorded wishes (', 'رغبات متسجلة (')}{data.wishes.length})</TabsTrigger>
          </TabsList>

          {/* ── By course & level ─────────────────────────────────── */}
          <TabsContent value="levels" className="mt-4">
            {data.byLevel.length === 0 ? (
              <p className="text-sm text-muted-foreground">{L('Nobody is waiting for a specific course/level yet.', 'مفيش حد مستني كورس / مستوى معيّن لسه.')}</p>
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
                      <Badge variant="secondary">{b.wishes} {L('want it', 'عايزينه')}</Badge>
                      <Badge variant="secondary">{b.finishedNext} {L('should move up to it', 'المفروض يطلعوا له')}</Badge>
                      <Badge variant="outline">{b.upcomingStudents} {L('in', 'في')} {b.upcomingGroups} {L('group(s) not started', 'جروب لسه مابدأش')}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Waiting for their group to start ──────────────────── */}
          <TabsContent value="upcoming" className="mt-4 space-y-4">
            {data.upcomingGroups.length === 0 && <p className="text-sm text-muted-foreground">{L('No students are waiting for a group to start.', 'مفيش طلاب مستنيين جروب يبدأ.')}</p>}
            {data.upcomingGroups.map(({ group, students }) => (
              <Card key={group.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{group.label}</CardTitle>
                  <CardDescription>
                    {courseLevel(group.course, group.level)} {L('· Month', '· شهر')} {group.cycleNumber} · {group.campus.name} · {students.length} {L('student(s)', 'طالب')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="divide-y rounded-md border">
                    {students.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <StudentCell s={s} />
                        <span className="text-xs text-muted-foreground">{L('added', 'اتضاف')} {fmtDate(s.addedAt)} {L('· waiting', '· مستني من')} {days(s.daysWaiting)}</span>
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
              {data.notInGroup.length === 0 && <p className="p-3 text-sm text-muted-foreground">{L('Every student is in a group.', 'كل الطلاب في جروبات.')}</p>}
              {data.notInGroup.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={s} />
                    <p className="text-xs text-muted-foreground">{s.campus.name} {L('· registered', '· اتسجّل')} {fmtDate(s.registeredAt)} {L('· waiting', '· مستني من')} {days(s.daysWaiting)}</p>
                    <div className="flex flex-wrap gap-1">
                      {s.wishes.length === 0 && <Badge variant="outline">{L('No course recorded', 'مفيش كورس متسجّل')}</Badge>}
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
              {data.finished.length === 0 && <p className="p-3 text-sm text-muted-foreground">{L('Nobody finished a group without continuing.', 'مفيش حد خلّص جروب ومكمّلش.')}</p>}
              {data.finished.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={f} />
                    <p className="text-xs">
                      <span className="text-muted-foreground">{L('Finished:', 'خلّص:')} </span>
                      {courseLevel(f.finishedGroup.course, f.finishedGroup.level)} {L('· Month', '· شهر')} {f.finishedGroup.cycleNumber}
                      <span className="text-muted-foreground"> {L('on', 'يوم')} {fmtDate(f.finishedGroup.completedAt)} ({days(f.daysWaiting)} {L('ago)', 'فاتوا)')}</span>
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">{L('Should join next:', 'المفروض يدخل بعد كده:')} </span>
                      {f.next ? (
                        <strong>{f.next.course.name} — {f.next.level.name}{f.next.kind === 'NEXT_MONTH' ? ` · Month ${f.next.cycleNumber}` : ''}</strong>
                      ) : (
                        <span>{L('Track finished — nothing after this level', 'التراك خلص — مفيش حاجة بعد المستوى ده')}</span>
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
              {data.wishes.length === 0 && <p className="p-3 text-sm text-muted-foreground">{L('No wishes recorded yet. Use “Waiting list” on a student.', 'لسه مفيش رغبات متسجلة. استخدم «قايمة الانتظار» على أي طالب.')}</p>}
              {data.wishes.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 space-y-1">
                    <StudentCell s={w.student} />
                    <p className="text-xs"><strong>{courseLevel(w.course, w.level)}</strong> · {w.student.campus.name} {L('· waiting', '· مستني من')} {days(w.daysWaiting)}{w.group && <> · <span className="font-semibold text-amber-700">{L('waiting for full group', 'مستني جروب مليان')} {w.group.label}</span></>}</p>
                    {w.notes && <p className="text-xs text-muted-foreground">{w.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canAddToGroup && <Button size="sm" variant="outline" onClick={() => { setAddTo({ student: w.student, preferCourseId: w.course.id, preferLevelId: w.level?.id }); setGroupId('') }}>
                      <UserPlus className="mr-1 h-4 w-4" /> {L('Add to group', 'ضيف لجروب')}
                    </Button>}
                    {canCancelWish && <Button size="sm" variant="ghost" disabled={cancelWish.isPending} onClick={() => cancelWish.mutate(w.id)}>
                      <X className="mr-1 h-4 w-4" /> {L('Remove', 'شيل')}
                    </Button>}
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
            <DialogDescription>{L('Everyone waiting for this course / level.', 'كل اللي مستنيين الكورس / المستوى ده.')}</DialogDescription>
          </DialogHeader>
          {bucketDetail && (
            <div className="space-y-5 text-sm">
              <section>
                <h3 className="mb-2 font-semibold">{L('Want it (', 'عايزينه (')}{bucketDetail.wishes.length})</h3>
                {bucketDetail.wishes.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <StudentCell s={w.student} />
                    <span className="text-xs text-muted-foreground">{days(w.daysWaiting)}</span>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">{L('Finished the previous step, should move up (', 'خلّصوا الخطوة اللي قبلها، المفروض يطلعوا (')}{bucketDetail.finished.length})</h3>
                {bucketDetail.finished.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <StudentCell s={f} />
                    <span className="text-xs text-muted-foreground">{L('finished', 'خلّص')} {fmtDate(f.finishedGroup.completedAt)}</span>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="mb-2 font-semibold">{L('In groups that have not started', 'في جروبات لسه مابدأتش')}</h3>
                {bucketDetail.upcoming.map((g) => (
                  <div key={g.group.id} className="border-b py-2">
                    <p className="font-medium">{g.group.label} · {g.students.length} {L('student(s)', 'طالب')}</p>
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
            <DialogTitle>{L('Add', 'ضيف')} {addTo?.student.name} {L('to a group', 'لجروب')}</DialogTitle>
            <DialogDescription>{L('Groups in', 'جروبات في')} {addTo?.student.campus.name} {L('that are running or not started yet. Matching course/level first.', 'شغالة أو لسه مابدأتش. نفس الكورس / المستوى الأول.')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{L('Group', 'الجروب')}</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue placeholder={groupChoices.length ? 'Choose a group' : 'No open groups in this branch'} /></SelectTrigger>
              <SelectContent>
                {groupChoices.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} — {courseLevel(g.course, g.level)} ({g.displayStatus === 'UPCOMING' ? 'not started' : 'running'}, {g.studentCount}{g.maxStudents ? `/${g.maxStudents}` : ''}{g.maxStudents && g.studentCount >= g.maxStudents ? ' · full' : ''})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTo(null)}>{L('Cancel', 'إلغاء')}</Button>
            <Button disabled={!groupId || addToGroup.isPending} onClick={() => addToGroup.mutate()}>
              {addToGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {L('Add', 'ضيف')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add wish dialog ─────────────────────────────────────────── */}
      <Dialog open={!!wishFor} onOpenChange={(o) => !o && setWishFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{L('Waiting list:', 'قايمة الانتظار:')} {wishFor?.name}</DialogTitle>
            <DialogDescription>{L('Which course (and level, if known) is this student waiting for?', 'الطالب ده مستني أنهي كورس (والمستوى لو معروف)؟')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{L('Course', 'الكورس')}</Label>
              <Select value={wishForm.subjectId} onValueChange={(v) => setWishForm({ ...wishForm, subjectId: v, levelId: 'NONE' })}>
                <SelectTrigger><SelectValue placeholder={L('Choose a course', 'اختار كورس')} /></SelectTrigger>
                <SelectContent>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{L('Level', 'المستوى')}</Label>
              <Select value={wishForm.levelId} onValueChange={(v) => setWishForm({ ...wishForm, levelId: v })} disabled={!wishForm.subjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">{L('Not decided yet', 'لسه ماتحددش')}</SelectItem>
                  {wishLevels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{L('Notes (optional)', 'ملاحظات (اختياري)')}</Label>
              <Textarea value={wishForm.notes} onChange={(e) => setWishForm({ ...wishForm, notes: e.target.value })} placeholder={L('e.g. prefers evenings, placement test on Sunday', 'مثلاً: يفضّل بالليل، اختبار تحديد مستوى يوم الأحد')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWishFor(null)}>{L('Cancel', 'إلغاء')}</Button>
            <Button disabled={!wishForm.subjectId || addWish.isPending} onClick={() => addWish.mutate()}>
              {addWish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {L('Save', 'حفظ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FullGroupDialog target={fullTarget} onClose={() => setFullTarget(null)} onDone={() => { setAddTo(null); setGroupId(''); refresh() }} />
    </div>
  )
}
