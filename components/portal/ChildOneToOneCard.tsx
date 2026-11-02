'use client'

/**
 * a02 M3 batch 2: a parent asks for a One-to-One from "My children": level, plan, weekly time, branch or online. The system checks an
 * instructor is free, then asks one instructor at a time (or books at once, setting). Own requests and how they stand are listed here.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Trash2, UserCheck } from 'lucide-react'
import { PLAN_LABEL, quote, type Plan, type PriceRow } from '@/lib/one-to-one/rules'
import { suggestParentPresent } from '@/lib/one-to-one/request-rules'

interface PlanRow { plan: Plan; sessions: number; price: number; siblingPrice: number | null; minutes: number | null }
interface Options {
  open: boolean; parentPicksInstructor: boolean; parentPresentUnderAge: number; age: number | null
  levels: { id: string; name: string; course: string; plans: PlanRow[] }[]
  siblings: { id: string; name: string }[]
  requests: { id: string; state: string; plan: string; sessions: number | null; slots: { dayOfWeek: number; time: string; mode?: string }[]; level: string; students: string[] }[]
}
interface Slot { dayOfWeek: number; time: string; mode: 'BRANCH' | 'ONLINE' }

const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'
const stateText = (s: string) => ({
  OFFERED: L('Waiting for an instructor to confirm', 'مستني مدرب يأكد'), NO_TEACHER: L('The branch will contact you', 'الفرع هيتواصل معاك'),
  BOOKED: L('Booked', 'اتحجز'), CANCELLED: L('Cancelled', 'اتلغى'),
} as Record<string, string>)[s] ?? s

interface Booking { id: string; level: string; sessions: { date: string; time: string; mode: string }[]; postponesLeft: number; postponesPerMonth: number; cancelHours: number; apologies: { id: string; date: string }[] }

function MyBookings({ studentId }: { studentId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['portal-one-to-one-sessions', studentId], queryFn: () => fetchApi<Booking[]>(`/api/guardian-portal/one-to-one/sessions?studentId=${studentId}`), enabled: !!studentId })
  const [f, setF] = useState<Record<string, { date?: string; newDate?: string; newTime?: string }>>({})
  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchApi('/api/guardian-portal/one-to-one/sessions', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Done', 'تم')); setF({}); qc.invalidateQueries({ queryKey: ['portal-one-to-one-sessions', studentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data?.length) return null
  const set = (k: string, patch: { date?: string; newDate?: string; newTime?: string }) => setF({ ...f, [k]: { ...f[k], ...patch } })
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{L('The sessions', 'الحصص')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data.map((b) => (
          <div key={b.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="font-semibold">{b.level}</p>
            {b.apologies.map((a) => (
              <div key={a.id} className="space-y-2 rounded bg-amber-50 p-2 text-xs">
                <p className="font-semibold text-amber-800">{L(`The instructor cannot come on ${a.date}. What would you like?`, `المدرب اعتذر عن حصة ${a.date}. تحب إيه؟`)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate({ eventId: a.id, choice: 'SUBSTITUTE' })}>{L('A substitute instructor', 'مدرب بديل')}</Button>
                  <Input type="date" aria-label={L('New date', 'الميعاد الجديد')} className="h-9 w-40" value={f[a.id]?.newDate ?? ''} onChange={(e) => set(a.id, { newDate: e.target.value })} />
                  <Input type="time" aria-label={L('New time', 'الوقت الجديد')} className="h-9 w-28" value={f[a.id]?.newTime ?? '16:00'} onChange={(e) => set(a.id, { newTime: e.target.value })} />
                  <Button size="sm" disabled={!f[a.id]?.newDate || send.isPending} onClick={() => send.mutate({ eventId: a.id, choice: 'POSTPONE', newDate: f[a.id]?.newDate, newTime: f[a.id]?.newTime ?? '16:00' })}>{L('A new date', 'ميعاد جديد')}</Button>
                </div>
              </div>
            ))}
            <p className="text-slate-600">{b.sessions.map((s) => `${dayName(new Date(`${s.date}T00:00:00Z`).getUTCDay())} ${s.date} ${s.time}`).join('، ') || L('No coming sessions', 'مفيش حصص جاية')}</p>
            {b.sessions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select className={sel} aria-label={L('Session to move', 'الحصة اللي هتتأجل')} value={f[b.id]?.date ?? ''} onChange={(e) => set(b.id, { date: e.target.value })}><option value="">{L('Move a session', 'أجّل حصة')}</option>{b.sessions.map((s) => <option key={s.date} value={s.date}>{s.date} {s.time}</option>)}</select>
                <Input type="date" aria-label={L('New date', 'الميعاد الجديد')} className="h-9 w-40" value={f[b.id]?.newDate ?? ''} onChange={(e) => set(b.id, { newDate: e.target.value })} />
                <Input type="time" aria-label={L('New time', 'الوقت الجديد')} className="h-9 w-28" value={f[b.id]?.newTime ?? '16:00'} onChange={(e) => set(b.id, { newTime: e.target.value })} />
                <Button size="sm" disabled={!f[b.id]?.date || !f[b.id]?.newDate || !b.postponesLeft || send.isPending} onClick={() => send.mutate({ groupId: b.id, date: f[b.id]?.date, newDate: f[b.id]?.newDate, newTime: f[b.id]?.newTime ?? '16:00' })}>{L('Move', 'أجّل')}</Button>
                <span className="text-slate-500">{L(`${b.postponesLeft} of ${b.postponesPerMonth} left this month; at least ${b.cancelHours} hours before`, `فاضل ${b.postponesLeft} من ${b.postponesPerMonth} الشهر ده؛ قبلها بـ ${b.cancelHours} ساعة على الأقل`)}</span>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ChildOneToOneCard({ studentId }: { studentId: string }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['portal-one-to-one', studentId], queryFn: () => fetchApi<Options>(`/api/guardian-portal/one-to-one?studentId=${studentId}`), enabled: !!studentId })
  const [levelId, setLevelId] = useState('')
  const [planKey, setPlanKey] = useState('')
  const [count, setCount] = useState('4')
  const [sibling, setSibling] = useState('')
  const [preferred, setPreferred] = useState('')
  const [slots, setSlots] = useState<Slot[]>([{ dayOfWeek: 0, time: '16:00', mode: 'BRANCH' }])
  const level = data?.levels.find((l) => l.id === levelId)
  const plan = level?.plans.find((p) => `${p.plan}|${p.sessions}` === planKey)
  const each = plan ? quote({ ...plan, levelId, scopeKey: '' } as PriceRow, Number(count) || 1, !!sibling) : null
  const slotsParam = encodeURIComponent(JSON.stringify(slots))
  const { data: check } = useQuery({
    queryKey: ['portal-one-to-one-check', studentId, levelId, slotsParam],
    queryFn: () => fetchApi<{ available: number; teachers: { id: string; name: string }[] }>(`/api/guardian-portal/one-to-one?studentId=${studentId}&levelId=${levelId}&slots=${slotsParam}`),
    enabled: !!levelId,
  })
  const setSlot = (i: number, patch: Partial<Slot>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal-one-to-one', studentId] })
  const ask = useMutation({
    mutationFn: () => fetchApi<{ state: string }>('/api/guardian-portal/one-to-one', {
      method: 'POST',
      body: JSON.stringify({ studentId, levelId, plan: plan!.plan, sessions: plan!.plan === 'SESSION' ? Number(count) || 1 : plan!.sessions, slots, ...(sibling && { siblingId: sibling }), ...(preferred && { preferredTeacherId: preferred }) }),
    }),
    onSuccess: (r) => { notify.success(r.state === 'BOOKED' ? L('Booked. The invoice is in your account.', 'اتحجز، والفاتورة في حسابك.') : L('Sent. An instructor will confirm soon.', 'اتبعت، ومدرب هيأكد قريب.')); setLevelId(''); setPlanKey(''); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/guardian-portal/one-to-one/${id}`, { method: 'DELETE' }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return null
  const lab = 'block text-xs text-slate-500'
  return (
    <div className="space-y-4">
      <MyBookings studentId={studentId} />
      {data.requests.length > 0 && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">{L('Your requests', 'طلباتك')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-semibold">{r.students.join(' + ')} · {r.level}</p>
                  <p className="text-slate-600">{r.slots.map((s) => `${dayName(s.dayOfWeek)} ${s.time}`).join('، ')} · {stateText(r.state)}</p>
                </div>
                {(r.state === 'OFFERED' || r.state === 'NO_TEACHER') && <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{L('Cancel', 'إلغاء')}</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><UserCheck className="h-4 w-4 text-indigo-600" /> {L('Ask for a One-to-One', 'اطلب One-to-One')}</CardTitle>
          <CardDescription>{L('Private sessions with one instructor at a fixed weekly time.', 'حصص خاصة مع مدرب واحد في ميعاد أسبوعي ثابت.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!data.open && <p className="text-amber-700">{L('Booking from here is closed. Please call the branch.', 'الحجز من هنا مقفول، كلم الفرع.')}</p>}
          {data.open && !data.levels.length && <p className="text-slate-500">{L('No One-to-One is available right now. Please call the branch.', 'مفيش One-to-One متاح دلوقتي، كلم الفرع.')}</p>}
          {data.open && data.levels.length > 0 && (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1"><span className={lab}>{L('Level', 'المستوى')}</span>
                  <select className={sel} value={levelId} onChange={(e) => { setLevelId(e.target.value); setPlanKey('') }}><option value="">—</option>{data.levels.map((l) => <option key={l.id} value={l.id}>{l.course} — {l.name}</option>)}</select></label>
                <label className="space-y-1"><span className={lab}>{L('Plan', 'النظام')}</span>
                  <select className={sel} value={planKey} disabled={!levelId} onChange={(e) => setPlanKey(e.target.value)}><option value="">—</option>{(level?.plans ?? []).map((p) => <option key={`${p.plan}|${p.sessions}`} value={`${p.plan}|${p.sessions}`}>{PLAN_LABEL[p.plan][ar ? 'ar' : 'en']}{p.plan !== 'SESSION' ? ` · ${p.sessions} ${L('sessions', 'حصة')}` : ''} · {p.price.toLocaleString('en-US')} {L('EGP', 'ج.م')}</option>)}</select></label>
                {plan?.plan === 'SESSION' && <label className="space-y-1"><span className={lab}>{L('How many sessions', 'كام حصة')}</span><Input type="number" min={1} className="h-9 w-20" value={count} onChange={(e) => setCount(e.target.value)} /></label>}
                {data.siblings.length > 0 && <label className="space-y-1"><span className={lab}>{L('With a sibling in the same session (same level)', 'مع أخوه في نفس الحصة (نفس المستوى)')}</span>
                  <select className={sel} value={sibling} onChange={(e) => setSibling(e.target.value)}><option value="">{L('No', 'لا')}</option>{data.siblings.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
              </div>
              {each && <p className="rounded bg-slate-50 px-2 py-1 text-xs">{L(`Each student pays ${each.amount.toLocaleString('en-US')} EGP for ${each.sessions} session(s)`, `كل طالب يدفع ${each.amount.toLocaleString('en-US')} ج.م لـ ${each.sessions} حصة`)}{plan?.minutes ? ` · ${plan.minutes} ${L('min', 'دقيقة')}` : ''}</p>}
              <div className="space-y-1">
                <span className={lab}>{L('Weekly time', 'الميعاد الأسبوعي')}</span>
                {slots.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select className={sel} value={s.dayOfWeek} onChange={(e) => setSlot(i, { dayOfWeek: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select>
                    <Input type="time" className="h-9 w-32" value={s.time} onChange={(e) => setSlot(i, { time: e.target.value })} />
                    <select className={sel} value={s.mode} onChange={(e) => setSlot(i, { mode: e.target.value as Slot['mode'] })}><option value="BRANCH">{L('In the branch', 'في الفرع')}</option><option value="ONLINE">{L('Online', 'أونلاين')}</option></select>
                    {slots.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-500" /></Button>}
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => setSlots([...slots, { dayOfWeek: 2, time: '16:00', mode: 'BRANCH' }])}><Plus className="me-1 h-3 w-3" />{L('Another weekly time', 'ميعاد تاني في الأسبوع')}</Button>
              </div>
              {levelId && check && (check.available
                ? <p className="text-xs text-emerald-700">{L('An instructor is free at this time.', 'فيه مدرب فاضي في الميعاد ده.')}</p>
                : <p className="text-xs text-amber-700">{L('No instructor is free at this time. Please try another time.', 'مفيش مدرب فاضي في الميعاد ده، جرّب ميعاد تاني.')}</p>)}
              {data.parentPicksInstructor && !!check?.teachers.length && (
                <label className="space-y-1"><span className={lab}>{L('Instructor you prefer (optional)', 'المدرب اللي تفضّله (اختياري)')}</span>
                  <select className={sel} value={preferred} onChange={(e) => setPreferred(e.target.value)}><option value="">—</option>{check.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              )}
              {suggestParentPresent(data.age, slots, data.parentPresentUnderAge) && <p className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-800">{L('For this age we suggest a parent stays nearby during online sessions.', 'في السن ده بنقترح ولي الأمر يكون موجود في الحصص الأونلاين.')}</p>}
              <Button disabled={!plan || !check?.available || ask.isPending} onClick={() => ask.mutate()}>{L('Send the request', 'ابعت الطلب')}</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
