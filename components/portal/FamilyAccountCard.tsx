'use client'

/**
 * Six phases 1-A: the family account inside "My children" — the people of the family (children not registered yet +
 * registered students), "add a child", the courses that suit each one (age, opened by TechNova), e-mail confirmation.
 * Booking from here comes in batch B. APIs /api/guardian-portal/family*.
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, Sparkles, X } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { ageText } from '@/lib/site/courses'
import { BookCourseDialog } from './BookCourseDialog'

type Person = { key: string; memberId: string | null; studentId: string | null; firstName: string; lastName: string; dob: string | null; age: number | null; gender: string | null; isSelf: boolean; registrationNumber: string | null }
type Family = { account: { firstName: string; email: string | null; emailVerified: boolean; selfAccount: boolean }; people: Person[]; settings: { unsuitable: string; emailCheck: boolean } }
type MyBooking = { id: string; status: string; statusText: { en: string; ar: string }; mode: string; course: { en: string; ar: string }; who: string; level: string | null; group: { name: string; campus: string } | null; invoice: { total: number; paid: number; status: string; proofStatus: string | null } | null; holdUntil: string | null; reason: string | null }
type Course = { slug: string; title: { en: string; ar: string }; summary: { en: string; ar: string }; imageUrl: string | null; color: string | null; minAge: number | null; maxAge: number | null; trackName: string | null; levels: number; modes: { online: boolean; recorded: boolean; branch: boolean }; price: { online: number | null; onlinePer: string; recorded: number | null }; fit: string; fitText: { en: string; ar: string }; bookable: boolean }

const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'

export function FamilyAccountCard() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const t = (x: { en: string; ar: string }) => (ar ? x.ar : x.en)
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['family'], queryFn: () => fetchApi<Family>('/api/guardian-portal/family'), retry: false })
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [m, setM] = useState({ firstName: '', lastName: '', dob: '', gender: '', school: '' })
  const [busy, setBusy] = useState(false)
  const [booking, setBooking] = useState<{ person: string; slug: string } | null>(null)
  const [wantSlug, setWantSlug] = useState<string | null>(null)

  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search)
      setWelcome(sp.get('welcome') === '1')
      setWantSlug(sp.get('book'))
    } catch { /* ignore */ }
  }, [])
  const people = data?.people ?? []
  const current = people.find((p) => p.key === sel) ?? people[0] ?? null
  const courses = useQuery({ queryKey: ['family-courses', current?.key], queryFn: () => fetchApi<{ courses: Course[]; unsuitable: string }>(`/api/guardian-portal/family/courses?person=${encodeURIComponent(current!.key)}`), enabled: !!current })
  const bookings = useQuery({ queryKey: ['family-bookings'], queryFn: () => fetchApi<MyBooking[]>('/api/guardian-portal/family/bookings'), enabled: !!data })
  // a course page sent the family here (?book=<course>): open the booking for the only child, or once one is chosen
  useEffect(() => {
    if (wantSlug && current && (people.length === 1 || sel)) { setBooking({ person: current.key, slug: wantSlug }); setWantSlug(null) }
  }, [wantSlug, current, people.length, sel])

  if (error || isLoading || !data) return null // old accounts without a family record simply do not see the card

  const save = async () => {
    setBusy(true)
    try {
      const row = await fetchApi<{ id: string }>('/api/guardian-portal/family/members', { method: 'POST', body: JSON.stringify({ ...m, gender: m.gender || undefined, school: m.school || null }) })
      notify.success(L('Added', 'اتضاف'))
      setAdding(false); setM({ firstName: '', lastName: data.account.selfAccount ? '' : m.lastName, dob: '', gender: '', school: '' })
      await qc.invalidateQueries({ queryKey: ['family'] })
      setSel(`m:${row.id}`)
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const cancelBooking = async (id: string) => {
    if (!confirm(L('Cancel this booking?', 'تلغي الحجز ده؟'))) return
    try { await fetchApi(`/api/guardian-portal/family/bookings/${id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['family-bookings'] }); void qc.invalidateQueries({ queryKey: ['family'] }) } catch (e) { notify.error((e as Error).message) }
  }
  const remove = async (p: Person) => {
    if (!p.memberId || !confirm(L(`Remove ${p.firstName}?`, `تشيل ${p.firstName}؟`))) return
    try {
      await fetchApi(`/api/guardian-portal/family/members/${p.memberId}`, { method: 'DELETE' })
      setSel(null)
      void qc.invalidateQueries({ queryKey: ['family'] })
    } catch (e) { notify.error((e as Error).message) }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {welcome ? (
        <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          <Sparkles className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
          <p>{L(`Welcome ${data.account.firstName}! Your account is ready. Add your children, then see the courses that suit each one.`, `أهلاً ${data.account.firstName}! حسابك جاهز. ضيف ولادك وشوف الكورسات المناسبة لكل واحد.`)}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{L('My family', 'عيلتي')}</h2>
        <button type="button" onClick={() => setAdding((x) => !x)} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" aria-hidden /> {data.account.selfAccount && !people.length ? L('Add myself', 'ضيف نفسي') : L('Add a child', 'ضيف ابن / بنت')}
        </button>
      </div>

      {adding ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">{L('First name', 'الاسم الأول')}<input className={input} value={m.firstName} onChange={(e) => setM({ ...m, firstName: e.target.value })} /></label>
            <label className="text-sm">{L('Family name', 'اسم العيلة')}<input className={input} value={m.lastName} onChange={(e) => setM({ ...m, lastName: e.target.value })} /></label>
            <label className="text-sm">{L('Date of birth', 'تاريخ الميلاد')}<input type="date" dir="ltr" className={input} value={m.dob} onChange={(e) => setM({ ...m, dob: e.target.value })} /></label>
            <label className="text-sm">{L('Boy / girl', 'ولد / بنت')}<select className={input} value={m.gender} onChange={(e) => setM({ ...m, gender: e.target.value })}><option value="">—</option><option value="MALE">{L('Boy', 'ولد')}</option><option value="FEMALE">{L('Girl', 'بنت')}</option></select></label>
            <label className="text-sm sm:col-span-2">{L('School (optional)', 'المدرسة (اختياري)')}<input className={input} value={m.school} onChange={(e) => setM({ ...m, school: e.target.value })} /></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy || !m.firstName || !m.lastName || !m.dob || !m.gender} onClick={() => void save()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? L('Saving…', 'بيتحفظ…') : L('Save', 'احفظ')}</button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm">{L('Cancel', 'إلغاء')}</button>
          </div>
        </div>
      ) : null}

      {people.length ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={L('Family', 'العيلة')}>
          {people.map((p) => (
            <span key={p.key} className={`inline-flex items-center gap-1 rounded-full border-2 ${current?.key === p.key ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}>
              <button type="button" role="tab" aria-selected={current?.key === p.key} onClick={() => setSel(p.key)} className="px-3 py-1.5 text-sm font-medium text-slate-900">
                {p.firstName}{p.age != null ? <span className="text-slate-500"> · {L(`${p.age} y`, `${p.age} سنة`)}</span> : null}
                {p.registrationNumber ? <span className="ms-1 text-xs text-emerald-700">✓</span> : null}
              </button>
              {p.memberId && !p.studentId ? <button type="button" onClick={() => void remove(p)} aria-label={L(`Remove ${p.firstName}`, `شيل ${p.firstName}`)} className="pe-2 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button> : null}
            </span>
          ))}
        </div>
      ) : !adding ? <p className="text-sm text-slate-600">{L('No one added yet. Start with “Add a child”.', 'لسه مفيش حد. ابدأ بـ «ضيف ابن / بنت».')}</p> : null}

      {current ? (
        <div>
          <h3 className="mb-2 text-base font-semibold text-slate-900">{L(`Courses for ${current.firstName}`, `كورسات مناسبة لـ ${current.firstName}`)}</h3>
          {courses.isLoading ? <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p> : !courses.data?.courses.length ? (
            <p className="text-sm text-slate-600">{L('No courses are open on the website yet.', 'مفيش كورسات متاحة لسه.')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {courses.data.courses.map((c) => (
                <article key={c.slug} className={`flex flex-col rounded-xl border p-3 ${c.bookable || c.fit === 'ENROLLED' ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-70'}`} style={{ borderTopWidth: 4, borderTopColor: c.color ?? undefined }}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-slate-900">{t(c.title)}</h4>
                    {!c.bookable && c.fit !== 'ENROLLED' ? <Lock className="h-4 w-4 flex-none text-slate-400" aria-hidden /> : null}
                  </div>
                  {c.trackName ? <p className="text-xs text-slate-500">{c.trackName}</p> : null}
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{t(c.summary)}</p>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {ageText(c.minAge, c.maxAge, ar) ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{ageText(c.minAge, c.maxAge, ar)}</span> : null}
                    {c.modes.online ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">{L('Live online', 'لايف أونلاين')}</span> : null}
                    {c.modes.recorded ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">{L('Recorded', 'مسجل')}</span> : null}
                    {c.modes.branch ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{L('At a branch', 'في الفرع')}</span> : null}
                  </div>
                  <p className={`mt-2 text-xs font-semibold ${c.fit === 'OPENED' || c.fit === 'SUITABLE' ? 'text-emerald-700' : c.fit === 'ENROLLED' ? 'text-blue-700' : 'text-slate-500'}`}>{t(c.fitText)}</p>
                  {c.price.online != null || c.price.recorded != null ? (
                    <p className="mt-1 text-sm text-slate-800"><span dir="ltr">{(c.price.online ?? c.price.recorded ?? 0).toLocaleString('en-US')}</span> {L('EGP', 'ج.م')}{c.price.online != null ? ` / ${c.price.onlinePer === 'MONTH' ? L('month', 'شهر') : L('level', 'مستوى')}` : ''}</p>
                  ) : null}
                <div className="mt-auto pt-2">
                    {c.bookable ? <button type="button" onClick={() => setBooking({ person: current.key, slug: c.slug })} className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white">{L('Book', 'احجز')}</button>
                      : c.fit !== 'ENROLLED' ? <button type="button" onClick={() => setBooking({ person: current.key, slug: c.slug })} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700">{L('I have a code', 'عندي كود')}</button> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">{L('A locked course does not suit the age: ask us to open it, or use a code that opens it.', 'الكورس المقفول مش مناسب للسن: اطلب نفتحهولك، أو استخدم كود بيفتحه.')}</p>
        </div>
      ) : null}

      {bookings.data?.length ? (
        <div>
          <h3 className="mb-2 text-base font-semibold text-slate-900">{L('My bookings', 'حجوزاتي')}</h3>
          <ul className="space-y-2">
            {bookings.data.map((b) => (
              <li key={b.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{t(b.course)} · {b.who}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : b.status === 'HOLD' ? 'bg-amber-50 text-amber-800' : ['EXPIRED', 'CANCELLED', 'REJECTED'].includes(b.status) ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-800'}`}>{t(b.statusText)}</span>
                </div>
                <p className="mt-1 text-slate-600">{b.level ?? ''}{b.group ? ` · ${b.group.name} · ${b.group.campus}` : ''}</p>
                {b.status === 'HOLD' && b.holdUntil ? <p className="mt-1 text-amber-800">{L('Pay before', 'ادفع قبل')} {new Date(b.holdUntil).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{b.invoice ? ` · ${b.invoice.total - b.invoice.paid} ${L('EGP', 'ج.م')}` : ''}{b.invoice?.proofStatus === 'PENDING' ? ` · ${L('receipt being checked', 'الإيصال بيتراجع')}` : ''}</p> : null}
                {b.reason && ['EXPIRED', 'CANCELLED', 'REJECTED'].includes(b.status) ? <p className="mt-1 text-slate-500">{b.reason.includes(' · ') ? b.reason.split(' · ')[ar ? 1 : 0] : b.reason}</p> : null}
                <div className="mt-2 flex gap-2">
                  {b.status === 'HOLD' ? <a href="/dashboard/fees" className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">{L('Pay', 'ادفع')}</a> : null}
                  {['REVIEW', 'WAITING'].includes(b.status) || (b.status === 'HOLD' && !b.invoice?.paid) ? <button type="button" onClick={() => void cancelBooking(b.id)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">{L('Cancel', 'إلغاء')}</button> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {booking ? <BookCourseDialog person={booking.person} slug={booking.slug} onClose={() => { setBooking(null); void qc.invalidateQueries({ queryKey: ['family-bookings'] }) }} /> : null}
      {wantSlug && !people.length ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{L('Add your child first, then the booking opens.', 'ضيف ابنك الأول وبعدها الحجز هيفتح.')}</p> : null}
      {wantSlug && people.length > 1 && !sel ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{L('Choose who you are booking for above.', 'اختار انت بتحجز لمين فوق.')}</p> : null}

      {data.settings.emailCheck && !data.account.emailVerified ? <EmailConfirm email={data.account.email} /> : null}
    </section>
  )
}

function EmailConfirm({ email }: { email: string | null }) {
  const qc = useQueryClient()
  const [mail, setMail] = useState(email ?? '')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const send = async () => {
    try { await fetchApi('/api/guardian-portal/family/email', { method: 'POST', body: JSON.stringify({ action: 'send', email: mail }) }); setSent(true) } catch (e) { notify.error((e as Error).message) }
  }
  const check = async () => {
    try { await fetchApi('/api/guardian-portal/family/email', { method: 'POST', body: JSON.stringify({ action: 'check', code }) }); notify.success(L('E-mail confirmed', 'الإيميل اتأكد')); void qc.invalidateQueries({ queryKey: ['family'] }) } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-semibold text-amber-900">{L('Confirm your e-mail', 'أكد الإيميل بتاعك')}</p>
      {!sent ? (
        <div className="mt-2 flex flex-wrap gap-2"><input dir="ltr" type="email" className={`${input} max-w-xs`} value={mail} onChange={(e) => setMail(e.target.value)} /><button type="button" onClick={() => void send()} className="rounded-xl bg-amber-600 px-3 py-2 font-semibold text-white">{L('Send a code', 'ابعت كود')}</button></div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2"><input dir="ltr" inputMode="numeric" maxLength={6} className={`${input} max-w-[10rem]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" /><button type="button" onClick={() => void check()} className="rounded-xl bg-amber-600 px-3 py-2 font-semibold text-white">{L('Confirm', 'أكّد')}</button></div>
      )}
    </div>
  )
}
