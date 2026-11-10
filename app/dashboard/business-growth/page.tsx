'use client'

/**
 * Business growth (p14, owner 2026-11-10): one screen with the company's numbers month by month — money, students,
 * continuation, where students stop, marketing, operations, quality, capacity, who the students are, comparisons of
 * places / tracks / courses / levels / instructors / partners, monthly targets and "needs your attention".
 * Data: GET /api/business-growth (lib/business/engine.ts). A branch manager sees his places only, never company profit.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDown, ArrowUp, Download, Loader2, Printer, Target, TrendingUp } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useUrlTab } from '@/hooks/use-url-tab'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BusinessGrowth } from '@/lib/business/engine'

type Data = BusinessGrowth & { canEditTargets: boolean }
const BLUE = '#2a78d6', ORANGE = '#eb6834'
const TABS = [['overview', 'Overview', 'نظرة عامة'], ['money', 'Money', 'الفلوس'], ['students', 'Students', 'الطلاب'], ['growth', 'Marketing', 'التسويق'], ['operations', 'Operations & quality', 'التشغيل والجودة'], ['compare', 'Compare', 'مقارنات']] as const
const DIMS = [['campus', 'Places', 'الأماكن'], ['track', 'Tracks', 'التراكات'], ['course', 'Courses', 'الكورسات'], ['level', 'Levels', 'المستويات'], ['teacher', 'Instructors', 'المدربين'], ['partner', 'Partners', 'الشركاء']] as const

const fmt = (n: number | null | undefined, ar: boolean, digits = 0) => (n == null ? '—' : n.toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { maximumFractionDigits: digits }))
const monthName = (ym: string, ar: boolean) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

function Delta({ v, invert = false }: { v: number | null; invert?: boolean }) {
  if (v == null) return <span className="text-xs text-slate-400">—</span>
  const good = invert ? v < 0 : v > 0
  const Icon = v >= 0 ? ArrowUp : ArrowDown
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${v === 0 ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-rose-700'}`}><Icon className="h-3 w-3" aria-hidden="true" />{Math.abs(v)}%</span>
}

function ChartCard({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-1"><CardTitle className="text-base">{title}</CardTitle>{note && <p className="text-xs text-slate-500">{note}</p>}</CardHeader>
      <CardContent><div className="h-56 w-full" dir="ltr">{children}</div></CardContent>
    </Card>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | number | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="border-b text-xs text-slate-500">{head.map((h, i) => <th key={i} className="px-2 py-2 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b last:border-0">{r.map((c, j) => <td key={j} className="px-2 py-1.5 tabular-nums">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export default function BusinessGrowthPage() {
  const ar = useI18n().locale === 'ar'
  const [tab, setTab] = useUrlTab()
  const active = (tab ?? 'overview') as (typeof TABS)[number][0]
  const [months, setMonths] = useState(12)
  const [dim, setDim] = useState<(typeof DIMS)[number][0]>('campus')
  const [cmpNow, setCmpNow] = useState(false)
  const { can } = useMyPermissions()
  const { data, isLoading, error, isFetching } = useQuery({ queryKey: ['business-growth', months], queryFn: () => fetchApi<Data>(`/api/business-growth?months=${months}`) })

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (error || !data) return <p className="text-sm text-rose-600">{(error as Error)?.message ?? L('Could not load', 'مقدرناش نحمّل')}</p>
  const d = data
  const chart = d.monthRows.map((r) => ({ ...r, label: monthName(r.ym, ar), net: Math.round(r.income - r.refunds) }))
  const tick = { fontSize: 11, fill: '#64748b' }
  const cmp = cmpNow ? d.comparisonsNow : d.comparisons

  return (
    <div className="space-y-5" dir={ar ? 'rtl' : 'ltr'} id="business-print">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><TrendingUp className="h-7 w-7 text-indigo-600" aria-hidden="true" /> {L('Business growth', 'تطور البزنس')}{isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}</h1>
          <p className="text-sm text-slate-500">{L(`${monthName(d.months[0], false)} → ${monthName(d.current, false)}. The running month is not finished yet.`, `${monthName(d.months[0], true)} ← ${monthName(d.current, true)}. الشهر الحالي لسه ما خلصش.`)}{!d.companyMoney && ' ' + L('Company profit and salaries are not shown here.', 'أرباح الشركة والمرتبات مش ظاهرة هنا.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <select aria-label={L('Months', 'الشهور')} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm">
            {[6, 12, 24].map((m) => <option key={m} value={m}>{L(`Last ${m} months`, `آخر ${m} شهر`)}</option>)}
          </select>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => window.print()}><Printer className="h-4 w-4" /> {L('Print', 'طباعة')}</Button>
          {can('business_growth', 'export') && <Button size="sm" variant="outline" className="gap-1" asChild><a href={`/api/business-growth?months=${months}&format=xlsx`}><Download className="h-4 w-4" /> Excel</a></Button>}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-100 p-1 print:hidden">
        {TABS.map(([k, en, a]) => <button key={k} type="button" role="tab" aria-selected={active === k} onClick={() => setTab(k)} className={`min-h-11 flex-1 whitespace-nowrap rounded-xl px-3 text-sm font-bold ${active === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600'}`}>{L(en, a)}</button>)}
      </div>

      {active === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.headline.map((h) => (
              <Card key={h.en}><CardContent className="p-4">
                <p className="text-xs text-slate-500">{L(h.en, h.ar)}</p>
                <p className="text-2xl font-extrabold text-slate-900">{fmt(h.now, ar)}{h.en.includes('%') && h.now != null ? '%' : ''}{h.money && h.now != null ? <span className="text-sm font-medium text-slate-500"> {L('EGP', 'ج')}</span> : null}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500"><span>{L('vs last month', 'عن الشهر اللي فات')} <Delta v={h.vsPrev} /></span><span>{L('vs a year ago', 'عن السنة اللي فاتت')} <Delta v={h.vsYear} /></span></div>
              </CardContent></Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" /> {L('Needs your attention', 'محتاج انتباهك')}</CardTitle></CardHeader>
            <CardContent>
              {d.attention.length === 0 ? <p className="text-sm text-emerald-700">✓ {L('Nothing worrying in the last finished month.', 'مفيش حاجة مقلقة في الشهر اللي خلص.')}</p> : (
                <ul className="space-y-2">{d.attention.map((a) => (
                  <li key={a.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${a.level === 'bad' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
                    <span><b>{a.level === 'bad' ? L('Urgent', 'مهم') : L('Watch', 'خد بالك')}:</b> {L(a.en, a.ar)}</span>
                    {a.href && <Link href={a.href} className="text-xs font-semibold underline print:hidden">{L('Open', 'افتح')}</Link>}
                  </li>
                ))}</ul>
              )}
            </CardContent>
          </Card>
          <Targets d={d} ar={ar} />
        </div>
      )}

      {active === 'money' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={L('Income per month (payments − refunds), EGP', 'الدخل كل شهر (المدفوع − المسترد)، جنيه')}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={56} /><Tooltip formatter={(v) => fmt(Number(v), ar)} /><Bar dataKey="net" name={L('Income', 'الدخل')} fill={BLUE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title={L('Income per active student, EGP', 'الدخل لكل طالب نشط، جنيه')}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={48} /><Tooltip formatter={(v) => fmt(Number(v), ar)} /><Line dataKey="perStudent" name={L('Per student', 'لكل طالب')} stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} /></LineChart></ResponsiveContainer>
          </ChartCard>
          <Card className="lg:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-base">{L('Month by month', 'شهر بشهر')}</CardTitle></CardHeader><CardContent>
            <Table head={[L('Month', 'الشهر'), L('Income', 'الدخل'), L('Refunds', 'المسترد'), L('Expenses', 'المصاريف'), ...(d.companyMoney ? [L('Salaries', 'المرتبات'), L('Profit', 'الربح')] : []), L('Invoiced', 'اتفوتر'), L('Collection %', 'التحصيل %')]}
              rows={[...d.monthRows].reverse().map((r) => [monthName(r.ym, ar), fmt(r.income, ar), fmt(r.refunds, ar), fmt(r.expenses, ar), ...(d.companyMoney ? [fmt(r.salaries, ar), <span key="p" className={r.profit != null && r.profit < 0 ? 'text-rose-700' : ''}>{fmt(r.profit, ar)}</span>] : []), fmt(r.invoiced, ar), r.collectionPct == null ? '—' : `${r.collectionPct}%`])} />
          </CardContent></Card>
          <Card><CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold">{L('Money health now', 'صحة الفلوس دلوقتي')}</p>
            <p>{L('Overdue invoices', 'فواتير متأخرة')}: <b className={d.overdue > 0 ? 'text-rose-700' : ''}>{fmt(d.overdue, ar)} {L('EGP', 'جنيه')}</b></p>
            <p>{L('A student pays on average, all time', 'الطالب بيدفع في المتوسط طول مدته')}: <b>{fmt(d.value.avgValueAll, ar)} {L('EGP', 'جنيه')}</b></p>
          </CardContent></Card>
        </div>
      )}

      {active === 'students' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={L('Active students per month', 'الطلاب النشطين كل شهر')} note={L('Active = at least one session that month.', 'نشط = حضر أو اتسجل له حصة في الشهر ده.')}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={40} allowDecimals={false} /><Tooltip /><Line dataKey="active" name={L('Active', 'نشطين')} stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} /></LineChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title={L('New and stopped students', 'طلاب جداد وطلاب وقفوا')}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={chart} barGap={2}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={36} allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="newStudents" name={L('New', 'جداد')} fill={BLUE} radius={[4, 4, 0, 0]} /><Bar dataKey="stopped" name={L('Stopped', 'وقفوا')} fill={ORANGE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title={L('Continuation %', 'نسبة الاستمرار %')} note={L("Of last month's students, how many are still coming.", 'من طلاب الشهر اللي قبله، كام لسه بيحضر.')}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={36} domain={[0, 100]} /><Tooltip formatter={(v) => `${v}%`} /><Line dataKey="continuation" name={L('Continuation', 'الاستمرار')} stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} connectNulls /></LineChart></ResponsiveContainer>
          </ChartCard>
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{L('Where students stop', 'الطلاب بيقفوا فين')}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
            <p>{L('Students who stopped', 'طلاب وقفوا')}: <b>{d.value.stoppedCount}</b> · {L('they stayed on average', 'قعدوا في المتوسط')} <b>{fmt(d.value.avgMonths, ar, 1)}</b> {L('month(s)', 'شهر')} · {L('and paid', 'ودفعوا')} <b>{fmt(d.value.avgValue, ar)}</b> {L('EGP', 'جنيه')}</p>
            {d.value.bands.map((b) => {
              const max = Math.max(1, ...d.value.bands.map((x) => x.count))
              return <div key={b.key} className="flex items-center gap-2"><span className="w-28 shrink-0 text-xs text-slate-600">{L(b.en, b.ar)}</span><div className="h-4 flex-1 rounded bg-slate-100"><div className="h-4 rounded" style={{ width: `${(b.count / max) * 100}%`, background: b.key === d.value.mostStopAt ? ORANGE : BLUE }} /></div><span className="w-8 text-end tabular-nums">{b.count}</span></div>
            })}
            {d.value.mostStopAt && <p className="text-xs text-slate-500">{L('Most students stop after', 'أغلب الطلاب بيقفوا بعد')} {L(d.value.bands.find((b) => b.key === d.value.mostStopAt)!.en, d.value.bands.find((b) => b.key === d.value.mostStopAt)!.ar)}.</p>}
          </CardContent></Card>
          <Card className="lg:col-span-2"><CardHeader className="pb-2"><CardTitle className="text-base">{L('Who our students are (in a group now)', 'مين طلابنا (اللي في جروب دلوقتي)')}: {d.demographics.total}</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3 text-sm">
            <Tally title={L('Age', 'السن')} items={d.demographics.ages} />
            <Tally title={L('Gender', 'النوع')} items={d.demographics.gender.map((g) => ({ ...g, key: g.key === 'MALE' ? L('Boys', 'ولاد') : g.key === 'FEMALE' ? L('Girls', 'بنات') : g.key }))} />
            <Tally title={L('City', 'المدينة')} items={d.demographics.cities} />
          </CardContent></Card>
        </div>
      )}

      {active === 'growth' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={L('New students per month', 'طلاب جداد كل شهر')}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={36} allowDecimals={false} /><Tooltip /><Bar dataKey="newStudents" name={L('New', 'جداد')} fill={BLUE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title={L('Same month, this year and last year (new students)', 'نفس الشهر السنة دي واللي فاتت (طلاب جداد)')}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={d.seasonality.map((s) => ({ ...s, label: monthName(`2026-${s.month}`, ar).split(' ')[0] }))} barGap={2}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={36} allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="newThisYear" name={L('This year', 'السنة دي')} fill={BLUE} radius={[4, 4, 0, 0]} /><Bar dataKey="newLastYear" name={L('Last year', 'السنة اللي فاتت')} fill={ORANGE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <Card><CardHeader className="pb-2"><CardTitle className="text-base">{L('Where new students came from (12 months)', 'الطلاب الجداد عرفونا منين (12 شهر)')}</CardTitle></CardHeader><CardContent><Tally items={d.marketing.sources} /></CardContent></Card>
          <Card><CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold">{L('Cost of a new student (12 months)', 'تكلفة الطالب الجديد (12 شهر)')}</p>
            <p>{L('Marketing spend', 'مصاريف التسويق')}: <b>{fmt(d.marketing.spend12, ar)}</b> · {L('new students', 'طلاب جداد')}: <b>{d.marketing.new12}</b></p>
            <p>{L('Per new student', 'لكل طالب جديد')}: <b>{d.marketing.costPerNew == null ? L('no marketing expenses recorded', 'مفيش مصاريف تسويق متسجلة') : `${fmt(d.marketing.costPerNew, ar)} ${L('EGP', 'جنيه')}`}</b></p>
            <p className="text-xs text-slate-500">{L('Counts expense categories named marketing / ads / promo.', 'بيحسب بنود المصاريف اللي اسمها تسويق / إعلانات.')}</p>
          </CardContent></Card>
          <Card className="lg:col-span-2"><CardContent className="pt-4">
            <Table head={[L('Month', 'الشهر'), L('Admission requests', 'طلبات تسجيل'), L('Website messages', 'رسايل الموقع'), L('New students', 'طلاب جداد'), L('Referrals', 'ترشيحات'), 'NPS']}
              rows={[...d.monthRows].reverse().map((r) => [monthName(r.ym, ar), r.requests, d.companyMoney ? r.inquiries : '—', r.newStudents, r.referrals, r.nps ?? '—'])} />
          </CardContent></Card>
        </div>
      )}

      {active === 'operations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={L('Attendance %', 'نسبة الحضور %')} note={L('An excused absence counts as absent.', 'الغياب بعذر بيتحسب غياب.')}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={36} domain={[0, 100]} /><Tooltip formatter={(v) => `${v}%`} /><Line dataKey="attendancePct" name={L('Attendance', 'الحضور')} stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} connectNulls /></LineChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title={L('Session rating (out of 5)', 'تقييم الحصص (من 5)')}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} width={30} domain={[0, 5]} /><Tooltip /><Line dataKey="rating" name={L('Rating', 'التقييم')} stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} connectNulls /></LineChart></ResponsiveContainer>
          </ChartCard>
          <Card className="lg:col-span-2"><CardContent className="pt-4">
            <Table head={[L('Month', 'الشهر'), L('Sessions held', 'حصص اتعملت'), L('Cancelled', 'اتلغت'), L('Ratings', 'تقييمات'), L('Complaints', 'شكاوى'), L('Lessons opened', 'دروس اتفتحت'), ...(d.companyMoney ? [L('People using the system', 'مستخدمين السيستم')] : [])]}
              rows={[...d.monthRows].reverse().map((r) => [monthName(r.ym, ar), r.sessions, r.cancelled, r.ratings, r.complaints, r.lessonViews, ...(d.companyMoney ? [r.activeUsers ?? '—'] : [])])} />
          </CardContent></Card>
          <Card><CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold">{L('Seats and waiting list (now)', 'الأماكن وقايمة الانتظار (دلوقتي)')}</p>
            <p>{L('Active groups', 'جروبات شغالة')}: <b>{d.capacity.groups}</b> · {L('students per group', 'طالب في الجروب')}: <b>{fmt(d.capacity.avgPerGroup, ar, 1)}</b></p>
            <p>{L('Seats filled (groups with a limit)', 'الأماكن المليانة (الجروبات اللي ليها حد)')}: <b>{d.capacity.fillPct == null ? '—' : `${d.capacity.fillPct}%`}</b> ({d.capacity.filled} / {d.capacity.seats})</p>
            <p>{L('Full groups', 'جروبات مليانة')}: <b>{d.capacity.fullGroups}</b> · {L('waiting', 'مستنيين')}: <b>{d.capacity.waiting}</b></p>
            {d.capacity.waitingByLevel.length > 0 && <ul className="list-inside list-disc text-xs text-slate-600">{d.capacity.waitingByLevel.map((w) => <li key={w.level}>{w.level}: {w.count}</li>)}</ul>}
          </CardContent></Card>
          <Card><CardContent className="space-y-1 p-4 text-sm">
            <p className="font-semibold">{L('Instructors (now)', 'المدربين (دلوقتي)')}</p>
            <p>{L('Instructors teaching', 'مدربين بيدرّسوا')}: <b>{d.staff.instructorsTeaching}</b></p>
            <p>{L('Students per instructor', 'طالب لكل مدرب')}: <b>{fmt(d.staff.studentsPerInstructor, ar, 1)}</b></p>
          </CardContent></Card>
        </div>
      )}

      {active === 'compare' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{L('Compare', 'مقارنة')} — {monthName(cmp.month, ar)}{cmpNow ? ` (${L('so far', 'لحد دلوقتي')})` : ''}</CardTitle>
            <div className="flex flex-wrap gap-1 pt-2 print:hidden"><Button size="sm" variant={!cmpNow ? 'default' : 'outline'} onClick={() => setCmpNow(false)}>{L('Last finished month', 'الشهر اللي خلص')}</Button><Button size="sm" variant={cmpNow ? 'default' : 'outline'} onClick={() => setCmpNow(true)}>{L('This month so far', 'الشهر ده لحد دلوقتي')}</Button></div>
            <div className="flex flex-wrap gap-1 pt-2 print:hidden">{DIMS.map(([k, en, a]) => <Button key={k} size="sm" variant={dim === k ? 'default' : 'outline'} onClick={() => setDim(k)}>{L(en, a)}</Button>)}</div>
            <p className="text-xs text-slate-500">{L('Income change is against the month before it. Continuation needs the month before too.', 'تغيّر الدخل مقارنة بالشهر اللي قبله. والاستمرار محسوب من طلاب الشهر اللي قبله.')}</p>
          </CardHeader>
          <CardContent>
            {cmp[dim].length === 0 ? <p className="text-sm text-slate-500">{L('Nothing to compare in that month.', 'مفيش حاجة نقارنها في الشهر ده.')}</p> : (
              <Table head={[L('Name', 'الاسم'), L('Active students', 'طلاب نشطين'), L('Income', 'الدخل'), L('Change', 'التغيّر'), L('Attendance %', 'الحضور %'), L('Continuation %', 'الاستمرار %'), L('Rating', 'التقييم')]}
                rows={cmp[dim].map((c) => [c.name, c.active, fmt(c.income, ar), <Delta key="d" v={c.incomeChange} />, c.attendancePct == null ? '—' : `${c.attendancePct}%`, c.continuation == null ? '—' : `${c.continuation}%`, c.rating ?? '—'])} />
            )}
          </CardContent>
        </Card>
      )}

      <style>{`@media print { body * { visibility: hidden } #business-print, #business-print * { visibility: visible } #business-print { position: absolute; inset: 0 } }`}</style>
    </div>
  )
}

function Tally({ title, items }: { title?: string; items: { key: string; count: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <div className="space-y-1.5">
      {title && <p className="font-semibold">{title}</p>}
      {items.length === 0 && <p className="text-xs text-slate-500">—</p>}
      {items.map((i) => <div key={i.key} className="flex items-center gap-2"><span className="w-24 shrink-0 truncate text-xs text-slate-600" title={i.key}>{i.key}</span><div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded" style={{ width: `${(i.count / max) * 100}%`, background: BLUE }} /></div><span className="w-8 text-end text-xs tabular-nums">{i.count}</span></div>)}
    </div>
  )
}

function Targets({ d, ar }: { d: Data; ar: boolean }) {
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Record<string, string> | null>(null)
  const cur = d.targets[0]
  const save = useMutation({
    mutationFn: () => fetchApi('/api/business-growth/targets', { method: 'PUT', body: JSON.stringify({ ym: cur.ym, campusId: d.scopeKey === 'ALL' ? null : d.scopeKey, values: Object.fromEntries(Object.entries(edit ?? {}).map(([k, v]) => [k, v.trim() === '' ? null : Number(v)])) }) }),
    onSuccess: () => { notify.success(L('Targets saved', 'الأهداف اتحفظت')); setEdit(null); qc.invalidateQueries({ queryKey: ['business-growth'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const stateCls = { AHEAD: 'text-emerald-700', ON_TRACK: 'text-emerald-700', BEHIND: 'text-rose-700', NONE: 'text-slate-400' } as const
  const stateText = { AHEAD: ['Ahead', 'سابقين'], ON_TRACK: ['On track', 'ماشيين صح'], BEHIND: ['Behind', 'متأخرين'], NONE: ['No target', 'مفيش هدف'] } as const
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Target className="h-5 w-5 text-indigo-600" aria-hidden="true" /> {L('This month’s targets', 'أهداف الشهر ده')} — {monthName(cur.ym, ar)}</CardTitle>
        {d.canEditTargets && !edit && <Button size="sm" variant="outline" className="print:hidden" onClick={() => setEdit(Object.fromEntries(cur.items.map((i) => [i.metric, i.target == null ? '' : String(i.target)])))}>{L('Set targets', 'حدد الأهداف')}</Button>}
      </CardHeader>
      <CardContent>
        {edit ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">{cur.items.map((i) => (
              <label key={i.metric} className="space-y-1 text-sm"><span className="text-slate-600">{L(i.en, i.ar)}</span><Input type="number" inputMode="decimal" min={0} value={edit[i.metric] ?? ''} onChange={(e) => setEdit({ ...edit, [i.metric]: e.target.value })} /></label>
            ))}</div>
            <p className="text-xs text-slate-500">{L('Leave empty to remove a target.', 'سيبه فاضي علشان تشيل الهدف.')}</p>
            <div className="flex gap-2"><Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button><Button size="sm" variant="outline" onClick={() => setEdit(null)}>{L('Cancel', 'إلغاء')}</Button></div>
          </div>
        ) : cur.items.every((i) => i.target == null) ? (
          <p className="text-sm text-slate-500">{L('No targets for this month yet.', 'لسه مفيش أهداف للشهر ده.')}</p>
        ) : (
          <Table head={[L('Target', 'الهدف'), L('Aim', 'المطلوب'), L('So far', 'لحد دلوقتي'), '%', L('State', 'الحالة')]}
            rows={cur.items.filter((i) => i.target != null).map((i) => [L(i.en, i.ar), fmt(i.target, ar), fmt(i.actual, ar, 1), i.pct == null ? '—' : `${i.pct}%`, <span key="s" className={`font-semibold ${stateCls[i.state]}`}>{L(stateText[i.state][0], stateText[i.state][1])}</span>])} />
        )}
      </CardContent>
    </Card>
  )
}
