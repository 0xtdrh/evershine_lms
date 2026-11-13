'use client'

/**
 * Six phases 1-B: booking a course from the family account, one question per step:
 * the way (live online / recorded / branch) → the group (details: days, start, place, seats, price) or "none fits" →
 * a code (optional) → review + agree → done ("pay within N hours" / "waits for TechNova" / "waiting list").
 * APIs GET/POST /api/guardian-portal/family/book.
 */

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n, dayName } from '@/lib/i18n/client'

type Group = { id: string; name: string; campusId: string; campusName: string; online: boolean; slots: { dayOfWeek: number; time: string }[]; startDate: string | null; free: number | null; full: boolean; price: number; installments: boolean }
type Options = {
  person: { key: string; firstName: string; age: number | null }
  course: { slug: string; title: { en: string; ar: string } }
  level: { id: string; name: string; course: string; perMonth: boolean }
  code: { code: string; kind: string; value: number } | null
  online: Group[] | null
  branch: { id: string; name: string; groups: Group[] }[] | null
  recorded: { plans: { plan: 'ONE_TIME' | 'SUBSCRIPTION'; price: number; days: number | null }[] } | null
}
type Booking = { status: string; statusText: { en: string; ar: string }; holdUntil: string | null; invoice: { total: number } | null }
type Mode = 'ONLINE' | 'RECORDED' | 'BRANCH'

const opt = (on: boolean) => `w-full rounded-xl border-2 p-3 text-start transition ${on ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`

