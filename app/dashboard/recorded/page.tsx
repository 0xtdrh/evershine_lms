'use client'

/**
 * a02 M4 batch 1 (2026-11-02): recorded courses: who is enrolled (access, progress, exam, certificate), enrolling a student, and the
 * catalogue (price and days per level, lessons open or in order, exam required, certificate shown at once). `?student=<id>` opens enrolling.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { campusLabel } from '@/lib/places/label'
import { PlayCircle } from 'lucide-react'

interface Row {
  id: string; plan: string; price: number | null; endsAt: string | null; state: 'OPEN' | 'NOT_PAID' | 'EXPIRED'; campus: { id: string; name: string }; level: string
  student: { id: string; name: string } | null; unpaidRenewal: boolean
  progress: { done: number; total: number; pct: number; hasExam: boolean; examScore: number | null; passMark: number | null; certificate: { certificateNumber: string; isRevealed: boolean } | null } | null
}
interface Course { id: string; levelId: string; level: string; subscriptionPrice: number | null; subscriptionDays: number | null; oneTimePrice: number | null; openMode: string; examRequired: boolean; autoReveal: boolean; isActive: boolean; hasExam: boolean }
interface LevelRow { id: string; name: string; subject: { name: string } }
interface StudentRow { id: string; firstName: string; lastName: string; registrationNumber?: string | null; campusId?: string }
interface Campus { id: string; name: string }

const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'
const lab = 'block text-xs text-slate-500'
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }) : '')
const stateText = (s: Row['state']) => ({ OPEN: L('Open', 'مفتوح'), NOT_PAID: L('Waiting for payment', 'مستني الدفع'), EXPIRED: L('Ended', 'خلص') })[s]
const stateColor = (s: Row['state']) => (s === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : s === 'EXPIRED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')

function List({ canRenew }: { canRenew: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['recorded'], queryFn: () => fetchApi<Row[]>('/api/recorded') })
  const renew = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/recorded/${id}/renew`, { method: 'POST', body: '{}' }),
    onSuccess: () => { notify.success(L('Renewal invoice made', 'فاتورة التجديد اتعملت')); qc.invalidateQueries({ queryKey: ['recorded'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>}
      {data && !data.length && <p className="py-8 text-center text-sm text-slate-500">{L('Nobody is enrolled yet.', 'لسه محدش مسجل.')}</p>}
      {(data ?? []).map((r) => (
        <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{r.student ? <Link className="text-indigo-700 hover:underline" href={`/dashboard/students/${r.student.id}`}>{r.student.name}</Link> : '—'} · {r.level}</p>
            <p className="text-slate-600">{campusLabel(r.campus)} · {r.plan === 'ONE_TIME' ? L('One-time purchase', 'شراء مرة واحدة') : L('Subscription', 'اشتراك')}{r.endsAt ? ` · ${L('until', 'لحد')} ${date(r.endsAt)}` : ''}</p>
            {r.progress && (
              <p className="text-slate-600">
                {L(`${r.progress.done} of ${r.progress.total} done`, `${r.progress.done} من ${r.progress.total} خلصوا`)} ({r.progress.pct}%)
                {r.progress.hasExam && ` · ${L('Exam', 'الامتحان')}: ${r.progress.examScore != null ? `${Math.round(r.progress.examScore)}%` : L('not yet', 'لسه')}`}
                {r.progress.certificate && ` · ${L('Certificate', 'الشهادة')} ${r.progress.certificate.certificateNumber} ${r.progress.certificate.isRevealed ? '' : L('(hidden)', '(مخفية)')}`}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${stateColor(r.state)}`}>{stateText(r.state)}</span>
            {canRenew && r.plan === 'SUBSCRIPTION' && !r.unpaidRenewal && <Button size="sm" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate(r.id)}>{L('Renew', 'جدّد')}</Button>}
            {r.unpaidRenewal && r.state !== 'NOT_PAID' && <span className="text-xs text-amber-700">{L('Renewal invoice not paid', 'فاتورة التجديد لسه ما اتدفعتش')}</span>}
          </div>
        </CardContent></Card>
      ))}
    </div>
  )
}

function Enrol({ startStudent, onDone }: { startStudent: string | null; onDone: () => void }) {
  const { data: courses } = useQuery({ queryKey: ['recorded-courses'], queryFn: () => fetchApi<Course[]>('/api/recorded/courses') })
  const { data: campuses } = useQuery({ queryKey: ['campuses-all'], queryFn: () => fetchPaginatedApi<Campus>('/api/campuses?limit=100') })
  const [q, setQ] = useState('')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [campusId, setCampusId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [plan, setPlan] = useState('')
  const { data: found } = useQuery({ queryKey: ['recorded-student-search', q], queryFn: () => fetchPaginatedApi<StudentRow>(`/api/students?search=${encodeURIComponent(q)}&limit=8`), enabled: q.trim().length >= 2 })
  const { data: first } = useQuery({ queryKey: ['recorded-start', startStudent], queryFn: () => fetchApi<StudentRow>(`/api/students/${startStudent}`), enabled: !!startStudent })
  useEffect(() => { if (first) { setStudent((s) => s ?? first); if (first.campusId) setCampusId((c) => c || first.campusId!) } }, [first])
  const course = (courses ?? []).find((c) => c.levelId === levelId)
  const go = useMutation({
    mutationFn: () => fetchApi('/api/recorded', { method: 'POST', body: JSON.stringify({ studentId: student!.id, campusId, levelId, plan }) }),
    onSuccess: () => { notify.success(L('Enrolled. The invoice is made.', 'اتسجل، والفاتورة اتعملت.')); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  return (
    <Card><CardContent className="space-y-4 pt-4 text-sm">
      <div className="space-y-1">
        <span className={lab}>{L('Student', 'الطالب')}</span>
        {student ? (
          <span className="flex w-fit items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800">{student.firstName} {student.lastName}<button type="button" aria-label={L('Remove', 'شيل')} onClick={() => setStudent(null)}>✕</button></span>
        ) : (
          <>
            <Input className="h-9 w-56" placeholder={L('Name or registration number', 'الاسم أو رقم التسجيل')} value={q} onChange={(e) => setQ(e.target.value)} />
            {q.trim().length >= 2 && <div className="flex flex-wrap gap-1">{(found?.data ?? []).map((s) => <button key={s.id} type="button" className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => { setStudent(s); if (s.campusId) setCampusId(s.campusId); setQ('') }}>{s.firstName} {s.lastName}{s.registrationNumber ? ` · ${s.registrationNumber}` : ''}</button>)}</div>}
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1"><span className={lab}>{L('Place', 'المكان')}</span>
          <select className={sel} value={campusId} onChange={(e) => setCampusId(e.target.value)}><option value="">—</option>{(campuses?.data ?? []).map((c) => <option key={c.id} value={c.id}>{campusLabel(c)}</option>)}</select></label>
        <label className="space-y-1"><span className={lab}>{L('Course', 'الكورس')}</span>
          <select className={sel} value={levelId} onChange={(e) => { setLevelId(e.target.value); setPlan('') }}><option value="">—</option>{(courses ?? []).filter((c) => c.isActive).map((c) => <option key={c.levelId} value={c.levelId}>{c.level}</option>)}</select></label>
        <label className="space-y-1"><span className={lab}>{L('Plan', 'النظام')}</span>
          <select className={sel} value={plan} disabled={!course} onChange={(e) => setPlan(e.target.value)}>
            <option value="">—</option>
            {course?.subscriptionPrice != null && <option value="SUBSCRIPTION">{L(`Subscription ${course.subscriptionDays} days`, `اشتراك ${course.subscriptionDays} يوم`)} · {course.subscriptionPrice.toLocaleString('en-US')} {L('EGP', 'ج.م')}</option>}
            {course?.oneTimePrice != null && <option value="ONE_TIME">{L('One-time purchase', 'شراء مرة واحدة')} · {course.oneTimePrice.toLocaleString('en-US')} {L('EGP', 'ج.م')}</option>}
          </select></label>
      </div>
      {courses && !courses.length && <p className="text-xs text-amber-700">{L('No recorded courses yet: add one in the Courses tab.', 'لسه مفيش كورسات مسجلة: ضيف واحد من تبويب الكورسات.')}</p>}
      <Button disabled={!student || !campusId || !levelId || !plan || go.isPending} onClick={() => go.mutate()}>{L('Enrol', 'سجّل')}</Button>
    </CardContent></Card>
  )
}

function Courses({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['recorded-courses'], queryFn: () => fetchApi<Course[]>('/api/recorded/courses') })
  const { data: levels } = useQuery({ queryKey: ['levels-all'], queryFn: () => fetchApi<LevelRow[]>('/api/levels') })
  const empty = { levelId: '', subscriptionPrice: '', subscriptionDays: '30', oneTimePrice: '', openMode: 'ALL', examRequired: true, autoReveal: false }
  const [f, setF] = useState(empty)
  const n = (v: string) => (v === '' ? null : Number(v))
  const save = useMutation({
    mutationFn: () => fetchApi('/api/recorded/courses', { method: 'POST', body: JSON.stringify({ ...f, subscriptionPrice: n(f.subscriptionPrice), subscriptionDays: n(f.subscriptionDays), oneTimePrice: n(f.oneTimePrice) }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setF(empty); qc.invalidateQueries({ queryKey: ['recorded-courses'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-4">
      {canEdit && (
        <Card><CardContent className="space-y-3 pt-4 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className={lab}>{L('Level (its curriculum is the course)', 'المستوى (منهجه هو الكورس)')}</span>
              <select className={sel} value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}><option value="">—</option>{(levels ?? []).map((l) => <option key={l.id} value={l.id}>{l.subject?.name} — {l.name}</option>)}</select></label>
            <label className="space-y-1"><span className={lab}>{L('Subscription price', 'سعر الاشتراك')}</span><Input type="number" min={0} className="h-9 w-28" value={f.subscriptionPrice} onChange={(e) => setF({ ...f, subscriptionPrice: e.target.value })} /></label>
            <label className="space-y-1"><span className={lab}>{L('Days', 'الأيام')}</span><Input type="number" min={1} className="h-9 w-20" value={f.subscriptionDays} onChange={(e) => setF({ ...f, subscriptionDays: e.target.value })} /></label>
            <label className="space-y-1"><span className={lab}>{L('One-time price', 'سعر الشراء مرة واحدة')}</span><Input type="number" min={0} className="h-9 w-28" value={f.oneTimePrice} onChange={(e) => setF({ ...f, oneTimePrice: e.target.value })} /></label>
            <label className="space-y-1"><span className={lab}>{L('Lessons', 'الدروس')}</span>
              <select className={sel} value={f.openMode} onChange={(e) => setF({ ...f, openMode: e.target.value })}><option value="ALL">{L('All open', 'مفتوحة كلها')}</option><option value="PREVIOUS">{L('In order', 'بالترتيب')}</option></select></label>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.examRequired} onChange={(e) => setF({ ...f, examRequired: e.target.checked })} /> {L('The certificate needs the final exam', 'الشهادة لازم امتحان نهائي')}</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={f.autoReveal} onChange={(e) => setF({ ...f, autoReveal: e.target.checked })} /> {L('Show the certificate at once (else it stays hidden until revealed)', 'اظهر الشهادة على طول (وإلا تفضل مخفية لحد ما تتظهر)')}</label>
          </div>
          <Button disabled={!f.levelId || save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
        </CardContent></Card>
      )}
      {(data ?? []).map((c) => (
        <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{c.level}{!c.isActive ? ` · ${L('stopped', 'موقوف')}` : ''}</p>
          <p className="text-slate-600">
            {c.subscriptionPrice != null && `${L('Subscription', 'اشتراك')} ${c.subscriptionPrice.toLocaleString('en-US')} / ${c.subscriptionDays} ${L('days', 'يوم')}`}
            {c.subscriptionPrice != null && c.oneTimePrice != null && ' · '}
            {c.oneTimePrice != null && `${L('One-time', 'مرة واحدة')} ${c.oneTimePrice.toLocaleString('en-US')}`}
            {` · ${c.openMode === 'ALL' ? L('all open', 'مفتوحة كلها') : L('in order', 'بالترتيب')}`}
          </p>
          {c.examRequired && !c.hasExam && <p className="text-xs font-semibold text-rose-700">{L('The certificate needs a final exam and the curriculum has none yet: nobody can get it until one is added.', 'الشهادة محتاجة امتحان نهائي والمنهج لسه مفيهوش: محدش هياخدها لحد ما يتضاف.')}</p>}
        </div>
      ))}
    </div>
  )
}

export default function RecordedPage() {
  useI18n()
  const { can } = useMyPermissions()
  const qc = useQueryClient()
  const [urlTab, setUrlTab] = useUrlTab()
  const [startStudent, setStartStudent] = useState<string | null>(null)
  useEffect(() => { setStartStudent(new URLSearchParams(window.location.search).get('student')) }, [])
  const tab = urlTab ?? (startStudent ? 'enrol' : 'list')
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><PlayCircle className="h-5 w-5 text-indigo-600" /> {L('Recorded courses', 'الكورسات المسجلة')}</h1>
        <p className="text-sm text-slate-500">{L('A student takes a course alone: lessons at any time, with a subscription or a one-time purchase.', 'الطالب بياخد الكورس لوحده: الدروس في أي وقت، باشتراك أو شراء مرة واحدة.')}</p>
      </div>
      <Tabs value={tab} onValueChange={setUrlTab}>
        <TabsList>
          <TabsTrigger value="list">{L('Students', 'الطلاب')}</TabsTrigger>
          {can('recorded_courses', 'create') && <TabsTrigger value="enrol">{L('Enrol', 'تسجيل')}</TabsTrigger>}
          <TabsTrigger value="courses">{L('Courses', 'الكورسات')}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-4"><List canRenew={can('recorded_courses', 'update')} /></TabsContent>
        {can('recorded_courses', 'create') && <TabsContent value="enrol" className="mt-4"><Enrol startStudent={startStudent} onDone={() => { qc.invalidateQueries({ queryKey: ['recorded'] }); setUrlTab('list') }} /></TabsContent>}
        <TabsContent value="courses" className="mt-4"><Courses canEdit={can('recorded_courses', 'update')} /></TabsContent>
      </Tabs>
    </div>
  )
}
