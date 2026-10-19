'use client'

/**
 * LMS analytics on the LMS hub (owner 2026-10-11): numbers of a period, groups table, students who need follow-up
 * (WhatsApp to the parent, written to the contact log), hardest questions, weekly activity. Data: /api/lms/analytics.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle, ArrowUpDown, BarChart3, Loader2, MessageCircle } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

type Opt = { id: string; name: string }
interface GroupRow { id: string; label: string; campus: string; course: string; level: string; teachers: string[]; students: number; openPct: number | null; onTimePct: number | null; latePct: number | null; missingPct: number | null; homeworkDue: number; homeworkAvg: number | null; quizAvg: number | null; pending: number; gradingHours: number | null; hasCurriculum: boolean; weak: string[] }
type Reason = 'MISSED_HOMEWORK' | 'LOW_QUIZZES' | 'INACTIVE'
interface Data {
  options: { campuses: Opt[]; tracks: Opt[]; courses: (Opt & { trackId: string | null })[]; levels: (Opt & { subjectId: string | null })[]; teachers: Opt[] }
  truncated: boolean
  summary: { groups: number; students: number; openPct: number | null; homeworkDue: number; onTimePct: number | null; latePct: number | null; missingPct: number | null; homeworkAvg: number | null; quizAvg: number | null; gradingHours: number | null; pending: number }
  groups: GroupRow[]
  risk: { studentId: string; name: string; reg: string; groupId: string; groupLabel: string; reasons: Reason[]; guardian: { id: string; name: string; phone: string } | null }[]
  hard: { blockId: string; quiz: string; level: string; id: string; textEn: string; type: string; answered: number; percentCorrect: number | null; commonWrong: string | null }[]
  weeks: { week: string; lessons: number; homework: number; quizzes: number }[]
}

const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const ALL = '__all'
const show = (v: number | null, unit = '%') => (v == null ? '—' : `${v}${unit}`)
const waNumber = (phone: string) => {
  const d = phone.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '')
  return /^01\d{9}$/.test(d) ? `2${d}` : d
}
const reasonLabel = (r: Reason) => ({
  MISSED_HOMEWORK: L('Missed the last 2 homework', 'ماسلّمش آخر 2 واجب'),
  LOW_QUIZZES: L('Last 2 quizzes under the pass mark', 'آخر 2 كويز تحت درجة النجاح'),
  INACTIVE: L('No lesson opened for 14 days', 'مافتحش أي درس من 14 يوم'),
}[r])
const reasonMessage = (r: Reason) => ({
  MISSED_HOMEWORK: L('has not handed in the last two homework', 'ماسلّمش آخر واجبين'),
  LOW_QUIZZES: L('scored under the pass mark in the last two quizzes', 'جاب أقل من درجة النجاح في آخر كويزين'),
  INACTIVE: L('has not opened the lessons on the platform for two weeks', 'مافتحش الدروس على المنصة من أسبوعين'),
}[r])

function Stat({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${bad ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${bad ? 'text-rose-700' : 'text-slate-900'}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

function FilterSelect({ value, onChange, all, items }: { value: string; onChange: (v: string) => void; all: string; items: Opt[] }) {
  if (!items.length) return null
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {items.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

type SortKey = 'label' | 'students' | 'openPct' | 'onTimePct' | 'missingPct' | 'homeworkAvg' | 'quizAvg' | 'pending' | 'gradingHours'

export function LmsAnalytics() {
  const [preset, setPreset] = useState('30')
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * DAY)))
  const [to, setTo] = useState(ymd(new Date()))
  const [f, setF] = useState({ campusId: '', trackId: '', subjectId: '', levelId: '', teacherId: '' })
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'onTimePct', asc: true })
  const [reasonFilter, setReasonFilter] = useState<Reason | ''>('')

  const choosePreset = (p: string) => {
    setPreset(p)
    if (p !== 'custom') { setFrom(ymd(new Date(Date.now() - Number(p) * DAY))); setTo(ymd(new Date())) }
  }
  const qs = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString()
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: ['lms-analytics', qs], queryFn: () => fetchApi<Data>(`/api/lms/analytics?${qs}`), staleTime: 60_000 })

  const set = (k: keyof typeof f, v: string) => setF((p) => {
    const n = { ...p, [k]: v }
    if (k === 'trackId') { n.subjectId = ''; n.levelId = '' }
    if (k === 'subjectId') n.levelId = ''
    return n
  })
  const courses = (data?.options.courses ?? []).filter((c) => !f.trackId || c.trackId === f.trackId)
  const levels = (data?.options.levels ?? []).filter((l) => (f.subjectId ? l.subjectId === f.subjectId : !f.trackId || courses.some((c) => c.id === l.subjectId)))

  const rows = useMemo(() => {
    const list = [...(data?.groups ?? [])]
    const { key, asc } = sort
    list.sort((a, b) => {
      const x = a[key], y = b[key]
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number)
      return asc ? c : -c
    })
    return list
  }, [data, sort])
  const risk = (data?.risk ?? []).filter((r) => !reasonFilter || r.reasons.includes(reasonFilter))
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'label' || key === 'onTimePct' || key === 'openPct' || key === 'quizAvg' || key === 'homeworkAvg' }))

  const logWhatsApp = (r: Data['risk'][number]) => {
    fetchApi('/api/contact-logs', {
      method: 'POST',
      body: JSON.stringify({ studentId: r.studentId, guardianId: r.guardian?.id ?? null, channel: 'WHATSAPP', reason: 'OTHER', summary: `LMS follow-up sent on WhatsApp: ${r.reasons.join(', ').toLowerCase().replace(/_/g, ' ')}.`, auto: true }),
    }).catch(() => undefined)
  }
  const waText = (r: Data['risk'][number]) => L(
    `Hello ${r.guardian?.name ?? ''}, this is TechNova. We noticed that ${r.name} ${r.reasons.map(reasonMessage).join(' and ')}. Can we help?`,
    `أهلاً ${r.guardian?.name ?? ''}، معاك TechNova. لاحظنا إن ${r.name} ${r.reasons.map(reasonMessage).join(' و')}. نقدر نساعد إزاي؟`,
  )

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="whitespace-nowrap px-2 py-2 text-start font-medium">
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-slate-900">{children}<ArrowUpDown className="h-3 w-3 opacity-50" /></button>
    </th>
  )
  const cell = (g: GroupRow, k: string, v: string) => <td className={`px-2 py-2 ${g.weak.includes(k) ? 'font-semibold text-rose-600' : ''}`}>{v}</td>
  const s = data?.summary

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-500"><BarChart3 className="h-4 w-4" /> {L('Analytics', 'التحليلات')}{isFetching && <Loader2 className="h-4 w-4 animate-spin" />}</h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset} onValueChange={choosePreset}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{L('Last 7 days', 'آخر 7 أيام')}</SelectItem>
            <SelectItem value="30">{L('Last 30 days', 'آخر 30 يوم')}</SelectItem>
            <SelectItem value="90">{L('Last 3 months', 'آخر 3 شهور')}</SelectItem>
            <SelectItem value="custom">{L('Choose dates', 'اختار التاريخ')}</SelectItem>
          </SelectContent>
        </Select>
        {preset === 'custom' && <>
          <DateInput className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <DateInput className="h-9 w-40" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </>}
        <FilterSelect value={f.campusId} onChange={(v) => set('campusId', v)} all={L('All branches', 'كل الفروع')} items={data?.options.campuses ?? []} />
        <FilterSelect value={f.trackId} onChange={(v) => set('trackId', v)} all={L('All tracks', 'كل الـ Tracks')} items={data?.options.tracks ?? []} />
        <FilterSelect value={f.subjectId} onChange={(v) => set('subjectId', v)} all={L('All courses', 'كل الكورسات')} items={courses} />
        <FilterSelect value={f.levelId} onChange={(v) => set('levelId', v)} all={L('All levels', 'كل المستويات')} items={levels} />
        <FilterSelect value={f.teacherId} onChange={(v) => set('teacherId', v)} all={L('All instructors', 'كل المدربين')} items={data?.options.teachers ?? []} />
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : error ? <p className="text-sm text-rose-600">{(error as Error).message}</p> : s && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={L('Students who opened lessons', 'طلبة فتحوا الدروس')} value={show(s.openPct)} hint={`${s.students} ${L('students', 'طالب')} · ${s.groups} ${L('groups', 'جروب')}`} bad={s.openPct != null && s.openPct < 40} />
          <Stat label={L('Homework on time', 'واجبات في معادها')} value={show(s.onTimePct)} hint={s.homeworkDue ? `${L('late', 'متأخر')} ${show(s.latePct)} · ${L('not handed in', 'ماتسلّمش')} ${show(s.missingPct)}` : L('no homework was due', 'مكانش فيه واجبات مطلوبة')} bad={s.onTimePct != null && s.onTimePct < 50} />
          <Stat label={L('Average homework / quiz score', 'متوسط الواجبات / الكويزات')} value={`${show(s.homeworkAvg)} / ${show(s.quizAvg)}`} bad={(s.homeworkAvg != null && s.homeworkAvg < 50) || (s.quizAvg != null && s.quizAvg < 50)} />
          <Stat label={L('Time to grade (average)', 'وقت التصحيح (متوسط)')} value={show(s.gradingHours, L(' h', ' ساعة'))} hint={`${s.pending} ${L('waiting now', 'مستني دلوقتي')}`} bad={s.gradingHours != null && s.gradingHours > 72} />
        </div>
        {data.truncated && <p className="text-xs text-amber-700">{L('Showing the first 200 groups — use the filters.', 'ظاهر أول 200 جروب بس — استخدم الفلاتر.')}</p>}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{L('Weekly activity', 'النشاط كل أسبوع')}</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weeks}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Legend />
                <Bar dataKey="lessons" name={L('Lessons opened', 'دروس اتفتحت')} fill="#6366f1" />
                <Bar dataKey="homework" name={L('Homework handed in', 'واجبات اتسلّمت')} fill="#10b981" />
                <Bar dataKey="quizzes" name={L('Quizzes done', 'كويزات اتحلّت')} fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{L('Groups', 'الجروبات')}</CardTitle>
            <CardDescription>{L('Red = weak: under 40% opened lessons, 50% homework on time, or 50% average score. Click a heading to sort.', 'الأحمر = ضعيف: أقل من 40% فتحوا الدروس، أو 50% واجبات في معادها، أو 50% متوسط درجات. اضغط على العنوان للترتيب.')}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!rows.length ? <p className="text-sm text-slate-500">{L('No active groups.', 'مفيش جروبات شغالة.')}</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500"><tr>
                  <Th k="label">{L('Group', 'الجروب')}</Th>
                  <Th k="students">{L('Students', 'الطلبة')}</Th>
                  <Th k="openPct">{L('Opened lessons', 'فتحوا الدروس')}</Th>
                  <Th k="onTimePct">{L('Homework on time', 'واجبات في معادها')}</Th>
                  <Th k="missingPct">{L('Not handed in', 'ماتسلّمش')}</Th>
                  <Th k="homeworkAvg">{L('Homework avg', 'متوسط الواجبات')}</Th>
                  <Th k="quizAvg">{L('Quiz avg', 'متوسط الكويزات')}</Th>
                  <Th k="pending">{L('To grade', 'مستني تصحيح')}</Th>
                  <Th k="gradingHours">{L('Grading time', 'وقت التصحيح')}</Th>
                </tr></thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id} className={`border-t border-slate-100 ${g.weak.length ? 'bg-rose-50/40' : ''}`}>
                      <td className="px-2 py-2">
                        <Link href={`/dashboard/groups?group=${g.id}`} className="font-medium text-slate-800 hover:underline">{g.label}</Link>
                        <div className="text-xs text-slate-400">{g.course} · {g.level} · {g.campus}{g.teachers.length ? ` · ${g.teachers.join(', ')}` : ''}</div>
                        {!g.hasCurriculum && <div className="text-xs text-amber-600">{L('No published curriculum', 'مفيش منهج منشور')}</div>}
                      </td>
                      <td className="px-2 py-2">{g.students}</td>
                      {cell(g, 'openPct', show(g.openPct))}
                      {cell(g, 'onTimePct', g.homeworkDue ? show(g.onTimePct) : '—')}
                      <td className="px-2 py-2">{g.homeworkDue ? show(g.missingPct) : '—'}</td>
                      {cell(g, 'homeworkAvg', show(g.homeworkAvg))}
                      {cell(g, 'quizAvg', show(g.quizAvg))}
                      <td className={`px-2 py-2 ${g.pending ? 'font-semibold text-amber-700' : ''}`}>{g.pending}</td>
                      <td className="px-2 py-2">{show(g.gradingHours, L(' h', ' ساعة'))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> {L('Students who need follow-up', 'طلبة محتاجين متابعة')} ({risk.length})</CardTitle>
                <CardDescription>{L('Based on today, not on the chosen period.', 'محسوبة على النهارده، مش على الفترة المختارة.')}</CardDescription>
              </div>
              <Select value={reasonFilter || ALL} onValueChange={(v) => setReasonFilter(v === ALL ? '' : (v as Reason))}>
                <SelectTrigger className="h-9 w-60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{L('Every reason', 'كل الأسباب')}</SelectItem>
                  {(['MISSED_HOMEWORK', 'LOW_QUIZZES', 'INACTIVE'] as Reason[]).map((r) => <SelectItem key={r} value={r}>{reasonLabel(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!risk.length ? <p className="text-sm text-slate-500">{L('Nobody right now.', 'مفيش حد دلوقتي.')}</p> : risk.slice(0, 100).map((r) => (
              <div key={`${r.studentId}-${r.groupId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/dashboard/students/${r.studentId}`} className="font-medium text-slate-800 hover:underline">{r.name}</Link>
                  <span className="text-xs text-slate-400"> · {r.reg} · {r.groupLabel}</span>
                  <div className="mt-1 flex flex-wrap gap-1">{r.reasons.map((x) => <span key={x} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{reasonLabel(x)}</span>)}</div>
                </div>
                {r.guardian?.phone ? (
                  <a href={`https://wa.me/${waNumber(r.guardian.phone)}?text=${encodeURIComponent(waText(r))}`} target="_blank" rel="noopener noreferrer" onClick={() => logWhatsApp(r)}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                    <MessageCircle className="h-4 w-4" /> {L('WhatsApp parent', 'واتساب لولي الأمر')}
                  </a>
                ) : <span className="text-xs text-slate-400">{L('No parent phone', 'مفيش رقم ولي أمر')}</span>}
              </div>
            ))}
            {risk.length > 100 && <p className="text-xs text-slate-400">{L('Showing the first 100.', 'ظاهر أول 100.')}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{L('Hardest questions', 'أصعب الأسئلة')}</CardTitle>
            <CardDescription>{L('Questions answered correctly by 60% or less (3+ answers, online quizzes of the period). Useful to improve the lesson or the question.', 'أسئلة جاوب عليها صح 60% أو أقل (3 إجابات أو أكتر، كويزات أونلاين في الفترة). مفيدة لتحسين الدرس أو السؤال.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!data.hard.length ? <p className="text-sm text-slate-500">{L('Nothing to show yet.', 'لسه مفيش حاجة.')}</p> : data.hard.map((q) => (
              <div key={`${q.blockId}-${q.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800">{q.textEn || q.type}</div>
                  <div className="text-xs text-slate-400">{q.level} · {q.quiz} · {q.answered} {L('answers', 'إجابة')}{q.commonWrong ? ` · ${L('most chosen wrong answer', 'أكتر إجابة غلط')}: ${q.commonWrong}` : ''}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${(q.percentCorrect ?? 0) < 40 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{q.percentCorrect}% {L('correct', 'صح')}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </>}
    </div>
  )
}
