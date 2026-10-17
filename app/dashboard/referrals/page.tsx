'use client'

/** Phase D: referrals — who referred whom, top referrers / ambassadors, reward settings. */

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Award, Gift, Loader2 } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface Report {
  totals: { referrals: number; rewarded: number; pending: number; rewardPaid: number }
  top: { id: string; name: string; phone: string; count: number; rewarded: number; reward: number; ambassador: boolean }[]
  rows: { id: string; code: string; status: string; createdAt: string; reward: number; student: { id: string; name: string; registrationNumber: string } | null; referrer: { name: string; phone: string } | null }[]
}
interface Settings { rewardEnabled: boolean; rewardAmount: number; welcomeEnabled: boolean; welcomeTypeId: string | null; ambassadorAt: number }

function SettingsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['referral-settings'], queryFn: () => fetchApi<{ settings: Settings; discountTypes: { id: string; name: string }[] }>('/api/referrals/settings') })
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { if (data) setS(data.settings) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/referrals/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Referral settings saved', 'إعدادات الترشيح اتحفظت')); qc.invalidateQueries({ queryKey: ['referral-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!s) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Settings', 'الإعدادات')}</CardTitle><CardDescription>Both can be switched on or off at any time; changes apply to new referrals / payments.</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          <input type="checkbox" checked={s.rewardEnabled} disabled={!canEdit} onChange={(e) => setS({ ...s, rewardEnabled: e.target.checked })} />
          {L('Reward the parent who referred:', 'مكافأة ولي الأمر اللي رشّح:')} <Input type="number" min={0} className="h-8 w-24" value={s.rewardAmount} disabled={!canEdit} onChange={(e) => setS({ ...s, rewardAmount: Number(e.target.value) || 0 })} /> {L('EGP in the wallet when the new student pays the first invoice', 'ج.م في المحفظة لما الطالب الجديد يدفع أول فاتورة')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={s.welcomeEnabled} disabled={!canEdit} onChange={(e) => setS({ ...s, welcomeEnabled: e.target.checked })} /> {L('Welcome discount for the new student:', 'خصم ترحيب للطالب الجديد:')}</label>
          <Select value={s.welcomeTypeId ?? 'none'} onValueChange={(v) => setS({ ...s, welcomeTypeId: v === 'none' ? null : v })} disabled={!canEdit}>
            <SelectTrigger className="h-8 w-56"><SelectValue placeholder={L('Choose a discount type', 'اختار نوع خصم')} /></SelectTrigger>
            <SelectContent><SelectItem value="none">—</SelectItem>{(data?.discountTypes ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-xs text-slate-500">{L('Create it on the Discounts page first (e.g. “Referral welcome 10%”, duration “first cycle”).', 'اعمله الأول من صفحة الخصومات (مثلاً «ترحيب إحالة 10%»، المدة «أول شهر»).')}</span>
        </div>
        <label className="flex items-center gap-2">{L('“TechNova Ambassador” from', '«سفير TechNova» من')} <Input type="number" min={1} className="h-8 w-16" value={s.ambassadorAt} disabled={!canEdit} onChange={(e) => setS({ ...s, ambassadorAt: Number(e.target.value) || 3 })} /> {L('rewarded referrals', 'ترشيحات اتكافأت')}</label>
        {canEdit && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{L('Save', 'حفظ')}</Button>}
      </CardContent>
    </Card>
  )
}

export default function ReferralsPage() {
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const role = session?.user?.role
  const { can, ready: permsReady } = useMyPermissions() // effective permissions (Permissions page + overrides)
  const allowed = can('referrals', 'read')
  const { data, isLoading } = useQuery({ queryKey: ['referrals'], queryFn: () => fetchApi<Report>('/api/referrals'), enabled: allowed })
  if (!role) return null
  if (role && !permsReady) return null
  if (!allowed) return <AccessDenied title={L('Referrals', 'الترشيحات')} message="You don't have access to referrals." />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Gift className="h-7 w-7 text-indigo-600" /> {L('Referrals', 'الترشيحات')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Every parent has a code in the portal. A new student is linked on the admission form, the online application, or the student page.', 'كل ولي أمر ليه كود في البوابة. الطالب الجديد بيتربط من استمارة التسجيل، أو طلب الأونلاين، أو صفحة الطالب.')}</p>
      </div>
      {isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[['Referrals', data.totals.referrals], ['Paid (rewarded)', data.totals.rewarded], ['Waiting for first payment', data.totals.pending], ['Rewards given', `${data.totals.rewardPaid} EGP`]].map(([l, v]) => (
              <Card key={l as string}><CardContent className="pt-4"><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold">{v}</p></CardContent></Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{L('Top referrers', 'أكتر ناس رشّحت')}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {data.top.map((t) => (
                  <div key={t.id} className="flex justify-between rounded border border-slate-100 px-2 py-1.5">
                    <span>{t.name} <span className="text-xs text-slate-400">{t.phone}</span>{t.ambassador && <Award className="ml-1 inline h-4 w-4 text-amber-500" />}</span>
                    <span className="text-xs">{t.count} {L('referred ·', 'رشّح ·')} {t.rewarded} {L('paid ·', 'دفع ·')} {t.reward} {L('EGP', 'ج.م')}</span>
                  </div>
                ))}
                {!data.top.length && <p className="text-slate-500">{L('No referrals yet.', 'لسه مفيش ترشيحات.')}</p>}
              </CardContent>
            </Card>
            <SettingsCard canEdit={can('referrals', 'update')} />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{L('All referrals', 'كل الترشيحات')}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">{L('Date', 'التاريخ')}</th><th>{L('New student', 'الطالب الجديد')}</th><th>{L('Referred by', 'رشّحه')}</th><th>{L('Code', 'الكود')}</th><th>{L('Status', 'الحالة')}</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="py-1.5">{new Date(r.createdAt).toLocaleDateString('en-GB')}</td>
                      <td>{r.student ? <Link href={`/dashboard/students/${r.student.id}`} className="text-indigo-700 hover:underline">{r.student.name}</Link> : '—'}</td>
                      <td>{r.referrer?.name ?? '—'} <span className="text-xs text-slate-400">{r.referrer?.phone}</span></td>
                      <td className="font-mono text-xs">{r.code}</td>
                      <td>{r.status === 'REWARDED' ? (r.reward ? `🎁 ${r.reward} EGP` : 'paid ✓') : r.status === 'PENDING' ? 'waiting for first payment' : r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
