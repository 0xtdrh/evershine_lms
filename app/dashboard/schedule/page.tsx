'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AcademyLogo } from '@/components/AcademyLogo'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { notify } from '@/lib/notify'
import { CalendarDays, CalendarOff, ChevronLeft, ChevronRight, Loader2, Printer, X } from 'lucide-react'

type Status = 'HELD' | 'MISSING' | 'SCHEDULED' | 'NOT_STARTED' | 'CANCELLED' | 'HOLIDAY'
interface Group {
  id: string
  label: string
  campus: { id: string; name: string }
  course: { id: string; name: string } | null
  track: { id: string; name: string } | null
  level: { id: string; name: string } | null
  teacher: { id: string; name: string } | null
  studentCount: number
  status: string
  notStarted: boolean
}
interface Session {
  groupId: string
  date: string
  time: string
  status: Status
  sessionNumber: number | null
  totalSessions: number
  isLastOfCycle: boolean
  isExtra?: boolean
  teacherId: string | null
  teacherName: string | null
  substitute: { name: string; confirmed: boolean } | null
  teacherAbsent: boolean
  cancelReason: string | null
  conflict: boolean
}
interface ScheduleData { from: string; to: string; today: string; groups: Group[]; sessions: Session[] }

// ── dates (YYYY-MM-DD, UTC) ─────────────────────────────────────────────────
const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => iso(new Date(D(s).getTime() + n * 86_400_000))
const startOfWeek = (s: string) => addDays(s, -D(s).getUTCDay())
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => D(s).toLocaleDateString(L('en-GB', 'ar-EG'), { timeZone: 'UTC', ...o })
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_AR = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت']
const dayName = (i: number) => L(DAYS_EN[i], DAYS_AR[i])
/** Roles that may add a holiday (the API checks the real permission, incl. overrides). */
const HOLIDAY_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']
const ALL = 'all'

function monthRange(anchor: string) {
  const first = `${anchor.slice(0, 7)}-01`
  const d = D(first)
  const last = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
  return { first, last, from: startOfWeek(first), to: addDays(startOfWeek(last), 6) }
}

const STATUS_STYLE: Record<Status, string> = {
  HELD: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  SCHEDULED: 'border-slate-200 bg-white text-slate-900 border-l-4 border-l-indigo-500',
  NOT_STARTED: 'border-dashed border-slate-300 bg-slate-50 text-slate-500',
  MISSING: 'border-amber-300 bg-amber-50 text-amber-900',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-400 line-through',
  HOLIDAY: 'border-sky-200 bg-sky-50 text-sky-700',
}

