'use client'

/**
 * Six phases 1-A: a family opens the link staff sent (offline family / forgotten password / old account) and chooses its
 * password. The link works once. Then it signs in and opens "My children". API /api/account/setup/[token].
 */

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { L, useI18n } from '@/lib/i18n/client'

export default function AccountSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { locale } = useI18n()
  const bi = (m: string) => (m.includes(' · ') ? m.split(' · ')[locale === 'ar' ? 1 : 0] : m)
  const router = useRouter()
  const [info, setInfo] = useState<{ firstName: string; phoneEnd: string } | null | 'bad'>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/account/setup/${encodeURIComponent(token)}`).then((r) => r.json()).then((j) => setInfo(j?.success ? j.data : 'bad')).catch(() => setInfo('bad'))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (pw !== pw2) return setErr(L('The two passwords are not the same', 'الباسوردين مش زي بعض'))
    setBusy(true)
    try {
      const r = await fetch(`/api/account/setup/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.success) return setErr(j?.error?.message ? bi(j.error.message) : L('Something went wrong. Try again.', 'حصلت مشكلة. جرّب تاني.'))
      const res = await signIn('credentials', { redirect: false, email: j.data.phone, password: pw })
      router.push(res?.ok ? '/dashboard/my-children?welcome=1' : '/login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout pageType="account-setup">
      {info === null ? <p className="text-center text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
        : info === 'bad' ? (
          <div className="space-y-3 text-center text-sm text-slate-700">
            <p>{L('This link has expired or was already used. Ask TechNova to send you a new one.', 'اللينك ده انتهى أو اتستخدم قبل كده. اطلب من TechNova لينك جديد.')}</p>
            <Link href="/login" className="font-semibold text-blue-700 underline">{L('Go to sign in', 'روح لصفحة الدخول')}</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-700">{L(`Welcome ${info.firstName}! You will sign in with your mobile (…${info.phoneEnd}) and this password.`, `أهلاً ${info.firstName}! هتدخل برقم موبايلك (…${info.phoneEnd}) والباسورد ده.`)}</p>
            <div><Label htmlFor="pw">{L('Password (8+)', 'الباسورد (8 أو أكتر)')}</Label><Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /></div>
            <div><Label htmlFor="pw2">{L('Again', 'تاني')}</Label><Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></div>
            {err ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}
            <Button type="submit" size="lg" disabled={busy} className="h-11 w-full rounded-2xl text-sm font-semibold">{busy ? L('Saving…', 'بيتحفظ…') : L('Save and open my account', 'احفظ وافتح حسابي')}</Button>
          </form>
        )}
    </AuthLayout>
  )
}
