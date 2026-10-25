'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Users, ClipboardList, Megaphone, UserCheck, Wallet,
  ClipboardCheck, BarChart2, LineChart, Target, CalendarDays,
} from 'lucide-react'
import Link from 'next/link'
import { RoleInsights } from '@/components/dashboard/RoleInsights'
import { BirthdayBanner } from '@/components/birthdays/BirthdayBanner'
import { TeacherRatingsCard } from '@/components/dashboard/TeacherRatingsCard'
import { L, useI18n } from '@/lib/i18n/client'

/** 2026-10-25: the template links (tasks & marks, exam results, daily PST scores, monthly monitoring) were replaced by the screens in use. */
const TEACHER_QUICK_LINKS = [
  {
    href: '/dashboard/teacher/students',
    icon: Users,
    get label() { return L('My students', 'طلابي') },
    get description() { return L('Students of your groups', 'طلاب جروباتك') },
    color: 'bg-indigo-50 text-indigo-700 border-indigo-100 hover:bg-indigo-100',
    iconBg: 'bg-indigo-100',
  },
  {
    href: '/dashboard/teacher/attendance',
    icon: ClipboardList,
    get label() { return L('Attendance', 'الحضور') },
    get description() { return L('Take attendance (also the sessions you cover)', 'سجّل الحضور (وكمان الحصص اللي بتغطيها)') },
    color: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100',
    iconBg: 'bg-emerald-100',
  },
  {
    href: '/dashboard/schedule',
    icon: CalendarDays,
    get label() { return L('My calendar', 'جدولي') },
    get description() { return L('Your sessions, holidays and makeup sessions', 'حصصك والإجازات والتعويضات') },
    color: 'bg-sky-50 text-sky-700 border-sky-100 hover:bg-sky-100',
    iconBg: 'bg-sky-100',
  },
  {
    href: '/dashboard/assignments',
    icon: ClipboardCheck,
    get label() { return L('Homework to grade', 'تصحيح الواجبات') },
    get description() { return L('Grade what students handed in', 'صحّح اللي الطلبة سلّموه') },
    color: 'bg-violet-50 text-violet-700 border-violet-100 hover:bg-violet-100',
    iconBg: 'bg-violet-100',
  },
  {
    href: '/dashboard/quizzes',
    icon: Target,
    get label() { return L('Quizzes', 'الكويزات') },
    get description() { return L('Results of the session quizzes', 'نتايج كويزات الحصص') },
    color: 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100',
    iconBg: 'bg-amber-100',
  },
  {
    href: '/dashboard/teacher/level-results',
    icon: BarChart2,
    get label() { return L('Level results', 'نتايج المستوى') },
    get description() { return L('Final marks of the level', 'الدرجات النهائية للمستوى') },
    color: 'bg-teal-50 text-teal-700 border-teal-100 hover:bg-teal-100',
    iconBg: 'bg-teal-100',
  },
  {
    href: '/dashboard/absence-excuses',
    icon: UserCheck,
    get label() { return L('Absence excuses', 'أعذار الغياب') },
    get description() { return L('Excuses sent by parents for your groups', 'الأعذار اللي أولياء الأمور بعتوها لجروباتك') },
    color: 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100',
    iconBg: 'bg-rose-100',
  },
  {
    href: '/dashboard/announcements',
    icon: Megaphone,
    get label() { return L('Announcements', 'الإعلانات') },
    get description() { return L('Messages to your groups and from the branch', 'رسايل لجروباتك ومن الفرع') },
    color: 'bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100',
    iconBg: 'bg-orange-100',
  },
  {
    href: '/dashboard/teacher/hr',
    icon: Wallet,
    get label() { return L('My affairs', 'شؤوني') },
    get description() { return L('Your attendance, leaves and salary (if shown)', 'حضورك وإجازاتك ومرتبك (لو ظاهر)') },
    color: 'bg-slate-50 text-slate-700 border-slate-100 hover:bg-slate-100',
    iconBg: 'bg-slate-100',
  },
]

