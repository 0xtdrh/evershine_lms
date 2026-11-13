'use client'

/**
 * Six phases E: group policies — how students enter a group (at once / after payment), the minimum to start, who counts,
 * the least instalment part, alert days, next-month seat days, and "start anyway" (the Super Admin's switch).
 * Rules per company / branch / track / course / level / group; for each field the most specific rule that sets it wins.
 * API /api/group-policies.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'

type Row = { id: string; scopeType: string; scopeId: string | null; entry: string | null; minStudents: number | null; countPaidOnly: boolean | null; minPartPercent: number | null; alertDays: number | null; nextMonthKeepDays: number | null; startAnyway: boolean | null }
type Data = { rows: Row[]; options: Record<string, { id: string; name: string }[]>; canEdit: boolean; canStartAnyway: boolean }

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const tri = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no')
const fromTri = (v: string) => (v === '' ? null : v === 'yes')
const num = (v: string) => (v === '' ? null : Number(v))

export default function GroupPoliciesPage() {
  useI18n()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['group-policies'], queryFn: () => fetchApi<Data>('/api/group-policies') })
  const empty = { scopeType: 'COMPANY', scopeId: '', entry: '', minStudents: '', countPaidOnly: '', minPartPercent: '', alertDays: '', nextMonthKeepDays: '', startAnyway: '' }
  const [f, setF] = useState(empty)
  const SCOPE: Record<string, string> = { COMPANY: L('Whole company', 'الشركة كلها'), CAMPUS: L('Branch / place', 'فرع / مكان'), TRACK: L('Track', 'تراك'), COURSE: L('Course', 'كورس'), LEVEL: L('Level', 'مستوى'), GROUP: L('Group', 'جروب') }
  if (!data) return <p className="p-6 text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
  const nameOf = (r: Row) => (r.scopeType === 'COMPANY' ? '' : data.options[r.scopeType]?.find((o) => o.id === r.scopeId)?.name ?? r.scopeId)
  const edit = (r: Row) => setF({ scopeType: r.scopeType, scopeId: r.scopeId ?? '', entry: r.entry ?? '', minStudents: r.minStudents?.toString() ?? '', countPaidOnly: tri(r.countPaidOnly), minPartPercent: r.minPartPercent?.toString() ?? '', alertDays: r.alertDays?.toString() ?? '', nextMonthKeepDays: r.nextMonthKeepDays?.toString() ?? '', startAnyway: tri(r.startAnyway) })
  const save = async () => {
    try {
      await fetchApi('/api/group-policies', {
        method: 'PUT',
        body: JSON.stringify({
          scopeType: f.scopeType, scopeId: f.scopeType === 'COMPANY' ? null : f.scopeId, entry: f.entry || null, minStudents: num(f.minStudents), countPaidOnly: fromTri(f.countPaidOnly),
          minPartPercent: num(f.minPartPercent), alertDays: num(f.alertDays), nextMonthKeepDays: num(f.nextMonthKeepDays), ...(data.canStartAnyway ? { startAnyway: fromTri(f.startAnyway) } : {}),
        }),
      })
      notify.success(L('Saved', 'اتحفظ')); setF(empty); void qc.invalidateQueries({ queryKey: ['group-policies'] })
    } catch (e) { notify.error((e as Error).message) }
  }
  const del = async (id: string) => { try { await fetchApi(`/api/group-policies?id=${id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['group-policies'] }) } catch (e) { notify.error((e as Error).message) } }
  const describe = (r: Row) => [
    r.entry ? (r.entry === 'AFTER_PAYMENT' ? L('joins after payment', 'الدخول بعد الدفع') : L('joins at once', 'الدخول على طول')) : null,
    r.minStudents ? L(`minimum ${r.minStudents} to start`, `أقل عدد للبداية ${r.minStudents}`) : null,
    r.countPaidOnly !== null ? (r.countPaidOnly ? L('only those who paid count', 'بيتحسب اللي دفع بس') : L('everyone counts', 'الكل بيتحسب')) : null,
    r.minPartPercent ? L(`least instalment ${r.minPartPercent}%`, `أقل دفعة ${r.minPartPercent}%`) : null,
    r.alertDays !== null ? L(`alert ${r.alertDays} day(s) before`, `تنبيه قبلها بـ ${r.alertDays} يوم`) : null,
    r.nextMonthKeepDays !== null ? L(`next month seat kept ${r.nextMonthKeepDays} day(s)`, `مكان الشهر الجاي محجوز ${r.nextMonthKeepDays} يوم`) : null,
    r.startAnyway !== null ? (r.startAnyway ? L('"start anyway" allowed', '«يبدأ برضه» مسموح') : L('"start anyway" not allowed', '«يبدأ برضه» ممنوع')) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{L('Group policies', 'سياسة الجروبات')}</h1>
        <p className="mt-1 text-sm text-slate-600">{L('How students enter a group and when a group may start. Without a rule: they join at once and there is no minimum. A more specific rule wins (group > level > course > track > branch > company), field by field.', 'الطالب بيدخل الجروب إزاي، والجروب يبدأ إمتى. من غير قاعدة: الدخول على طول ومفيش حد أدنى. القاعدة الأدق بتكسب (جروب > مستوى > كورس > تراك > فرع > الشركة)، خانة خانة.')}</p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        {data.rows.length ? (
          <ul className="divide-y divide-slate-100">{data.rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span><b>{SCOPE[r.scopeType]}{nameOf(r) ? `: ${nameOf(r)}` : ''}</b><span className="block text-slate-600">{describe(r) || '—'}</span></span>
              {data.canEdit ? <span className="flex gap-2"><button type="button" onClick={() => edit(r)} className="text-xs text-blue-700">{L('Edit', 'عدّل')}</button><button type="button" onClick={() => void del(r.id)} className="text-xs text-red-700">{L('Remove', 'شيل')}</button></span> : null}
            </li>
          ))}</ul>
        ) : <p className="p-3 text-sm text-slate-500">{L('No rules yet.', 'مفيش قواعد لسه.')}</p>}
      </section>
      {data.canEdit ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">{L('Add / change a rule', 'ضيف / عدّل قاعدة')}</h2>
          <p className="text-xs text-slate-500">{L('Leave a field empty to take it from above.', 'سيب الخانة فاضية علشان تاخدها من اللي فوق.')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">{L('For', 'على')}<select className={input} value={f.scopeType} onChange={(e) => setF({ ...f, scopeType: e.target.value, scopeId: '' })}>{Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {f.scopeType !== 'COMPANY' ? <label className="text-sm">{SCOPE[f.scopeType]}<select className={input} value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}><option value="">—</option>{(data.options[f.scopeType] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
            <label className="text-sm">{L('Joining the group', 'الدخول للجروب')}<select className={input} value={f.entry} onChange={(e) => setF({ ...f, entry: e.target.value })}><option value="">{L('(from above)', '(من اللي فوق)')}</option><option value="NOW">{L('At once — seat held until paid', 'على طول — المكان محجوز لحد الدفع')}</option><option value="AFTER_PAYMENT">{L('Only after payment', 'بعد الدفع بس')}</option></select></label>
            <label className="text-sm">{L('Minimum students to start', 'أقل عدد للبداية')}<input type="number" min={1} className={input} value={f.minStudents} onChange={(e) => setF({ ...f, minStudents: e.target.value })} /></label>
            <label className="text-sm">{L('Who counts toward the minimum', 'مين بيتحسب في العدد')}<select className={input} value={f.countPaidOnly} onChange={(e) => setF({ ...f, countPaidOnly: e.target.value })}><option value="">{L('(from above — paid only when "after payment")', '(من اللي فوق — اللي دفع بس لو «بعد الدفع»)')}</option><option value="yes">{L('Only those who paid', 'اللي دفع بس')}</option><option value="no">{L('Everyone in the group', 'كل اللي في الجروب')}</option></select></label>
            <label className="text-sm">{L('Least instalment that counts (%)', 'أقل دفعة بتتحسب في التقسيط (%)')}<input type="number" min={1} max={100} className={input} value={f.minPartPercent} onChange={(e) => setF({ ...f, minPartPercent: e.target.value })} placeholder={L('any payment', 'أي دفعة')} /></label>
            <label className="text-sm">{L('Alert staff N days before the expected start', 'نبّه الموظف قبل البداية المتوقعة بـ')}<input type="number" min={0} className={input} value={f.alertDays} onChange={(e) => setF({ ...f, alertDays: e.target.value })} placeholder="5" /></label>
            <label className="text-sm">{L('Next month: seat kept N days after the deadline', 'الشهر الجاي: المكان محجوز كام يوم بعد المهلة')}<input type="number" min={0} className={input} value={f.nextMonthKeepDays} onChange={(e) => setF({ ...f, nextMonthKeepDays: e.target.value })} placeholder="7" /></label>
            {data.canStartAnyway ? <label className="text-sm">{L('"Start anyway" below the minimum', '«يبدأ برضه» تحت الحد الأدنى')}<select className={input} value={f.startAnyway} onChange={(e) => setF({ ...f, startAnyway: e.target.value })}><option value="">{L('(from above — not allowed)', '(من اللي فوق — ممنوع)')}</option><option value="yes">{L('Allowed (for staff with the permission)', 'مسموح (للي عنده الصلاحية)')}</option><option value="no">{L('Not allowed', 'ممنوع')}</option></select></label> : null}
          </div>
          <button type="button" disabled={f.scopeType !== 'COMPANY' && !f.scopeId} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{L('Save', 'احفظ')}</button>
        </section>
      ) : null}
    </div>
  )
}
