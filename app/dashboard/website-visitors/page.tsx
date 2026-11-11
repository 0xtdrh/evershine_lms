'use client'

/** x01 "Website visitors": how many, from where, how long, which device / city / page, which cards and forms. website:read. */

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { SOURCE_LABEL, type VisitSource } from '@/lib/site/visit-rules'
import { KIND_LABEL, type RequestKind } from '@/lib/site/request-rules'
import { SITE_CONTENT } from '@/lib/site/content'

interface Row { key: string; count: number }
interface Data {
  days: number; live: number
  totals: { visits: number; visitors: number; avgSeconds: number; pagesPerVisit: number; bounceRate: number; converted: number; conversionRate: number; requests: number; requestsTracked: number }
  byDay: { day: string; visits: number }[]
  bySource: (Row & { converted: number; requests: number })[]
  byDevice: Row[]; byCity: Row[]; byLanding: Row[]; byCampaign: Row[]; audience: Row[]; nav: Row[]
  forms: { opened: number; sent: number; byKind: (Row & { sent: number })[] }
  whatsapp: number; requestsByKind: Row[]
}

const BLUE = '#2a78d6'
const RANGES = [7, 30, 90, 365]

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900" dir="ltr" style={{ textAlign: 'start' }}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

function Bars({ title, rows, label, total, extra }: { title: string; rows: Row[]; label?: (k: string) => string; total: number; extra?: (r: Row) => string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-bold text-slate-800">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">{L('Nothing yet.', 'لسه مفيش.')}</p> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate text-slate-700">{label ? label(r.key) : r.key}</span><span className="shrink-0 font-semibold text-slate-900">{r.count}{extra ? <span className="ms-2 text-xs font-normal text-slate-500">{extra(r)}</span> : null}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full" style={{ width: `${total ? Math.max(3, (r.count / total) * 100) : 0}%`, background: BLUE }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function WebsiteVisitorsPage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const [days, setDays] = useState(30)
  const { data, isLoading } = useQuery({ queryKey: ['website-visitors', days], queryFn: () => fetchApi<Data>(`/api/website/visitors?days=${days}`), refetchInterval: 30_000 })
  const src = (k: string) => (k in SOURCE_LABEL ? (ar ? SOURCE_LABEL[k as VisitSource].ar : SOURCE_LABEL[k as VisitSource].en) : k)
  const dev = (k: string) => ({ MOBILE: L('Mobile', 'موبايل'), TABLET: L('Tablet', 'تابلت'), DESKTOP: L('Computer', 'كمبيوتر') } as Record<string, string>)[k] ?? k
  const kind = (k: string) => (k in KIND_LABEL ? (ar ? KIND_LABEL[k as RequestKind].ar : KIND_LABEL[k as RequestKind].en) : k)
  const city = (k: string) => (k === '—' ? L('Unknown', 'مش معروفة') : k)
  // cards and menu items are recorded by their English name; show the Arabic one on an Arabic screen
  const named = (k: string) => {
    const hit = [...SITE_CONTENT.audience.map((a) => a.title), ...SITE_CONTENT.nav.map((n) => n.label)].find((b) => b.en === k)
    return hit && ar ? hit.ar : k
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{L('Website visitors', 'زوار الموقع')}</h1>
          <p className="text-sm text-slate-500">{L('Counts only: who came, from where, how long, and what they did. A visitor’s IP is kept only if they accepted cookies, and wiped after 90 days.', 'أرقام بس: مين دخل، منين، أد إيه، وعمل إيه. الـ IP بيتحفظ بس لو الزائر وافق على الكوكيز، وبيتمسح بعد 90 يوم.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/website" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{L('Website', 'الموقع')}</Link>
          <Link href="/dashboard/leads" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{L('Website requests', 'طلبات الموقع')}</Link>
          <div className="flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label={L('Period', 'المدة')}>
            {RANGES.map((d) => <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${days === d ? 'bg-sky-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{d === 365 ? L('Year', 'سنة') : L(`${d} days`, `${d} يوم`)}</button>)}
          </div>
        </div>
      </div>

      {isLoading || !data ? <p className="text-sm text-slate-500">…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label={L('On the website now', 'موجودين دلوقتي')} value={data.live} hint={L('in the last minute', 'في آخر دقيقة')} />
            <Tile label={L('Visits', 'الزيارات')} value={data.totals.visits} hint={L(`${data.totals.visitors} visitors`, `${data.totals.visitors} زائر`)} />
            <Tile label={L('Average time', 'متوسط الوقت')} value={mmss(data.totals.avgSeconds)} hint={L(`${data.totals.pagesPerVisit} pages per visit`, `${data.totals.pagesPerVisit} صفحة في الزيارة`)} />
            <Tile label={L('Left quickly', 'خرجوا بسرعة')} value={`${data.totals.bounceRate}%`} hint={L('one page, under 15 seconds', 'صفحة واحدة وأقل من 15 ثانية')} />
            <Tile label={L('Took action', 'اتواصلوا')} value={`${data.totals.conversionRate}%`} hint={L(`${data.totals.converted} visits sent a form or tapped WhatsApp`, `${data.totals.converted} زيارة بعتت فورم أو داست واتساب`)} />
            <Tile label={L('Requests', 'الطلبات')} value={data.totals.requests} hint={L(`${data.totals.requestsTracked} with a known source`, `${data.totals.requestsTracked} معروف جايين منين`)} />
            <Tile label={L('Forms opened → sent', 'فورمات اتفتحت ← اتبعتت')} value={`${data.forms.opened} → ${data.forms.sent}`} />
            <Tile label={L('WhatsApp taps', 'ضغطات الواتساب')} value={data.whatsapp} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-slate-800">{L('Visits per day', 'الزيارات كل يوم')}</h2>
            <div style={{ height: 240 }} dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.byDay} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={18} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(v: number) => [v, L('visits', 'زيارة')]} />
                  <Line type="monotone" dataKey="visits" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-bold text-slate-800">{L('Where they came from', 'جايين منين')}</h2>
              {data.bySource.length === 0 ? <p className="text-sm text-slate-500">{L('Nothing yet.', 'لسه مفيش.')}</p> : (
                <>
                  <div style={{ height: Math.max(120, data.bySource.length * 34) }} dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.bySource.map((s) => ({ name: src(s.key), visits: s.count }))} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#334155' }} />
                        <Tooltip formatter={(v: number) => [v, L('visits', 'زيارة')]} />
                        <Bar dataKey="visits" fill={BLUE} radius={[0, 4, 4, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <table className="mt-3 w-full text-sm">
                    <thead><tr className="text-xs text-slate-500"><th className="text-start font-semibold">{L('Source', 'المصدر')}</th><th className="text-end font-semibold">{L('Visits', 'زيارات')}</th><th className="text-end font-semibold">{L('Took action', 'اتواصلوا')}</th><th className="text-end font-semibold">{L('Requests', 'طلبات')}</th></tr></thead>
                    <tbody>{data.bySource.map((s) => <tr key={s.key} className="border-t border-slate-100"><td className="py-1.5">{src(s.key)}</td><td className="text-end">{s.count}</td><td className="text-end">{s.converted}</td><td className="text-end">{s.requests}</td></tr>)}</tbody>
                  </table>
                </>
              )}
            </div>
            <Bars title={L('“Who are you?” cards clicked', 'كروت «إنت جاي علشان» اللي اتداس عليها')} rows={data.audience} label={named} total={Math.max(1, ...data.audience.map((r) => r.count))} />
            <Bars title={L('Device', 'الجهاز')} rows={data.byDevice} label={dev} total={data.totals.visits} />
            <Bars title={L('City', 'المدينة')} rows={data.byCity} label={city} total={data.totals.visits} />
            <Bars title={L('First page they opened', 'أول صفحة فتحوها')} rows={data.byLanding} total={data.totals.visits} />
            <Bars title={L('Forms: opened (sent)', 'الفورمات: اتفتحت (اتبعتت)')} rows={data.forms.byKind} label={kind} total={Math.max(1, ...data.forms.byKind.map((r) => r.count))} extra={(r) => `(${(r as Row & { sent: number }).sent})`} />
            <Bars title={L('Campaign links', 'لينكات الحملات')} rows={data.byCampaign} total={Math.max(1, ...data.byCampaign.map((r) => r.count))} />
            <Bars title={L('Menu items clicked', 'بنود القائمة اللي اتداس عليها')} rows={data.nav} label={named} total={Math.max(1, ...data.nav.map((r) => r.count))} />
          </div>
          <p className="text-xs text-slate-500">{L('Campaign link: add ?utm_source=facebook&utm_campaign=winter-camp to the website link in an ad, so its visits are counted apart.', 'لينك الحملة: زوّد ‎?utm_source=facebook&utm_campaign=winter-camp على لينك الموقع في الإعلان، فزياراته تتحسب لوحدها.')}</p>
        </>
      )}
    </div>
  )
}
