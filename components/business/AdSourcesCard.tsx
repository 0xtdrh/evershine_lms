'use client'

/** x01 / business growth: spend, visits, requests and new students per ad source for one month (company only). */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { SOURCE_LABEL, type VisitSource } from '@/lib/site/visit-rules'
import { cairoToday } from '@/lib/dates/cairo'

interface Row { source: VisitSource; spend: number; visits: number; requests: number; newStudents: number; costPerRequest: number | null; costPerNew: number | null }
interface Data { ym: string; rows: Row[]; totals: { spend: number; visits: number; requests: number; newFromWebsite: number; newOther: number; newStudentsTotal: number; costPerNewAll: number | null } }

export function AdSourcesCard({ canEdit }: { canEdit: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const [ym, setYm] = useState(cairoToday().slice(0, 7))
  const { data, isLoading } = useQuery({ queryKey: ['ad-sources', ym], queryFn: () => fetchApi<Data>(`/api/business-growth/ad-sources?ym=${ym}`) })
  const [spend, setSpend] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setSpend(Object.fromEntries(data.rows.map((r) => [r.source, r.spend ? String(r.spend) : '']))) }, [data])
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { maximumFractionDigits: 0 }))
  const dirty = !!data && data.rows.some((r) => (spend[r.source] || '') !== (r.spend ? String(r.spend) : ''))

  const save = async () => {
    setBusy(true)
    try {
      const values = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v === '' ? null : Number(v)]))
      const r = await fetchApi<Data>('/api/business-growth/ad-sources', { method: 'PUT', body: JSON.stringify({ ym, values }) })
      qc.setQueryData(['ad-sources', ym], r)
      notify.success(L('Saved', 'اتحفظ'))
    } catch (e) {
      notify.error(e instanceof Error ? e.message : L('Could not save', 'معرفتش أحفظ'))
    } finally {
      setBusy(false)
    }
  }

  const rows = (data?.rows ?? []).filter((r) => r.spend || r.visits || r.requests || r.newStudents || canEdit)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{L('Ads: cost per request and per new student', 'الإعلانات: تكلفة الطلب والطالب الجديد')}</p>
          <p className="text-xs text-slate-500">{L('Type what you spent on each source this month. Requests come from the website forms; a new student counts for the source of the first website request with the same phone.', 'اكتب صرفت كام على كل مصدر الشهر ده. الطلبات من فورمات الموقع، والطالب الجديد بيتحسب للمصدر بتاع أول طلب من الموقع بنفس رقم الموبايل.')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">{L('Month', 'الشهر')}
          <input type="month" dir="ltr" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
        </label>
      </div>
      {isLoading || !data ? <p className="mt-3 text-sm text-slate-500">…</p> : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500"><tr>
                <th className="py-2 text-start font-semibold">{L('Source', 'المصدر')}</th><th className="py-2 text-start font-semibold">{L('Spent (EGP)', 'المصروف (جنيه)')}</th>
                <th className="py-2 text-end font-semibold">{L('Visits', 'زيارات')}</th><th className="py-2 text-end font-semibold">{L('Requests', 'طلبات')}</th>
                <th className="py-2 text-end font-semibold">{L('New students', 'طلاب جداد')}</th><th className="py-2 text-end font-semibold">{L('Per request', 'للطلب')}</th><th className="py-2 text-end font-semibold">{L('Per new student', 'للطالب الجديد')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.source} className="border-t border-slate-100">
                    <td className="py-1.5">{ar ? SOURCE_LABEL[r.source].ar : SOURCE_LABEL[r.source].en}</td>
                    <td className="py-1.5">{canEdit ? <input type="number" min={0} dir="ltr" aria-label={L('Spent', 'المصروف')} className="w-28 rounded-md border border-slate-200 px-2 py-1" value={spend[r.source] ?? ''} onChange={(e) => setSpend({ ...spend, [r.source]: e.target.value })} /> : n(r.spend)}</td>
                    <td className="py-1.5 text-end">{r.visits}</td><td className="py-1.5 text-end">{r.requests}</td><td className="py-1.5 text-end">{r.newStudents}</td>
                    <td className="py-1.5 text-end">{n(r.costPerRequest)}</td><td className="py-1.5 text-end font-semibold">{n(r.costPerNew)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>{L('Total spent', 'إجمالي المصروف')}: <b>{n(data.totals.spend)}</b> · {L('new students', 'طلاب جداد')}: <b>{data.totals.newStudentsTotal}</b> ({L(`${data.totals.newFromWebsite} through the website, ${data.totals.newOther} other ways`, `${data.totals.newFromWebsite} عن طريق الموقع، ${data.totals.newOther} بطرق تانية`)}) · {L('per new student overall', 'للطالب الجديد إجمالاً')}: <b>{n(data.totals.costPerNewAll)}</b></p>
            {canEdit ? <button type="button" disabled={!dirty || busy} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-40" onClick={() => void save()}>{busy ? '…' : L('Save', 'احفظ')}</button> : null}
          </div>
        </>
      )}
    </div>
  )
}
