'use client'

/** Security part 2: two-step sign-in on / off and for which roles, idle sign-out, and each staff account's status (reset for a lost phone). Super Admin. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ShieldCheck } from 'lucide-react'

interface Settings { twoFactorEnabled: boolean; twoFactorRoles: string[]; idleMinutes: number; roleChoices: string[] }
interface Row { id: string; email: string; role: string; totpEnabledAt: string | null; required: boolean }

const ROLE: Record<string, [string, string]> = { SUPER_ADMIN: ['Super Admin', 'Super Admin'], ADMIN: ['Admin', 'مدير'], BRANCH_MANAGER: ['Branch manager', 'مدير فرع'], ACCOUNTANT: ['Accountant', 'محاسب'], SECRETARY: ['Secretary', 'سكرتارية'], MARKETING: ['Marketing', 'تسويق'], TEACHER: ['Instructor', 'مدرب'] }

export default function SecuritySettingsPage() {
  useI18n()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['security-settings'], queryFn: () => fetchApi<Settings>('/api/security/settings') })
  const { data: rows } = useQuery({ queryKey: ['security-users'], queryFn: () => fetchApi<Row[]>('/api/security/two-factor/users') })
  const [f, setF] = useState<Settings | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/security/settings', { method: 'PUT', body: JSON.stringify({ twoFactorEnabled: f!.twoFactorEnabled, twoFactorRoles: f!.twoFactorRoles, idleMinutes: f!.idleMinutes }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['security-settings'] }); qc.invalidateQueries({ queryKey: ['security-users'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  const reset = useMutation({
    mutationFn: (userId: string) => fetchApi('/api/security/two-factor/users', { method: 'POST', body: JSON.stringify({ userId }) }),
    onSuccess: () => { notify.success(L('Reset. They set it up again at the next sign-in.', 'اتلغى، وهيظبطه تاني أول ما يدخل.')); qc.invalidateQueries({ queryKey: ['security-users'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  const role = (r: string) => (ROLE[r] ? L(ROLE[r][0], ROLE[r][1]) : r)
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 text-sm">
      <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-indigo-600" /> {L('Sign-in security', 'أمان الدخول')}</h1>
      {f && (
        <Card><CardContent className="space-y-4 pt-4">
          <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={f.twoFactorEnabled} onChange={(e) => setF({ ...f, twoFactorEnabled: e.target.checked })} /> {L('Two-step sign-in is ON (code from a phone app)', 'التحقق بخطوتين شغال (كود من تطبيق على الموبايل)')}</label>
          <div className={f.twoFactorEnabled ? '' : 'opacity-50'}>
            <p className="mb-1 text-xs text-slate-500">{L('Must use it (others can turn it on for themselves):', 'لازم يستخدموه (الباقيين يقدروا يشغّلوه لنفسهم):')}</p>
            <div className="flex flex-wrap gap-3">
              {f.roleChoices.map((r) => (
                <label key={r} className="flex items-center gap-1"><input type="checkbox" disabled={!f.twoFactorEnabled} checked={f.twoFactorRoles.includes(r)} onChange={(e) => setF({ ...f, twoFactorRoles: e.target.checked ? [...f.twoFactorRoles, r] : f.twoFactorRoles.filter((x) => x !== r) })} /> {role(r)}</label>
              ))}
            </div>
          </div>
          <label className="block space-y-1"><span className="block text-xs text-slate-500">{L('Sign staff out after this many minutes with no use (0 = never). Families are never signed out this way.', 'خروج الموظف بعد الدقايق دي من غير استخدام (0 = أبدًا). الأهالي مش بيخرجوا كده.')}</span>
            <Input type="number" min={0} max={720} className="h-9 w-28" value={f.idleMinutes} onChange={(e) => setF({ ...f, idleMinutes: Number(e.target.value) })} /></label>
          {!f.twoFactorEnabled && <p className="text-xs font-semibold text-rose-700">{L('With it off, a stolen password is enough to open any account.', 'وهو مقفول، الباسورد المسروق كفاية يفتح أي حساب.')}</p>}
          <div className="flex flex-wrap gap-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button><Link href="/setup-2fa"><Button variant="outline">{L('My two-step sign-in', 'التحقق بخطوتين بتاعي')}</Button></Link></div>
        </CardContent></Card>
      )}
      <div className="space-y-2">
        <h2 className="font-semibold">{L('Staff accounts', 'حسابات الموظفين')}</h2>
        {(rows ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
            <div><p className="font-medium" dir="ltr">{r.email}</p><p className="text-xs text-slate-500">{role(r.role)}</p></div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.totpEnabledAt ? 'bg-emerald-100 text-emerald-800' : r.required ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                {r.totpEnabledAt ? L('On', 'شغال') : r.required ? L('Will set up at next sign-in', 'هيظبطه أول ما يدخل') : L('Off', 'مقفول')}
              </span>
              {r.totpEnabledAt && <Button size="sm" variant="outline" disabled={reset.isPending} onClick={() => { if (window.confirm(L('Reset two-step sign-in for this account (lost phone)?', 'تلغي التحقق بخطوتين للحساب ده (موبايل ضاع)؟'))) reset.mutate(r.id) }}>{L('Reset', 'إلغاء')}</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
