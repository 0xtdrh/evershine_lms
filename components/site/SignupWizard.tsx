'use client'

/**
 * Six phases 1-a: the website sign-up steps (course & way → time → who → family → students → review → pay → done).
 * Sends to /api/public/signup, which makes admission requests that staff approve. The draft is kept in this tab
 * (sessionStorage) so a refresh does not lose it.
 */

import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import type { PublicCourse } from '@/lib/site/courses-store'
import { ageText } from '@/lib/site/courses'
import { normalizePhone } from '@/lib/site/request-rules'
import { MIN_SELF_AGE, ageOnDay, stepsFor, type SignupStep } from '@/lib/site/signup'
import { getSid, track } from './tracker'

type Student = { firstName: string; lastName: string; dob: string; gender: '' | 'MALE' | 'FEMALE'; school: string; experience: string }
interface Draft {
  mode: '' | 'ONLINE' | 'RECORDED'; groupId: string; who: '' | 'PARENT' | 'SELF'
  parent: { firstName: string; lastName: string; phone: string; email: string; relation: string }
  selfPhone: string; selfEmail: string; country: string; city: string
  students: Student[]; agree: boolean; code: string; paymentRef: string; referral: string
}
const emptyStudent = (): Student => ({ firstName: '', lastName: '', dob: '', gender: '', school: '', experience: '' })
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date())

