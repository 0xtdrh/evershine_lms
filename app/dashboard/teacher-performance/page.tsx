'use client'

/**
 * R2: instructor performance — managers see a table of their instructors (click for details); an instructor sees only
 * their own page, when the admin allows it. Numbers: attendance, ratings, renewals, complaints, grading, session reports.
 */

import { Fragment, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Award, Loader2 } from 'lucide-react'

interface Perf {
  teacher: { id: string; name: string; campus: string }
  groups: { active: number; total: number; sessionsHeld: number; coveredAsSubstitute: number }
  attendance: { pct: number | null; records: number; absent: number }
  ratings: { sessionFaces: { average: number | null; count: number; outOf: number }; parentsOnInstructor: { average: number | null; count: number; outOf: number } }
  renewal: { pct: number | null; yes: number; answered: number }
  complaints: { complaints: number; praise: number; suggestions: number }
  grading: { waiting: number; gradedInPeriod: number; averageHours: number | null }
  reports: { total: number; sent: number; withPersonalNote: number | null }
  missingAttendance: number
}

const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const show = (v: number | null | undefined, unit = '%') => (v == null ? '—' : `${v}${unit}`)

function Stat({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold ${bad ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

function Detail({ p }: { p: Perf }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label={L('Attendance of the groups', 'حضور الجروبات')} value={show(p.attendance.pct)} hint={`${p.groups.active} ${L('active groups', 'جروب شغال')} · ${p.groups.sessionsHeld} ${L('sessions', 'حصة')}`} bad={p.attendance.pct != null && p.attendance.pct < 75} />
      <Stat label={L('Session ratings (faces)', 'تقييم الحصص (الوشوش)')} value={p.ratings.sessionFaces.average == null ? '—' : `${p.ratings.sessionFaces.average} / 4`} hint={`${p.ratings.sessionFaces.count} ${L('ratings', 'تقييم')}`} bad={p.ratings.sessionFaces.average != null && p.ratings.sessionFaces.average < 2.5} />
      <Stat label={L('Parents rate the instructor', 'أولياء الأمور بيقيّموا المدرب')} value={p.ratings.parentsOnInstructor.average == null ? '—' : `${p.ratings.parentsOnInstructor.average} / 5`} hint={`${p.ratings.parentsOnInstructor.count} ${L('surveys', 'استبيان')}`} bad={p.ratings.parentsOnInstructor.average != null && p.ratings.parentsOnInstructor.average < 3.5} />
      <Stat label={L('Renewal rate', 'نسبة التجديد')} value={show(p.renewal.pct)} hint={`${p.renewal.yes} / ${p.renewal.answered} ${L('answered yes', 'قالوا أيوه')}`} bad={p.renewal.pct != null && p.renewal.pct < 60} />
      <Stat label={L('Complaints / praise', 'شكاوى / شكر')} value={`${p.complaints.complaints} / ${p.complaints.praise}`} hint={`${p.complaints.suggestions} ${L('suggestions', 'اقتراح')}`} bad={p.complaints.complaints > 0} />
      <Stat label={L('Waiting to be graded', 'مستني تصحيح')} value={String(p.grading.waiting)} hint={`${L('average grading time', 'متوسط وقت التصحيح')} ${show(p.grading.averageHours, L(' h', ' ساعة'))}`} bad={p.grading.waiting > 10 || (p.grading.averageHours ?? 0) > 72} />
      <Stat label={L('Session reports sent', 'تقارير الحصص اللي اتبعتت')} value={`${p.reports.sent} / ${p.reports.total}`} hint={`${L('with a personal note', 'فيها لمسة شخصية')} ${show(p.reports.withPersonalNote)}`} />
      <Stat label={L('Sessions without attendance', 'حصص من غير حضور')} value={String(p.missingAttendance)} bad={p.missingAttendance > 0} />
    </div>
  )
}

function SettingsLine() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['perf-settings'], queryFn: () => fetchApi<{ teacherCanSee: boolean }>('/api/teachers/performance/settings') })
  const save = useMutation({
    mutationFn: (v: boolean) => fetchApi('/api/teachers/performance/settings', { method: 'PUT', body: JSON.stringify({ teacherCanSee: v }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['perf-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return null
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={data.teacherCanSee} disabled={save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
      {L('Instructors can see their own performance page', 'المدرب يقدر يشوف صفحة أدائه')}
    </label>
  )
}

export default function TeacherPerformancePage() {
  const { data: session } = useSession()
  const { dir } = useI18n()
  const role = session?.user?.role ?? ''
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * DAY)))
  const [to, setTo] = useState(ymd(new Date()))
  const [open, setOpen] = useState<string | null>(null)
  const allowedRole = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'].includes(role)
  const { data, isLoading, error } = useQuery({ queryKey: ['teacher-performance', from, to], queryFn: () => fetchApi<{ own: boolean; rows: Perf[] }>(`/api/teachers/performance?from=${from}&to=${to}`), enabled: allowedRole, retry: false })
  if (!role) return null
  if (!allowedRole || error) return <AccessDenied title={L('Instructor performance', 'أداء المدرب')} message={error ? (error as Error).message : L("You don't have access to this page.", 'مش عندك صلاحية للصفحة دي.')} />
  const own = data?.own
  return (
    <div className="space-y-4" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Award className="h-7 w-7 text-indigo-600" /> {own ? L('My performance', 'أدائي') : L('Instructor performance', 'أداء المدربين')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Attendance, ratings, renewals, complaints, grading and session reports for the chosen period. Red = needs attention.', 'الحضور والتقييمات والتجديد والشكاوى والتصحيح وتقارير الحصص في الفترة المختارة. الأحمر = محتاج انتباه.')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        {(role === 'SUPER_ADMIN' || role === 'ADMIN') && <SettingsLine />}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : own && data?.rows[0] ? <Detail p={data.rows[0]} /> : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{L('Instructors', 'المدربين')}</CardTitle><CardDescription>{L('Click an instructor for the details.', 'اضغط على المدرب للتفاصيل.')}</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            {!data?.rows.length ? <p className="text-sm text-slate-500">{L('No instructors.', 'مفيش مدربين.')}</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr>
                  <th className="px-2 py-2 text-start">{L('Instructor', 'المدرب')}</th>
                  <th className="px-2 py-2 text-start">{L('Attendance', 'الحضور')}</th>
                  <th className="px-2 py-2 text-start">{L('Faces', 'الوشوش')}</th>
                  <th className="px-2 py-2 text-start">{L('Parents', 'أولياء الأمور')}</th>
                  <th className="px-2 py-2 text-start">{L('Renewal', 'التجديد')}</th>
                  <th className="px-2 py-2 text-start">{L('Complaints', 'الشكاوى')}</th>
                  <th className="px-2 py-2 text-start">{L('To grade', 'مستني تصحيح')}</th>
                  <th className="px-2 py-2 text-start">{L('No attendance', 'من غير حضور')}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((p) => (
                    <Fragment key={p.teacher.id}>
                      <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === p.teacher.id ? null : p.teacher.id)}>
                        <td className="px-2 py-2"><span className="font-medium text-slate-800">{p.teacher.name}</span><div className="text-xs text-slate-400">{p.teacher.campus} · {p.groups.active} {L('groups', 'جروب')}</div></td>
                        <td className={`px-2 py-2 ${p.attendance.pct != null && p.attendance.pct < 75 ? 'font-semibold text-rose-600' : ''}`}>{show(p.attendance.pct)}</td>
                        <td className="px-2 py-2">{p.ratings.sessionFaces.average ?? '—'}</td>
                        <td className="px-2 py-2">{p.ratings.parentsOnInstructor.average ?? '—'}</td>
                        <td className={`px-2 py-2 ${p.renewal.pct != null && p.renewal.pct < 60 ? 'font-semibold text-rose-600' : ''}`}>{show(p.renewal.pct)}</td>
                        <td className={`px-2 py-2 ${p.complaints.complaints ? 'font-semibold text-rose-600' : ''}`}>{p.complaints.complaints}</td>
                        <td className={`px-2 py-2 ${p.grading.waiting > 10 ? 'font-semibold text-amber-700' : ''}`}>{p.grading.waiting}</td>
                        <td className={`px-2 py-2 ${p.missingAttendance ? 'font-semibold text-rose-600' : ''}`}>{p.missingAttendance}</td>
                      </tr>
                      {open === p.teacher.id && <tr><td colSpan={8} className="bg-slate-50 p-3"><Detail p={p} /></td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