export function BookCourseDialog({ person, slug, onClose }: { person: string; slug: string; onClose: () => void }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const t = (x: { en: string; ar: string }) => (ar ? x.ar : x.en)
  const bi = (m: string) => (m.includes(' · ') ? m.split(' · ')[ar ? 1 : 0] : m)
  const qc = useQueryClient()
  const [o, setO] = useState<Options | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<Mode | null>(null)
  const [campus, setCampus] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null | 'NONE'>(null)
  const [plan, setPlan] = useState<'ONE_TIME' | 'SUBSCRIPTION' | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Booking | null>(null)

  const load = async (withCode?: string) => {
    setErr(null)
    try {
      const r = await fetchApi<Options>(`/api/guardian-portal/family/book?person=${encodeURIComponent(person)}&slug=${encodeURIComponent(slug)}${withCode ? `&code=${encodeURIComponent(withCode)}` : ''}`)
      setO(r)
      const ways = [r.online ? 'ONLINE' : null, r.branch ? 'BRANCH' : null, r.recorded?.plans.length ? 'RECORDED' : null].filter(Boolean) as Mode[]
      if (ways.length === 1) setMode(ways[0])
    } catch (e) { setErr(bi((e as Error).message)) }
  }
  useEffect(() => { void load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, slug])

  const when = (g: Group) => g.slots.map((s) => `${dayName(s.dayOfWeek)} ${s.time}`).join(' · ') || g.name
  const groups: Group[] = mode === 'ONLINE' ? o?.online ?? [] : mode === 'BRANCH' ? o?.branch?.find((b) => b.id === campus)?.groups ?? [] : []
  const chosen = groups.find((g) => g.id === group) ?? null
  const price = mode === 'RECORDED' ? o?.recorded?.plans.find((p) => p.plan === plan)?.price ?? null : chosen?.price ?? null
  const ready = !!mode && (mode === 'RECORDED' ? !!plan : mode === 'BRANCH' ? !!campus && group !== null : group !== null) && agree

  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetchApi<Booking>('/api/guardian-portal/family/book', {
        method: 'POST',
        body: JSON.stringify({ person, slug, mode, groupId: group && group !== 'NONE' ? group : null, campusId: campus, plan, code: o?.code?.code ?? null, agree: true }),
      })
      setDone(r)
      void qc.invalidateQueries({ queryKey: ['family'] }); void qc.invalidateQueries({ queryKey: ['family-bookings'] }); void qc.invalidateQueries({ queryKey: ['family-courses'] })
    } catch (e) { setErr(bi((e as Error).message)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={L('Book a course', 'احجز كورس')}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">{L('Book for', 'حجز لـ')} {o?.person.firstName ?? '…'}</p>
            <h2 className="text-lg font-bold text-slate-900">{o ? t(o.course.title) : L('Loading…', 'بيحمّل…')}</h2>
            {o ? <p className="text-sm text-slate-600">{L('Starts at', 'بيبدأ من')} {o.level.course} — {o.level.name}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label={L('Close', 'اقفل')} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <p className="text-xl font-bold text-emerald-700">{done.status === 'CONFIRMED' ? L('Booked and confirmed!', 'اتحجز واتأكد!') : done.status === 'HOLD' ? L('The seat is held for you', 'المكان اتحجزلك') : done.status === 'WAITING' ? L('On the waiting list', 'اتسجل في قايمة الانتظار') : L('Booking sent', 'الحجز اتبعت')}</p>
            <p className="text-sm text-slate-700">
              {done.status === 'HOLD' ? L(`Pay the first invoice (${done.invoice?.total ?? ''} EGP) before ${done.holdUntil ? new Date(done.holdUntil).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} to confirm it. You can pay online, by wallet, or upload a transfer receipt.`, `ادفع أول فاتورة (${done.invoice?.total ?? ''} ج.م) قبل ${done.holdUntil ? new Date(done.holdUntil).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} علشان المكان يتأكد. تقدر تدفع أونلاين أو من المحفظة أو ترفع صورة تحويل.`)
                : done.status === 'REVIEW' ? L('TechNova will confirm it soon and you will get a notification.', 'TechNova هتأكده قريب وهيوصلك إشعار.')
                : done.status === 'WAITING' ? L('We will tell you as soon as a seat is free.', 'هنبلغك أول ما يفضى مكان.')
                : L('Lessons open according to the course plan.', 'الدروس بتفتح حسب خطة الكورس.')}
            </p>
            <div className="flex justify-center gap-2">
              {done.status === 'HOLD' ? <a href="/dashboard/fees" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">{L('Pay now', 'ادفع دلوقتي')}</a> : null}
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">{L('Close', 'اقفل')}</button>
            </div>
          </div>
        ) : !o ? (
          err ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</p> : <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
        ) : (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-900">1. {L('How?', 'إزاي؟')}</legend>
              <div className="grid gap-2">
                {o.online ? <button type="button" className={opt(mode === 'ONLINE')} onClick={() => { setMode('ONLINE'); setGroup(null); setCampus(null) }}><b className="block text-sm">{L('Live online', 'لايف أونلاين')}</b><span className="text-xs text-slate-600">{L('A small group with an instructor, from home', 'جروب صغير مع مدرب من البيت')}</span></button> : null}
                {o.branch?.length ? <button type="button" className={opt(mode === 'BRANCH')} onClick={() => { setMode('BRANCH'); setGroup(null) }}><b className="block text-sm">{L('At a branch', 'في الفرع')}</b><span className="text-xs text-slate-600">{L('With the robots and kits, at a TechNova branch', 'مع الروبوتات والأدوات في فرع TechNova')}</span></button> : null}
                {o.recorded?.plans.length ? <button type="button" className={opt(mode === 'RECORDED')} onClick={() => { setMode('RECORDED'); setGroup(null); setCampus(null) }}><b className="block text-sm">{L('Recorded', 'مسجل')}</b><span className="text-xs text-slate-600">{L('Watch any time, at your own pace', 'يتفرج في أي وقت وعلى راحته')}</span></button> : null}
                {!o.online && !o.branch?.length && !o.recorded?.plans.length ? <p className="text-sm text-slate-600">{L('No way is open for this course yet. Ask TechNova.', 'مفيش طريقة متاحة للكورس ده لسه. كلّم TechNova.')}</p> : null}
              </div>
            </fieldset>

            {mode === 'BRANCH' ? (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-slate-900">2. {L('Which branch?', 'أنهي فرع؟')}</legend>
                <div className="flex flex-wrap gap-2">{o.branch!.map((b) => <button key={b.id} type="button" onClick={() => { setCampus(b.id); setGroup(null) }} aria-pressed={campus === b.id} className={`rounded-full border px-3 py-1.5 text-sm ${campus === b.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300'}`}>{b.name}</button>)}</div>
              </fieldset>
            ) : null}

            {(mode === 'ONLINE' || (mode === 'BRANCH' && campus)) ? (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-slate-900">{mode === 'BRANCH' ? 3 : 2}. {L('Which time?', 'أنهي ميعاد؟')}</legend>
                <div className="grid gap-2">
                  {groups.map((g) => (
                    <button key={g.id} type="button" onClick={() => setGroup(g.id)} className={opt(group === g.id)}>
                      <b className="block text-sm">{when(g)}</b>
                      <span className="block text-xs text-slate-600">
                        {g.startDate ? `${L('starts', 'بيبدأ')} ${new Date(g.startDate).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' })} · ` : `${L('starting soon', 'بيبدأ قريب')} · `}
                        {g.full ? L('full — waiting list', 'كامل — قايمة انتظار') : g.free != null ? L(`${g.free} seats left`, `فاضل ${g.free} أماكن`) : L('seats available', 'فيه أماكن')}
                        {' · '}<span dir="ltr">{g.price.toLocaleString('en-US')}</span> {L('EGP', 'ج.م')}{o.level.perMonth ? ` / ${L('month', 'شهر')}` : ''}{g.installments ? ` · ${L('instalments', 'تقسيط')}` : ''}
                      </span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setGroup('NONE')} className={opt(group === 'NONE')}><b className="block text-sm">{L('None of these times fit', 'مفيش ميعاد مناسب')}</b><span className="text-xs text-slate-600">{L('Join the waiting list; we call you when a time opens', 'ادخل قايمة الانتظار وهنكلمك لما يفتح ميعاد')}</span></button>
                </div>
              </fieldset>
            ) : null}

            {mode === 'RECORDED' ? (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-slate-900">2. {L('Which plan?', 'أنهي نظام؟')}</legend>
                <div className="grid gap-2">{o.recorded!.plans.map((p) => (
                  <button key={p.plan} type="button" onClick={() => setPlan(p.plan)} className={opt(plan === p.plan)}>
                    <b className="block text-sm">{p.plan === 'ONE_TIME' ? L('Pay once — yours for good', 'تدفع مرة واحدة — ليك على طول') : L(`Subscription — ${p.days} days`, `اشتراك — ${p.days} يوم`)}</b>
                    <span className="text-xs text-slate-600"><span dir="ltr">{p.price.toLocaleString('en-US')}</span> {L('EGP', 'ج.م')}</span>
                  </button>
                ))}</div>
              </fieldset>
            ) : null}

            {mode ? (
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-900">{L('Have a code? (optional)', 'عندك كود؟ (اختياري)')}</label>
                {o.code ? <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800" dir="auto">✓ <span dir="ltr">{o.code.code}</span> — {o.code.kind === 'FREE' ? L('free', 'مجاني') : o.code.kind === 'PREPAID' ? L('paid in advance', 'مدفوع مقدماً') : o.code.kind === 'PERCENT' ? L(`${o.code.value}% off`, `خصم ${o.code.value}%`) : L(`${o.code.value} EGP off`, `خصم ${o.code.value} ج.م`)}</p> : (
                  <div className="flex gap-2"><input dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="NILE-AB12CD" /><button type="button" disabled={!code.trim()} onClick={() => void load(code)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{L('Use', 'استخدم')}</button></div>
                )}
              </div>
            ) : null}

            {mode ? (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                <p><b>{o.person.firstName}</b> · {t(o.course.title)} · {mode === 'ONLINE' ? L('live online', 'لايف أونلاين') : mode === 'RECORDED' ? L('recorded', 'مسجل') : o.branch?.find((b) => b.id === campus)?.name ?? L('branch', 'فرع')}</p>
                {chosen ? <p>{when(chosen)}</p> : group === 'NONE' ? <p>{L('Waiting list', 'قايمة الانتظار')}</p> : null}
                {price != null ? <p>{L('Price', 'السعر')}: <span dir="ltr">{price.toLocaleString('en-US')}</span> {L('EGP', 'ج.م')}{o.code ? ` — ${L('the code is taken off the invoice', 'الكود بيتخصم من الفاتورة')}` : ''}</p> : null}
                <label className="flex items-start gap-2"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4" /><span>{L('I agree to the course rules and the payment and refund policies.', 'موافق على قواعد الكورس وسياسات الدفع والاسترداد.')} <a href="/policies" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{L('Read', 'اقرأ')}</a></span></label>
              </div>
            ) : null}

            {err ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
            <button type="button" disabled={!ready || busy} onClick={() => void send()} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? L('Booking…', 'بيتحجز…') : L('Book', 'احجز')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