export function SignupWizard({ course }: { course: PublicCourse }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const T = (en: string, a: string) => (ar ? a : en)
  const t = (x: { en: string; ar: string }) => (ar ? x.ar : x.en)
  const key = `tn_join_${course.slug}`
  const onlyMode = course.modes.online && !course.modes.recorded ? 'ONLINE' : !course.modes.online && course.modes.recorded ? 'RECORDED' : ''
  const [d, setD] = useState<Draft>(() => ({
    mode: onlyMode, groupId: '', who: '', parent: { firstName: '', lastName: '', phone: '', email: '', relation: '' },
    selfPhone: '', selfEmail: '', country: 'Egypt', city: '', students: [emptyStudent()], agree: false, code: '', paymentRef: '', referral: '',
  }))
  const [step, setStep] = useState<SignupStep>('course')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeInfo, setCodeInfo] = useState<{ ok: boolean; text: string } | null>(null)
  const [done, setDone] = useState<{ ref: string; count: number; existingFamily: boolean } | null>(null)

  useEffect(() => {
    try { const s = sessionStorage.getItem(key); if (s) setD((x) => ({ ...x, ...JSON.parse(s) })) } catch { /* private mode */ }
    try { const r = new URLSearchParams(location.search).get('ref'); if (r) setD((x) => ({ ...x, referral: r })) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(d)) } catch { /* private mode */ } }, [d, key])

  const steps = useMemo(() => stepsFor(d.mode || null, d.who || null), [d.mode, d.who])
  const idx = steps.indexOf(step)
  const days = ar ? ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const group = course.onlineGroups.find((g) => g.id === d.groupId)
  const price = d.mode === 'ONLINE' ? course.price.online : d.mode === 'RECORDED' ? course.price.recorded : null
  const when = (g: { slots: { dayOfWeek: number; time: string }[]; name: string }) => g.slots.map((x) => `${days[x.dayOfWeek]} ${x.time}`).join(' · ') || g.name
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })
  const setStu = (i: number, patch: Partial<Student>) => set({ students: d.students.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  const check = (): string => {
    if (step === 'course' && !d.mode) return T('Choose how to learn', 'اختار طريقة التعلم')
    if (step === 'who' && !d.who) return T('Who is signing up?', 'مين بيسجّل؟')
    if (step === 'family') {
      if (d.parent.firstName.trim().length < 2 || d.parent.lastName.trim().length < 2) return T("Write the parent's name", 'اكتب اسم ولي الأمر')
      if (!normalizePhone(d.parent.phone)) return T('Write a valid mobile number (e.g. 01012345678)', 'اكتب رقم موبايل صحيح (مثلاً 01012345678)')
      if (d.city.trim().length < 2) return T('Write the city', 'اكتب المدينة')
    }
    if (step === 'students') {
      for (const s of d.students) {
        if (s.firstName.trim().length < 2 || s.lastName.trim().length < 2) return T("Write the student's name", 'اكتب اسم الطالب')
        if (!s.dob) return T('Write the date of birth', 'اكتب تاريخ الميلاد')
        if (!s.gender) return T('Choose boy or girl', 'اختار ولد ولا بنت')
      }
      if (d.who === 'SELF') {
        if (ageOnDay(d.students[0].dob, today()) < MIN_SELF_AGE) return T(`Signing up alone is from age ${MIN_SELF_AGE}; a parent signs up younger students`, `التسجيل لوحدك من سن ${MIN_SELF_AGE}، والأصغر ولي أمره يسجّله`)
        if (!normalizePhone(d.selfPhone)) return T('Write a valid mobile number', 'اكتب رقم موبايل صحيح')
        if (d.city.trim().length < 2) return T('Write the city', 'اكتب المدينة')
      }
    }
    if (step === 'review' && !d.agree) return T('Please accept the terms', 'لازم توافق على الشروط')
    return ''
  }
  const next = () => {
    const e = check()
    setErr(e)
    if (e) return
    const n = steps[idx + 1]
    if (n) { setStep(n); track('CTA', `join:${course.slug}:${n}`); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  }
  const back = () => { setErr(''); const p = steps[idx - 1]; if (p) setStep(p) }
  const phone = d.who === 'SELF' ? d.selfPhone : d.parent.phone

  const tryCode = async () => {
    setCodeInfo(null)
    if (!d.code.trim()) return
    const r = await fetch('/api/public/codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: d.code, listing: course.slug, phone }) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.success) { setCodeInfo({ ok: false, text: T('Could not check the code', 'معرفتش أتأكد من الكود') }); return }
    setCodeInfo({ ok: !!j.data.ok, text: ar ? j.data.text.ar : j.data.text.en })
  }

  const send = async () => {
    setErr('')
    setBusy(true)
    try {
      const body = {
        listing: course.slug, mode: d.mode, groupId: d.groupId || null, who: d.who,
        parent: d.who === 'PARENT' ? d.parent : null, selfPhone: d.who === 'SELF' ? d.selfPhone : null, selfEmail: d.who === 'SELF' ? d.selfEmail : null,
        country: d.country, city: d.city, students: d.students.map((s) => ({ ...s, gender: s.gender || 'MALE' })),
        code: d.code.trim() || null, paymentRef: d.paymentRef.trim() || null, referral: d.referral.trim() || null, agree: true, sid: getSid(),
      }
      const r = await fetch('/api/public/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (r.status === 429) { setErr(T('Too many tries. Try again later.', 'محاولات كتير. جرّب كمان شوية.')); return }
      if (!r.ok || !j?.success) { setErr(j?.error?.message ?? T('Something went wrong. Try again.', 'حصلت مشكلة. جرّب تاني.')); return }
      track('FORM_SENT', `SIGNUP:${course.slug}`)
      setDone(j.data)
      setStep('done')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      try { sessionStorage.removeItem(key) } catch { /* ignore */ }
    } catch {
      setErr(T('No connection. Try again.', 'مفيش اتصال. جرّب تاني.'))
    } finally {
      setBusy(false)
    }
  }

  const LABEL: Record<SignupStep, string> = {
    course: T('The way', 'الطريقة'), time: T('The time', 'الميعاد'), who: T('Who', 'مين'), family: T('Parent', 'ولي الأمر'),
    students: T('Student', 'الطالب'), review: T('Review', 'المراجعة'), pay: T('Payment', 'الدفع'), done: T('Done', 'تم'),
  }

  return (
    <div className="tns-join">
      <ol className="tns-progress" aria-label={T('Steps', 'الخطوات')}>
        {steps.map((s, i) => <li key={s} className={i < idx ? 'past' : i === idx ? 'now' : ''} aria-current={i === idx ? 'step' : undefined}><span>{i + 1}</span>{LABEL[s]}</li>)}
      </ol>
      <div className="tns-join-row">
        <div className="tns-card tns-join-main">
          {step === 'course' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('How would you like to learn?', 'تحب تتعلم إزاي؟')}</h2>
            <div className="tns-choices">
              {course.modes.online ? <button type="button" className={d.mode === 'ONLINE' ? 'on' : ''} onClick={() => set({ mode: 'ONLINE' })}><b>{T('Live online', 'لايف أونلاين')}</b><span>{T('A small group with an instructor, at fixed times', 'جروب صغير مع مدرب في مواعيد ثابتة')}</span></button> : null}
              {course.modes.recorded ? <button type="button" className={d.mode === 'RECORDED' ? 'on' : ''} onClick={() => set({ mode: 'RECORDED', groupId: '' })}><b>{T('Recorded', 'مسجل')}</b><span>{T('Watch any time, at your own pace', 'تتفرج في أي وقت وعلى راحتك')}</span></button> : null}
            </div>
          </> : null}

          {step === 'time' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('Choose the group time', 'اختار ميعاد الجروب')}</h2>
            <div className="tns-choices">
              {course.onlineGroups.map((g) => {
                const full = g.free != null && g.free <= 0
                return <button key={g.id} type="button" disabled={full} className={d.groupId === g.id ? 'on' : ''} onClick={() => set({ groupId: g.id })}><b>{when(g)}</b><span>{full ? T('Full — you can still ask to wait', 'كامل') : g.free != null ? T(`${g.free} seats left`, `فاضل ${g.free} أماكن`) : ''}{g.startDate ? ` · ${T('starts', 'بيبدأ')} ${g.startDate}` : ''}</span></button>
              })}
              <button type="button" className={d.groupId === '' ? 'on' : ''} onClick={() => set({ groupId: '' })}><b>{T('None of these fit', 'مفيش ميعاد مناسب')}</b><span>{T('We will call you with other times', 'هنكلمك بمواعيد تانية')}</span></button>
            </div>
            <p style={{ fontSize: 13 }}>{T('Times are Cairo time.', 'المواعيد بتوقيت القاهرة.')}</p>
          </> : null}

          {step === 'who' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('Who is signing up?', 'مين بيسجّل؟')}</h2>
            <div className="tns-choices">
              <button type="button" className={d.who === 'PARENT' ? 'on' : ''} onClick={() => set({ who: 'PARENT' })}><b>{T('A parent, for my child(ren)', 'ولي أمر، لابني أو ولادي')}</b><span>{T('You can add brothers and sisters', 'تقدر تضيف الإخوات')}</span></button>
              <button type="button" className={d.who === 'SELF' ? 'on' : ''} onClick={() => set({ who: 'SELF', students: [d.students[0] ?? emptyStudent()] })}><b>{T('Me — I am the student', 'أنا الطالب')}</b><span>{T(`From age ${MIN_SELF_AGE} (university and adults)`, `من سن ${MIN_SELF_AGE} (جامعة وكبار)`)}</span></button>
            </div>
          </> : null}

          {step === 'family' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('Parent details', 'بيانات ولي الأمر')}</h2>
            <div className="tns-fields">
              <label>{T('First name', 'الاسم الأول')}<input value={d.parent.firstName} onChange={(e) => set({ parent: { ...d.parent, firstName: e.target.value } })} autoComplete="given-name" /></label>
              <label>{T('Family name', 'اسم العيلة')}<input value={d.parent.lastName} onChange={(e) => set({ parent: { ...d.parent, lastName: e.target.value } })} autoComplete="family-name" /></label>
              <label>{T('Mobile (WhatsApp)', 'الموبايل (واتساب)')}<input dir="ltr" inputMode="tel" placeholder="01012345678" value={d.parent.phone} onChange={(e) => set({ parent: { ...d.parent, phone: e.target.value } })} autoComplete="tel" /></label>
              <label>{T('Email (optional)', 'الإيميل (اختياري)')}<input dir="ltr" type="email" value={d.parent.email} onChange={(e) => set({ parent: { ...d.parent, email: e.target.value } })} autoComplete="email" /></label>
              <label>{T('Relation', 'صلة القرابة')}<select value={d.parent.relation} onChange={(e) => set({ parent: { ...d.parent, relation: e.target.value } })}><option value="">—</option><option value="Father">{T('Father', 'الأب')}</option><option value="Mother">{T('Mother', 'الأم')}</option><option value="Other">{T('Other', 'تاني')}</option></select></label>
              <label>{T('Country', 'الدولة')}<input value={d.country} onChange={(e) => set({ country: e.target.value })} autoComplete="country-name" /></label>
              <label>{T('City', 'المدينة')}<input value={d.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" /></label>
            </div>
          </> : null}

          {step === 'students' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{d.who === 'SELF' ? T('Your details', 'بياناتك') : T('Student details', 'بيانات الطالب')}</h2>
            {d.students.map((s, i) => (
              <div key={i} className="tns-stu">
                {d.students.length > 1 ? <div className="head"><b>{T(`Student ${i + 1}`, `الطالب ${i + 1}`)}</b><button type="button" onClick={() => set({ students: d.students.filter((_, j) => j !== i) })}>{T('Remove', 'شيل')}</button></div> : null}
                <div className="tns-fields">
                  <label>{T('First name', 'الاسم الأول')}<input value={s.firstName} onChange={(e) => setStu(i, { firstName: e.target.value })} /></label>
                  <label>{T('Family name', 'اسم العيلة')}<input value={s.lastName} onChange={(e) => setStu(i, { lastName: e.target.value })} /></label>
                  <label>{T('Date of birth', 'تاريخ الميلاد')}<input type="date" dir="ltr" value={s.dob} onChange={(e) => setStu(i, { dob: e.target.value })} /></label>
                  <label>{T('Boy / girl', 'ولد / بنت')}<select value={s.gender} onChange={(e) => setStu(i, { gender: e.target.value as Student['gender'] })}><option value="">—</option><option value="MALE">{d.who === 'SELF' ? T('Male', 'ذكر') : T('Boy', 'ولد')}</option><option value="FEMALE">{d.who === 'SELF' ? T('Female', 'أنثى') : T('Girl', 'بنت')}</option></select></label>
                  <label>{d.who === 'SELF' ? T('University / work (optional)', 'الجامعة أو الشغل (اختياري)') : T('School (optional)', 'المدرسة (اختياري)')}<input value={s.school} onChange={(e) => setStu(i, { school: e.target.value })} /></label>
                  <label>{T('Did they learn programming or robotics before? (optional)', 'اتعلم برمجة أو روبوتكس قبل كده؟ (اختياري)')}<input value={s.experience} onChange={(e) => setStu(i, { experience: e.target.value })} /></label>
                </div>
                {s.dob && (course.minAge != null || course.maxAge != null) && (ageOnDay(s.dob, today()) < (course.minAge ?? 0) || ageOnDay(s.dob, today()) > (course.maxAge ?? 200)) ? <p className="tns-warn">{T(`Note: this course is for ${ageText(course.minAge, course.maxAge, false)}. We will help you choose the right one.`, `ملحوظة: الكورس ده ${ageText(course.minAge, course.maxAge, true)}. هنساعدك تختار المناسب.`)}</p> : null}
              </div>
            ))}
            {d.who === 'SELF' ? (
              <div className="tns-fields" style={{ marginTop: 12 }}>
                <label>{T('Mobile (WhatsApp)', 'الموبايل (واتساب)')}<input dir="ltr" inputMode="tel" placeholder="01012345678" value={d.selfPhone} onChange={(e) => set({ selfPhone: e.target.value })} /></label>
                <label>{T('Email (optional)', 'الإيميل (اختياري)')}<input dir="ltr" type="email" value={d.selfEmail} onChange={(e) => set({ selfEmail: e.target.value })} /></label>
                <label>{T('Country', 'الدولة')}<input value={d.country} onChange={(e) => set({ country: e.target.value })} /></label>
                <label>{T('City', 'المدينة')}<input value={d.city} onChange={(e) => set({ city: e.target.value })} /></label>
              </div>
            ) : d.students.length < 5 ? <button type="button" className="tns-btn ghost sm" style={{ marginTop: 12 }} onClick={() => set({ students: [...d.students, { ...emptyStudent(), lastName: d.students[0]?.lastName ?? '' }] })}>+ {T('Add a brother or sister', 'ضيف أخ أو أخت')}</button> : null}
          </> : null}

          {step === 'review' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('Check before sending', 'راجع قبل ما تبعت')}</h2>
            <dl className="tns-review">
              <div><dt>{T('Course', 'الكورس')}</dt><dd>{t(course.title)}</dd></div>
              <div><dt>{T('Way', 'الطريقة')}</dt><dd>{d.mode === 'ONLINE' ? T('Live online', 'لايف أونلاين') : T('Recorded', 'مسجل')}{group ? ` · ${when(group)}` : d.mode === 'ONLINE' ? ` · ${T('time to be agreed', 'الميعاد هيتحدد')}` : ''}</dd></div>
              {d.who === 'PARENT' ? <div><dt>{T('Parent', 'ولي الأمر')}</dt><dd>{d.parent.firstName} {d.parent.lastName} · <span dir="ltr">{d.parent.phone}</span></dd></div> : <div><dt>{T('Mobile', 'الموبايل')}</dt><dd dir="ltr">{d.selfPhone}</dd></div>}
              <div><dt>{d.students.length > 1 ? T('Students', 'الطلاب') : T('Student', 'الطالب')}</dt><dd>{d.students.map((s) => `${s.firstName} ${s.lastName}`).join('، ')}</dd></div>
            </dl>
            <label className="tns-agree"><input type="checkbox" checked={d.agree} onChange={(e) => set({ agree: e.target.checked })} />{T('I agree to the terms and policies, and to the course rules.', 'موافق على الشروط والسياسات وقواعد الكورس.')} <a href="/policies" target="_blank" rel="noopener noreferrer">{T('Read them', 'اقرأها')}</a></label>
          </> : null}

          {step === 'pay' ? <>
            <h2 className="tns-h2" style={{ fontSize: 24 }}>{T('Payment', 'الدفع')}</h2>
            <div className="tns-fields">
              <label className="wide">{T('Have a code? (optional)', 'عندك كود؟ (اختياري)')}
                <span style={{ display: 'flex', gap: 8 }}><input dir="ltr" value={d.code} onChange={(e) => { set({ code: e.target.value.toUpperCase() }); setCodeInfo(null) }} placeholder="NILE-AB12CD" /><button type="button" className="tns-btn ghost sm" onClick={() => void tryCode()}>{T('Check', 'تأكد')}</button></span>
              </label>
              {codeInfo ? <p className={codeInfo.ok ? 'tns-ok' : 'tns-warn'} role="status">{codeInfo.text}</p> : null}
              <label className="wide">{T('Paid by InstaPay or a wallet? Write the transfer number (optional)', 'حوّلت InstaPay أو محفظة؟ اكتب رقم التحويل (اختياري)')}<input dir="ltr" value={d.paymentRef} onChange={(e) => set({ paymentRef: e.target.value })} /></label>
              <label className="wide">{T('Referral code from a friend (optional)', 'كود دعوة من صديق (اختياري)')}<input dir="ltr" value={d.referral} onChange={(e) => set({ referral: e.target.value })} /></label>
            </div>
            <p style={{ fontSize: 14, marginTop: 10 }}>{T('No payment yet? Send the sign-up now: we will confirm the time and send the payment details on WhatsApp. Lessons open after the payment is confirmed (or with a free code).', 'لسه مادفعتش؟ ابعت التسجيل دلوقتي: هنأكد الميعاد ونبعتلك تفاصيل الدفع على الواتساب. الدروس بتفتح بعد تأكيد الدفع (أو بكود مجاني).')}</p>
          </> : null}

          {step === 'done' && done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div className="tns-ico" style={{ width: 70, height: 70, margin: '0 auto' }}><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg></div>
              <h2 className="tns-h2" style={{ fontSize: 26, marginTop: 16 }}>{T('Your sign-up was sent!', 'التسجيل وصلنا!')}</h2>
              <p className="tns-lead" style={{ margin: '0 auto' }}>{T(`Reference ${done.ref}. What happens next: we confirm ${d.mode === 'ONLINE' ? 'the group time' : 'the course'} and the payment on WhatsApp, then you receive the login of the student account.`, `رقم الطلب ${done.ref}. اللي هيحصل: هنأكد ${d.mode === 'ONLINE' ? 'ميعاد الجروب' : 'الكورس'} والدفع معاك على الواتساب، وبعدها توصلك بيانات دخول حساب الطالب.`)}</p>
              {done.existingFamily ? <p style={{ marginTop: 10 }}>{T('Your number is already with us: the new student is added to the same family account.', 'رقمك متسجل عندنا: الطالب الجديد هيتضاف لنفس حساب العيلة.')}</p> : null}
            </div>
          ) : null}

          {err ? <p role="alert" className="tns-warn" style={{ marginTop: 14 }}>{err}</p> : null}
          {step !== 'done' ? (
            <div className="tns-join-nav">
              {idx > 0 ? <button type="button" className="tns-btn ghost" onClick={back}>{T('Back', 'رجوع')}</button> : <span />}
              {step === 'pay' ? <button type="button" className="tns-btn brand" disabled={busy} onClick={() => void send()}>{busy ? T('Sending…', 'بيتبعت…') : T('Send the sign-up', 'ابعت التسجيل')}</button>
                : <button type="button" className="tns-btn brand" onClick={next}>{T('Next', 'التالي')}</button>}
            </div>
          ) : null}
        </div>

        <aside className="tns-card tns-join-sum">
          <p className="tns-kick" style={{ margin: 0 }}>{T('Your choice', 'اختيارك')}</p>
          <h3 style={{ margin: '6px 0 0' }}>{t(course.title)}</h3>
          {ageText(course.minAge, course.maxAge, ar) ? <p style={{ margin: '4px 0 0' }}>{ageText(course.minAge, course.maxAge, ar)}</p> : null}
          {d.mode ? <p style={{ margin: '10px 0 0' }}>{d.mode === 'ONLINE' ? T('Live online', 'لايف أونلاين') : T('Recorded', 'مسجل')}{group ? ` · ${when(group)}` : ''}</p> : null}
          {price != null ? <p style={{ margin: '10px 0 0', fontWeight: 700, color: 'var(--text)', fontSize: 20 }}><span className="en">{price.toLocaleString('en-US')}</span> {T('EGP', 'ج.م')}<span style={{ fontWeight: 400, fontSize: 14, color: 'var(--muted)' }}>{d.mode === 'ONLINE' ? ` / ${course.price.onlinePer === 'MONTH' ? T('month', 'شهر') : T('level', 'مستوى')}` : ''}{d.students.length > 1 ? ` × ${d.students.length}` : ''}</span></p> : null}
          {codeInfo?.ok ? <p className="tns-ok" style={{ marginTop: 8 }}>{codeInfo.text}</p> : null}
          <p style={{ fontSize: 13, marginTop: 12 }}>{T('Brothers and sisters may get the family discount; staff confirm the final amount.', 'الإخوات ممكن ياخدوا خصم الإخوات، والمبلغ النهائي بيأكده الموظف.')}</p>
        </aside>
      </div>
    </div>
  )
}
