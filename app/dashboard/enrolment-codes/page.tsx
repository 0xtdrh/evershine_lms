'use client'

/**
 * Six phases 1-a: enrolment codes. Staff make a batch of codes (free / percent / amount, for any or chosen course pages,
 * uses per code, end date, partner), see who used each code, download them as Excel and stop / start a batch.
 * A code is checked on the website sign-up and becomes an approved discount when staff approve the request.
 * APIs /api/enrolment-codes(/[batch]); permissions = Discounts.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { CODE_KINDS, CODE_KIND_LABEL, codeBenefit, type CodeKind } from '@/lib/site/codes'

type Batch = { batch: string; kind: string; value: number; scope: string; maxUses: number | null; expiresAt: string | null; createdAt: string; codes: number; used: number; active: number; partnerId: string | null; note: string | null }
type Data = { batches: Batch[]; listings: { slug: string; titleAr: string | null; titleEn: string | null }[]; partners: { id: string; name: string }[] }
type CodeRow = { code: string; uses: number; maxUses: number | null; active: boolean; usedBy: { phone: string; at: string }[] }

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const fmt = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric' })

export default function EnrolmentCodesPage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { can } = useMyPermissions()
  const { data, isLoading } = useQuery({ queryKey: ['enrolment-codes'], queryFn: () => fetchApi<Data>('/api/enrolment-codes') })
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState({ batch: '', count: 10, kind: 'PERCENT' as CodeKind, value: 20, duration: 'FIRST_CYCLE', scope: 'ANY', scopeIds: [] as string[], maxUses: '1' as string, expiresAt: '', partnerId: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string[] | null>(null)
  const codes = useQuery({ queryKey: ['enrolment-codes', open], queryFn: () => fetchApi<CodeRow[]>(`/api/enrolment-codes/${encodeURIComponent(open!)}`), enabled: !!open })

  const create = async () => {
    setBusy(true)
    try {
      const res = await fetchApi<{ codes: string[] }>('/api/enrolment-codes', {
        method: 'POST',
        body: JSON.stringify({
          ...form, value: form.kind === 'FREE' ? 0 : Number(form.value), count: Number(form.count),
          maxUses: form.maxUses === '' ? null : Number(form.maxUses), expiresAt: form.expiresAt || null, partnerId: form.partnerId || null, note: form.note || null,
        }),
      })
      setMade(res.codes)
      notify.success(L(`${res.codes.length} codes made`, `اتعمل ${res.codes.length} كود`))
      void qc.invalidateQueries({ queryKey: ['enrolment-codes'] })
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (b: Batch) => {
    try {
      await fetchApi(`/api/enrolment-codes/${encodeURIComponent(b.batch)}`, { method: 'PATCH', body: JSON.stringify({ active: b.active === 0 }) })
      void qc.invalidateQueries({ queryKey: ['enrolment-codes'] })
    } catch (e) { notify.error((e as Error).message) }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{L('Enrolment codes', 'أكواد التسجيل')}</h1>
        <p className="mt-1 text-sm text-slate-600">{L('Codes a family types when signing up on the website: free, a percent or an amount off. A used code becomes an approved discount when you approve the request in Admissions.', 'أكواد الأهل بيكتبوها وهما بيسجّلوا على الموقع: مجاني أو خصم بنسبة أو بمبلغ. الكود المستخدم بيتحول لخصم متوافق عليه لما توافق على الطلب في «التسجيل».')}</p>
      </div>

      {can('discounts', 'create') ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{L('Make codes', 'اعمل أكواد')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">{L('Batch name (English, e.g. NILE-SCHOOL)', 'اسم المجموعة (إنجليزي، مثلاً NILE-SCHOOL)')}<input dir="ltr" className={input} value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value.toUpperCase() })} /></label>
            <label className="text-sm">{L('How many codes', 'عدد الأكواد')}<input type="number" min={1} max={500} className={input} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></label>
            <label className="text-sm">{L('Kind', 'النوع')}<select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as CodeKind })}>{CODE_KINDS.map((k) => <option key={k} value={k}>{ar ? CODE_KIND_LABEL[k].ar : CODE_KIND_LABEL[k].en}</option>)}</select></label>
            {form.kind !== 'FREE' ? <label className="text-sm">{form.kind === 'PERCENT' ? L('Percent', 'النسبة %') : L('Amount (EGP)', 'المبلغ (جنيه)')}<input type="number" min={1} className={input} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></label> : null}
            <label className="text-sm">{L('For how long', 'لمدة إيه')}<select className={input} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}><option value="FIRST_CYCLE">{L('First month / level only', 'أول شهر أو مستوى بس')}</option><option value="EVERY_CYCLE">{L('Every month', 'كل شهر')}</option><option value="ONE_TIME">{L('One invoice', 'فاتورة واحدة')}</option></select></label>
            <label className="text-sm">{L('Uses per code (empty = no limit)', 'مرات الاستخدام لكل كود (فاضي = مفتوح)')}<input type="number" min={1} className={input} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} /></label>
            <label className="text-sm">{L('Ends on (optional)', 'ينتهي يوم (اختياري)')}<input type="date" className={input} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
            <label className="text-sm">{L('Partner (optional)', 'الشريك (اختياري)')}<select className={input} value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })}><option value="">—</option>{data?.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-sm">{L('Works for', 'يشتغل على')}<select className={input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option value="ANY">{L('Any course', 'أي كورس')}</option><option value="LISTING">{L('Chosen courses', 'كورسات أختارها')}</option></select></label>
            <label className="text-sm sm:col-span-2 lg:col-span-3">{L('Note (optional)', 'ملحوظة (اختياري)')}<input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          {form.scope === 'LISTING' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {data?.listings.length ? data.listings.map((l) => {
                const on = form.scopeIds.includes(l.slug)
                return <button key={l.slug} type="button" onClick={() => setForm({ ...form, scopeIds: on ? form.scopeIds.filter((x) => x !== l.slug) : [...form.scopeIds, l.slug] })} className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700'}`}>{(ar ? l.titleAr : l.titleEn) || l.slug}</button>
              }) : <p className="text-sm text-slate-500">{L('No course pages yet (Website → Courses).', 'مفيش صفحات كورسات لسه (الموقع ← الكورسات).')}</p>}
            </div>
          ) : null}
          <button type="button" disabled={busy || form.batch.length < 2} onClick={() => void create()} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? L('Making…', 'بيتعمل…') : L('Make the codes', 'اعمل الأكواد')}</button>
          {made ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" dir="ltr"><p className="mb-1 font-semibold" dir="auto">{L('New codes:', 'الأكواد الجديدة:')}</p><p className="break-all font-mono">{made.join('  ')}</p></div> : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-200 p-4 text-lg font-semibold text-slate-900">{L('Batches', 'المجموعات')}</h2>
        {isLoading ? <p className="p-4 text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p> : !data?.batches.length ? <p className="p-4 text-sm text-slate-500">{L('No codes yet.', 'مفيش أكواد لسه.')}</p> : (
          <ul className="divide-y divide-slate-200">
            {data.batches.map((b) => (
              <li key={b.batch} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => setOpen(open === b.batch ? null : b.batch)} className="font-mono font-semibold text-blue-700" dir="ltr">{b.batch}</button>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{codeBenefit(b.kind, b.value, ar)}</span>
                  <span className="text-sm text-slate-600">{L(`${b.codes} codes · used ${b.used} time(s)`, `${b.codes} كود · اتستخدم ${b.used} مرة`)}</span>
                  {b.expiresAt ? <span className="text-sm text-slate-600">{L('ends', 'ينتهي')} {fmt(b.expiresAt, ar)}</span> : null}
                  {b.scope === 'LISTING' ? <span className="text-sm text-slate-600">{L('chosen courses', 'كورسات محددة')}</span> : null}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${b.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{b.active ? L('on', 'شغال') : L('stopped', 'متوقف')}</span>
                  <span className="ms-auto flex gap-2">
                    <a href={`/api/enrolment-codes/${encodeURIComponent(b.batch)}?format=xlsx`} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700">Excel</a>
                    {can('discounts', 'update') ? <button type="button" onClick={() => void toggle(b)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700">{b.active ? L('Stop', 'وقّف') : L('Start', 'شغّل')}</button> : null}
                  </span>
                </div>
                {b.note ? <p className="mt-1 text-sm text-slate-500">{b.note}</p> : null}
                {open === b.batch ? (
                  codes.isLoading ? <p className="mt-2 text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p> : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-start text-slate-500"><th className="p-2 text-start">{L('Code', 'الكود')}</th><th className="p-2 text-start">{L('Used', 'اتستخدم')}</th><th className="p-2 text-start">{L('By (phone)', 'مين (الموبايل)')}</th></tr></thead>
                        <tbody>
                          {codes.data?.map((c) => (
                            <tr key={c.code} className="border-t border-slate-100">
                              <td className="p-2 font-mono" dir="ltr">{c.code}</td>
                              <td className="p-2">{c.uses} / {c.maxUses ?? '∞'}</td>
                              <td className="p-2" dir="ltr">{c.usedBy.map((u) => u.phone).join(', ') || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
