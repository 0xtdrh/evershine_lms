'use client'

/**
 * Six phases 1-A: the family makes its account (parent, or a student of 18+ alone). Ready at once: the page signs in with
 * the phone + password and opens "My children", where the family adds its children and sees the courses that suit them.
 * API POST /api/public/account. A phone that already has an account is sent to sign in / reset the password.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { L, useI18n } from '@/lib/i18n/client'

type Who = 'PARENT' | 'SELF'

export default function SignupPage() {
  const { locale } = useI18n()
  /** server messages are 'English · عربي' */
  const bi = (m: string) => (m.includes(' · ') ? m.split(' · ')[locale === 'ar' ? 1 : 0] : m)
  const router = useRouter()
  const [who, setWho] = useState<Who>('PARENT')
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', password: '', password2: '', relationship: '', country: 'Egypt', city: '', dob: '', gender: '', website: '' })
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })

  const [partner, setPartner] = useState<{ code: string; name: string } | null>(null)
  const [referral, setReferral] = useState('')
  useEffect(() => {
    try {
      const r = new URLSearchParams(window.location.search).get('ref')
      if (r) setReferral(r)
      const code = new URLSearchParams(window.location.search).get('partner')
      if (code) fetch(`/api/public/partner-code?code=${encodeURIComponent(code)}`).then((r) => r.json()).then((j) => { if (j?.success) setPartner({ code, name: j.data.name }) }).catch(() => null)
    } catch { /* ignore */ }
  }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null); setExists(false)
    if (f.password !== f.password2) return setErr(L('The two passwords are not the same', 'الباسوردين مش زي بعض'))
    if (!agree) return setErr(L('Please accept the terms', 'لازم توافق على الشروط'))
    setBusy(true)
    try {
      const body = { who, firstName: f.firstName, lastName: f.lastName, phone: f.phone, email: f.email || null, password: f.password, relationship: who === 'PARENT' ? f.relationship || null : null, country: f.country, city: f.city, dob: who === 'SELF' ? f.dob : null, gender: who === 'SELF' ? f.gender || null : null, agree: true, website: f.website, partnerCode: partner?.code ?? null, referral: referral.trim() || null }
      const r = await fetch('/api/public/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (r.status === 429) return setErr(L('Too many tries. Try again later.', 'محاولات كتير. جرّب كمان شوية.'))
      if (!r.ok || !j?.success) {
        if (j?.error?.code === 'ACCOUNT_EXISTS') setExists(true)
        const d = Array.isArray(j?.error?.details) ? (j.error.details as { field: string; message: string }[])[0] : null
        const fieldName: Record<string, string> = { firstName: L('the first name', 'الاسم الأول'), lastName: L('the family name', 'اسم العيلة'), phone: L('the mobile number', 'رقم الموبايل'), email: L('the e-mail', 'الإيميل'), password: L('the password', 'الباسورد'), city: L('the city', 'المدينة'), country: L('the country', 'الدولة'), dob: L('the date of birth', 'تاريخ الميلاد') }
        const msg = d ? (d.message.includes(' · ') ? bi(d.message) : `${L('Check', 'راجع')} ${fieldName[d.field] ?? d.field}`) : null
        return setErr(msg || (j?.error?.message ? bi(j.error.message) : null) || L('Something went wrong. Try again.', 'حصلت مشكلة. جرّب تاني.'))
      }
      const res = await signIn('credentials', { redirect: false, email: j.data.phone, password: f.password })
      let next = '/dashboard/my-children?welcome=1'
      try {
        const cb = new URLSearchParams(window.location.search).get('callbackUrl')
        if (cb && cb.startsWith('/dashboard/my-children')) next = `${cb}${cb.includes('?') ? '&' : '?'}welcome=1`
      } catch { /* ignore */ }
      router.push(res?.ok ? next : '/login')
    } catch {
      setErr(L('No connection. Try again.', 'مفيش اتصال. جرّب تاني.'))
    } finally {
      setBusy(false)
    }
  }

  const choice = (w: Who, title: string, sub: string) => (
    <button type="button" onClick={() => setWho(w)} aria-pressed={who === w}
      className={`flex-1 rounded-2xl border-2 p-3 text-start transition ${who === w ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <span className="block text-sm font-semibold text-slate-900">{title}</span>
      <span className="block text-xs text-slate-600">{sub}</span>
    </button>
  )

  return (
    <AuthLayout pageType="signup">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {partner ? <p className="rounded-2xl bg-violet-50 p-3 text-sm text-violet-900">{L(`You are signing up through ${partner.name}.`, `انت بتسجّل عن طريق ${partner.name}.`)}</p> : null}
        <div className="flex gap-2">
          {choice('PARENT', L('I am a parent', 'أنا ولي أمر'), L('For my child(ren)', 'لابني أو ولادي'))}
          {choice('SELF', L('I am the student', 'أنا الطالب'), L('Age 18 or more', 'من سن 18'))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="fn">{L('First name', 'الاسم الأول')}</Label><Input id="fn" value={f.firstName} onChange={set('firstName')} autoComplete="given-name" required /></div>
          <div><Label htmlFor="ln">{L('Family name', 'اسم العيلة')}</Label><Input id="ln" value={f.lastName} onChange={set('lastName')} autoComplete="family-name" required /></div>
        </div>
        <div><Label htmlFor="ph">{L('Mobile (WhatsApp) — you sign in with it', 'الموبايل (واتساب) — بتدخل بيه')}</Label><Input id="ph" dir="ltr" inputMode="tel" placeholder="01012345678" value={f.phone} onChange={set('phone')} autoComplete="tel" required /></div>
        <div><Label htmlFor="em">{L('E-mail (optional)', 'الإيميل (اختياري)')}</Label><Input id="em" dir="ltr" type="email" value={f.email} onChange={set('email')} autoComplete="email" /></div>
        {who === 'SELF' ? (
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="dob">{L('Date of birth', 'تاريخ الميلاد')}</Label><Input id="dob" type="date" dir="ltr" value={f.dob} onChange={set('dob')} required /></div>
            <div><Label htmlFor="gd">{L('Gender', 'النوع')}</Label>
              <select id="gd" value={f.gender} onChange={set('gender')} className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"><option value="">—</option><option value="MALE">{L('Male', 'ذكر')}</option><option value="FEMALE">{L('Female', 'أنثى')}</option></select></div>
          </div>
        ) : (
          <div><Label htmlFor="rel">{L('You are the child’s…', 'انت بالنسبة للطفل…')}</Label>
            <select id="rel" value={f.relationship} onChange={set('relationship')} className="h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm"><option value="">—</option><option value="Father">{L('Father', 'الأب')}</option><option value="Mother">{L('Mother', 'الأم')}</option><option value="Other">{L('Other', 'تاني')}</option></select></div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="co">{L('Country', 'الدولة')}</Label><Input id="co" value={f.country} onChange={set('country')} autoComplete="country-name" /></div>
          <div><Label htmlFor="ci">{L('City', 'المدينة')}</Label><Input id="ci" value={f.city} onChange={set('city')} autoComplete="address-level2" required /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label htmlFor="pw">{L('Password (8+)', 'الباسورد (8 أو أكتر)')}</Label><Input id="pw" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required /></div>
          <div><Label htmlFor="pw2">{L('Again', 'تاني')}</Label><Input id="pw2" type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" required /></div>
        </div>
        <div><Label htmlFor="ref">{L('Invite code from a friend (optional)', 'كود دعوة من صديق (اختياري)')}</Label><Input id="ref" dir="ltr" value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="TN-REF-…" /></div>
        <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4" />
          <span>{L('I agree to the terms and policies.', 'موافق على الشروط والسياسات.')} <Link href="/policies" target="_blank" className="text-blue-700 underline">{L('Read them', 'اقرأها')}</Link></span>
        </label>
        {err ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {err}
            {exists ? <div className="mt-2 flex gap-3"><Link href="/login" className="font-semibold underline">{L('Sign in', 'ادخل')}</Link><Link href="/forgot-password" className="font-semibold underline">{L('Forgot the password', 'نسيت الباسورد')}</Link></div> : null}
          </div>
        ) : null}
        <Button type="submit" size="lg" disabled={busy} className="h-11 w-full rounded-2xl text-sm font-semibold">{busy ? L('Creating…', 'بيتعمل…') : L('Create the account', 'اعمل الحساب')}</Button>
      </form>
    </AuthLayout>
  )
}
