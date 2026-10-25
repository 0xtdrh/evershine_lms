'use client'

import { L, useI18n } from '@/lib/i18n/client'
import { useState, useEffect } from 'react'
import { GroupLessonsPanel } from '@/components/lms/GroupLessonsPanel'
import { SessionReportPanel } from '@/components/session-reports/SessionReportPanel'
import { OnlineLinkField } from '@/components/online/OnlineLinkField'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import QRScannerModal from '@/components/QRScannerModal'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  Loader2, QrCode, Download, RefreshCw, CheckCircle, ScanLine,
  ClipboardList, UserCheck, UserX, Clock, Info, Timer
} from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { cairoToday } from '@/lib/dates/cairo'

/* ─── Types ────────────────────────────────────────────────────── */
type AttStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'

interface RosterRow {
  studentEnrollmentId: string
  rollNumber: string
  student: { firstName: string; lastName: string }
  todayStatus: AttStatus | null
  excuse?: { status: string; reason: string } | null
  onlineJoinedAt?: string | null
}

interface TeacherClassRecord {
  id: string
  name: string
  section: string
  classSectionId?: string | null
  legacyClassId?: string | null
  coveringDates?: string[] | null
}

interface TeacherSectionRecord {
  id: string
  className: string
  sectionName: string
  /** days this teacher covers the group as a substitute (null = own group) */
  coveringDates?: string[] | null
}

/* ─── Status config ─────────────────────────────────────────────── */
const STATUS_CONFIG: Record<AttStatus, { label: string; icon: React.ReactNode; active: string; idle: string }> = {
  PRESENT: {
    get label() { return L('Present', 'حاضر') }, icon: <UserCheck className="w-3.5 h-3.5" />,
    active: 'bg-emerald-600 text-white border-emerald-600',
    idle:   'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
  },
  ABSENT: {
    get label() { return L('Absent', 'غايب') }, icon: <UserX className="w-3.5 h-3.5" />,
    active: 'bg-red-600 text-white border-red-600',
    idle:   'border-red-300 text-red-700 hover:bg-red-50',
  },
  LATE: {
    get label() { return L('Late', 'متأخر') }, icon: <Clock className="w-3.5 h-3.5" />,
    active: 'bg-amber-500 text-white border-amber-500',
    idle:   'border-amber-300 text-amber-700 hover:bg-amber-50',
  },
  EXCUSED: {
    get label() { return L('Excused', 'بعذر') }, icon: <CheckCircle className="w-3.5 h-3.5" />,
    active: 'bg-blue-600 text-white border-blue-600',
    idle:   'border-blue-300 text-blue-700 hover:bg-blue-50',
  },
}

