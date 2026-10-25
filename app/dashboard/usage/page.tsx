'use client'

/**
 * 2026-10-18 usage report — how often students, parents, instructors and staff open TechNova and for how long
 * (visits, sign-ins, active time, average visit, last seen), plus who never opened it in the period. Data: /api/usage.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Activity, Loader2 } from 'lucide-react'

interface Person { userId: string; name: string; role: string; visits: number; logins: number; activeSeconds: number; days: number; avgVisitMin: number; lastAt: string | null }
interface Data { from: string; to: string; total: { people: number; visits: number; activeSeconds: number; logins: number; avgVisitMin: number }; people: Person[]; never: { userId: string; name: string; role: string }[] }

const ROLE_AR: Record<string, string> = { STUDENT: 'طالب', PARENT: 'ولي أمر', GUARDIAN: 'ولي أمر', TEACHER: 'مدرب', SUPER_ADMIN: 'المالك', ADMIN: 'أدمن', BRANCH_MANAGER: 'مدير فرع', SECRETARY: 'سكرتيرة', ACCOUNTANT: 'محاسب', MARKETING: 'تسويق' }
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function UsagePage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { can, ready, role } = useMyPermissions()
  const now = new Date()
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const to = iso(now)
  const from = period === 'day' ? to : period === 'week' ? iso(new Date(now.getTime() - 6 * 86_400_000)) : `${to.slice(0, 7)}-01`
  const { data, isLoading } = useQuery({
    queryKey: ['usage', from, to, who, q],
    queryFn: () => fetchApi<Data>(`/api/usage?from=${from}&to=${to}${who ? `&role=${who}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled: ready && can('audit_logs', 'read'),
  })
  if (role && !ready) return null
  if (!can('audit_logs', 'read')) return <AccessDenied title={L('Usage', 'الاستخدام')} message={L("You don't have access to the usage report.", 'مالكش صلاحية على تقرير الاستخدام.')} />
  const mins = (s: number) => Math.round(s / 60)
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
  const chip = (k: string, label: string, cur: string, set: (v: never) => void) => (
    <button key={k} type="button" onClick={() => set(k as never)} className={`rounded-full border px-3 py-1 text-sm ${cur === k ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>{label}</button>
  )
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Activity className="h-7 w-7 text-indigo-600" /> {L('Usage', 'الاستخدام')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('How often each person opens TechNova and for how long. A visit = opening the site after 30 minutes away; time counts only while the page is open in front of them.', 'كل شخص بيفتح TechNova كام مرة ولمدة قد إيه. الزيارة = فتح الموقع بعد غياب 30 دقيقة؛ والوقت بيتحسب بس والصفحة مفتوحة قدامه.')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chip('day', L('Today', 'النهارده'), period, setPeriod)}{chip('week', L('Last 7 days', 'آخر 7 أيام'), period, setPeriod)}{chip('month', L('This month', 'الشهر ده'), period, setPeriod)}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {chip('', L('Everyone', 'الكل'), who, setWho)}{chip('STUDENT', L('Students', 'الطلاب'), who, setWho)}{chip('PARENT', L('Parents', 'أولياء الأمور'), who, setWho)}{chip('TEACHER', L('Instructors', 'المدربين'), who, setWho)}{chip('STAFF', L('Staff', 'الموظفين'), who, setWho)}
        <Input className="h-9 w-56" placeholder={L('Search a name…', 'دوّر باسم…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[[L('People who used it', 'ناس استخدموه'), data.total.people], [L('Visits', 'زيارات'), data.total.visits], [L('Active time (hours)', 'وقت الاستخدام (ساعات)'), Math.round(data.total.activeSeconds / 360) / 10], [L('Average visit (minutes)', 'متوسط الزيارة (دقايق)'), data.total.avgVisitMin]].map(([k, v]) => (
              <Card key={String(k)}><CardContent className="pt-4"><p className="text-xs text-slate-500">{k}</p><p className="text-2xl font-bold tabular-nums text-slate-900">{v}</p></CardContent></Card>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>
                <th className="p-2 text-start">{L('Name', 'الاسم')}</th><th className="p-2 text-start">{L('Role', 'الدور')}</th><th className="p-2 text-start">{L('Visits', 'زيارات')}</th>
                <th className="p-2 text-start">{L('Sign-ins', 'تسجيل دخول')}</th><th className="p-2 text-start">{L('Days', 'أيام')}</th><th className="p-2 text-start">{L('Active minutes', 'دقايق الاستخدام')}</th>
                <th className="p-2 text-start">{L('Average visit', 'متوسط الزيارة')}</th><th className="p-2 text-start">{L('Last seen', 'آخر ظهور')}</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {data.people.map((p) => (
                  <tr key={p.userId} className="border-t">
                    <td className="p-2 font-medium">{p.name}</td><td className="p-2 text-slate-500">{ar ? ROLE_AR[p.role] ?? p.role : p.role}</td><td className="p-2">{p.visits}</td>
                    <td className="p-2">{p.logins}</td><td className="p-2">{p.days}</td><td className="p-2">{mins(p.activeSeconds)}</td><td className="p-2">{p.avgVisitMin} {L('min', 'د')}</td><td className="p-2 text-slate-500">{fmt(p.lastAt)}</td>
                  </tr>
                ))}
                {!data.people.length && <tr><td colSpan={8} className="p-3 text-slate-500">{L('Nobody yet in this period.', 'لسه محدش في الفترة دي.')}</td></tr>}
              </tbody>
            </table>
          </div>
          {who && (
            <Card><CardContent className="space-y-1 pt-4 text-sm">
              <p className="font-semibold text-slate-800">{L(`Never opened it in this period (${data.never.length})`, `ماافتحوش خالص في الفترة دي (${data.never.length})`)}</p>
              <p className="text-slate-600">{data.never.length ? data.never.map((n) => n.name).join('، ') : L('Everyone opened it.', 'الكل فتح.')}</p>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  )
}
