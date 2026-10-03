'use client'

import { useState, useRef } from 'react'
import { ParentRenewalsCard } from '@/components/portal/ParentRenewalsCard'
import { ParentWalletCard } from '@/components/portal/ParentWalletCard'
import { ParentRatingsCard } from '@/components/portal/ParentRatingsCard'
import { ChildExcusesCard } from '@/components/portal/ChildExcusesCard'
import { AttendanceTimeline } from '@/components/attendance/AttendanceTimeline'
import { StudentReportsList } from '@/components/reports/StudentReportsList'
import { BirthdayBanner } from '@/components/birthdays/BirthdayBanner'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { AccessDenied } from '@/components/AccessDenied'
import { Users, ClipboardCheck, BarChart2, Calendar, CreditCard, Loader2, Download, Plus, Send, BookOpen, Clock, Upload, Trophy, Award, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadPdf } from '@/lib/pdf'
import { notify } from '@/lib/notify'
import Link from 'next/link'
import { FeePaymentDialog } from '@/components/features/guardian/FeePaymentDialog'
import { MonitoringReportPanel } from '@/components/academic/MonitoringReportPanel'
import ResultReportCard, { type ReportCardResult, type ReportCardStudent } from '@/components/academic/ResultReportCard'
import { TaskMarksPanel, type TaskResultItem } from '@/components/academic/TaskMarksPanel'
import { MonthlyMonitoringGrid } from '@/components/academic/MonthlyMonitoringGrid'
import { getDisplayedPosition, type ResultCardConfig } from '@/lib/academic/result-card-config'

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

type Child = {
  id: string
  firstName: string
  lastName: string
  fatherName?: string
  registrationNumber: string
  rollNumber: string | null
  profilePicture: string | null
  shift: string | null
  deliveryMode: string | null
  campus: { name: string }
  batch: { name: string } | null
  house: { name: string; color: string } | null
  class: { name: string; shift: string | null } | null
}

type ChildAcademic = {
  student: Child
  activeYear: { name: string } | null
  enrollmentId: string | null
  enrollment: {
    rollNumber: string
    deliveryMode: string
    classSection: {
      className: string
      sectionName: string
      shift?: { code: string }
    }
    subjectEnrollments: Array<{
      subjectOffering: { subject: { name: string }; teacher?: { firstName: string; lastName: string } }
    }>
  } | null
  attendance: {
    summary: { present: number; absent: number; late: number; attendancePct: number | null }
    records: Array<{ attendanceDate: string; status: string }>
  }
  results: Array<{ subjectName: string; percentage: number; grade: string; isPassed: boolean }>
  // Enhanced declared results — mirrors DeclaredResult from student portal
  declaredResults: Array<{
    termResultId: string
    examSessionId: string
    examSessionLabel: string
    sectionLabel: string
    shiftName: string | null
    overallPercentage: number
    grade: string
    classPosition: number | null
    manualPosition: number | null
    resultCardConfig?: ResultCardConfig
    performanceBatch: string
    teacherRemarks: string | null
    customFields: Array<{ label: string; value: string }>
    declaredAt: string | null
    subjects: Array<{
      subjectId: string
      subjectName: string
      subjectCode: string
      totalMarks: number
      obtainedMarks: number
      percentage: number
      grade: string
      resultStatus: string
      isPassed: boolean
      isAbsent: boolean
      isNotApplicable: boolean
      remarks: string | null
      performanceBatch?: string | null
    }>
  }>
  taskResults: Array<{
    id: string
    taskId: string
    title: string
    type: string
    dueDate: string | null
    maxMarks: number
    obtainedMarks: number
    percentage: number
    remarks: string | null
    subjectName: string
    subjectCode: string | null
    classLabel: string
    shiftName: string | null
    updatedAt: string
  }>
  overallPercentage: number | null
  timetable: Array<{
    dayOfWeek: number
    startTime: string
    endTime: string
    subjectOffering: { subject: { name: string } }
    teacher: { firstName: string; lastName: string }
  }>
  feeInvoices: Array<{
    id: string
    challanNumber: string
    month: string
    totalAmount: number
    paidAmount: number
    status: string
    dueDate: string
    penaltyAmount: number
    proofStatus: string | null
  }>
  monitoringReports: {
    daily: Array<{ date: string; courseName: string; remarks: string | null; grade: string | null; highlight: string | null }>
    monthly: Array<{
      id: string
      month: number
      year: number
      declaredAt: string | null
      columns: Array<{ id: string; label: string; type: 'COURSE' | 'CUSTOM' }>
      student: {
        courseMarks: Record<string, { totalMarks: number; obtainedMarks: number }>
        customValues: Record<string, string>
        remarks: string
        totalMarks: number
        obtainedMarks: number
        percentage: number
        performanceBatch: string
        rank: number
      }
    }>
  }
}

