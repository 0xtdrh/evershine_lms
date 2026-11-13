'use client'

/**
 * Six phases 1-B: staff side of course bookings — the list (approve / reject / cancel) and the confirm rules
 * (AUTO after payment or STAFF approves first; seat hold hours) per company / branch / track / course / level / group.
 * APIs /api/bookings, /api/bookings/[id], /api/bookings/rules.
 */

import { useState } from 'react'
import { dayName } from '@/lib/i18n/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'

type Row = {
  id: string; status: string; statusText: { en: string; ar: string }; mode: string; code: string | null; course: { en: string; ar: string }; level: string | null; who: string; registrationNumber: string | null
  family: { firstName: string; lastName: string; phoneNumber: string } | null; group: { name: string; campus: string } | null
  invoice: { number: string; total: number; paid: number; status: string; proofStatus: string | null } | null; holdUntil: string | null; reason: string | null; createdAt: string
}
type Rule = { id: string; scopeType: string; scopeId: string | null; confirm: string; holdHours: number | null }
type Opt = { id: string; name: string }

const input = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const WAY: Record<string, [string, string]> = { ONLINE: ['Live online', 'لايف أونلاين'], RECORDED: ['Recorded', 'مسجل'], BRANCH: ['Branch', 'فرع'] }

export function StaffBookings({ canUpdate }: { canUpdate: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const list = useQuery({ queryKey: ['staff-bookings', status], queryFn: () => fetchApi<Row[]>(`/api/bookings${status ? `?status=${status}` : ''}`) })
  const act = async (id: string, action: 'APPROVE' | 'REJECT' | 'CANCEL') => {
    const reason = action === 'APPROVE' ? null : prompt(L('Reason (the family sees it)', 'السبب (العيلة بتشوفه)')) ?? undefined
    if (reason === undefined) return
    try { await fetchApi(`/api/bookings/${id}`, { method: 'POST', body: JSON.stringify({ action, reason }) }); notify.success(L('Done', 'تم')); void qc.invalidateQueries({ queryKey: ['staff-bookings'] }) } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[['', L('All', 'الكل')], ['REVIEW', L('To approve', 'مستني موافقة')], ['PLACEMENT', L('Need a level', 'محتاج تحديد مستوى')], ['HOLD', L('Held, not paid', 'محجوز ومش مدفوع')], ['WAITING', L('Waiting list', 'قايمة انتظار')], ['CONFIRMED', L('Confirmed', 'اتأكد')], ['EXPIRED', L('Expired', 'انتهى')]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={`rounded-full border px-3 py-1 text-sm ${status === k ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700'}`}>{label}</button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="p-2 text-start">{L('Student', 'الطالب')}</th><th className="p-2 text-start">{L('Course', 'الكورس')}</th><th className="p-2 text-start">{L('Way / group', 'الطريقة / الجروب')}</th>
            <th className="p-2 text-start">{L('Invoice', 'الفاتورة')}</th><th className="p-2 text-start">{L('Status', 'الحالة')}</th><th className="p-2" />
          </tr></thead>
          <tbody>
            {list.isLoading ? <tr><td colSpan={6} className="p-3 text-slate-500">{L('Loading…', 'بيحمّل…')}</td></tr> : !list.data?.length ? <tr><td colSpan={6} className="p-3 text-slate-500">{L('No bookings.', 'مفيش حجوزات.')}</td></tr> : list.data.map((b) => (
              <tr key={b.id} className="border-t border-slate-100 align-top">
                <td className="p-2"><b>{b.who}</b>{b.registrationNumber ? <span className="block text-xs text-emerald-700" dir="ltr">{b.registrationNumber}</span> : null}{b.family ? <span className="block text-xs text-slate-500">{b.family.firstName} {b.family.lastName} · <span dir="ltr">{b.family.phoneNumber}</span></span> : null}</td>
                <td className="p-2">{ar ? b.course.ar : b.course.en}{b.level ? <span className="block text-xs text-slate-500">{b.level}</span> : null}{b.code ? <span className="block text-xs text-violet-700" dir="ltr">{b.code}</span> : null}</td>
                <td className="p-2">{ar ? WAY[b.mode]?.[1] : WAY[b.mode]?.[0]}{b.group ? <span className="block text-xs text-slate-500">{b.group.name} · {b.group.campus}</span> : null}</td>
                <td className="p-2">{b.invoice ? <><span dir="ltr">{b.invoice.number}</span><span className="block text-xs text-slate-500">{b.invoice.paid} / {b.invoice.total}{b.invoice.proofStatus === 'PENDING' ? ` · ${L('receipt to check', 'إيصال للمراجعة')}` : ''}</span></> : '—'}</td>
                <td className="p-2">{ar ? b.statusText.ar : b.statusText.en}{b.status === 'HOLD' && b.holdUntil ? <span className="block text-xs text-amber-700">{L('until', 'لحد')} {new Date(b.holdUntil).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}</td>
                <td className="p-2 whitespace-nowrap">
                  <a href={`/reports/booking/${b.id}`} target="_blank" rel="noopener noreferrer" className="me-1 text-xs text-blue-700 underline">{L('Summary', 'الملخص')}</a>
                  {canUpdate && b.status === 'REVIEW' ? <><button type="button" onClick={() => void act(b.id, 'APPROVE')} className="me-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">{L('Approve', 'وافق')}</button><button type="button" onClick={() => void act(b.id, 'REJECT')} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">{L('Reject', 'ارفض')}</button></> : null}
                  {canUpdate && b.status === 'PLACEMENT' ? <PlaceForm id={b.id} recorded={b.mode === 'RECORDED'} onDone={() => void qc.invalidateQueries({ queryKey: ['staff-bookings'] })} /> : null}
                  {canUpdate && ['HOLD', 'WAITING', 'PLACEMENT'].includes(b.status) ? <button type="button" onClick={() => void act(b.id, 'CANCEL')} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">{L('Cancel', 'إلغاء')}</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function BookingRules() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['booking-rules'], queryFn: () => fetchApi<{ rules: Rule[]; options: Record<string, Opt[]> }>('/api/bookings/rules') })
  const [r, setR] = useState({ scopeType: 'COMPANY', scopeId: '', confirm: 'AUTO', holdHours: '' })
  if (!data) return null
  const SCOPE: Record<string, string> = { COMPANY: L('Whole company', 'الشركة كلها'), CAMPUS: L('Branch / place', 'فرع / مكان'), TRACK: L('Track', 'تراك'), COURSE: L('Course', 'كورس'), LEVEL: L('Level', 'مستوى'), GROUP: L('Group', 'جروب') }
  const nameOf = (x: Rule) => (x.scopeType === 'COMPANY' ? '' : data.options[x.scopeType]?.find((o) => o.id === x.scopeId)?.name ?? x.scopeId)
  const save = async () => {
    try {
      await fetchApi('/api/bookings/rules', { method: 'PUT', body: JSON.stringify({ scopeType: r.scopeType, scopeId: r.scopeType === 'COMPANY' ? null : r.scopeId, confirm: r.confirm, holdHours: r.holdHours ? Number(r.holdHours) : null }) })
      notify.success(L('Saved', 'اتحفظ')); void qc.invalidateQueries({ queryKey: ['booking-rules'] })
    } catch (e) { notify.error((e as Error).message) }
  }
  const del = async (id: string) => { try { await fetchApi(`/api/bookings/rules?id=${id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['booking-rules'] }) } catch (e) { notify.error((e as Error).message) } }
  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <p className="font-semibold text-slate-900">{L('How bookings are confirmed', 'الحجوزات بتتأكد إزاي')}</p>
      <p className="text-xs text-slate-600">{L('Without a rule: automatically, and the seat is held 48 hours for payment. A more specific rule wins (group > level > course > track > branch > company).', 'من غير قاعدة: أوتوماتيك، والمكان بيتحجز 48 ساعة للدفع. القاعدة الأدق بتكسب (جروب > مستوى > كورس > تراك > فرع > الشركة).')}</p>
      {data.rules.length ? <ul className="space-y-1">{data.rules.map((x) => (
        <li key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
          <span>{SCOPE[x.scopeType]}{nameOf(x) ? `: ${nameOf(x)}` : ''} — {x.confirm === 'STAFF' ? L('staff approve first', 'الموظف يوافق الأول') : L('automatic after payment', 'أوتوماتيك بعد الدفع')}{x.holdHours ? ` · ${L(`hold ${x.holdHours} h`, `حجز ${x.holdHours} ساعة`)}` : ''}</span>
          <button type="button" onClick={() => void del(x.id)} className="text-xs text-red-700">{L('Remove', 'شيل')}</button>
        </li>
      ))}</ul> : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">{L('For', 'على')}<select className={`${input} block`} value={r.scopeType} onChange={(e) => setR({ ...r, scopeType: e.target.value, scopeId: '' })}>{Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {r.scopeType !== 'COMPANY' ? <label className="text-xs">{SCOPE[r.scopeType]}<select className={`${input} block max-w-[16rem]`} value={r.scopeId} onChange={(e) => setR({ ...r, scopeId: e.target.value })}><option value="">—</option>{(data.options[r.scopeType] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label> : null}
        <label className="text-xs">{L('Confirm', 'التأكيد')}<select className={`${input} block`} value={r.confirm} onChange={(e) => setR({ ...r, confirm: e.target.value })}><option value="AUTO">{L('Automatic after payment', 'أوتوماتيك بعد الدفع')}</option><option value="STAFF">{L('Staff approve first', 'الموظف يوافق الأول')}</option></select></label>
        <label className="text-xs">{L('Hold (hours)', 'الحجز (ساعات)')}<input type="number" min={1} className={`${input} block w-24`} value={r.holdHours} onChange={(e) => setR({ ...r, holdHours: e.target.value })} placeholder="48" /></label>
        <button type="button" disabled={r.scopeType !== 'COMPANY' && !r.scopeId} onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{L('Save', 'احفظ')}</button>
      </div>
    </div>
  )
}

/** A track booking waiting for its level: choose the level (after talking to the family / a test) and a group, then place. */
function PlaceForm({ id, recorded, onDone }: { id: string; recorded: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [levelId, setLevelId] = useState('')
  const [groupId, setGroupId] = useState('')
  const { data } = useQuery({ queryKey: ['placement', id], queryFn: () => fetchApi<{ levels: Opt[]; groups: (Opt & { levelId: string; slots: unknown; full: boolean })[] }>(`/api/bookings/${id}`), enabled: open })
  const save = async () => {
    try { await fetchApi(`/api/bookings/${id}`, { method: 'POST', body: JSON.stringify({ action: 'PLACE', levelId, groupId: groupId || null }) }); notify.success(L('Placed', 'اتسكّن')); onDone() } catch (e) { notify.error((e as Error).message) }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="me-1 rounded-lg bg-violet-600 px-2 py-1 text-xs font-semibold text-white">{L('Set the level', 'حدد المستوى')}</button>
  const slots = (x: unknown) => (Array.isArray(x) ? (x as { dayOfWeek: number; time: string }[]).map((s) => `${dayName(s.dayOfWeek)} ${s.time}`).join(' · ') : '')
  return (
    <div className="mt-1 space-y-1 rounded-lg border border-violet-200 bg-violet-50 p-2 text-xs">
      <select className="w-full rounded border border-slate-300 bg-white p-1" value={levelId} onChange={(e) => { setLevelId(e.target.value); setGroupId('') }}><option value="">{L('Level…', 'المستوى…')}</option>{data?.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      {!recorded && levelId ? <select className="w-full rounded border border-slate-300 bg-white p-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">{L('No group yet (waiting list)', 'لسه مفيش جروب (قايمة انتظار)')}</option>{data?.groups.filter((g) => g.levelId === levelId).map((g) => <option key={g.id} value={g.id}>{g.name} {slots(g.slots)}{g.full ? ` — ${L('full', 'كامل')}` : ''}</option>)}</select> : null}
      <div className="flex gap-1"><button type="button" disabled={!levelId} onClick={() => void save()} className="rounded bg-violet-600 px-2 py-1 font-semibold text-white disabled:opacity-50">{L('Place', 'سكّن')}</button><button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-2 py-1">{L('Close', 'اقفل')}</button></div>
    </div>
  )
}
