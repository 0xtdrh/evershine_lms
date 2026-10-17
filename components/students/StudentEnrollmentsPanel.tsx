'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { GraduationCap, Plus, Loader2, Pencil, Trash2, RotateCcw, Check, X, ChevronDown, ChevronUp } from 'lucide-react'
import { notify } from '@/lib/notify'
import type { SessionShift } from '@/lib/validation/shift'
import Link from 'next/link'
import { L } from '@/lib/i18n/client'

export interface StudentEnrollmentRow {
  id: string
  rollNumber: string
  status: string
  deliveryMode: string
  academicYear: { id: string; name: string; isActive: boolean; isLocked: boolean }
  classSection: {
    id: string
    className: string
    sectionName: string
    grade?: number | null
    campus: { name: string; code: string }
    batch: { name: string; code: string }
    shift: { code: SessionShift; name: string; startTime: string; endTime: string }
  }
  subjectEnrollments?: Array<{
    subjectOffering: { subject: { name: string; code: string } }
  }>
}

interface ClassSectionOption {
  id: string
  className: string
  sectionName: string
  grade?: number
  campus: { code: string }
  batch: { code: string }
  shift: { code: SessionShift; name: string }
}

interface InlineEditState {
  rollNumber: string
  deliveryMode: 'PHYSICAL' | 'ONLINE' | 'HYBRID'
}

interface Props {
  studentId: string
  campusId: string
  batchId?: string
  canManage?: boolean
  compact?: boolean
}