type ChildLeave = {
  id: string
  startDate: string
  endDate: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: string
  remarks: string | null
  createdAt: string
}

export default function MyChildrenPage() {
  const { data: session, status } = useSession()
  const qc = useQueryClient()
  const [selectedChildId, setSelectedChildId] = useState('')
  // Per-session download state: null = idle, string = termResultId being downloaded
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  
  // Payment Proof Modal State
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<ChildAcademic['feeInvoices'][number] | null>(null)

  const role = session?.user?.role
  const allowed = role === 'PARENT' || role === 'GUARDIAN'

  const { data: children, isLoading: loadingChildren } = useQuery({
    queryKey: ['guardian-children'],
    queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'),
    enabled: allowed,
  })

  const childId = selectedChildId || children?.[0]?.id || ''



  const { data: academic, isLoading: loadingAcademic } = useQuery({
    queryKey: ['guardian-child-academic', childId],
    queryFn: () => fetchApi<ChildAcademic>(`/api/guardian-portal/children/${childId}/academic`),
    enabled: !!childId && allowed,
  })


  if (status === 'loading') return null
  if (!allowed) {
    return (
      <AccessDenied
        title="My Children"
        message="Parents and guardians can monitor linked students' attendance, results, and fees here."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users className="w-7 h-7 text-emerald-600" />
          My Children
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Monitor academic progress, attendance, results, and fee status for your linked students.
        </p>
      </div>

      <BirthdayBanner />
      <ParentRatingsCard />
      <ParentRenewalsCard />
      <ParentWalletCard />

      {loadingChildren ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading children…
        </div>
      ) : (children ?? []).length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-gray-600">
            No students are linked to your account. Please contact the school office to link your child.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Child Selector ───────────────────────────────────────── */}
          <div className="flex flex-wrap gap-3">
            {(children ?? []).map((c) => {
              const initials = `${c.firstName[0]}${c.lastName[0]}`.toUpperCase()
              const isSelected = childId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedChildId(c.id)}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50 shadow-md'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:shadow-sm'
                  }`}
                >
                  {c.profilePicture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.profilePicture} alt={c.firstName} className="h-10 w-10 rounded-xl object-cover" />
                  ) : (
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${
                      isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className={`font-bold text-sm truncate ${isSelected ? 'text-emerald-800' : 'text-slate-800'}`}>
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{c.registrationNumber}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {loadingAcademic ? (
            <div className="flex items-center gap-2 text-gray-500 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading academic records…
            </div>
          ) : academic ? (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="attendance">Attendance</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
                <TabsTrigger value="fees">Fees</TabsTrigger>
                <TabsTrigger value="excuses">Absence excuse</TabsTrigger>
                <TabsTrigger value="reports">Reports</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                {/* ── Premium Child Hero Card ─────────────────────────── */}
                {(() => {
                  const selectedChild = (children ?? []).find((c) => c.id === childId)
                  const cInitials = selectedChild ? `${selectedChild.firstName[0]}${selectedChild.lastName[0]}`.toUpperCase() : ''
                  const cShift: string | null = null // session shift is switched off (TechNova)
                  return (
                    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 shadow-xl">
                      <div className="pointer-events-none absolute -top-8 -right-8 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
                      <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-teal-400/10 blur-2xl" />

                      <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
                        <div className="shrink-0">
                          {selectedChild?.profilePicture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selectedChild.profilePicture} alt={selectedChild.firstName} className="h-20 w-20 rounded-2xl object-cover ring-4 ring-white/20" />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-700 text-2xl font-black text-white ring-4 ring-white/20">
                              {cInitials}
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h2 className="text-xl font-black text-white">
                            {academic.student.firstName} {academic.student.lastName}
                          </h2>
                          <p className="text-emerald-300 text-sm mt-0.5">
                            {academic.activeYear?.name ?? 'No active year'} · {academic.student.campus.name}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {academic.enrollment && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white border border-white/10">
                                <BookOpen className="h-3.5 w-3.5 text-emerald-300" />
                                {academic.enrollment.classSection.className}-{academic.enrollment.classSection.sectionName}
                              </span>
                            )}
                            {cShift && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white border border-white/10">
                                <Clock className="h-3.5 w-3.5 text-amber-300" />
                                {cShift} Shift
                              </span>
                            )}
                            {academic.enrollment?.deliveryMode && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white border border-white/10">
                                {academic.enrollment.deliveryMode}
                              </span>
                            )}
                          </div>
                        </div>

                        {academic.enrollment?.rollNumber && (
                          <div className="shrink-0 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Roll No.</p>
                            <p className="text-2xl font-black text-white">{academic.enrollment.rollNumber}</p>
                          </div>
                        )}
                      </div>

                      {/* Stats bar */}
                      <div className="grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 sm:grid-cols-4">
                        {[
                          { label: 'Attendance', value: academic.attendance.summary.attendancePct != null ? `${academic.attendance.summary.attendancePct}%` : '—' },
                          { label: 'Subjects', value: academic.enrollment?.subjectEnrollments?.length ?? '—' },
                          { label: 'Avg. Result', value: academic.overallPercentage != null ? `${academic.overallPercentage}%` : '—' },
                          { label: 'Invoices', value: academic.feeInvoices?.length ?? 0 },
                        ].map(({ label, value }) => (
                          <div key={label} className="px-4 py-3 text-center">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">{label}</p>
                            <p className="mt-0.5 text-sm font-bold text-white">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Enrolled subjects list */}
                {academic.enrollment && (academic.enrollment.subjectEnrollments ?? []).length > 0 && (
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-indigo-600" /> Enrolled Subjects
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {academic.enrollment.subjectEnrollments.map((se, idx) => (
                          <div key={idx} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2.5 hover:bg-indigo-50/30 transition-colors">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-black text-indigo-700">
                              {se.subjectOffering.subject.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{se.subjectOffering.subject.name}</p>
                              {se.subjectOffering.teacher && (
                                <p className="text-[11px] text-slate-400 truncate">
                                  {se.subjectOffering.teacher.firstName} {se.subjectOffering.teacher.lastName}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {academic.timetable.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="w-4 h-4" /> Timetable
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      {academic.timetable.map((t) => (
                        <div key={`${t.dayOfWeek}-${t.startTime}`} className="flex justify-between border-b py-1">
                          <span>
                            {DAY_NAMES[t.dayOfWeek]} {t.startTime}–{t.endTime}
                          </span>
                          <span>{t.subjectOffering.subject.name}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="attendance" className="mt-4">
                <AttendanceTimeline studentId={childId} />
              </TabsContent>

              <TabsContent value="results" className="mt-4 space-y-4">
                {/* ── Premium declared-results accordion ── */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <BarChart2 className="w-5 h-5 text-purple-600" />
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Declared Exam Results</h3>
                      <p className="text-xs text-slate-500">
                        Official marks sheets published and verified by the administration.
                      </p>
                    </div>
                  </div>

                  {(() => {
                    const declaredResults = academic.declaredResults ?? []
                    if (declaredResults.length === 0) {
                      return (
                        <Card>
                          <CardContent className="pt-12 pb-12">
                            <div className="text-center">
                              <Trophy className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                              <h4 className="text-sm font-bold text-slate-900">No Declared Results Found</h4>
                              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                                Results for your child have not been declared yet.
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    }

                    const cardStudent: ReportCardStudent = {
                      firstName: academic.student.firstName,
                      lastName: academic.student.lastName,
                      fatherName: academic.student.fatherName,
                      registrationNumber: academic.student.registrationNumber,
                      rollNumber: academic.student.rollNumber,
                      profilePicture: academic.student.profilePicture,
                      campus: academic.student.campus,
                      batch: academic.student.batch,
                    }

                    async function handleDownload(sessionResult: ReportCardResult) {
                      const el = cardRefs.current[sessionResult.termResultId]
                      if (!el) {
                        notify.error('Please expand the result card first, then try downloading again.')
                        return
                      }
                      setDownloadingId(sessionResult.termResultId)
                      try {
                        await downloadPdf({
                          element: el,
                          filename: `${academic.student.firstName}_${sessionResult.examSessionLabel.replace(/\s+/g, '_')}-ReportCard`,
                          orientation: 'portrait',
                          format: 'a4',
                          scale: 3,
                        })
                        notify.success('Report card downloaded successfully.')
                      } catch (e) {
                        notify.error(e instanceof Error ? e.message : 'Download failed.')
                      } finally {
                        setDownloadingId(null)
                      }
                    }

                    return declaredResults.map((sessionResult) => {
                      const isExpanded = expandedSession === sessionResult.termResultId
                      const isDownloading = downloadingId === sessionResult.termResultId

                      const batchColorClass =
                        sessionResult.performanceBatch === 'Nova Stars'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : sessionResult.performanceBatch === 'Quaid'
                          ? 'bg-blue-100 text-blue-800 border-blue-200'
                          : sessionResult.performanceBatch === 'Iqbal'
                          ? 'bg-amber-100 text-amber-800 border-amber-200'
                          : 'bg-rose-100 text-rose-800 border-rose-200'

                      return (
                        <div
                          key={sessionResult.termResultId}
                          className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm"
                        >
                          <div
                            className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gradient-to-r from-slate-50 to-white cursor-pointer hover:from-slate-100/60 transition-colors border-b"
                            onClick={() => setExpandedSession(isExpanded ? null : sessionResult.termResultId)}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                                <Award className="w-5 h-5 text-purple-600" />
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                                  {sessionResult.examSessionLabel}
                                </h4>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  {sessionResult.sectionLabel}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 ml-auto">
                              <div className="text-right">
                                <span className="text-xl font-black text-slate-900">
                                  {sessionResult.overallPercentage.toFixed(1)}%
                                </span>
                                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                                  <Badge className={`${batchColorClass} text-[10px] font-bold border py-0`}>
                                    {sessionResult.performanceBatch}
                                  </Badge>
                                  {getDisplayedPosition(sessionResult.resultCardConfig, sessionResult.classPosition, sessionResult.manualPosition) !== null && (
                                    <Badge className="bg-slate-900 hover:bg-slate-900 text-white text-[10px] font-bold py-0">
                                      Rank #{getDisplayedPosition(sessionResult.resultCardConfig, sessionResult.classPosition, sessionResult.manualPosition)}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 text-xs h-8 font-semibold flex-shrink-0"
                                disabled={isDownloading}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (!isExpanded) {
                                    setExpandedSession(sessionResult.termResultId)
                                    setTimeout(() => handleDownload(sessionResult as ReportCardResult), 300)
                                  } else {
                                    handleDownload(sessionResult as ReportCardResult)
                                  }
                                }}
                              >
                                {isDownloading ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                                PDF
                              </Button>

                              {isExpanded ? (
                                <ChevronUp className="h-5 w-5 text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="p-4 sm:p-6 bg-slate-50/40">
                              <ResultReportCard
                                ref={(el) => { cardRefs.current[sessionResult.termResultId] = el }}
                                result={sessionResult as ReportCardResult}
                                student={cardStudent}
                                sessionName={academic.activeYear?.name}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })
                  })()}
                </div>

                {/* ── Task & Assignment Marks ─────────────────────────── */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5 text-violet-600" />
                    <div>
                      <h3 className="text-base font-bold text-slate-900">Assignments &amp; Task Marks</h3>
                      <p className="text-xs text-slate-500">
                        Subject-wise breakdown of all graded tasks assigned by the teacher.
                      </p>
                    </div>
                  </div>
                  <TaskMarksPanel taskResults={(academic.taskResults as TaskResultItem[])} />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ClipboardCheck className="w-5 h-5 text-indigo-600" />
                      Monitoring Reports
                    </CardTitle>
                    <CardDescription>Daily feedback is visible after teacher save; monthly reports are visible after declaration.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-800">Recent daily monitoring</h3>
                      {academic.monitoringReports.daily.length === 0 ? <p className="text-sm text-gray-500">No daily monitoring entries yet.</p> : (
                        <div className="space-y-2">
                          {academic.monitoringReports.daily.map((entry, index) => (
                            <div key={`${entry.date}-${entry.courseName}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                              <div><p className="font-medium">{entry.courseName}</p><p className="text-xs text-slate-500">{new Date(entry.date).toLocaleDateString('en-GB')} · Grade: {entry.grade ?? '—'} · {entry.highlight === 'STAR_OF_THE_DAY' ? 'Star of the Day' : entry.highlight === 'POOR' ? 'Poor' : 'No highlight'}</p></div>
                              <p className="max-w-md text-slate-600">{entry.remarks || '—'}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-600" />
                        Declared Monthly Performance Sheets
                      </h3>
                      {academic.monitoringReports.monthly.length === 0 ? (
                        <p className="text-sm text-slate-500 bg-slate-50 border border-dashed rounded-lg p-6 text-center">
                          No monthly monitoring report has been declared yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {academic.monitoringReports.monthly.map((report) => (
                            <MonthlyMonitoringGrid key={report.id} report={report} />
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="monitoring" className="mt-4">
                <MonitoringReportPanel
                  endpoint={`/api/guardian-portal/children/${childId}/monitoring`}
                  title={`${academic.student.firstName}'s Academic Monitoring`}
                />
              </TabsContent>

              <TabsContent value="fees" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-blue-600" />
                      Fee Challans
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {academic.feeInvoices.length === 0 ? (
                      <p className="text-gray-500">No fee records.</p>
                    ) : (
                      academic.feeInvoices.map((inv) => (
                        <div
                          key={inv.challanNumber}
                          className="flex flex-wrap justify-between items-center border rounded p-3 gap-2"
                        >
                          <div>
                            <p className="font-medium">{inv.month}</p>
                            <p className="text-xs text-gray-500">{inv.challanNumber}</p>
                          </div>
                          <div className="text-right">
                            <p>
                              EGP {Number(inv.paidAmount)} / {Number(inv.totalAmount)}
                            </p>
                            <Badge 
                              variant={
                                inv.status === 'PAID' ? 'default' :
                                inv.status === 'OVERDUE' ? 'destructive' : 
                                inv.status === 'CANCELLED' ? 'secondary' : 'default'
                              }
                            >
                              {inv.status}
                            </Badge>
                            {Number(inv.penaltyAmount) > 0 && (
                              <p className="text-xs text-red-600">Penalty: EGP {inv.penaltyAmount}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            <Link
                              href={`/dashboard/fees/${inv.id}`}
                              className="text-xs text-blue-600 hover:underline text-center border border-blue-200 px-3 py-1 rounded"
                            >
                              View challan
                            </Link>
                            
                            {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                              inv.proofStatus === 'PENDING' ? (
                                <Badge variant="outline" className="flex items-center gap-1 text-[10px]">
                                  <Clock className="w-3 h-3" /> Awaiting Approval
                                </Badge>
                              ) : (
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setSelectedInvoice(inv)
                                    setPaymentDialogOpen(true)
                                  }}
                                >
                                  <Upload className="w-3 h-3 mr-1" />
                                  Upload Proof
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="excuses" className="mt-4">
                <ChildExcusesCard studentId={childId} childName={`${academic.student?.firstName ?? ''}`} />
              </TabsContent>

              <TabsContent value="reports" className="mt-4">
                <StudentReportsList studentId={childId} />
              </TabsContent>
            </Tabs>
          ) : null}
        </>
      )}

      {/* Payment Upload Modal */}
      <FeePaymentDialog 
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        studentId={childId}
        invoice={selectedInvoice}
      />
    </div>
  )
}