export default function GroupsSchedulePage() {
  const { data: auth } = useSession()
  useI18n() // re-render on a language switch
  const isTeacher = auth?.user?.role === 'TEACHER'
  const canAddHoliday = HOLIDAY_ROLES.includes(auth?.user?.role ?? '')
  const [holidayOpen, setHolidayOpen] = useState(false)
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(() => iso(new Date()))
  const [campus, setCampus] = useState(ALL)
  const [track, setTrack] = useState(ALL)
  const [course, setCourse] = useState(ALL)
  const [teacher, setTeacher] = useState(ALL)

  // remember the chosen view (per browser only)
  useEffect(() => { try { const v = localStorage.getItem('schedule-view'); if (v === 'month' || v === 'week') setView(v) } catch { /* ignore */ } }, [])
  useEffect(() => { try { localStorage.setItem('schedule-view', view) } catch { /* ignore */ } }, [view])

  const range = useMemo(() => {
    if (view === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 6) } }
    const m = monthRange(anchor)
    return { from: m.from, to: m.to }
  }, [view, anchor])

  const { data, isLoading, error } = useQuery({
    queryKey: ['groups-schedule', range.from, range.to],
    queryFn: () => fetchApi<ScheduleData>(`/api/groups/schedule?from=${range.from}&to=${range.to}`),
  })

  const groupsById = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g])), [data])
  const options = useMemo(() => {
    const uniq = <T extends { id: string; name: string }>(xs: (T | null | undefined)[]) =>
      [...new Map(xs.filter((x): x is T => !!x).map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name))
    const gs = (data?.groups ?? []).filter((g) => (campus === ALL || g.campus.id === campus) && (track === ALL || g.track?.id === track))
    return {
      campuses: uniq((data?.groups ?? []).map((g) => g.campus)),
      tracks: uniq((data?.groups ?? []).filter((g) => campus === ALL || g.campus.id === campus).map((g) => g.track)),
      courses: uniq(gs.map((g) => g.course)),
      teachers: uniq((data?.groups ?? []).map((g) => g.teacher)),
    }
  }, [data, campus, track])

  const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => {
    const g = groupsById.get(s.groupId)
    if (!g) return false
    if (campus !== ALL && g.campus.id !== campus) return false
    if (track !== ALL && g.track?.id !== track) return false
    if (course !== ALL && g.course?.id !== course) return false
    if (teacher !== ALL && s.teacherId !== teacher && g.teacher?.id !== teacher) return false
    return true
  }), [data, groupsById, campus, track, course, teacher])

  const byDate = useMemo(() => {
    const m = new Map<string, Session[]>()
    for (const s of sessions) m.set(s.date, [...(m.get(s.date) ?? []), s])
    return m
  }, [sessions])

  const filterText = [
    campus !== ALL ? `${L('Branch', 'الفرع')}: ${options.campuses.find((x) => x.id === campus)?.name}` : isTeacher ? null : L('All branches', 'كل الفروع'),
    track !== ALL ? `${L('Track', 'المسار')}: ${options.tracks.find((x) => x.id === track)?.name}` : null,
    course !== ALL ? `${L('Course', 'الكورس')}: ${options.courses.find((x) => x.id === course)?.name}` : null,
    teacher !== ALL ? `${L('Instructor', 'المدرب')}: ${options.teachers.find((x) => x.id === teacher)?.name}` : null,
  ].filter(Boolean).join(' · ')
  const periodText = view === 'week'
    ? `${fmt(range.from, { day: 'numeric', month: 'short' })} – ${fmt(range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : fmt(monthRange(anchor).first, { month: 'long', year: 'numeric' })
  const counts = {
    clashes: sessions.filter((s) => s.conflict).length,
    missing: sessions.filter((s) => s.status === 'MISSING').length,
    last: sessions.filter((s) => s.isLastOfCycle && s.status !== 'HELD').length,
  }

  const move = (dir: -1 | 1) => {
    if (view === 'week') return setAnchor(addDays(anchor, dir * 7))
    const d = D(`${anchor.slice(0, 7)}-01`)
    setAnchor(iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1))))
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          #schedule-print, #schedule-print * { visibility: visible !important; }
          #schedule-print { position: absolute; left: 0; top: 0; width: 100%; }
          #schedule-print .print-break-avoid { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><CalendarDays className="h-5 w-5 text-indigo-600" /> {isTeacher ? L('My calendar', 'جدولي') : L('Groups schedule', 'جدول الجروبات')}</h1>
          <p className="text-sm text-slate-500">{L('Every session on its real date, with its number, substitutes, cancellations and clashes.', 'كل حصة في يومها الحقيقي، برقمها والبديل والإلغاء والتعارضات.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(['week', 'month'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${view === v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {v === 'week' ? L('Week', 'أسبوع') : L('Month', 'شهر')}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" /> {L('Print', 'طباعة')}</Button>
          {canAddHoliday && (
            <Button size="sm" className="gap-1.5" onClick={() => setHolidayOpen(true)}><CalendarOff className="h-4 w-4" /> {L('Add holiday', 'إضافة إجازة')}</Button>
          )}
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)} aria-label={L('Previous', 'السابق')}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(iso(new Date()))}>{L('Today', 'النهارده')}</Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)} aria-label={L('Next', 'التالي')}><ChevronRight className="h-4 w-4" /></Button>
        <span className="mr-2 text-sm font-semibold text-slate-800">{periodText}</span>
        {!isTeacher && (
          <FilterSelect value={campus} onChange={(v) => { setCampus(v); setTrack(ALL); setCourse(ALL) }} all={L('All branches', 'كل الفروع')} items={options.campuses} />
        )}
        <FilterSelect value={track} onChange={(v) => { setTrack(v); setCourse(ALL) }} all={L('All tracks', 'كل المسارات')} items={options.tracks} />
        <FilterSelect value={course} onChange={setCourse} all={L('All courses', 'كل الكورسات')} items={options.courses} />
        {!isTeacher && <FilterSelect value={teacher} onChange={setTeacher} all={L('All instructors', 'كل المدربين')} items={options.teachers} />}
      </div>

      <div className="no-print flex flex-wrap gap-2 text-xs">
        <Legend className={STATUS_STYLE.HELD} text={L('Held (attendance taken)', 'اتعملت (الحضور متسجل)')} />
        <Legend className={STATUS_STYLE.SCHEDULED} text={L('Upcoming', 'جاية')} />
        <Legend className={STATUS_STYLE.NOT_STARTED} text={L('Group not started yet', 'الجروب لسه مابدأش')} />
        <Legend className={STATUS_STYLE.MISSING} text={`${L('No attendance recorded', 'الحضور مش متسجل')}${counts.missing ? ` (${counts.missing})` : ''}`} />
        <Legend className={STATUS_STYLE.CANCELLED} text={L('Cancelled', 'اتلغت')} />
        <Legend className={STATUS_STYLE.HOLIDAY} text={L('Holiday (session moved to the next day)', 'إجازة (الحصة اتأجلت لليوم اللي بعده)')} />
        <Legend className="border-rose-400 bg-rose-50 text-rose-700 ring-1 ring-rose-400" text={`${L('Instructor clash', 'تعارض للمدرب')}${counts.clashes ? ` (${counts.clashes})` : ''}`} />
        <Legend className="border-indigo-600 bg-indigo-600 text-white" text={`${L('Last session of the month', 'آخر حصة في الشهر')}${counts.last ? ` (${counts.last})` : ''}`} />
      </div>

      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {L('Loading…', 'بيحمّل…')}</p>}
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{(error as Error).message}</p>}

      {data && (
        <div id="schedule-print" className="rounded-xl bg-white">
          <div className="mb-3 hidden items-center justify-between border-b border-slate-200 pb-2 print:flex">
            <div className="flex items-center gap-3">
              <AcademyLogo variant="compact" className="h-10 w-10" />
              <div>
                <p className="text-base font-bold text-slate-900">TechNova · {isTeacher ? `${L('Calendar', 'جدول')}${auth?.user?.name ? ` ${L('of', '')} ${auth.user.name}` : ''}` : L('Groups schedule', 'جدول الجروبات')}</p>
                <p className="text-xs text-slate-600">{filterText || L('All', 'الكل')} · {view === 'week' ? L('Week', 'أسبوع') : L('Month', 'شهر')}: {periodText}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">{L('Printed', 'اتطبع')} {new Date().toLocaleString(L('en-GB', 'ar-EG'))}</p>
          </div>

          {view === 'week' ? (
            <WeekView from={range.from} today={data.today} byDate={byDate} groupsById={groupsById} isTeacher={isTeacher} />
          ) : (
            <MonthView anchor={anchor} today={data.today} byDate={byDate} groupsById={groupsById} isTeacher={isTeacher} />
          )}
          {sessions.length === 0 && <p className="py-6 text-center text-sm text-slate-500">{L('No sessions in this period', 'مفيش حصص في الفترة دي')}{filterText ? L(' for this filter', ' بالفلتر ده') : ''}.</p>}
        </div>
      )}
      {holidayOpen && <AddHolidayDialog campuses={options.campuses} onClose={() => setHolidayOpen(false)} />}
    </div>
  )
}

function FilterSelect({ value, onChange, all, items }: { value: string; onChange: (v: string) => void; all: string; items: { id: string; name: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[140px] text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function Legend({ className, text }: { className: string; text: string }) {
  return <span className={`rounded-md border px-2 py-0.5 ${className}`}>{text}</span>
}

function href(s: Session, isTeacher: boolean) {
  return isTeacher ? '/dashboard/teacher/my-schedule' : `/dashboard/groups?group=${s.groupId}`
}

function SessionCard({ s, g, compact, isTeacher }: { s: Session; g: Group | undefined; compact?: boolean; isTeacher: boolean }) {
  const cls = `${STATUS_STYLE[s.status]} ${s.conflict ? 'ring-2 ring-rose-500 bg-rose-50' : ''}`
  const number = s.sessionNumber ? `${s.sessionNumber}/${s.totalSessions}` : null
  const notes = (
    <>
      {s.conflict && <span className="font-bold text-rose-700">{L('Clash', 'تعارض')}</span>}
      {s.status === 'MISSING' && <span className="font-semibold text-amber-700">{L('No attendance', 'مفيش حضور')}</span>}
      {s.substitute && <span className="text-violet-700">{L('Sub', 'بديل')}: {s.substitute.name}{s.substitute.confirmed ? '' : L(' (waiting)', ' (مستني)')}</span>}
      {s.teacherAbsent && !s.substitute?.confirmed && s.status !== 'CANCELLED' && <span className="text-rose-600">{L('Instructor absent', 'المدرب غايب')}</span>}
      {s.status === 'CANCELLED' && s.cancelReason && <span className="inline-block">{s.cancelReason}</span>}
      {s.status === 'HOLIDAY' && <span className="font-semibold">{L('Holiday · moved', 'إجازة · اتأجلت')}</span>}
      {s.isExtra && <span className="font-semibold text-indigo-700">{L('Extra session', 'حصة إضافية')}</span>}
    </>
  )
  if (compact) {
    return (
      <Link href={href(s, isTeacher)} className={`print-break-avoid block rounded border px-1 py-0.5 text-[10px] leading-tight hover:opacity-80 ${cls}`}
        title={`${g?.label ?? ''} · ${g?.course?.name ?? ''} ${g?.level?.name ?? ''} · ${s.teacherName ?? L('no instructor', 'من غير مدرب')}`}>
        <span className="font-semibold">{s.time || '—'}</span> {g?.label}
        {number && <span className="text-slate-500"> · {number}</span>}
        {s.isLastOfCycle && s.status !== 'HELD' && <span className="ml-0.5 rounded bg-indigo-600 px-1 text-white">{L('last', 'آخر')}</span>}
        <span className="flex flex-wrap gap-x-1">{notes}</span>
      </Link>
    )
  }
  return (
    <Link href={href(s, isTeacher)} className={`print-break-avoid block rounded-lg border px-2 py-1.5 text-xs hover:opacity-80 ${cls}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold">{s.time || '—'}</span>
        {number && <span className="rounded bg-slate-900/5 px-1 text-[10px] font-semibold">{L('Session', 'حصة')} {number}</span>}
      </div>
      <p className="font-semibold">{g?.label}</p>
      <p className="text-[11px] opacity-80">{g?.course?.name} · {g?.level?.name}</p>
      <p className="text-[11px] opacity-80">{s.teacherName ?? L('No instructor', 'من غير مدرب')} · {g?.studentCount ?? 0} {L('students', 'طالب')}</p>
      {g && g.campus && <p className="text-[10px] opacity-60">{g.campus.name}</p>}
      {s.isLastOfCycle && s.status !== 'HELD' && (
        <p className="mt-0.5 inline-block rounded bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">{L('Last session · advance the group after it', 'آخر حصة · رحّل الجروب بعدها')}</p>
      )}
      <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px]">{notes}</div>
    </Link>
  )
}