export function StudentEnrollmentsPanel({
  studentId,
  campusId,
  batchId,
  canManage = false,
  compact = false,
}: Props) {
  const qc = useQueryClient()

  // ── Add enrollment form state ────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false)
  const [classSectionId, setClassSectionId] = useState('')
  const [rollNumber, setRollNumber] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<'PHYSICAL' | 'ONLINE' | 'HYBRID'>('PHYSICAL')

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<InlineEditState>({ rollNumber: '', deliveryMode: 'PHYSICAL' })

  // ── History section toggle ───────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)

  // ── Re-enroll state ──────────────────────────────────────────────────────
  const [reEnrollingId, setReEnrollingId] = useState<string | null>(null)
  const [reEnrollRoll, setReEnrollRoll] = useState('')

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: enrollmentsRaw, isLoading } = useQuery({
    queryKey: ['student-enrollments', studentId],
    queryFn: () => fetchApi<StudentEnrollmentRow[]>(`/api/students/${studentId}/enrollments`),
  })

  const enrollments = Array.isArray(enrollmentsRaw)
    ? enrollmentsRaw
    : (enrollmentsRaw as { data?: StudentEnrollmentRow[] })?.data ?? []

  // ── Campus filter toggle state ───────────────────────────────────────────
  const [filterByCampus, setFilterByCampus] = useState(true)

  // WHY: We query sections for the student's campus first. If zero sections exist
  // for that specific campus (or if campusId is missing/unassigned), we fall back
  // to querying ALL active sections across the institution so admins are never blocked
  // by an empty dropdown.
  const { data: sectionsRaw, isLoading: sectionsLoading } = useQuery({
    queryKey: ['class-sections-for-enrollment', campusId, filterByCampus],
    queryFn: async () => {
      if (filterByCampus && campusId) {
        const campusRes = await fetchApi<ClassSectionOption[]>(`/api/class-sections?campusId=${encodeURIComponent(campusId)}`)
        const campusItems = Array.isArray(campusRes) ? campusRes : (campusRes as any)?.data ?? []
        if (campusItems.length > 0) return campusItems
      }
      // Fallback or explicit "All Campuses": fetch all active sections
      const allRes = await fetchApi<ClassSectionOption[]>(`/api/class-sections`)
      return Array.isArray(allRes) ? allRes : (allRes as any)?.data ?? []
    },
    enabled: showAdd || !!reEnrollingId,
  })

  const sections = Array.isArray(sectionsRaw)
    ? sectionsRaw
    : (sectionsRaw as { data?: ClassSectionOption[] })?.data ?? []

  // ── Derived state ────────────────────────────────────────────────────────
  const active    = enrollments.filter((e) => e.status === 'ACTIVE')
  const withdrawn = enrollments.filter((e) => e.status !== 'ACTIVE')

  // ── Mutations ────────────────────────────────────────────────────────────

  const addMutation = useMutation({
    mutationFn: () =>
      fetchApi(`/api/students/${studentId}/enrollments`, {
        method: 'POST',
        body: JSON.stringify({ classSectionId, rollNumber, deliveryMode }),
      }),
    onSuccess: () => {
      notify.success(L('Section enrollment added', 'التسكين اتضاف'))
      qc.invalidateQueries({ queryKey: ['student-enrollments', studentId] })
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      setShowAdd(false)
      setClassSectionId('')
      setRollNumber('')
    },
    onError: (err: Error) => notify.error(err.message || 'Failed to add enrollment'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InlineEditState }) =>
      fetchApi(`/api/student-enrollments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      notify.success(L('Enrollment updated', 'التسكين اتحدّث'))
      qc.invalidateQueries({ queryKey: ['student-enrollments', studentId] })
      setEditingId(null)
    },
    onError: (err: Error) => notify.error(err.message || 'Failed to update enrollment'),
  })

  // WHY soft-delete via WITHDRAWN status:
  // Historical marks, attendance, and assessments recorded against this enrollment
  // must be retained. Hard deletion would cascade-destroy them, violating audit requirements.
  const withdrawMutation = useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/api/student-enrollments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      notify.success(L('Student withdrawn from section. Historical records are preserved.', 'الطالب اتسحب. السجلات القديمة محفوظة.'))
      qc.invalidateQueries({ queryKey: ['student-enrollments', studentId] })
      qc.invalidateQueries({ queryKey: ['student', studentId] })
    },
    onError: (err: Error) => notify.error(err.message || 'Failed to withdraw enrollment'),
  })

  // Re-enroll: create a fresh enrollment for the same student in the same or different section
  const reEnrollMutation = useMutation({
    mutationFn: ({ sectionId, roll }: { sectionId: string; roll: string }) =>
      fetchApi(`/api/students/${studentId}/enrollments`, {
        method: 'POST',
        body: JSON.stringify({ classSectionId: sectionId, rollNumber: roll, deliveryMode: 'PHYSICAL' }),
      }),
    onSuccess: () => {
      notify.success(L('Student re-enrolled successfully', 'الطالب اتسجّل تاني'))
      qc.invalidateQueries({ queryKey: ['student-enrollments', studentId] })
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      setReEnrollingId(null)
      setReEnrollRoll('')
    },
    onError: (err: Error) => notify.error(err.message || 'Failed to re-enroll'),
  })

  // WHY explicit mutation: auto-enrollment of mandatory subjects is a write operation
  // that was previously triggered implicitly on every GET request, creating phantom
  // subject assignments. It is now admin-only and manually triggered.
  const autoEnrollMutation = useMutation({
    mutationFn: (enrollmentId: string) =>
      fetchApi(`/api/student-enrollments/${enrollmentId}/auto-enroll-subjects`, { method: 'POST' }),
    onSuccess: () => {
      notify.success(L('Mandatory subjects enrolled successfully', 'المواد الإجبارية اتسجلت'))
      qc.invalidateQueries({ queryKey: ['student-enrollments', studentId] })
    },
    onError: (err: Error) => notify.error(err.message || 'Failed to auto-enroll subjects'),
  })

  // ── Handler helpers ──────────────────────────────────────────────────────

  function startEdit(e: StudentEnrollmentRow) {
    setEditingId(e.id)
    setEditForm({ rollNumber: e.rollNumber, deliveryMode: e.deliveryMode as InlineEditState['deliveryMode'] })
  }

  function handleWithdraw(e: StudentEnrollmentRow) {
    if (e.academicYear.isLocked) {
      notify.error(L('Cannot withdraw from a locked academic year.', 'مش هينفع السحب من سنة دراسية مقفولة.'))
      return
    }
    if (!confirm(`Withdraw ${e.classSection.className}-${e.classSection.sectionName} enrollment?\nHistorical attendance and marks will be preserved.`)) return
    withdrawMutation.mutate(e.id)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              {L('Academic Engine Enrollments', 'التسكين القديم')}
            </CardTitle>
            <CardDescription className="text-xs">
              {L('Section placements with full lifecycle management (edit · withdraw · re-enroll).', 'التسكين في الفصول القديمة (تعديل · سحب · إعادة).')}
            </CardDescription>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" className="gap-1 text-xs h-8 shrink-0" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="w-3.5 h-3.5" />
              {L('Add section', 'ضيف فصل')}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ── Add enrollment form ─────────────────────────────────────── */}
        {showAdd && canManage && (
          <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-indigo-800">{L('New section enrollment', 'تسكين جديد')}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-indigo-600 hover:text-indigo-800"
                onClick={() => setFilterByCampus((v) => !v)}
              >
                {filterByCampus ? 'Show all campus sections' : 'Filter by student campus'}
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{L('Class section', 'الفصل')}</Label>
              <Select value={classSectionId} onValueChange={setClassSectionId} disabled={sectionsLoading}>
                <SelectTrigger className="h-9 text-sm bg-white">
                  {sectionsLoading
                    ? <span className="flex items-center gap-1.5 text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {L('Loading sections…', 'بيحمّل الفصول…')}</span>
                    : <SelectValue placeholder={L('Select section', 'اختار الفصل')} />
                  }
                </SelectTrigger>
                <SelectContent>
                  {sections.length === 0 && !sectionsLoading ? (
                    <div className="py-4 px-3 text-center text-xs text-gray-500">
                      <p>{L('No active class sections available.', 'مفيش فصول.')}</p>
                      <Link href="/dashboard/academic-engine" className="text-indigo-600 underline font-medium mt-1 inline-block">
                        {L('Create sections in Academic Engine', 'اعمل فصول من الشاشة القديمة')}
                      </Link>
                    </div>
                  ) : (
                    sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-semibold">{s.className}-{s.sectionName}</span>
                        <span className="text-indigo-600 font-mono ml-1.5">[{s.campus?.code || 'Campus'}]</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{L('Roll number', 'رقم الجلوس')}</Label>
                <Input className="h-9 text-sm bg-white" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L('Delivery', 'الحضور')}</Label>
                <Select value={deliveryMode} onValueChange={(v) => setDeliveryMode(v as typeof deliveryMode)}>
                  <SelectTrigger className="h-9 text-sm bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PHYSICAL">{L('Physical', 'حضوري')}</SelectItem>
                    <SelectItem value="ONLINE">{L('Online', 'أونلاين')}</SelectItem>
                    <SelectItem value="HYBRID">{L('Hybrid', 'مختلط')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={!classSectionId || !rollNumber || addMutation.isPending} onClick={() => addMutation.mutate()}>
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save enrollment'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>{L('Cancel', 'إلغاء')}</Button>
            </div>
          </div>
        )}

        {/* ── Active enrollments ──────────────────────────────────────── */}
        {isLoading ? (
          <p className="text-xs text-gray-400">{L('Loading enrollments…', 'بيحمّل…')}</p>
        ) : active.length === 0 ? (
          <p className="text-xs text-gray-500">
            {L('No active section enrollments. Use', 'مفيش تسكين. استخدم')}{' '}
            <Link href="/dashboard/academic" className="text-blue-600 underline">{L('Academic Engine', 'الشاشة القديمة')}</Link>
            {' '}{L('or add a section above.', 'أو ضيف فصل فوق.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((e) => {
              const isEditing = editingId === e.id
              const isLocked  = e.academicYear.isLocked

              return (
                <li key={e.id} className="rounded-xl border bg-gray-50/80 overflow-hidden">
                  {/* Main row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {e.classSection.className} {L('— Section', '— فصل')} {e.classSection.sectionName}
                        <span className="text-gray-400 font-normal ml-1">{L('· Roll', '· جلوس')} {e.rollNumber}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {e.academicYear.name} · {e.classSection.campus.code} · {e.deliveryMode}
                      </p>
                      {e.subjectEnrollments && e.subjectEnrollments.length > 0 && (
                        <p className="text-[10px] text-gray-400 mt-1">
                          {e.subjectEnrollments.length} {L('subject(s) enrolled', 'مادة')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                      {isLocked && <Badge variant="secondary" className="text-[10px]">{L('Locked', 'مقفول')}</Badge>}
                      <Link href={`/dashboard/attendance/sections?sectionId=${e.classSection.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs h-7">{L('Attendance', 'الحضور')}</Button>
                      </Link>
                      {/* Auto-enroll button: shown when FIXED section has no subject assignments yet */}
                      {canManage && !isLocked && (!e.subjectEnrollments || e.subjectEnrollments.length === 0) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          title={L('Auto-enroll mandatory subjects for this FIXED section', 'سجّل المواد الإجبارية لوحدها')}
                          disabled={autoEnrollMutation.isPending}
                          onClick={() => autoEnrollMutation.mutate(e.id)}
                        >
                          {autoEnrollMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '+'}
                          {L('Subjects', 'المواد')}
                        </Button>
                      )}
                      {canManage && !isLocked && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-500 hover:text-indigo-600"
                            title={L('Edit roll number / delivery mode', 'عدّل رقم الجلوس / طريقة الحضور')}
                            onClick={() => isEditing ? setEditingId(null) : startEdit(e)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-slate-500 hover:text-red-600"
                            title={L('Withdraw from this section', 'اسحب من الفصل ده')}
                            disabled={withdrawMutation.isPending}
                            onClick={() => handleWithdraw(e)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline edit panel */}
                  {isEditing && canManage && (
                    <div className="border-t border-indigo-100 bg-indigo-50/40 px-3 py-2.5 flex flex-col sm:flex-row gap-2 items-end">
                      <div className="space-y-1 flex-1">
                        <Label className="text-xs">{L('Roll number', 'رقم الجلوس')}</Label>
                        <Input
                          className="h-8 text-xs bg-white"
                          value={editForm.rollNumber}
                          onChange={(ev) => setEditForm((f) => ({ ...f, rollNumber: ev.target.value }))}
                        />
                      </div>
                      <div className="space-y-1 w-40">
                        <Label className="text-xs">{L('Delivery mode', 'طريقة الحضور')}</Label>
                        <Select
                          value={editForm.deliveryMode}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, deliveryMode: v as InlineEditState['deliveryMode'] }))}
                        >
                          <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PHYSICAL">{L('Physical', 'حضوري')}</SelectItem>
                            <SelectItem value="ONLINE">{L('Online', 'أونلاين')}</SelectItem>
                            <SelectItem value="HYBRID">{L('Hybrid', 'مختلط')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          disabled={updateMutation.isPending}
                          onClick={() => updateMutation.mutate({ id: e.id, data: editForm })}
                        >
                          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          {L('Save', 'حفظ')}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* ── Historical / withdrawn enrollments ──────────────────────── */}
        {!compact && withdrawn.length > 0 && (
          <div className="pt-2 border-t border-dashed border-gray-200">
            <button
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {withdrawn.length} {L('historical enrollment', 'تسكين قديم')}{withdrawn.length !== 1 ? 's' : ''} {L('on record', 'متسجل')}
            </button>

            {showHistory && (
              <ul className="space-y-1.5 mt-2">
                {withdrawn.map((e) => (
                  <li key={e.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border border-dashed border-gray-200 bg-gray-50/40">
                    <div>
                      <p className="text-xs font-medium text-gray-600">
                        {e.classSection.className}-{e.classSection.sectionName}
                        <span className="text-gray-400 font-normal ml-1">· {e.academicYear.name}</span>
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {e.classSection.campus.code} {L('· Roll', '· جلوس')} {e.rollNumber} · {e.deliveryMode}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {e.status.toLowerCase()}
                      </Badge>

                      {/* Re-enroll only when academic year is not locked */}
                      {canManage && !e.academicYear.isLocked && (
                        reEnrollingId === e.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              className="h-7 w-24 text-xs"
                              placeholder={L('Roll no.', 'رقم الجلوس')}
                              value={reEnrollRoll}
                              onChange={(ev) => setReEnrollRoll(ev.target.value)}
                            />
                            <Select
                              value={classSectionId || e.classSection.id}
                              onValueChange={setClassSectionId}
                            >
                              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder={L('Section', 'الفصل')} /></SelectTrigger>
                              <SelectContent>
                                {sections.length > 0
                                  ? sections.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.className}-{s.sectionName}
                                    </SelectItem>
                                  ))
                                  : <SelectItem value={e.classSection.id}>
                                    {e.classSection.className}-{e.classSection.sectionName} {L('(same)', '(نفسه)')}
                                  </SelectItem>
                                }
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={!reEnrollRoll || reEnrollMutation.isPending}
                              onClick={() => reEnrollMutation.mutate({
                                sectionId: classSectionId || e.classSection.id,
                                roll: reEnrollRoll,
                              })}
                            >
                              {reEnrollMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setReEnrollingId(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs text-indigo-600 border-indigo-200"
                            onClick={() => { setReEnrollingId(e.id); setReEnrollRoll(e.rollNumber); setClassSectionId(e.classSection.id) }}
                          >
                            <RotateCcw className="w-3 h-3" />
                            {L('Re-enroll', 'سجّل تاني')}
                          </Button>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
