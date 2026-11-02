'use client'

/**
 * a02 M3 One-to-One (2026-11-01): its own screen, never on the Groups page. The list (student, instructor, weekly time, plan,
 * sessions left, next cycle), the price list per level, and a new booking (one student, or two siblings in the same level sharing
 * one session; only instructors who are qualified and free are offered). `?student=<id>` opens a booking for that student.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { campusLabel } from '@/lib/places/label'
import { Plus, Trash2, UserCheck } from 'lucide-react'
import { PLAN_LABEL, quote, type Plan, type PriceRow } from '@/lib/one-to-one/rules'

interface Row {
  id: string; status: string; plan: Plan | null; price: number | null; minutes: number | null
  slots: { dayOfWeek: number; time: string; mode?: string }[] | null
  campus: { id: string; name: string }; level: { id: string; name: string; course: string } | null
  students: { id: string; name: string }[]; teacher: { id: string; name: string } | null
  sessionsDone: number; sessionsTotal: number; sessionsLeft: number; finished: boolean
}
interface Campus { id: string; name: string; kind?: string }
interface LevelRow { id: string; name: string; subject: { id: string; name: string } }
interface StudentRow { id: string; firstName: string; lastName: string; registrationNumber?: string | null }
interface Slot { dayOfWeek: number; time: string; mode: 'BRANCH' | 'ONLINE'; roomId: string }

const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'
const planText = (p: string | null, ar: boolean) => (p && PLAN_LABEL[p as Plan] ? PLAN_LABEL[p as Plan][ar ? 'ar' : 'en'] : '—')
const way = (m?: string) => (m === 'ONLINE' ? L('online', 'أونلاين') : L('branch', 'فرع'))
const levelName = (l: LevelRow) => `${l.subject?.name ?? ''} — ${l.name}`
const useCampuses = () => useQuery({ queryKey: ['campuses-all'], queryFn: () => fetchPaginatedApi<Campus>('/api/campuses?limit=100') })

function List({ canRenew, ar }: { canRenew: boolean; ar: boolean }) {
  const qc = useQueryClient()
  const [all, setAll] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['one-to-one', all], queryFn: () => fetchApi<Row[]>(`/api/one-to-one${all ? '?status=ALL' : ''}`) })
  const renew = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/one-to-one/${id}/renew`, { method: 'POST', body: '{}' }),
    onSuccess: () => { notify.success(L('Next cycle made', 'الدورة الجاية اتعملت')); qc.invalidateQueries({ queryKey: ['one-to-one'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {L('Show finished too', 'اعرض اللي خلصوا كمان')}</label>
      {isLoading && <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>}
      {data && !data.length && <p className="py-8 text-center text-sm text-slate-500">{L('No One-to-One yet.', 'لسه مفيش One-to-One.')}</p>}
      {(data ?? []).map((r) => (
        <Card key={r.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">👤 {r.students.map((s) => <Link key={s.id} className="me-2 text-indigo-700 hover:underline" href={`/dashboard/students/${s.id}`}>{s.name}</Link>)}{r.students.length === 2 && <span className="text-xs font-normal text-slate-500">{L('(siblings, same session)', '(أخين في نفس الحصة)')}</span>}</p>
            <p className="text-slate-600">{r.level ? `${r.level.course} — ${r.level.name}` : '—'} · {campusLabel(r.campus)}</p>
            <p className="text-slate-600">{L('Instructor', 'المدرب')}: {r.teacher?.name ?? '—'} · {(r.slots ?? []).map((s) => `${dayName(s.dayOfWeek)} ${s.time} (${way(s.mode)})`).join('، ') || '—'}</p>
            <p className="text-slate-600">{planText(r.plan, ar)}{r.price != null ? ` · ${r.price.toLocaleString('en-US')} ${L('EGP', 'ج.م')}` : ''}{r.minutes ? ` · ${r.minutes} ${L('min', 'دقيقة')}` : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.finished ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {L(`${r.sessionsDone} of ${r.sessionsTotal} sessions`, `${r.sessionsDone} من ${r.sessionsTotal} حصة`)}{r.status === 'COMPLETED' ? ` · ${L('finished', 'خلص')}` : ''}
            </span>
            {canRenew && r.status === 'ACTIVE' && r.finished && <Button size="sm" disabled={renew.isPending} onClick={() => renew.mutate(r.id)}>{L('Make the next cycle', 'اعمل الدورة الجاية')}</Button>}
          </div>
        </CardContent></Card>
      ))}
    </div>
  )
}

function Prices({ canEdit, ar }: { canEdit: boolean; ar: boolean }) {
  const qc = useQueryClient()
  const { data: campuses } = useCampuses()
  const { data: levels } = useQuery({ queryKey: ['levels-all'], queryFn: () => fetchApi<LevelRow[]>('/api/levels') })
  const { data: rows } = useQuery({ queryKey: ['one-to-one-prices'], queryFn: () => fetchApi<(PriceRow & { id: string })[]>('/api/one-to-one/prices') })
  const empty = { levelId: '', campusId: '', plan: 'MONTH' as Plan, sessions: '', price: '', siblingPrice: '', minutes: '' }
  const [f, setF] = useState(empty)
  const n = (v: string) => (v === '' ? null : Number(v))
  const save = useMutation({
    mutationFn: () => fetchApi('/api/one-to-one/prices', { method: 'POST', body: JSON.stringify({ levelId: f.levelId, campusId: f.campusId || null, plan: f.plan, sessions: n(f.sessions), price: Number(f.price), siblingPrice: n(f.siblingPrice), minutes: n(f.minutes) }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setF({ ...empty, levelId: f.levelId, campusId: f.campusId }); qc.invalidateQueries({ queryKey: ['one-to-one-prices'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/one-to-one/prices/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['one-to-one-prices'] }), onError: (e: Error) => notify.error(e.message),
  })
  const lv = new Map((levels ?? []).map((l) => [l.id, levelName(l)]))
  const pl = new Map((campuses?.data ?? []).map((c) => [c.id, campusLabel(c)]))
  return (
    <div className="space-y-4">
      {canEdit && (
        <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4 text-sm">
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Level', 'المستوى')}</span>
            <select className={sel} value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}><option value="">—</option>{(levels ?? []).map((l) => <option key={l.id} value={l.id}>{levelName(l)}</option>)}</select></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Place', 'المكان')}</span>
            <select className={sel} value={f.campusId} onChange={(e) => setF({ ...f, campusId: e.target.value })}><option value="">{L('Everywhere', 'كل الأماكن')}</option>{(campuses?.data ?? []).map((c) => <option key={c.id} value={c.id}>{campusLabel(c)}</option>)}</select></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Plan', 'النظام')}</span>
            <select className={sel} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as Plan })}>{(['MONTH', 'PACKAGE', 'SESSION'] as Plan[]).map((p) => <option key={p} value={p}>{planText(p, ar)}</option>)}</select></label>
          {f.plan !== 'SESSION' && <label className="space-y-1"><span className="block text-xs text-slate-500">{f.plan === 'PACKAGE' ? L('Sessions', 'عدد الحصص') : L('Sessions (empty = the level)', 'الحصص (فاضي = زي المستوى)')}</span><Input type="number" min={1} className="h-9 w-28" value={f.sessions} onChange={(e) => setF({ ...f, sessions: e.target.value })} /></label>}
          <label className="space-y-1"><span className="block text-xs text-slate-500">{f.plan === 'SESSION' ? L('Price of a session', 'سعر الحصة') : L('Price', 'السعر')}</span><Input type="number" min={0} className="h-9 w-28" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Each sibling (same session)', 'لكل أخ (نفس الحصة)')}</span><Input type="number" min={0} className="h-9 w-28" value={f.siblingPrice} onChange={(e) => setF({ ...f, siblingPrice: e.target.value })} /></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Minutes', 'الدقايق')}</span><Input type="number" min={10} className="h-9 w-20" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></label>
          <Button disabled={!f.levelId || f.price === '' || save.isPending} onClick={() => save.mutate()}><Plus className="me-1 h-4 w-4" />{L('Save', 'احفظ')}</Button>
        </CardContent></Card>
      )}
      <div className="space-y-2">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <p><b>{lv.get(r.levelId) ?? '—'}</b> · {r.scopeKey === 'ALL' ? L('everywhere', 'كل الأماكن') : pl.get(r.scopeKey) ?? '—'} · {planText(r.plan, ar)}{r.plan !== 'SESSION' ? ` (${r.sessions} ${L('sessions', 'حصة')})` : ''} · <b>{r.price.toLocaleString('en-US')} {L('EGP', 'ج.م')}</b>{r.siblingPrice != null ? ` · ${L('sibling', 'الأخ')} ${r.siblingPrice.toLocaleString('en-US')}` : ''}{r.minutes ? ` · ${r.minutes} ${L('min', 'دقيقة')}` : ''}</p>
            {canEdit && <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>}
          </div>
        ))}
        {rows && !rows.length && <p className="py-6 text-center text-sm text-slate-500">{L('No prices yet. Add one for each level.', 'لسه مفيش أسعار. ضيف سعر لكل مستوى.')}</p>}
      </div>
    </div>
  )
}

function Book({ onDone, ar, startStudent }: { onDone: () => void; ar: boolean; startStudent: string | null }) {
  const { data: campuses } = useCampuses()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<StudentRow[]>([])
  const [campusId, setCampusId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [priceId, setPriceId] = useState('')
  const [count, setCount] = useState('4')
  const [slots, setSlots] = useState<Slot[]>([{ dayOfWeek: 0, time: '16:00', mode: 'BRANCH', roomId: '' }])
  const [teacherId, setTeacherId] = useState('')
  const [payment, setPayment] = useState<'FULL' | 'INSTALLMENTS'>('FULL')
  const [rate, setRate] = useState('')
  const { data: found } = useQuery({ queryKey: ['one-to-one-student-search', q], queryFn: () => fetchPaginatedApi<StudentRow>(`/api/students?search=${encodeURIComponent(q)}&limit=8`), enabled: q.trim().length >= 2 })
  const { data: first } = useQuery({ queryKey: ['one-to-one-start', startStudent], queryFn: () => fetchApi<StudentRow>(`/api/students/${startStudent}`), enabled: !!startStudent })
  useEffect(() => { if (first) setPicked((p) => (p.length ? p : [first])) }, [first])
  const { data: levels } = useQuery({ queryKey: ['levels-of-place', campusId], queryFn: () => fetchApi<LevelRow[]>(`/api/levels?campusId=${campusId}`), enabled: !!campusId })
  const { data: prices } = useQuery({ queryKey: ['one-to-one-prices', levelId], queryFn: () => fetchApi<(PriceRow & { id: string })[]>(`/api/one-to-one/prices?levelId=${levelId}`), enabled: !!levelId })
  const { data: rooms } = useQuery({ queryKey: ['place-rooms', campusId], queryFn: () => fetchApi<{ campus: { roomMode: string }; rooms: { id: string; name: string }[] }>(`/api/places/${campusId}/rooms`), enabled: !!campusId, retry: false })
  const usable = useMemo(() => {
    const here = (prices ?? []).filter((r) => r.scopeKey === campusId)
    const key = (r: PriceRow) => `${r.plan}|${r.plan === 'SESSION' ? 1 : r.sessions}`
    const have = new Set(here.map(key))
    return [...here, ...(prices ?? []).filter((r) => r.scopeKey === 'ALL' && !have.has(key(r)))]
  }, [prices, campusId])
  const price = usable.find((r) => r.id === priceId)
  const sibling = picked.length === 2
  const each = price ? quote(price, Number(count) || 1, sibling) : null
  const slotsParam = encodeURIComponent(JSON.stringify(slots.map(({ dayOfWeek, time, mode }) => ({ dayOfWeek, time, mode }))))
  const { data: teachers, isFetching: loadingTeachers } = useQuery({
    queryKey: ['one-to-one-teachers', campusId, levelId, slotsParam],
    queryFn: () => fetchApi<{ id: string; name: string }[]>(`/api/one-to-one/instructors?campusId=${campusId}&levelId=${levelId}&slots=${slotsParam}`),
    enabled: !!campusId && !!levelId,
  })
  useEffect(() => { if (teacherId && teachers && !teachers.some((t) => t.id === teacherId)) setTeacherId('') }, [teachers, teacherId])
  const setSlot = (i: number, patch: Partial<Slot>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const save = useMutation({
    mutationFn: () => fetchApi('/api/one-to-one', {
      method: 'POST',
      body: JSON.stringify({
        studentIds: picked.map((s) => s.id), campusId, levelId, plan: price!.plan, sessions: price!.plan === 'SESSION' ? Number(count) || 1 : price!.sessions,
        slots: slots.map((s) => ({ dayOfWeek: s.dayOfWeek, time: s.time, mode: s.mode, ...(s.roomId && { roomId: s.roomId }) })), teacherId, payment, ...(rate !== '' && { teacherRate: Number(rate) }),
      }),
    }),
    onSuccess: () => { notify.success(L('Booked. The invoice is made.', 'اتحجز، والفاتورة اتعملت.')); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const row = 'space-y-1'
  const lab = 'block text-xs text-slate-500'
  return (
    <Card><CardContent className="space-y-4 pt-4 text-sm">
      <div className={row}>
        <span className={lab}>{L('Student (a second one = a sibling in the same session)', 'الطالب (التاني = أخ في نفس الحصة)')}</span>
        <div className="flex flex-wrap items-center gap-2">
          {picked.map((s) => <span key={s.id} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800">{s.firstName} {s.lastName}<button type="button" aria-label={L('Remove', 'شيل')} onClick={() => setPicked(picked.filter((x) => x.id !== s.id))}>✕</button></span>)}
          {picked.length < 2 && <Input className="h-9 w-56" placeholder={L('Name or registration number', 'الاسم أو رقم التسجيل')} value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        {q.trim().length >= 2 && picked.length < 2 && (
          <div className="flex flex-wrap gap-1">{(found?.data ?? []).filter((s) => !picked.some((p) => p.id === s.id)).map((s) => (
            <button key={s.id} type="button" className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => { setPicked([...picked, s]); setQ('') }}>{s.firstName} {s.lastName}{s.registrationNumber ? ` · ${s.registrationNumber}` : ''}</button>
          ))}</div>
        )}
        {sibling && <p className="text-xs text-slate-500">{L('Two siblings share one session: they must be in the same level. For different levels, book two separate One-to-Ones.', 'الأخين في حصة واحدة لازم يكونوا في نفس المستوى. لو مستواهم مختلف، احجز لكل واحد لوحده.')}</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={row}><span className={lab}>{L('Place', 'المكان')}</span>
          <select className={sel} value={campusId} onChange={(e) => { setCampusId(e.target.value); setLevelId(''); setPriceId(''); setTeacherId('') }}><option value="">—</option>{(campuses?.data ?? []).map((c) => <option key={c.id} value={c.id}>{campusLabel(c)}</option>)}</select></label>
        <label className={row}><span className={lab}>{L('Level', 'المستوى')}</span>
          <select className={sel} value={levelId} disabled={!campusId} onChange={(e) => { setLevelId(e.target.value); setPriceId(''); setTeacherId('') }}><option value="">—</option>{(levels ?? []).map((l) => <option key={l.id} value={l.id}>{levelName(l)}</option>)}</select></label>
        <label className={row}><span className={lab}>{L('Plan', 'النظام')}</span>
          <select className={sel} value={priceId} disabled={!levelId} onChange={(e) => setPriceId(e.target.value)}><option value="">—</option>{usable.map((r) => <option key={r.id} value={r.id}>{planText(r.plan, ar)}{r.plan !== 'SESSION' ? ` · ${r.sessions} ${L('sessions', 'حصة')}` : ''} · {r.price.toLocaleString('en-US')}</option>)}</select></label>
        {price?.plan === 'SESSION' && <label className={row}><span className={lab}>{L('How many sessions', 'كام حصة')}</span><Input type="number" min={1} className="h-9 w-20" value={count} onChange={(e) => setCount(e.target.value)} /></label>}
      </div>
      {levelId && !usable.length && prices && <p className="text-xs text-amber-700">{L('This level has no One-to-One price yet: add it in the Prices tab first.', 'المستوى ده لسه مالوش سعر One-to-One: ضيفه الأول من تبويب الأسعار.')}</p>}
      {each && <p className="rounded bg-slate-50 px-2 py-1 text-xs">{L(`Each student pays ${each.amount.toLocaleString('en-US')} EGP for ${each.sessions} session(s)`, `كل طالب يدفع ${each.amount.toLocaleString('en-US')} ج.م لـ ${each.sessions} حصة`)}</p>}
      <div className={row}>
        <span className={lab}>{L('Weekly time', 'الميعاد الأسبوعي')}</span>
        {slots.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={sel} value={s.dayOfWeek} onChange={(e) => setSlot(i, { dayOfWeek: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select>
            <Input type="time" className="h-9 w-32" value={s.time} onChange={(e) => setSlot(i, { time: e.target.value })} />
            <select className={sel} value={s.mode} onChange={(e) => setSlot(i, { mode: e.target.value as Slot['mode'], roomId: '' })}><option value="BRANCH">{L('In the branch', 'في الفرع')}</option><option value="ONLINE">{L('Online', 'أونلاين')}</option></select>
            {s.mode === 'BRANCH' && !!rooms?.rooms?.length && <select className={sel} value={s.roomId} onChange={(e) => setSlot(i, { roomId: e.target.value })}><option value="">{L('Room', 'القاعة')}</option>{rooms.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
            {slots.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-500" /></Button>}
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setSlots([...slots, { dayOfWeek: 2, time: '16:00', mode: 'BRANCH', roomId: '' }])}><Plus className="me-1 h-3 w-3" />{L('Another weekly time', 'ميعاد تاني في الأسبوع')}</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={row}><span className={lab}>{L('Instructor (qualified and free at these times)', 'المدرب (مؤهل وفاضي في المواعيد دي)')}</span>
          <select className={sel} value={teacherId} disabled={!levelId} onChange={(e) => setTeacherId(e.target.value)}><option value="">{loadingTeachers ? L('Checking…', 'بيدوّر…') : '—'}</option>{(teachers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className={row}><span className={lab}>{L('Payment', 'الدفع')}</span>
          <select className={sel} value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}><option value="FULL">{L('In full before the start', 'كامل قبل البدء')}</option><option value="INSTALLMENTS">{L('Instalments allowed', 'مسموح بالتقسيط')}</option></select></label>
        <label className={row}><span className={lab}>{L('Instructor rate per session (empty = his rate)', 'أجر المدرب للحصة (فاضي = سعره)')}</span><Input type="number" min={0} className="h-9 w-32" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      </div>
      {levelId && teachers && !teachers.length && !loadingTeachers && <p className="text-xs text-amber-700">{L('No qualified instructor is free at these times. Try another time.', 'مفيش مدرب مؤهل فاضي في المواعيد دي. جرّب ميعاد تاني.')}</p>}
      <Button disabled={!picked.length || !campusId || !levelId || !price || !teacherId || save.isPending} onClick={() => save.mutate()}><UserCheck className="me-1 h-4 w-4" />{L('Book', 'احجز')}</Button>
    </CardContent></Card>
  )
}

export default function OneToOnePage() {
  const ar = useI18n().locale === 'ar'
  const { can } = useMyPermissions()
  const qc = useQueryClient()
  const [urlTab, setUrlTab] = useUrlTab()
  const [startStudent, setStartStudent] = useState<string | null>(null)
  useEffect(() => { setStartStudent(new URLSearchParams(window.location.search).get('student')) }, [])
  const tab = urlTab ?? (startStudent ? 'book' : 'list')
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><UserCheck className="h-5 w-5 text-indigo-600" /> One-to-One</h1>
        <p className="text-sm text-slate-500">{L('Private sessions: one student with one instructor at a fixed weekly time, in a branch or online.', 'حصص خاصة: طالب واحد مع مدرب واحد في ميعاد أسبوعي ثابت، في الفرع أو أونلاين.')}</p>
      </div>
      <Tabs value={tab} onValueChange={setUrlTab}>
        <TabsList>
          <TabsTrigger value="list">{L('The list', 'القايمة')}</TabsTrigger>
          {can('one_to_one', 'create') && <TabsTrigger value="book">{L('New booking', 'حجز جديد')}</TabsTrigger>}
          <TabsTrigger value="prices">{L('Prices', 'الأسعار')}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-4"><List canRenew={can('one_to_one', 'update')} ar={ar} /></TabsContent>
        {can('one_to_one', 'create') && <TabsContent value="book" className="mt-4"><Book ar={ar} startStudent={startStudent} onDone={() => { qc.invalidateQueries({ queryKey: ['one-to-one'] }); setUrlTab('list') }} /></TabsContent>}
        <TabsContent value="prices" className="mt-4"><Prices canEdit={can('one_to_one', 'update')} ar={ar} /></TabsContent>
      </Tabs>
    </div>
  )
}
