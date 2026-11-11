'use client'

/** x01: the website request form (dialog). Sends to /api/public/website-request; lands in the system's "Website requests". */

import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/client'
import { KIND_LABEL, NEEDS_ORG, normalizePhone, type RequestKind } from '@/lib/site/request-rules'

export interface FormOpen { kind: RequestKind; page: string; topic?: string }

const TITLE: Record<RequestKind, { en: string; ar: string; hint: { en: string; ar: string } }> = {
  CONTACT: { en: 'Send us a message', ar: 'ابعتلنا رسالة', hint: { en: 'We will call you back soon.', ar: 'هنكلمك في أقرب وقت.' } },
  SOLUTION: { en: 'Ask for a solution', ar: 'اطلب حل لمكانك', hint: { en: 'Tell us the problem and we will propose a solution.', ar: 'قولّنا المشكلة وإحنا نقترح الحل.' } },
  SCHOOL: { en: 'An offer for your school', ar: 'عرض لمدرستك', hint: { en: 'We will contact you with the right programme for your school.', ar: 'هنتواصل معاك بالبرنامج المناسب لمدرستك.' } },
  PARTNER: { en: 'Apply for a partnership', ar: 'طلب شراكة', hint: { en: 'Tell us who you are and how you would like to work with us.', ar: 'عرّفنا بنفسك وإزاي حابب نشتغل سوا.' } },
  PRODUCT: { en: 'Order a product', ar: 'اطلب منتج', hint: { en: 'We will call you to confirm the order.', ar: 'هنكلمك نأكد الطلب.' } },
}

export function RequestForm({ open, onClose, solutions, partnerKinds }: { open: FormOpen; onClose: () => void; solutions: string[]; partnerKinds: string[] }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const T = (x: { en: string; ar: string }) => (ar ? x.ar : x.en)
  const [f, setF] = useState({ name: '', phone: '', email: '', organisation: '', topic: open.topic ?? '', message: '', website: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    first.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const needsOrg = NEEDS_ORG.includes(open.kind)
  const topics = open.kind === 'SOLUTION' ? solutions : open.kind === 'PARTNER' ? partnerKinds : []
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (f.name.trim().length < 2) return setErr(ar ? 'اكتب اسمك.' : 'Write your name.')
    if (!normalizePhone(f.phone)) return setErr(ar ? 'اكتب رقم موبايل صحيح (مثلاً 01012345678).' : 'Write a valid phone number (e.g. 01012345678).')
    if (needsOrg && !f.organisation.trim()) return setErr(ar ? 'اكتب اسم المدرسة أو الشركة.' : 'Write the name of the school / company.')
    setBusy(true)
    try {
      const res = await fetch('/api/public/website-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, kind: open.kind, page: open.page }) })
      if (res.status === 429) return setErr(ar ? 'بعت طلبات كتير. جرّب كمان شوية.' : 'Too many requests. Try again later.')
      if (!res.ok) return setErr(ar ? 'حصلت مشكلة. جرّب تاني.' : 'Something went wrong. Try again.')
      setDone(true)
    } catch {
      setErr(ar ? 'مفيش اتصال. جرّب تاني.' : 'No connection. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tns-modal" role="dialog" aria-modal="true" aria-labelledby="tns-form-title" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="tns-modal-box">
        <button type="button" className="tns-modal-x" onClick={onClose} aria-label={ar ? 'قفل' : 'Close'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 4px' }}>
            <div className="tns-ico" style={{ width: 64, height: 64, margin: '0 auto' }}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg></div>
            <h2 id="tns-form-title" className="tns-h2" style={{ fontSize: 24, marginTop: 16 }}>{ar ? 'وصلنا طلبك، شكراً!' : 'Thank you, we got it!'}</h2>
            <p style={{ color: 'var(--muted)' }}>{T(TITLE[open.kind].hint)}</p>
            <button type="button" className="tns-btn brand" style={{ marginTop: 14 }} onClick={onClose}>{ar ? 'تمام' : 'OK'}</button>
          </div>
        ) : (
          <form onSubmit={send} noValidate>
            <p className="tns-kick" style={{ marginBottom: 4 }}>{T(KIND_LABEL[open.kind])}</p>
            <h2 id="tns-form-title" className="tns-h2" style={{ fontSize: 24 }}>{T(TITLE[open.kind])}</h2>
            <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 15 }}>{T(TITLE[open.kind].hint)}</p>
            <div className="tns-fields">
              <label>{ar ? 'الاسم' : 'Name'}<input ref={first} value={f.name} onChange={set('name')} autoComplete="name" required /></label>
              <label>{ar ? 'الموبايل (واتساب)' : 'Mobile (WhatsApp)'}<input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" dir="ltr" placeholder="01012345678" required /></label>
              {needsOrg ? <label>{open.kind === 'SCHOOL' ? (ar ? 'اسم المدرسة' : 'School name') : ar ? 'اسم الشركة / الجهة' : 'Company / organisation'}<input value={f.organisation} onChange={set('organisation')} autoComplete="organization" required /></label> : null}
              {topics.length ? (
                <label>{open.kind === 'SOLUTION' ? (ar ? 'الحل اللي محتاجه' : 'The solution you need') : ar ? 'نوع الشراكة' : 'Partnership type'}
                  <select value={f.topic} onChange={set('topic')}><option value="">{ar ? '— اختار —' : '— choose —'}</option>{topics.map((x) => <option key={x} value={x}>{x}</option>)}</select>
                </label>
              ) : open.topic ? <label>{ar ? 'المنتج' : 'Product'}<input value={f.topic} onChange={set('topic')} /></label> : null}
              <label>{ar ? 'الإيميل (اختياري)' : 'Email (optional)'}<input type="email" value={f.email} onChange={set('email')} autoComplete="email" dir="ltr" /></label>
              <label className="wide">{ar ? 'رسالتك' : 'Your message'}<textarea rows={3} value={f.message} onChange={set('message')} maxLength={2000} /></label>
              <label aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', opacity: 0, pointerEvents: 'none' }}>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
            </div>
            {err ? <p role="alert" style={{ color: '#b42318', fontWeight: 600, margin: '12px 0 0' }}>{err}</p> : null}
            <button type="submit" className="tns-btn brand" style={{ marginTop: 18, width: '100%' }} disabled={busy}>{busy ? (ar ? 'بيتبعت…' : 'Sending…') : ar ? 'ابعت' : 'Send'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