export default function TeacherPortalIndexPage() {
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const router = useRouter()

  // 2026-10-25: students no longer use the template "leave requests" — parents send absence excuses
  const { data: pendingExcuses } = useQuery<{ excuses: unknown[] }>({
    queryKey: ['teacher-excuses-pending'],
    queryFn: () => fetchApi<{ excuses: unknown[] }>('/api/absence-excuses?status=PENDING'),
    enabled: session?.user?.role === 'TEACHER',
  })

  const pendingLeavesCount = pendingExcuses?.excuses?.length ?? 0

  // Non-teachers hitting /dashboard/teacher/* should be redirected
  useEffect(() => {
    if (session?.user && session.user.role !== 'TEACHER') {
      router.replace('/dashboard')
    }
  }, [session, router])

  const name = session?.user?.name?.split(' ')[0] ?? 'Teacher'

  return (
    <div className="p-3.5 sm:p-6 max-w-6xl mx-auto space-y-4 sm:space-y-8">
      <BirthdayBanner />
      <RoleInsights />
      <TeacherRatingsCard />
      {/* Header Banner */}
      <Card className="overflow-hidden rounded-2xl sm:rounded-[28px] bg-slate-950/95 text-white shadow-xl ring-1 ring-slate-900/10">
        <div className="p-5 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.3em] sm:tracking-[0.35em] text-slate-400">{L('Teacher Portal', 'بوابة المدرب')}</p>
              <h1 className="mt-2 sm:mt-4 text-2xl font-semibold tracking-tight text-white sm:text-4xl">
                {L('Welcome back,', 'أهلاً بيك تاني،')} {name}
              </h1>
              <p className="mt-2 sm:mt-3 max-w-2xl text-xs sm:text-sm leading-relaxed text-slate-300">
                {L('Manage your classes, student progress, announcements, and requests from a single professional portal built for classroom workflows.', 'تابع جروباتك وتقدّم الطلاب والإعلانات والطلبات من مكان واحد.')}
              </p>
            </div>
            <div className="rounded-2xl sm:rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5 text-left sm:text-right shrink-0">
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.25em] sm:tracking-[0.35em] text-slate-400">{L('Today', 'النهارده')}</p>
              <p className="mt-1 sm:mt-3 text-base sm:text-xl font-semibold text-white">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Leave Status Alert */}
      <Card className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white/90 shadow-sm">
        <div className="p-4 sm:p-6 flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.25em] text-slate-500 font-semibold">{L('Absence excuses', 'أعذار الغياب')}</p>
            <p className="mt-1 text-base sm:text-lg font-semibold text-slate-900">{pendingLeavesCount} {L(pendingLeavesCount === 1 ? 'excuse waiting for a decision' : 'excuses waiting for a decision', 'عذر مستني قرار')}</p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">{L('Excuses parents sent for sessions of your groups (an approved one is marked Excused in the attendance sheet).', 'الأعذار اللي أولياء الأمور بعتوها لحصص جروباتك (العذر المقبول بيظهر «بعذر» في كشف الحضور).')}</p>
          </div>
          <Link href="/dashboard/absence-excuses" className="w-full sm:w-auto inline-flex items-center justify-center rounded-xl sm:rounded-2xl bg-slate-900 px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-white transition hover:bg-slate-800 shrink-0">
            {L('Open absence excuses', 'افتح أعذار الغياب')}
          </Link>
        </div>
      </Card>

      {/* My Shifts Summary Card */}
      <MyShiftsSummary />

      {/* Quick Access Section */}
      <div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-[0.2em] sm:tracking-[0.24em] text-slate-500">{L('Quick access', 'اختصارات')}</h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">{L('Open the most important teacher workflows with a single tap.', 'أهم حاجات المدرب بضغطة واحدة.')}</p>
          </div>
        </div>

        <div className="mt-4 sm:mt-5 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {TEACHER_QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`group relative overflow-hidden rounded-2xl sm:rounded-[24px] border border-slate-200/80 bg-white p-4 sm:p-5 transition duration-150 hover:-translate-y-0.5 hover:shadow-lg flex items-start sm:block gap-3.5 sm:gap-0 ${link.color}`}
              aria-label={link.label}
            >
              <div className={`flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-xl sm:rounded-2xl ${link.iconBg} transition duration-150 group-hover:scale-105 shrink-0`}>
                <link.icon className="h-5 w-5" />
              </div>
              <div className="sm:mt-4 min-w-0 flex-1">
                <p className="font-semibold text-sm text-slate-900 leading-tight">{link.label}</p>
                <p className="mt-1 sm:mt-2 text-xs leading-relaxed text-slate-600">{link.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Admin Disclaimer Banner */}
      <Card className="rounded-2xl sm:rounded-[24px] border border-amber-100 bg-amber-50 p-4 sm:px-6 sm:py-5 text-amber-900 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-xs sm:text-sm">{L('Reminder — Read-only student records', 'تذكير — بيانات الطلاب للعرض بس')}</p>
            <p className="text-xs sm:text-sm text-amber-800/90 leading-relaxed">
              {L('You can view student profiles and class details here, but direct record edits are handled by the Admin team. Use', 'تقدر تشوف بيانات الطلاب والجروبات، بس التعديل بتعمله الإدارة. استخدم')} <strong>{L('Request Admin Action', 'اطلب من الإدارة')}</strong> {L('on the My Students page when follow-up is needed.', 'في صفحة طلابي لما تحتاج متابعة.')}
            </p>
          </div>
          <div className="inline-flex self-start sm:self-auto items-center gap-2 rounded-xl bg-amber-100/80 px-3 py-1.5 text-[10px] sm:text-xs font-semibold uppercase tracking-[0.15em] text-amber-900 shrink-0">
            <span>{L('Best practice', 'نصيحة')}</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── My Shifts Summary Sub-Component ─────────────────────────────────────────
