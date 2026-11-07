'use client'

/** Security part 2: set up two-step sign-in with an authenticator app (required for some roles, optional for the rest). */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { signOut } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck } from 'lucide-react'

interface Status { enabled: boolean; required: boolean; companyOn: boolean; sparesLeft: number }

export default function SetupTwoFactorPage() {
  useI18n()
  const { data: status, refetch } = useQuery({ queryKey: ['2fa-me'], queryFn: () => fetchApi<Status>('/api/security/two-factor') })
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [spares, setSpares] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try { setSetup(await fetchApi('/api/security/two-factor', { method: 'POST', body: JSON.stringify({ action: 'start' }) })) } catch (e) { notify.error((e as Error).message) } finally { setBusy(false) }
  }
  const confirm = async () => {
    setBusy(true)
    try { const r = await fetchApi<{ spares: string[] }>('/api/security/two-factor', { method: 'POST', body: JSON.stringify({ action: 'confirm', code }) }); setSpares(r.spares); void refetch() } catch (e) { notify.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 p-6 text-sm">
      <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-6 w-6 text-indigo-600" /> {L('Two-step sign-in', 'التحقق بخطوتين')}</h1>
      {/* switched off / not required any more while this session was waiting: sign in again to drop the old flag */}
      {status && !status.required && !status.enabled && !setup && !spares && (
        <div className="space-y-2 rounded-lg bg-sky-50 p-3 text-sky-900">
          <p className="font-semibold">{L('Your account does not need two-step sign-in now.', 'حسابك مش محتاج التحقق بخطوتين دلوقتي.')}</p>
          <p>{L('Sign in again to continue (you can still turn it on for yourself below).', 'ادخل تاني علشان تكمل (وتقدر برضه تشغّله لنفسك من تحت).')}</p>
          <Button onClick={() => signOut({ callbackUrl: '/login' })}>{L('Sign in again', 'ادخل تاني')}</Button>
        </div>
      )}
      {status?.required && !status.enabled && !spares && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{L('Your account must use two-step sign-in. Set it up to continue.', 'حسابك لازم يستخدم التحقق بخطوتين. ظبطه علشان تكمل.')}</p>}
      {status?.enabled && !spares && (
        <div className="space-y-2 rounded-lg bg-emerald-50 p-3 text-emerald-900">
          <p className="font-semibold">{L('Two-step sign-in is on for your account.', 'التحقق بخطوتين شغال على حسابك.')}</p>
          <p>{L(`Spare codes left: ${status.sparesLeft}. If you lose the phone, a Super Admin can reset it.`, `الأكواد الاحتياطية الباقية: ${status.sparesLeft}. لو الموبايل ضاع، الـ Super Admin يقدر يلغيه.`)}</p>
          <a className="text-indigo-700 underline" href="/dashboard">{L('Back to the dashboard', 'ارجع للوحة')}</a>
        </div>
      )}
      {status && !status.enabled && !setup && !spares && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 ps-5 text-slate-700">
            <li>{L('Install Google Authenticator or Microsoft Authenticator on your phone.', 'نزّل Google Authenticator أو Microsoft Authenticator على موبايلك.')}</li>
            <li>{L('Press start, then scan the QR code with the app.', 'دوس ابدأ، وبعدين صوّر الكود بالتطبيق.')}</li>
            <li>{L('Type the 6 numbers the app shows.', 'اكتب الـ 6 أرقام اللي التطبيق بيطلعها.')}</li>
          </ol>
          <Button disabled={busy} onClick={start}>{L('Start', 'ابدأ')}</Button>
        </div>
      )}
      {setup && !spares && (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt={L('QR code for the app', 'كود التطبيق')} className="h-60 w-60 rounded-lg border bg-white p-2" />
          <p className="text-xs text-slate-500">{L('Cannot scan? Type this key in the app:', 'مش قادر تصوّر؟ اكتب المفتاح ده في التطبيق:')} <code dir="ltr" className="break-all">{setup.secret}</code></p>
          <div className="flex gap-2">
            <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-10 w-36 text-center text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            <Button disabled={busy || code.length !== 6} onClick={confirm}>{L('Turn it on', 'شغّله')}</Button>
          </div>
        </div>
      )}
      {spares && (
        <div className="space-y-3">
          <p className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-900">{L('Done. Two-step sign-in is on.', 'تمام، التحقق بخطوتين اشتغل.')}</p>
          <p>{L('Write these spare codes on paper and keep them safe. Each one works once if you lose the phone. They are not shown again.', 'اكتب الأكواد الاحتياطية دي على ورقة واحفظها كويس. كل واحد بيشتغل مرة واحدة لو الموبايل ضاع، ومش هتظهر تاني.')}</p>
          <div dir="ltr" className="grid grid-cols-2 gap-2 rounded-lg border bg-white p-3 font-mono text-base">{spares.map((s) => <span key={s}>{s}</span>)}</div>
          <Button onClick={() => signOut({ callbackUrl: '/login?code=2fa_ready' })}>{L('I wrote them down: sign in again', 'كتبتهم، ادخل تاني')}</Button>
        </div>
      )}
      {!spares && <button type="button" className="text-xs text-slate-500 underline" onClick={() => signOut({ callbackUrl: '/login' })}>{L('Sign out', 'خروج')}</button>}
    </main>
  )
}
