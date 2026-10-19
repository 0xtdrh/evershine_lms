'use client'

/**
 * Partners part 1: the money deals of a partner, built from pieces (who collects, the share pieces, extras), and a live
 * check of what a deal gives for a month from the real numbers in the system.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { COLLECTOR_LABELS, COMPONENT_KINDS, KIND_LABELS, type Collector, type ComponentKind, type DealComponent, type DealExtra, type DealLine } from '@/lib/partners/deal'
import type { PartnerDetail } from './types'
import { Calculator, Loader2, Pencil, Plus, Scale, Trash2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface DealRow {
  id: string; title: string; campusId: string | null; contractId: string | null; collector: Collector; components: DealComponent[]; extras: DealExtra[] | null
  countPartnerCancelled: boolean; period: 'MONTH' | 'TERM'; validFrom: string; validTo: string | null; notes: string | null; isActive: boolean
}
interface Preview {
  from: string; to: string
  facts: { collected: number; refunds: number; discounts: number; sessionsHeld: number; sessionsCancelledByPartner: number; students: number; groups: number; months: number }
  result: { lines: DealLine[]; shareTotal: number; balanceForTechNova: number; sessionsCounted: number }
}

const d10 = (s: string | null) => (s ? s.slice(0, 10) : '')
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
const blank = (): Omit<DealRow, 'id'> => ({ title: '', campusId: null, contractId: null, collector: 'TECHNOVA', components: [{ kind: 'PERCENT', value: 30, base: 'NET' }], extras: [], countPartnerCancelled: true, period: 'MONTH', validFrom: new Date().toISOString().slice(0, 10), validTo: null, notes: '', isActive: true })

function summary(d: Pick<DealRow, 'collector' | 'components'>) {
  return d.components.map((c) => (c.kind === 'PERCENT' ? `${c.value}%` : `${L(KIND_LABELS[c.kind].en, KIND_LABELS[c.kind].ar)} ${c.value}`)).join(' + ')
}

export function PartnerDeals({ p, canEdit }: { p: PartnerDetail; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data: deals = [], isLoading } = useQuery({ queryKey: ['partner-deals', p.id], queryFn: () => fetchApi<DealRow[]>(`/api/partners/${p.id}/deals`) })
  const [editing, setEditing] = useState<string | 'NEW' | null>(null)
  const [f, setF] = useState(blank())
  const [checkFor, setCheckFor] = useState<string | null>(null)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const range = (() => { const [y, m] = month.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` } })()
  const { data: preview, isFetching } = useQuery({
    queryKey: ['deal-preview', checkFor, range.from],
    queryFn: () => fetchApi<Preview>(`/api/partner-deals/${checkFor}/preview?from=${range.from}&to=${range.to}`),
    enabled: !!checkFor,
  })
  const save = useMutation({
    mutationFn: (body: typeof f) => editing === 'NEW'
      ? fetchApi(`/api/partners/${p.id}/deals`, { method: 'POST', body: JSON.stringify(body) })
      : fetchApi(`/api/partner-deals/${editing}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setEditing(null); qc.invalidateQueries({ queryKey: ['partner-deals', p.id] }); qc.invalidateQueries({ queryKey: ['deal-preview'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const open = (d: DealRow | null) => {
    setEditing(d ? d.id : 'NEW')
    setF(d ? { ...d, validFrom: d10(d.validFrom), validTo: d.validTo ? d10(d.validTo) : null, notes: d.notes ?? '', extras: d.extras ?? [] } : blank())
  }
  const placeName = (id: string | null) => (id ? p.places.find((x) => x.id === id)?.name ?? '?' : L('All places', 'كل الأماكن'))
  const setComp = (i: number, c: Partial<DealComponent>) => setF({ ...f, components: f.components.map((x, j) => (j === i ? { ...x, ...c } : x)) })
  const setExtra = (i: number, c: Partial<DealExtra>) => setF({ ...f, extras: (f.extras ?? []).map((x, j) => (j === i ? { ...x, ...c } : x)) })
  const share = COLLECTOR_LABELS[f.collector].share

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">{L('Each partner has its own deal. Build it from pieces; the system calculates the money for any month from what is recorded (payments, sessions, students).', 'كل شريك ليه اتفاقه. ركّبه من القطع، والسيستم بيحسب الفلوس لأي شهر من اللي متسجل (المدفوعات، الحصص، الطلاب).')}</p>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : deals.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">{L('No deal yet.', 'لسه مفيش اتفاق.')}</p>}
      <ul className="space-y-2">
        {deals.map((d) => (
          <li key={d.id} className={`space-y-2 rounded-lg border border-slate-200 p-3 ${d.isActive ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-600" />
              <span className="font-medium text-slate-900">{d.title}</span>
              <span className="text-xs text-slate-500">· {placeName(d.campusId)} · {L(COLLECTOR_LABELS[d.collector].en, COLLECTOR_LABELS[d.collector].ar)}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">{summary(d)}</span>
              <span className="text-xs text-slate-500">{d10(d.validFrom)} → {d.validTo ? d10(d.validTo) : L('open', 'مفتوح')}</span>
              {!d.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{L('Stopped', 'موقوف')}</span>}
              <span className="ms-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setCheckFor(checkFor === d.id ? null : d.id)}><Calculator className="me-1 h-4 w-4" />{L('Check a month', 'احسب شهر')}</Button>
                {canEdit && <Button size="sm" variant="ghost" onClick={() => open(d)}><Pencil className="h-4 w-4" /></Button>}
              </span>
            </div>
            {checkFor === d.id && (
              <div className="space-y-2 rounded-md bg-slate-50 p-3">
                <div className="flex items-center gap-2"><Label className="text-xs">{L('Month', 'الشهر')}</Label><Input type="month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />{isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}</div>
                {preview && (
                  <>
                    <p className="text-xs text-slate-600">
                      {L('Collected', 'اتحصّل')} {money(preview.facts.collected)} · {L('refunds', 'استرداد')} {money(preview.facts.refunds)} · {L('discounts', 'خصومات')} {money(preview.facts.discounts)} · {preview.facts.sessionsHeld} {L('sessions', 'حصة')}
                      {preview.facts.sessionsCancelledByPartner ? ` (+${preview.facts.sessionsCancelledByPartner} ${L('cancelled by the partner', 'لغاها الشريك')})` : ''} · {preview.facts.students} {L('students', 'طالب')} · {preview.facts.groups} {L('groups', 'جروب')}
                    </p>
                    <table className="w-full text-xs">
                      <tbody>
                        {preview.result.lines.map((l, i) => (
                          <tr key={i} className="border-b border-slate-200">
                            <td className="py-1">{L(l.label, l.labelAr)}</td>
                            <td className="py-1 text-slate-500">{l.quantity} × {l.rate}</td>
                            <td className="py-1 text-end">{money(l.amount)}</td>
                            <td className="py-1 text-end text-slate-500">{l.payer === 'TECHNOVA' ? L('TechNova pays', 'TechNova تدفع') : L('Partner pays', 'الشريك يدفع')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className={`text-sm font-semibold ${preview.result.balanceForTechNova >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {preview.result.balanceForTechNova >= 0 ? L('The partner owes TechNova', 'الشريك عليه لـ TechNova') : L('TechNova owes the partner', 'TechNova عليها للشريك')}: {money(Math.abs(preview.result.balanceForTechNova))}
                    </p>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit && editing === null && <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="me-1 h-4 w-4" />{L('Add deal', 'ضيف اتفاق')}</Button>}
      {canEdit && editing !== null && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">{L('Name', 'الاسم')}</Label><Input className="h-9" placeholder={L('e.g. Deal 2026/27', 'مثلًا اتفاق 2026/27')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('For which place', 'لأنهي مكان')}</Label>
              <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2" value={f.campusId ?? ''} onChange={(e) => setF({ ...f, campusId: e.target.value || null })}>
                <option value="">{L('All places of the partner', 'كل أماكن الشريك')}</option>
                {p.places.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{L('Who collects from the parents?', 'مين بيحصّل من أولياء الأمور؟')}</Label>
              <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2" value={f.collector} onChange={(e) => setF({ ...f, collector: e.target.value as Collector })}>
                {(Object.keys(COLLECTOR_LABELS) as Collector[]).map((c) => <option key={c} value={c}>{L(COLLECTOR_LABELS[c].en, COLLECTOR_LABELS[c].ar)}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold">{L(share.en, share.ar)} — {L('pieces (they add up)', 'القطع (بتتجمع)')}</Label>
            {f.components.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={c.kind} onChange={(e) => setComp(i, { kind: e.target.value as ComponentKind })}>
                  {COMPONENT_KINDS.map((k) => <option key={k} value={k}>{L(KIND_LABELS[k].en, KIND_LABELS[k].ar)}</option>)}
                </select>
                <Input type="number" min={0} className="h-9 w-28" value={c.value} onChange={(e) => setComp(i, { value: Number(e.target.value) })} />
                <span className="text-xs text-slate-500">{c.kind === 'PERCENT' ? '%' : 'EGP'}</span>
                {c.kind === 'PERCENT' && (
                  <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" value={c.base ?? 'NET'} onChange={(e) => setComp(i, { base: e.target.value as 'NET' | 'GROSS' })}>
                    <option value="NET">{L('of net revenue (after refunds)', 'من صافي الإيراد (بعد الاسترداد)')}</option>
                    <option value="GROSS">{L('of revenue before discounts', 'من الإيراد قبل الخصومات')}</option>
                  </select>
                )}
                {c.kind === 'PERCENT' && f.collector !== 'INSTITUTION' && (
                  <span className="w-full text-xs font-medium text-indigo-700">
                    {f.collector === 'TECHNOVA'
                      ? L(`The partner takes ${c.value}% — TechNova keeps ${100 - Number(c.value)}%`, `الشريك ياخد ${c.value}% — TechNova تاخد ${100 - Number(c.value)}%`)
                      : L(`TechNova takes ${c.value}% — the partner keeps ${100 - Number(c.value)}%`, `TechNova تاخد ${c.value}% — الشريك ياخد ${100 - Number(c.value)}%`)}
                  </span>
                )}
                {c.kind === 'PER_HOUR' && <><Input type="number" min={0.25} step={0.25} className="h-9 w-20" value={c.hoursPerSession ?? 1} onChange={(e) => setComp(i, { hoursPerSession: Number(e.target.value) })} /><span className="text-xs text-slate-500">{L('hours / session', 'ساعة للحصة')}</span></>}
                <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setF({ ...f, components: f.components.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setF({ ...f, components: [...f.components, { kind: 'FIXED_MONTHLY', value: 0 }] })}><Plus className="me-1 h-4 w-4" />{L('Add piece', 'ضيف قطعة')}</Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold">{L('Extras (tools, transport, …)', 'إضافات (أدوات، مواصلات، …)')}</Label>
            {(f.extras ?? []).map((x, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="h-9 w-40" placeholder={L('Name', 'الاسم')} value={x.label} onChange={(e) => setExtra(i, { label: e.target.value })} />
                <Input type="number" min={0} className="h-9 w-24" value={x.amount} onChange={(e) => setExtra(i, { amount: Number(e.target.value) })} />
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" value={x.per} onChange={(e) => setExtra(i, { per: e.target.value as DealExtra['per'] })}>
                  <option value="ONCE">{L('once', 'مرة واحدة')}</option><option value="MONTH">{L('per month', 'في الشهر')}</option><option value="SESSION">{L('per session', 'على كل حصة')}</option>
                </select>
                <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" value={x.payer} onChange={(e) => setExtra(i, { payer: e.target.value as DealExtra['payer'] })}>
                  <option value="PARTNER">{L('the partner pays', 'الشريك يدفعها')}</option><option value="TECHNOVA">{L('TechNova pays', 'TechNova تدفعها')}</option>
                </select>
                <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setF({ ...f, extras: (f.extras ?? []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setF({ ...f, extras: [...(f.extras ?? []), { label: '', amount: 0, per: 'MONTH', payer: 'PARTNER' }] })}><Plus className="me-1 h-4 w-4" />{L('Add extra', 'ضيف إضافة')}</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-xs sm:col-span-3"><input type="checkbox" checked={f.countPartnerCancelled} onChange={(e) => setF({ ...f, countPartnerCancelled: e.target.checked })} />{L('Sessions the partner cancels still count', 'الحصص اللي الشريك بيلغيها بتتحسب')}</label>
            <div className="space-y-1"><Label className="text-xs">{L('Statement every', 'كشف الحساب كل')}</Label>
              <select className="h-9 w-full rounded-md border border-slate-200 bg-white px-2" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as 'MONTH' | 'TERM' })}>
                <option value="MONTH">{L('Month', 'شهر')}</option><option value="TERM">{L('Term', 'ترم')}</option>
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">{L('From', 'من')}</Label><DateInput className="h-9" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">{L('To (empty = open)', 'لحد (فاضي = مفتوح)')}</Label><DateInput className="h-9" value={f.validTo ?? ''} onChange={(e) => setF({ ...f, validTo: e.target.value || null })} /></div>
            <div className="space-y-1 sm:col-span-3"><Label className="text-xs">{L('Notes', 'ملاحظات')}</Label><Textarea rows={2} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
            {editing !== 'NEW' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{L('Active', 'شغال')}</label>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={save.isPending || f.title.trim().length < 2} onClick={() => save.mutate(f)}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>{L('Cancel', 'إلغاء')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