/* ─── QR Countdown ─────────────────────────────────────────────── */
function QrCountdown({ expiresAt }: { expiresAt: Date }) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const calc = () => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setRemaining(diff)
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const pct  = Math.round((remaining / 1800) * 100)

  return (
    <div className="text-center space-y-2">
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${remaining > 300 ? 'bg-emerald-100 text-emerald-800' : remaining > 60 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
        <Timer className="w-3.5 h-3.5" />
        {remaining === 0 ? 'Expired' : `${mins}m ${String(secs).padStart(2, '0')}s remaining`}
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mx-auto max-w-xs">
        <div
          className={`h-full rounded-full transition-all ${pct > 30 ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/* ─── Main Page ─────────────────────────────────────────────────── */
export default function TeacherAttendancePage() {
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const qc = useQueryClient()
  const [classSectionId, setClassSectionId] = useState('')
  const [date,           setDate]           = useState(cairoToday())
  const [activeTab,      setActiveTab]      = useState<'manual' | 'qr'>('manual')
  const [statusMap,      setStatusMap]      = useState<Record<string, AttStatus>>({})
  const [qrCode,         setQrCode]         = useState<string | null>(null)
  const [qrExpiresAt,    setQrExpiresAt]    = useState<Date | null>(null)
  const [cardScannerOpen, setCardScannerOpen] = useState(false)

  /* ── Queries ── */
  const { data: teacherClassesRaw } = useQuery({
    queryKey: ['teacher-portal-classes-attendance'],
    queryFn:  async () => {
      if (session?.user?.role !== 'TEACHER') {
        return fetchApi<TeacherClassRecord[]>('/api/teacher-portal/classes')
      }

      // Attendance must submit a ClassSection ID. The legacy classes endpoint
      // can legitimately return a legacy-only assignment, which is not a
      // valid identifier for the section-scoped roster authorization check.
      const sections = await fetchApi<TeacherSectionRecord[]>('/api/teacher-portal/sections')
      return sections.map((section) => ({
        id: section.id,
        name: section.className,
        section: section.sectionName,
        classSectionId: section.id,
        legacyClassId: null,
        coveringDates: section.coveringDates ?? null,
      }))
    },
    enabled:  !!session?.user,
    staleTime: 5 * 60 * 1000,
  })

  const teacherClasses = Array.isArray(teacherClassesRaw)
    ? teacherClassesRaw
    : (teacherClassesRaw as any)?.data ?? []

  const { data: roster, isLoading, refetch } = useQuery({
    queryKey: ['enrollment-roster-teacher', classSectionId, date],
    queryFn:  () => fetchApi<{ enrollments: RosterRow[] }>(
      `/api/enrollment-attendance/roster?classSectionId=${classSectionId}&date=${date}`
    ),
    enabled: !!classSectionId,
  })

  /* Seed status map from roster */
  useEffect(() => {
    if (!roster?.enrollments?.length) { setStatusMap({}); return }
    const next: Record<string, AttStatus> = {}
    for (const row of roster.enrollments) {
      next[row.studentEnrollmentId] = row.todayStatus ?? (row.excuse?.status === 'APPROVED' ? 'EXCUSED' : 'PRESENT')
    }
    setStatusMap(next)
  }, [roster])

  /* ── Save bulk attendance ── */
  const saveMutation = useMutation({
    mutationFn: () => fetchApi('/api/enrollment-attendance', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId,
        attendanceDate: date,
        records: (roster?.enrollments ?? []).map(row => ({
          studentEnrollmentId: row.studentEnrollmentId,
          status: statusMap[row.studentEnrollmentId] ?? 'PRESENT',
        })),
      }),
    }),
    onSuccess: () => { notify.success(L('Attendance saved successfully', 'الحضور اتحفظ')); refetch(); qc.invalidateQueries({ queryKey: ['group-lessons', classSectionId] }); qc.invalidateQueries({ queryKey: ['session-report', classSectionId] }) },
    onError:   (e: Error) => notify.error(e.message),
  })

  /* ── Generate QR ── */
  const qrMutation = useMutation({
    mutationFn: () => fetchApi<any>('/api/qr-codes/generate', {
      method: 'POST',
      body: JSON.stringify({ classSectionId }),
    }),
    onSuccess: (data: any) => {
      setQrCode(data.qrCode)
      setQrExpiresAt(new Date(data.expiresAt))
      notify.success(L('QR code generated — valid for 30 minutes', 'الكود اتعمل — شغال 30 دقيقة'))
    },
    onError: (e: Error) => notify.error(e.message),
  })

  /* ── Scan a student ID card attendance credential ── */
  const cardScanMutation = useMutation({
    mutationFn: (studentQrCode: string) => fetchApi<{
      alreadyMarked?: boolean
      studentEnrollmentId: string
      student?: { firstName: string; lastName: string }
      status: AttStatus
    }>('/api/enrollment-attendance/student-card-scan', {
      method: 'POST',
      body: JSON.stringify({ classSectionId, attendanceDate: date, studentQrCode }),
    }),
    onSuccess: (data) => {
      setStatusMap((current) => ({ ...current, [data.studentEnrollmentId]: data.status }))
      void refetch()
      const name = data.student ? `${data.student.firstName} ${data.student.lastName}` : 'Student'
      notify.success(data.alreadyMarked ? `${name} was already marked present` : `${name} marked present`)
    },
    onError: (e: Error) => notify.error(e.message || 'Unable to record student-card attendance'),
  })

  /* ── Export ── */
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!classSectionId || !date) {
        throw new Error(L('Please choose the group and the date', 'اختار الجروب والتاريخ'))
      }
      const res = await fetch('/api/enrollment-attendance/teacher-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classSectionId, date }),
      })
      if (!res.ok) {
        // Try to parse error message from response
        let msg = L('Export failed', 'التصدير ماتمّش')
        try {
          const err = await res.json()
          msg = err?.message || msg
        } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      if (blob.size === 0) {
        throw new Error('No attendance data to export for this class/date')
      }
      // Try to trigger download in a user-initiated event
      const url  = window.URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `attendance_${date}.xlsx`
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      }, 100)
    },
    onSuccess: () => notify.success(L('Attendance exported', 'ملف الحضور نزل')),
    onError:   (e: Error) => notify.error(e.message || L('Export failed', 'التصدير ماتمّش')),
  })

  if (!['TEACHER', 'SUPER_ADMIN', 'ADMIN'].includes(session?.user?.role ?? '')) {
    return <div className="p-8 text-center text-gray-500">{L('You do not have permission to mark attendance.', 'مش مسموح لك تسجّل الحضور.')}</div>
  }

  const enrollments  = roster?.enrollments ?? []
  const presentCount = Object.values(statusMap).filter(s => s === 'PRESENT').length
  const absentCount  = Object.values(statusMap).filter(s => s === 'ABSENT').length
  const lateCount    = Object.values(statusMap).filter(s => s === 'LATE').length

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          {L('Attendance', 'تسجيل الحضور')}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {L('Mark attendance by hand, or let students scan a QR code.', 'سجّل الحضور بإيدك، أو خلّي الطلبة يعملوا scan لكود QR.')}
        </p>
      </div>

      {/* Guide Banner (2026-10-25: short, bilingual) */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-semibold mb-2 flex items-center gap-1.5"><Info className="w-4 h-4" /> {L('How to mark attendance', 'إزاي تسجّل الحضور')}</p>
        <ol className="list-decimal ps-4 space-y-0.5 text-xs">
          <li>{L('Choose the group and the date.', 'اختار الجروب والتاريخ.')}</li>
          <li>{L('For each student tap Present / Absent / Late / Excused (an approved excuse is filled in for you).', 'لكل طالب دوس حاضر / غايب / متأخر / بعذر (العذر المقبول بيتعلّم لوحده).')}</li>
          <li>{L('Press Save. Or show the QR code: students who scan it are marked present.', 'دوس «احفظ». أو اعرض كود QR: اللي يعمله scan بيتسجل حاضر.')}</li>
        </ol>
        <p className="mt-2 text-xs">{L('Covering for another instructor? The group appears here on the day you cover it.', 'بتغطي مكان مدرب تاني؟ الجروب بيظهر هنا يوم الحصة اللي بتغطيها.')}</p>
      </div>

      {/* Section + Date selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L('Select Class &amp; Date', 'الجروب والتاريخ')}</CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{L('Class Section', 'الجروب')} <span className="text-red-500">*</span></Label>
            <Select value={classSectionId} onValueChange={v => { setClassSectionId(v); setQrCode(null) }}>
              <SelectTrigger><SelectValue placeholder={L('Choose section', 'اختار الجروب')} /></SelectTrigger>
              <SelectContent>
                {teacherClasses.map((item) => {
                  const value = item.classSectionId ?? item.legacyClassId ?? item.id
                  return (
                    <SelectItem key={value} value={value}>
                      {item.name} - {item.section || ''}{item.coveringDates?.length ? ` · ${L('substitute', 'بديل')} ${item.coveringDates.join('، ')}` : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{L('Date', 'التاريخ')}</Label>
            <DateInput
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {classSectionId && <OnlineLinkField groupId={classSectionId} />}
      {classSectionId && <GroupLessonsPanel groupId={classSectionId} />}
      {classSectionId && <SessionReportPanel groupId={classSectionId} date={date} />}

      {classSectionId && (
        <>
          {/* Tab switcher */}
          <div className="flex rounded-lg border overflow-hidden w-fit">
            {(['manual', 'qr'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 text-sm font-medium flex items-center gap-2 transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {tab === 'manual' ? <><ClipboardList className="w-4 h-4" /> {L('By hand', 'بالإيد')}</> : <><QrCode className="w-4 h-4" /> {L('QR Code', 'كود QR')}</>}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => setCardScannerOpen(true)}
            disabled={cardScanMutation.isPending}
            className="gap-2"
          >
            <ScanLine className="w-4 h-4" /> {L('Scan student card', 'scan كارنيه الطالب')}
          </Button>

          {/* ── MANUAL TAB ── */}
          {activeTab === 'manual' && (
            <div className="space-y-4">
              {/* Summary bar */}
              {enrollments.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: L('Present', 'حاضر'), count: presentCount, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
                    { label: L('Absent', 'غايب'),  count: absentCount,  cls: 'bg-red-50 border-red-200 text-red-800' },
                    { label: L('Late', 'متأخر'),    count: lateCount,    cls: 'bg-amber-50 border-amber-200 text-amber-800' },
                  ].map(({ label, count, cls }) => (
                    <div key={label} className={`rounded-lg border p-3 text-center ${cls}`}>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs font-medium mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick-mark all buttons */}
              {enrollments.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-gray-500 font-medium">{L('Mark all as:', 'علّم الكل:')}</span>
                  {(['PRESENT', 'ABSENT'] as AttStatus[]).map(st => {
                    const cfg = STATUS_CONFIG[st]
                    return (
                      <button
                        key={st}
                        onClick={() => {
                          const next: Record<string, AttStatus> = {}
                          enrollments.forEach(r => { next[r.studentEnrollmentId] = st })
                          setStatusMap(next)
                        }}
                        className={`px-3 py-1 rounded-md border text-xs font-medium flex items-center gap-1 transition-colors ${cfg.idle}`}
                      >
                        {cfg.icon} {cfg.label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Roster */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">
                    {L('Students', 'الطلبة')}
                    {enrollments.length > 0 && (
                      <span className="ms-2 text-sm font-normal text-gray-500">
                        ({enrollments.length})
                      </span>
                    )}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="gap-1">
                    {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {L('Refresh', 'تحديث')}
                  </Button>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <p className="text-sm text-gray-400">{L('Loading roster…', 'بيحمّل الطلبة…')}</p>
                  ) : enrollments.length === 0 ? (
                    <p className="text-sm text-amber-700">{L('No active enrollments in this section.', 'مفيش طلبة في الجروب ده.')}</p>
                  ) : (
                    <div className="space-y-2">
                      {enrollments.map(row => {
                        const current = statusMap[row.studentEnrollmentId] ?? 'PRESENT'
                        return (
                          <div
                            key={row.studentEnrollmentId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 hover:bg-gray-50 transition-colors"
                          >
                            <div>
                              <p className="font-medium text-sm">
                                {row.student.firstName} {row.student.lastName}
                              </p>
                              <p className="text-xs text-gray-500">{L('No.', 'رقم')} {row.rollNumber}</p>
                              {row.onlineJoinedAt && <p className="mt-1 text-xs text-emerald-700">🟢 {L('Joined online', 'دخل أونلاين')} {new Date(row.onlineJoinedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>}
                              {row.excuse && (
                                <p className={`mt-1 text-xs ${row.excuse.status === 'APPROVED' ? 'text-indigo-700' : 'text-amber-700'}`}>
                                  {row.excuse.status === 'APPROVED' ? L('Excused', 'بعذر') : L('Excuse waiting for approval', 'عذر مستني الموافقة')}: {row.excuse.reason}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              {(Object.keys(STATUS_CONFIG) as AttStatus[]).map(st => {
                                const cfg = STATUS_CONFIG[st]
                                const isActive = current === st
                                return (
                                  <button
                                    key={st}
                                    onClick={() => setStatusMap(m => ({ ...m, [row.studentEnrollmentId]: st }))}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-all ${isActive ? cfg.active : cfg.idle}`}
                                    title={cfg.label}
                                  >
                                    {cfg.icon}
                                    <span className="hidden sm:inline">{cfg.label}</span>
                                    <span className="sm:hidden">{cfg.label[0]}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Action row */}
              {enrollments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    className="gap-2 bg-blue-600 hover:bg-blue-700"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    {L('Save attendance', 'احفظ الحضور')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => exportMutation.mutate()}
                    disabled={exportMutation.isPending}
                    className="gap-2"
                  >
                    {exportMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {L('Export Excel', 'صدّر Excel')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── QR TAB ── */}
          {activeTab === 'qr' && (
            <div className="space-y-4">
              <Card className="border-indigo-200 bg-indigo-50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-indigo-600" />
                    QR Code Attendance
                  </CardTitle>
                  <CardDescription>
                    Generate a QR code and display it on the board. Students scan it to mark themselves present.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {!qrCode ? (
                    <div className="text-center space-y-4">
                      <div className="w-48 h-48 bg-white border-2 border-dashed border-indigo-300 rounded-xl mx-auto flex items-center justify-center">
                        <QrCode className="w-16 h-16 text-indigo-200" />
                      </div>
                      <p className="text-sm text-indigo-700">{L('No QR code generated yet.', 'لسه ماعملتش كود QR.')}</p>
                      <Button
                        onClick={() => qrMutation.mutate()}
                        disabled={qrMutation.isPending}
                        className="gap-2 bg-indigo-600 hover:bg-indigo-700"
                      >
                        {qrMutation.isPending
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <QrCode className="w-4 h-4" />
                        }
                        Generate QR Code
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-center">
                        <img
                          src={qrCode}
                          alt={L('Attendance QR Code', 'كود QR للحضور')}
                          className="border-4 border-indigo-600 p-3 bg-white rounded-xl shadow-lg w-56 h-56 object-contain"
                        />
                      </div>
                      {qrExpiresAt && <QrCountdown expiresAt={qrExpiresAt} />}
                      <div className="rounded-lg bg-white border border-indigo-200 p-3 text-sm text-indigo-800 space-y-1">
                        <p className="font-semibold">{L('📋 Instructions for students:', '📋 للطلبة:')}</p>
                        <ol className="list-decimal pl-4 text-xs space-y-0.5">
                          <li>{L('Open the TechNova student app or portal.', 'افتح بوابة الطالب.')}</li>
                          <li>Tap <strong>{L('Scan QR', L('Scan QR', 'Scan QR'))}</strong> {L('on the attendance screen.', 'في شاشة الحضور.')}</li>
                          <li>{L('Point your camera at this QR code.', 'وجّه الكاميرا للكود.')}</li>
                          <li>{L('Your attendance will be marked automatically.', 'حضورك هيتسجل لوحده.')}</li>
                        </ol>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => { setQrCode(null); setQrExpiresAt(null) }}
                        >
                          Generate New Code
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 gap-2"
                          onClick={() => refetch()}
                        >
                          <RefreshCw className="w-4 h-4" /> Refresh Roster
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Who has scanned */}
              {enrollments.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{L('Scanned / Marked Status', 'مين اتسجل')}</CardTitle>
                    <CardDescription>{L('Students who scanned the QR are marked Present automatically. Mark the rest manually.', 'اللي عمل scan اتسجل حاضر لوحده. علّم الباقي بإيدك.')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {enrollments.map(row => {
                        const st = statusMap[row.studentEnrollmentId] ?? row.todayStatus
                        const cfg = st ? STATUS_CONFIG[st as AttStatus] : null
                        return (
                          <div key={row.studentEnrollmentId} className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-gray-50">
                            <div>
                              <p className="text-sm font-medium">{row.student.firstName} {row.student.lastName}</p>
                              <p className="text-xs text-gray-500">{L('No.', 'رقم')} {row.rollNumber}</p>
                            </div>
                            {cfg ? (
                              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border flex items-center gap-1 ${STATUS_CONFIG[st as AttStatus].active}`}>
                                {cfg.icon} {cfg.label}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 italic">{L('Not marked', 'لسه')}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending}
                        className="gap-2 bg-blue-600 hover:bg-blue-700"
                      >
                        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save All Attendance
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      <QRScannerModal
        open={cardScannerOpen}
        onClose={() => setCardScannerOpen(false)}
        onDetected={(code) => {
          if (!cardScanMutation.isPending) cardScanMutation.mutate(code)
        }}
      />
    </div>
  )
}