const SHIFT_BADGE_CLASSES: Record<string, string> = {
  MORNING: 'bg-amber-100 text-amber-800 border-amber-200',
  EVENING: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  NIGHT: 'bg-violet-100 text-violet-800 border-violet-200',
}

function MyShiftsSummary() {
  const { data: session } = useSession()

  const { data: assignmentsRaw, isLoading } = useQuery<{
    teacher?: {
      id: string
      name: string
      email: string
      employeeId: string
      profilePicture: string | null
    }
    shifts: Array<{
      code: string
      label: string
      sections: Array<{
        classSectionId?: string
        className: string
        sectionName: string
        subject: string
        subjectCode?: string
        studentCount: number
        deliveryMode: string
        campusName?: string
        batchName?: string
      }>
    }>
    totalSections: number
    totalStudents: number
    activeShifts: string[]
    academicYear?: string
  }>({
    queryKey: ['teacher-my-assignments'],
    queryFn: () => fetchApi('/api/teacher-portal/my-assignments'),
    enabled: session?.user?.role === 'TEACHER',
  })

  const assignments = assignmentsRaw
  const teacherInitials = assignments?.teacher?.name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'T'

  if (isLoading) {
    return (
      <Card className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white/90 shadow-sm">
        <div className="p-4 sm:p-6 animate-pulse space-y-3">
          <div className="h-4 w-36 bg-slate-200 rounded" />
          <div className="h-6 w-48 bg-slate-200 rounded" />
        </div>
      </Card>
    )
  }

  if (!assignments || assignments.shifts.length === 0) return null

  return (
    <Card className="rounded-2xl sm:rounded-[24px] border border-slate-200 bg-white/90 shadow-sm overflow-hidden">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm shrink-0">
              {assignments.teacher?.profilePicture ? (
                <Image
                  src={assignments.teacher.profilePicture}
                  alt={`${assignments.teacher.name} profile`}
                  fill
                  sizes="56px"
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-900 text-sm font-bold text-white">
                  {teacherInitials}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-[0.25em] text-slate-500 font-semibold">{L('My Teaching Profile', 'ملفي كمدرب')}</p>
              <p className="mt-1 text-base sm:text-lg font-semibold text-slate-900">
                {assignments.totalSections} {L(assignments.totalSections === 1 ? 'class section' : 'class sections', 'جروب')} · {assignments.totalStudents} {L(assignments.totalStudents === 1 ? 'student' : 'students', 'طالب')}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {assignments.teacher?.name && <span>{assignments.teacher.name}</span>}
                {assignments.teacher?.employeeId && <span>{L('Employee ID:', 'الرقم الوظيفي:')} {assignments.teacher.employeeId}</span>}
                {assignments.academicYear && <span>{assignments.academicYear}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assignments.activeShifts.map((code) => (
              <Badge
                key={code}
                variant="outline"
                className={`text-[10px] sm:text-xs font-bold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full ${SHIFT_BADGE_CLASSES[code] ?? 'bg-gray-100 text-gray-700'}`}
              >
                {assignments.shifts.find((s) => s.code === code)?.label ?? code}
              </Badge>
            ))}
          </div>
        </div>

        {/* Shift breakdown */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.shifts.map((shift) => (
            <div key={shift.code} className={`rounded-xl sm:rounded-2xl border p-3.5 sm:p-4 ${SHIFT_BADGE_CLASSES[shift.code]?.replace('text-', 'border-').split(' ')[0]} bg-white`}>
              <p className="text-xs sm:text-sm font-bold text-slate-800">{shift.label}</p>
              <div className="mt-2 space-y-1.5">
                {shift.sections.slice(0, 4).map((sec, i) => (
                  <div key={i} className="text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-900">{sec.className}-{sec.sectionName}</span>
                    <span className="text-slate-400">·</span>
                    <span className="truncate max-w-[120px]">{sec.subject}</span>
                    {sec.deliveryMode !== 'PHYSICAL' && (
                      <span className="text-[9px] bg-cyan-100 text-cyan-700 px-1 py-0.5 rounded">
                        {sec.deliveryMode === 'ONLINE' ? '💻' : '🔄'}
                      </span>
                    )}
                  </div>
                ))}
                {shift.sections.length > 4 && (
                  <p className="text-[10px] text-slate-400 font-medium">+{shift.sections.length - 4} {L('more sections', 'جروبات تانية')}</p>
                )}
              </div>
              <p className="mt-2.5 text-[10px] text-slate-500 font-medium border-t pt-1.5 border-slate-100">
                {shift.sections.reduce((s, sec) => s + sec.studentCount, 0)} {L('enrolled students', 'طالب مسجّل')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