function WeekView({ from, today, byDate, groupsById, isTeacher }: { from: string; today: string; byDate: Map<string, Session[]>; groupsById: Map<string, Group>; isTeacher: boolean }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7 print:grid-cols-7">
      {days.map((d, i) => (
        <div key={d} className={`min-h-[120px] rounded-lg border p-1.5 ${d === today ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200'}`}>
          <p className={`mb-1.5 text-xs font-semibold ${d === today ? 'text-indigo-700' : 'text-slate-600'}`}>
            {dayName(i)} <span className="font-normal text-slate-500">{fmt(d, { day: 'numeric', month: 'short' })}</span>
          </p>
          <div className="space-y-1.5">
            {(byDate.get(d) ?? []).map((s, k) => <SessionCard key={`${s.groupId}-${k}`} s={s} g={groupsById.get(s.groupId)} isTeacher={isTeacher} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function MonthView({ anchor, today, byDate, groupsById, isTeacher }: { anchor: string; today: string; byDate: Map<string, Session[]>; groupsById: Map<string, Group>; isTeacher: boolean }) {
  const m = monthRange(anchor)
  const days: string[] = []
  for (let d = m.from; d <= m.to; d = addDays(d, 1)) days.push(d)
  const inMonth = (d: string) => d.slice(0, 7) === m.first.slice(0, 7)
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-7 gap-px rounded-lg border border-slate-200 bg-slate-200">
        {DAYS_EN.map((d, i) => <div key={d} className="bg-slate-50 px-1.5 py-1 text-center text-xs font-semibold text-slate-600">{L(d.slice(0, 3), DAYS_AR[i])}</div>)}
        {days.map((d) => (
          <div key={d} className={`min-h-[96px] p-1 ${inMonth(d) ? 'bg-white' : 'bg-slate-50'} ${d === today ? 'ring-2 ring-inset ring-indigo-400' : ''}`}>
            <p className={`mb-0.5 text-[11px] font-semibold ${inMonth(d) ? 'text-slate-700' : 'text-slate-400'}`}>{fmt(d, { day: 'numeric' })}</p>
            <div className="space-y-0.5">
              {(byDate.get(d) ?? []).map((s, k) => <SessionCard key={`${s.groupId}-${k}`} s={s} g={groupsById.get(s.groupId)} compact isTeacher={isTeacher} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 5-B (2026-10-17): add a holiday (one day or a range) straight from the schedule; sessions on it move to the next day. */
function AddHolidayDialog({ campuses, onClose }: { campuses: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) // Cairo's date (YYYY-MM-DD)
  const [date, setDate] = useState(today)
  const [toDate, setToDate] = useState('')
  const [name, setName] = useState('')
  const [campusId, setCampusId] = useState(campuses.length === 1 ? campuses[0].id : '')
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (name.trim().length < 2) return notify.error(L('Write the holiday name', 'اكتب اسم الإجازة'))
    setSaving(true)
    try {
      await fetchApi('/api/holidays', { method: 'POST', body: JSON.stringify({ date, toDate: toDate || undefined, name: name.trim(), campusId }) })
      notify.success(L('Holiday added. Sessions on it move to the next day.', 'الإجازة اتضافت، والحصص اللي فيها اتأجلت لليوم اللي بعده.'))
      await qc.invalidateQueries({ queryKey: ['groups-schedule'] })
      onClose()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="no-print fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><CalendarOff className="h-4 w-4 text-sky-600" />{L('Add holiday', 'إضافة إجازة')}</h2>
          <button type="button" onClick={onClose} aria-label="close" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">{L('Name', 'الاسم')}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={L('e.g. Eid al-Adha', 'مثلاً: عيد الأضحى')} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-slate-600">{L('From', 'من')}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">{L('To (optional)', 'لحد (اختياري)')}</span>
            <Input type="date" value={toDate} min={date} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-600">{L('Where', 'فين')}</span>
          <select value={campusId} onChange={(e) => setCampusId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm">
            <option value="">{L('Whole company (all branches)', 'الشركة كلها (كل الفروع)')}</option>
            {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500">{L('Sessions on these days are not lost: they move to the next session day. Managing all holidays: Groups → Holidays.', 'الحصص اللي في الأيام دي مش بتضيع: بتتأجل لليوم اللي بعده. إدارة كل الإجازات: الجروبات ← الإجازات.')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{L('Cancel', 'إلغاء')}</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{L('Save', 'حفظ')}</Button>
        </div>
      </div>
    </div>
  )
}
