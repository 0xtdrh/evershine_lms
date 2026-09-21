'use client'

import { useMemo, useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { notify } from '@/lib/notify'
import { Loader2, Users, MapPin, GraduationCap, Calendar, Clock, Plus, Pencil, Trash2, CheckCircle2, X } from 'lucide-react'

interface Campus { id: string; name: string }
interface Batch { id: string; name: string }
interface Shift { id: string; name: string }
interface AcademicYear { id: string; name: string; isActive: boolean }
interface Track { id: string; name: string }
interface Course { id: string; name: string; code: string; track: { id: string; name: string } | null }
interface Level { id: string; subjectId: string; name: string; order: number }

interface GroupSummary {
  id: string
  label: string
  campus: { id: string; name: string }
  course: { id: string; name: string } | null
  track: { id: string; name: string } | null
  level: { id: string; name: string; numberOfMonths: number; numberOfSessions: number } | null
  teacher: { id: string; name: string } | null
  studentCount: number
  startDate: string | null
  expectedEndDate: string | null
  scheduleSlots: { dayOfWeek: number; time: string }[] | null
  status: 'ACTIVE' | 'COMPLETED'
  displayStatus: 'ACTIVE' | 'COMPLETED' | 'UPCOMING'
}

interface GroupDetail extends Omit<GroupSummary, 'campus' | 'level'> {
  className: string
  sectionName: string
  campusId: string
  batchId: string
  shiftId: string
  currentCycleNumber: number
  campus: { id: string; name: string }
  batch: { id: string; name: string }
  shift: { id: string; name: string }
  level: (GroupSummary['level'] & { pricingType: 'MONTHLY' | 'FULL_LEVEL'; monthlyPrice: number | null; fullLevelPrice: number | null }) | null
  enrollments: {
    id: string
    rollNumber: string
    student: {
      id: string; firstName: string; lastName: string; fullNameEn: string | null; registrationNumber: string
      campus: { id: string; name: string }
    }
  }[]
}

interface TeacherOption { id: string; firstName: string; lastName: string }

interface StudentSearchResult {
  id: string
  firstName: string
  lastName: string
  registrationNumber: string
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-EG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toDateInputValue(d: string | null): string {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

/** Which calendar month of the level "today" falls in, and when that month ends. */
function currentMonthEndDate(startDate: string, numberOfMonths: number): Date {
  const start = new Date(startDate)
  const monthsElapsed = Math.max(
    0,
    (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  )
  const currentMonthIndex = Math.min(Math.floor(monthsElapsed) + 1, numberOfMonths)
  const end = new Date(start)
  end.setMonth(end.getMonth() + currentMonthIndex)
  return end
}

function statusBadge(status: GroupSummary['displayStatus']) {
  if (status === 'COMPLETED') return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Completed</Badge>
  if (status === 'UPCOMING') return <Badge className="bg-amber-50 text-amber-700 border-amber-100">Upcoming</Badge>
  return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">Active</Badge>
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

export default function GroupsPage() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const role = session?.user?.role as string | undefined
  const myCampusId = session?.user?.campusId as string | undefined
  const isCampusLocked = role !== 'SUPER_ADMIN'

  const { data: groups = [], isLoading } = useQuery<GroupSummary[]>({
    queryKey: ['groups'],
    queryFn: () => fetchApi('/api/groups'),
  })

  const [filter, setFilter] = useState<'ACTIVE' | 'UPCOMING' | 'COMPLETED'>('ACTIVE')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const filtered = useMemo(() => groups.filter((g) => g.displayStatus === filter), [groups, filter])
  const counts = useMemo(() => ({
    ACTIVE: groups.filter((g) => g.displayStatus === 'ACTIVE').length,
    UPCOMING: groups.filter((g) => g.displayStatus === 'UPCOMING').length,
    COMPLETED: groups.filter((g) => g.displayStatus === 'COMPLETED').length,
  }), [groups])

  const { data: detail, isLoading: isDetailLoading } = useQuery<GroupDetail>({
    queryKey: ['group-detail', selectedGroupId],
    queryFn: () => fetchApi(`/api/groups/${selectedGroupId}`),
    enabled: !!selectedGroupId,
  })

  // ── Reference data used by the create/edit forms ─────────────────────
  const { data: campuses = [] } = useQuery<Campus[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses') })
  const { data: shifts = [] } = useQuery<Shift[]>({ queryKey: ['shifts'], queryFn: () => fetchApi('/api/shifts') })
  const { data: tracks = [] } = useQuery<Track[]>({ queryKey: ['tracks'], queryFn: () => fetchApi('/api/tracks') })
  const { data: courses = [] } = useQuery<Course[]>({ queryKey: ['academic-subjects-for-config'], queryFn: () => fetchApi('/api/academic-subjects') })
  const { data: academicYears = [] } = useQuery<AcademicYear[]>({ queryKey: ['academic-years'], queryFn: () => fetchApi('/api/academic-years') })
  const activeYear = academicYears.find((y) => y.isActive)

  // ── Instructor assignment ────────────────────────────────────────────
  const { data: teacherOptions = [] } = useQuery<TeacherOption[]>({
    queryKey: ['teachers-for-group', detail?.campusId],
    queryFn: async () => {
      const res = await fetchApi<{ teachers: TeacherOption[] }>(`/api/teachers/for-selection?mode=all&campusId=${detail?.campusId}`)
      return res.teachers
    },
    enabled: !!detail?.campusId,
  })

  const assignInstructorMutation = useMutation({
    mutationFn: (teacherId: string | null) =>
      fetchApi(`/api/groups/${selectedGroupId}/instructor`, { method: 'POST', body: JSON.stringify({ teacherId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      notify.success('Instructor updated')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to assign instructor')),
  })

  // ── Create group ──────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    campusId: '', batchId: '', shiftId: '', className: '', sectionName: '',
    trackId: '', courseId: '', levelId: '', startDate: '',
  })

  const { data: createBatches = [] } = useQuery<Batch[]>({
    queryKey: ['batches', createForm.campusId],
    queryFn: () => fetchApi(`/api/batches?campusId=${createForm.campusId}`),
    enabled: !!createForm.campusId,
  })
  const coursesForCreate = useMemo(
    () => courses.filter((c) => c.track?.id === createForm.trackId),
    [courses, createForm.trackId]
  )
  const { data: levelsForCreate = [] } = useQuery<Level[]>({
    queryKey: ['levels', createForm.courseId],
    queryFn: () => fetchApi(`/api/levels?subjectId=${createForm.courseId}`),
    enabled: !!createForm.courseId,
  })

  const resetCreateForm = () => setCreateForm({ campusId: isCampusLocked ? (myCampusId ?? '') : '', batchId: '', shiftId: '', className: '', sectionName: '', trackId: '', courseId: '', levelId: '', startDate: '' })

  // Branch-scoped roles never pick a campus — it's fixed to their own.
  useEffect(() => {
    if (isCampusLocked && myCampusId && !createForm.campusId) {
      setCreateForm((f) => ({ ...f, campusId: myCampusId }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCampusLocked, myCampusId])

  const createGroupMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          campusId: createForm.campusId,
          batchId: createForm.batchId,
          shiftId: createForm.shiftId,
          className: createForm.className,
          sectionName: createForm.sectionName,
          levelId: createForm.levelId || null,
          startDate: createForm.startDate ? new Date(createForm.startDate).toISOString() : null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      notify.success('Group created')
      setCreateOpen(false)
      resetCreateForm()
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to create group')),
  })

  // ── Edit group ────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    className: '', sectionName: '', trackId: '', courseId: '', levelId: '',
    startDate: '', expectedEndDate: '',
  })
  const [scheduleSlots, setScheduleSlots] = useState<{ dayOfWeek: number; time: string }[]>([])

  const openEdit = () => {
    if (!detail) return
    const course = courses.find((c) => c.id === detail.course?.id)
    setEditForm({
      className: detail.className,
      sectionName: detail.sectionName,
      trackId: course?.track?.id ?? '',
      courseId: detail.course?.id ?? '',
      levelId: detail.level?.id ?? '',
      startDate: toDateInputValue(detail.startDate),
      expectedEndDate: toDateInputValue(detail.expectedEndDate),
    })
    setScheduleSlots(detail.scheduleSlots ?? [])
    setEditOpen(true)
  }

  const coursesForEdit = useMemo(() => courses.filter((c) => c.track?.id === editForm.trackId), [courses, editForm.trackId])
  const { data: levelsForEdit = [] } = useQuery<Level[]>({
    queryKey: ['levels', editForm.courseId],
    queryFn: () => fetchApi(`/api/levels?subjectId=${editForm.courseId}`),
    enabled: !!editForm.courseId && editOpen,
  })

  const updateGroupMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/groups/${selectedGroupId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          className: editForm.className,
          sectionName: editForm.sectionName,
          levelId: editForm.levelId || null,
          startDate: editForm.startDate ? new Date(editForm.startDate).toISOString() : null,
          expectedEndDate: editForm.expectedEndDate ? new Date(editForm.expectedEndDate).toISOString() : null,
          scheduleSlots: scheduleSlots.length > 0 ? scheduleSlots : null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      notify.success('Group updated')
      setEditOpen(false)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to update group')),
  })

  const toggleStatusMutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'COMPLETED') =>
      fetchApi(`/api/groups/${selectedGroupId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      notify.success('Status updated')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to update status')),
  })

  const [confirmAdvance, setConfirmAdvance] = useState(false)
  const [continuingIds, setContinuingIds] = useState<Set<string>>(new Set())

  const openAdvanceDialog = () => {
    if (!detail) return
    setContinuingIds(new Set(detail.enrollments.map((e) => e.student.id)))
    setConfirmAdvance(true)
  }

  const advanceCycleMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/groups/${selectedGroupId}/advance-cycle`, {
        method: 'POST',
        body: JSON.stringify({ continuingStudentIds: Array.from(continuingIds) }),
      }),
    onSuccess: (res: { action: string; nextLevel: { name: string } | null; movedToNextCourse: boolean; withdrawnCount: number }) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      setConfirmAdvance(false)
      const withdrawnNote = res.withdrawnCount > 0 ? ` · ${res.withdrawnCount} student${res.withdrawnCount === 1 ? '' : 's'} withdrawn` : ''
      if (res.action === 'MONTH_COMPLETED') notify.success(`Month closed — next month started${withdrawnNote}`)
      else if (res.action === 'LEVEL_COMPLETED') {
        notify.success(
          (res.movedToNextCourse ? `Course finished — moved to ${res.nextLevel?.name}` : `Level closed — moved to ${res.nextLevel?.name}`) + withdrawnNote
        )
      } else notify.success(`Track finished — this was the last level, group marked completed${withdrawnNote}`)
    },
    onError: (err: unknown) => {
      notify.error(apiErrorMessage(err, 'Failed to close the cycle'))
      setConfirmAdvance(false)
    },
  })

  // ── Delete group ──────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteGroupMutation = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${selectedGroupId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      notify.success('Group deleted')
      setConfirmDelete(false)
      setSelectedGroupId(null)
    },
    onError: (err: unknown) => {
      notify.error(apiErrorMessage(err, 'Failed to delete group'))
      setConfirmDelete(false)
    },
  })

  // ── Students in the group ─────────────────────────────────────────────
  const [studentQuery, setStudentQuery] = useState('')
  const { data: studentResults = [] } = useQuery<StudentSearchResult[]>({
    queryKey: ['students-search-for-group', studentQuery],
    queryFn: () => fetchApi(`/api/students?search=${encodeURIComponent(studentQuery)}&limit=8`),
    enabled: studentQuery.trim().length >= 2,
  })

  const addStudentMutation = useMutation({
    mutationFn: (studentId: string) =>
      fetchApi('/api/student-enrollments', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          academicYearId: activeYear?.id,
          classSectionId: selectedGroupId,
          rollNumber: String(Math.floor(Math.random() * 9000) + 1000),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      notify.success('Student added')
      setStudentQuery('')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to add student')),
  })

  const removeStudentMutation = useMutation({
    mutationFn: (enrollmentId: string) => fetchApi(`/api/student-enrollments/${enrollmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-detail', selectedGroupId] })
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      notify.success('Student removed from group')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to remove student')),
  })

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Groups</h1>
          <CardDescription>Full control — create, edit, staff, and manage every group here.</CardDescription>
        </div>
        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New group
        </Button>
      </div>

      <div className="flex gap-2">
        {(['ACTIVE', 'UPCOMING', 'COMPLETED'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
              filter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f === 'ACTIVE' ? 'Active' : f === 'UPCOMING' ? 'Upcoming' : 'Completed'}
            <span className={filter === f ? 'text-indigo-100 ml-1.5' : 'text-slate-400 ml-1.5'}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No groups here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedGroupId(g.id)}
              className="text-left p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-semibold text-slate-900">{g.label}</p>
                {statusBadge(g.displayStatus)}
              </div>
              <p className="text-sm text-slate-600">
                {g.course?.name ?? 'No course set'}{g.level && ` · ${g.level.name}`}
              </p>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {g.campus.name}</p>
                <p className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {g.studentCount} students {g.teacher && `· ${g.teacher.name}`}</p>
                <p className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {formatDate(g.startDate)} → {formatDate(g.expectedEndDate)}</p>
                {g.scheduleSlots && g.scheduleSlots.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {g.scheduleSlots.map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.time}`).join(', ')}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Group detail */}
      <Dialog open={!!selectedGroupId} onOpenChange={(o) => { if (!o) setSelectedGroupId(null) }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <DialogTitle>{detail?.label ?? 'Group'}</DialogTitle>
                <DialogDescription>
                  {detail?.course?.name}{detail?.level && ` · ${detail.level.name}`}{detail?.track && ` · ${detail.track.name} track`}
                </DialogDescription>
              </div>
              {detail && <div className="pt-1">{statusBadge(detail.displayStatus)}</div>}
            </div>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Branch</p>
                  <p className="text-slate-800">{detail.campus.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Instructor</p>
                  <Select
                    value={detail.teacher?.id ?? 'none'}
                    onValueChange={(v) => assignInstructorMutation.mutate(v === 'none' ? null : v)}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Not assigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not assigned</SelectItem>
                      {teacherOptions.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.firstName} {t.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Starts</p>
                  <p className="text-slate-800">{formatDate(detail.startDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Level ends</p>
                  <p className="text-slate-800">{formatDate(detail.expectedEndDate)}</p>
                </div>
                {detail.level && detail.level.numberOfMonths > 1 && detail.startDate && (
                  <div>
                    <p className="text-xs text-slate-400">This month ends</p>
                    <p className="text-slate-800">{formatDate(currentMonthEndDate(detail.startDate, detail.level.numberOfMonths).toISOString())}</p>
                  </div>
                )}
                {detail.level && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400">Level pricing</p>
                    <p className="text-slate-800">
                      {detail.level.pricingType === 'MONTHLY'
                        ? `${detail.level.monthlyPrice ?? '—'} / month`
                        : `${detail.level.fullLevelPrice ?? '—'} full level`}
                      {' · '}{detail.level.numberOfSessions} sessions over {detail.level.numberOfMonths} months
                    </p>
                  </div>
                )}
                {detail.level?.pricingType === 'MONTHLY' && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400">Current billing cycle</p>
                    <p className="text-slate-800">Month {detail.currentCycleNumber}</p>
                  </div>
                )}
                {detail.scheduleSlots && detail.scheduleSlots.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400">Weekly schedule</p>
                    <p className="text-slate-800">
                      {detail.scheduleSlots.map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.time}`).join(', ')}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openEdit}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
                {detail.level && detail.status === 'ACTIVE' && (
                  <Button
                    size="sm" variant="outline" className="gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                    onClick={openAdvanceDialog}
                  >
                    {detail.level.pricingType === 'MONTHLY' ? 'Month finished' : 'Level finished'}
                  </Button>
                )}
                {detail.status === 'ACTIVE' ? (
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    disabled={toggleStatusMutation.isPending}
                    onClick={() => toggleStatusMutation.mutate('COMPLETED')}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark completed
                  </Button>
                ) : (
                  <Button
                    size="sm" variant="outline" className="gap-1.5"
                    disabled={toggleStatusMutation.isPending}
                    onClick={() => toggleStatusMutation.mutate('ACTIVE')}
                  >
                    Reopen
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-indigo-600" /> Students ({detail.enrollments.length})
                </p>
                <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto mb-2">
                  {detail.enrollments.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No students enrolled yet.</p>
                  ) : (
                    detail.enrollments.map((e) => (
                      <div key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <p className="text-slate-800">{e.student.fullNameEn || `${e.student.firstName} ${e.student.lastName}`}</p>
                          <p className="text-xs text-slate-400">
                            {e.student.registrationNumber}
                            {e.student.campus.id !== detail.campusId && <span className="text-amber-600"> · home branch: {e.student.campus.name}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm" variant="ghost" className="h-6 w-6 p-0"
                            disabled={removeStudentMutation.isPending}
                            onClick={() => removeStudentMutation.mutate(e.id)}
                          >
                            <X className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <Input
                  placeholder="Search by student name to add..."
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                />
                {studentResults.length > 0 && (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-40 overflow-y-auto mt-2">
                    {studentResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={addStudentMutation.isPending}
                        onClick={() => addStudentMutation.mutate(s.id)}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-slate-50"
                      >
                        <span className="text-slate-800">{s.firstName} {s.lastName}</span>
                        <span className="text-xs text-slate-400 font-mono">{s.registrationNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Create group */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm() }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!isCampusLocked && (
              <Select value={createForm.campusId} onValueChange={(v) => setCreateForm({ ...createForm, campusId: v, batchId: '' })}>
                <SelectTrigger><SelectValue placeholder="Branch" /></SelectTrigger>
                <SelectContent>{campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={createForm.batchId} onValueChange={(v) => setCreateForm({ ...createForm, batchId: v })} disabled={!createForm.campusId}>
              <SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent>{createBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={createForm.shiftId} onValueChange={(v) => setCreateForm({ ...createForm, shiftId: v })}>
              <SelectTrigger><SelectValue placeholder="Shift" /></SelectTrigger>
              <SelectContent>{shifts.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex gap-3">
              <Input placeholder="Group name" value={createForm.className} onChange={(e) => setCreateForm({ ...createForm, className: e.target.value })} />
              <Input placeholder="Section (e.g. A)" value={createForm.sectionName} onChange={(e) => setCreateForm({ ...createForm, sectionName: e.target.value })} />
            </div>
            <Select value={createForm.trackId} onValueChange={(v) => setCreateForm({ ...createForm, trackId: v, courseId: '', levelId: '' })}>
              <SelectTrigger><SelectValue placeholder="Track" /></SelectTrigger>
              <SelectContent>{tracks.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={createForm.courseId} onValueChange={(v) => setCreateForm({ ...createForm, courseId: v, levelId: '' })} disabled={!createForm.trackId}>
              <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
              <SelectContent>{coursesForCreate.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={createForm.levelId} onValueChange={(v) => setCreateForm({ ...createForm, levelId: v })} disabled={!createForm.courseId}>
              <SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger>
              <SelectContent>{levelsForCreate.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="date" placeholder="Start date" value={createForm.startDate} onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })} />
          </div>
          <DialogFooter>
            <Button
              disabled={!createForm.campusId || !createForm.batchId || !createForm.shiftId || !createForm.className || !createForm.sectionName || createGroupMutation.isPending}
              onClick={() => createGroupMutation.mutate()}
            >
              {createGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit group */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <Input placeholder="Group name" value={editForm.className} onChange={(e) => setEditForm({ ...editForm, className: e.target.value })} />
              <Input placeholder="Section" value={editForm.sectionName} onChange={(e) => setEditForm({ ...editForm, sectionName: e.target.value })} />
            </div>
            <Select value={editForm.trackId} onValueChange={(v) => setEditForm({ ...editForm, trackId: v, courseId: '', levelId: '' })}>
              <SelectTrigger><SelectValue placeholder="Track" /></SelectTrigger>
              <SelectContent>{tracks.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={editForm.courseId} onValueChange={(v) => setEditForm({ ...editForm, courseId: v, levelId: '' })} disabled={!editForm.trackId}>
              <SelectTrigger><SelectValue placeholder="Course" /></SelectTrigger>
              <SelectContent>{coursesForEdit.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={editForm.levelId} onValueChange={(v) => setEditForm({ ...editForm, levelId: v })} disabled={!editForm.courseId}>
              <SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger>
              <SelectContent>{levelsForEdit.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex gap-3">
              <Input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
              <Input type="date" value={editForm.expectedEndDate} onChange={(e) => setEditForm({ ...editForm, expectedEndDate: e.target.value })} />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Weekly schedule</p>
              {scheduleSlots.map((slot, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Select value={String(slot.dayOfWeek)} onValueChange={(v) => {
                    const next = [...scheduleSlots]; next[i] = { ...slot, dayOfWeek: Number(v) }; setScheduleSlots(next)
                  }}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{DAY_NAMES.map((d, idx) => <SelectItem key={idx} value={String(idx)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input
                    type="time" value={slot.time}
                    onChange={(e) => { const next = [...scheduleSlots]; next[i] = { ...slot, time: e.target.value }; setScheduleSlots(next) }}
                  />
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setScheduleSlots(scheduleSlots.filter((_, idx) => idx !== i))}>
                    <X className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setScheduleSlots([...scheduleSlots, { dayOfWeek: 0, time: '16:00' }])}>
                <Plus className="w-3.5 h-3.5" /> Add time slot
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={updateGroupMutation.isPending} onClick={() => updateGroupMutation.mutate()}>
              {updateGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cycle-advance: pick who continues */}
      <Dialog open={confirmAdvance} onOpenChange={setConfirmAdvance}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.level?.pricingType === 'MONTHLY' ? 'Close this month' : 'Close this level'}
            </DialogTitle>
            <DialogDescription>
              {detail?.level?.pricingType === 'MONTHLY'
                ? `Closes month ${detail?.currentCycleNumber} and starts month ${(detail?.currentCycleNumber ?? 1) + 1}.`
                : 'Moves the group to the next level (or the next course in the track if this was the last level).'}
              {' '}Uncheck anyone who is not continuing — they&apos;ll be withdrawn from the group.
            </DialogDescription>
          </DialogHeader>

          <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {detail?.enrollments.map((e) => (
              <label key={e.id} className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                <span className="text-slate-800">{e.student.fullNameEn || `${e.student.firstName} ${e.student.lastName}`}</span>
                <Checkbox
                  checked={continuingIds.has(e.student.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(continuingIds)
                    if (checked) next.add(e.student.id)
                    else next.delete(e.student.id)
                    setContinuingIds(next)
                  }}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-400">{continuingIds.size} of {detail?.enrollments.length ?? 0} continuing</p>

          <DialogFooter>
            <Button disabled={advanceCycleMutation.isPending} onClick={() => advanceCycleMutation.mutate()}>
              {advanceCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-2xl max-w-md p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-slate-900">Delete {detail?.label}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed">
              This is blocked while the group still has active students. Historical records (attendance, grades) are kept either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 flex-col-reverse sm:flex-row">
            <AlertDialogCancel className="h-10 text-xs sm:text-sm rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" disabled={deleteGroupMutation.isPending} onClick={() => deleteGroupMutation.mutate()}>
                {deleteGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
