'use client'

/**
 * Partners part 1-B: statements of a partner — make one for a month / period, check it, add manual lines (draft),
 * approve (frozen), record payments both ways; the rest of an approved statement moves into the next one.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DealLine } from '@/lib/partners/deal'
import type { ManualLine } from '@/lib/partners/statement'
import type { PartnerDetail } from './types'
import { CheckCircle2, ChevronDown, ChevronUp, FileSpreadsheet, Loader2, Plus, Trash2, Wallet } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Pay { id: string; direction: 'PARTNER_TO_TECHNOVA' | 'TECHNOVA_TO_PARTNER'; amount: number; method: string; paidAt: string; reference: string | null; note: string | null }
interface Statement {
  id: string; number: string; campusId: string | null; periodFrom: string; periodTo: string; status: string
  facts: { collected: number; refunds: number; discounts: number; sessionsHeld: number; sessionsCancelledByPartner: number; students: number; groups: number }
  lines: DealLine[]; manualLines: ManualLine[] | null; periodBalance: number; previousBalance: number; totalDue: number; rest: number; notes: string | null
  approvedAt: string | null; payments: Pay[]
}

const money = (n: number) => `${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
const d10 = (s: string) => s.slice(0, 10)
const STATUS: Record<string, [string, string, string]> = {
  DRAFT: ['Draft', 'مسودة', 'bg-slate-100 text-slate-700'],
  APPROVED: ['Approved', 'معتمد', 'bg-indigo-50 text-indigo-700'],
  PARTIAL: ['Partly paid', 'مدفوع جزئي', 'bg-amber-50 text-amber-700'],
  PAID: ['Settled', 'متسوّي', 'bg-emerald-50 text-emerald-700'],
  CARRIED: ['Moved to a later statement', 'اترحّل لكشف بعده', 'bg-slate-100 text-slate-500'],
}
const who = (n: number) => (n > 0 ? L('the partner owes TechNova', 'الشريك عليه لـ TechNova') : n < 0 ? L('TechNova owes the partner', 'TechNova عليها للشريك') : L('nothing due', 'مفيش فلوس'))

export function PartnerStatements({ p, perms }: { p: PartnerDetail; perms: { create: boolean; approve: boolean; update: boolean } }) {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['partner-statements', p.id], queryFn: () => fetchApi<Statement[]>(`/api/partners/${p.id}/statements`) })
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
  const [month, setMonth] = useState(lastMonth)
  const [campusId, setCampusId] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner-statements', p.id] })
  const range = (() => { const [y, m] = month.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` } })()
  const make = useMutation({
    mutationFn: () => fetchApi<{ id: string }>(`/api/partners/${p.id}/statements`, { method: 'POST', body: JSON.stringify({ campusId: campusId || null, ...range }) }),
    onSuccess: (r) => { notify.success(L('Statement made (draft)', 'الكشف اتعمل (مسودة)')); setOpen(r.id); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const placeName = (id: string | null) => (id ? p.places.find((x) => x.id === id)?.name ?? '?' : L('All places', 'كل الأماكن'))
  return (
    <div className="space-y-3 text-sm">
      {perms.create && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <div className="space-y-1"><Label className="text-xs">{L('Month', 'الشهر')}</Label><Input type="month" className="h-9 w-40" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Place', 'المكان')}</Label>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
              <option value="">{L('All places (one statement)', 'كل الأماكن (كشف واحد)')}</option>
              {p.places.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>
          <Button size="sm" disabled={make.isPending} onClick={() => make.mutate()}>{make.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="me-1 h-4 w-4" />}{L('Make statement', 'اعمل كشف')}</Button>
        </div>
      )}
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : rows.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">{L('No statements yet.', 'لسه مفيش كشوف.')}</p>}
      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.id} className="rounded-lg border border-slate-200">
            <button type="button" className="flex w-full flex-wrap items-center gap-2 p-3 text-start" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="font-medium text-slate-900">{s.number}</span>
              <span className="text-xs text-slate-500">{d10(s.periodFrom)} → {d10(s.periodTo)} · {placeName(s.campusId)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[s.status]?.[2] ?? ''}`}>{L(STATUS[s.status]?.[0] ?? s.status, STATUS[s.status]?.[1] ?? s.status)}</span>
              <span className={`ms-auto text-sm font-semibold ${s.rest > 0 ? 'text-emerald-700' : s.rest < 0 ? 'text-rose-700' : 'text-slate-500'}`}>{money(s.rest)} · {who(s.rest)}</span>
              {open === s.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {open === s.id && <StatementBody s={s} perms={perms} onChange={refresh} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatementBody({ s, perms, onChange }: { s: Statement; perms: { create: boolean; approve: boolean; update: boolean }; onChange: () => void }) {
  const [manual, setManual] = useState<ManualLine[]>(s.manualLines ?? [])
  // 2026-10-24 live test: the remaining was only a grey placeholder (looked filled, the button did nothing) — start with it
  const [pay, setPay] = useState({ amount: String(Math.abs(s.rest) || ''), method: 'Bank Transfer', paidAt: new Date().toISOString().slice(0, 10), reference: '', note: '' })
  useEffect(() => { setPay((p) => ({ ...p, amount: Math.abs(s.rest) > 0.009 ? String(Math.abs(s.rest)) : '' })) }, [s.rest])
  const draft = s.status === 'DRAFT'
  const err = (e: Error) => notify.error(e.message)
  const recalc = useMutation({ mutationFn: () => fetchApi(`/api/partner-statements/${s.id}`, { method: 'PATCH', body: JSON.stringify({ manualLines: manual }) }), onSuccess: () => { notify.success(L('Recalculated', 'اتحسب تاني')); onChange() }, onError: err })
  const approve = useMutation({ mutationFn: () => fetchApi(`/api/partner-statements/${s.id}/approve`, { method: 'POST' }), onSuccess: () => { notify.success(L('Approved — the numbers are now frozen', 'اتعتمد — الأرقام اتقفلت')); onChange() }, onError: err })
  const del = useMutation({ mutationFn: () => fetchApi(`/api/partner-statements/${s.id}`, { method: 'DELETE' }), onSuccess: () => { notify.success(L('Deleted', 'اتمسح')); onChange() }, onError: err })
  const addPay = useMutation({
    mutationFn: () => fetchApi(`/api/partner-statements/${s.id}/payments`, { method: 'POST', body: JSON.stringify({ direction: s.rest > 0 ? 'PARTNER_TO_TECHNOVA' : 'TECHNOVA_TO_PARTNER', amount: Number(pay.amount), method: pay.method, paidAt: pay.paidAt, reference: pay.reference || null, note: pay.note || null }) }),
    onSuccess: () => { notify.success(L('Payment recorded', 'الدفعة اتسجلت')); setPay({ ...pay, reference: '', note: '' }); onChange() },
    onError: err,
  })
  const f = s.facts
  return (
    <div className="space-y-3 border-t border-slate-100 p-3 text-xs">
      <p className="text-slate-600">
        {L('Collected', 'اتحصّل')} {money(f.collected)} · {L('refunds', 'استرداد')} {money(f.refunds)} · {L('discounts', 'خصومات')} {money(f.discounts)} · {f.sessionsHeld} {L('sessions', 'حصة')}
        {f.sessionsCancelledByPartner ? ` (+${f.sessionsCancelledByPartner} ${L('cancelled by the partner', 'لغاها الشريك')})` : ''} · {f.students} {L('students', 'طالب')} · {f.groups} {L('groups', 'جروب')}
      </p>
      <table className="w-full">
        <tbody>
          {s.lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1">{L(l.label, l.labelAr)}</td><td className="py-1 text-slate-500">{l.quantity} × {l.rate}</td>
              <td className="py-1 text-end">{money(l.amount)}</td><td className="py-1 text-end text-slate-500">{l.payer === 'TECHNOVA' ? L('TechNova pays', 'TechNova تدفع') : L('Partner pays', 'الشريك يدفع')}</td>
            </tr>
          ))}
          {!draft && (s.manualLines ?? []).map((l, i) => (
            <tr key={`m${i}`} className="border-b border-slate-100 text-indigo-700">
              <td className="py-1">{l.label}{l.reason ? ` — ${l.reason}` : ''}</td><td /><td className="py-1 text-end">{money(l.amount)}</td>
              <td className="py-1 text-end">{l.payer === 'TECHNOVA' ? L('TechNova pays', 'TechNova تدفع') : L('Partner pays', 'الشريك يدفع')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && perms.create && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <Label className="text-xs font-semibold">{L('Manual lines (agreed discount, extra cost, …)', 'بنود يدوي (خصم متفق عليه، مصاريف زيادة، …)')}</Label>
          {manual.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-40" placeholder={L('Name', 'الاسم')} value={l.label} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input type="number" min={0} className="h-8 w-24" value={l.amount} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <select className="h-8 rounded-md border border-slate-200 bg-white px-2" value={l.payer} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, payer: e.target.value as ManualLine['payer'] } : x)))}>
                <option value="PARTNER">{L('the partner pays', 'الشريك يدفعه')}</option><option value="TECHNOVA">{L('TechNova pays', 'TechNova تدفعه')}</option>
              </select>
              <Input className="h-8 w-48" placeholder={L('Reason', 'السبب')} value={l.reason ?? ''} onChange={(e) => setManual(manual.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
              <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => setManual(manual.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setManual([...manual, { label: '', amount: 0, payer: 'TECHNOVA', reason: '' }])}><Plus className="me-1 h-4 w-4" />{L('Add line', 'ضيف بند')}</Button>
        </div>
      )}
      <div className="space-y-1 rounded-md bg-slate-50 p-2 text-sm">
        <p>{L('This period', 'الفترة دي')}: <b>{money(s.periodBalance)}</b> — {who(s.periodBalance)}</p>
        {s.previousBalance !== 0 && <p>{L('Carried from earlier statements', 'مترحّل من كشوف قبل كده')}: <b>{money(s.previousBalance)}</b> — {who(s.previousBalance)}</p>}
        <p>{L('Total', 'الإجمالي')}: <b>{money(s.totalDue)}</b> — {who(s.totalDue)}</p>
        {!draft && <p>{L('Left', 'الباقي')}: <b>{money(s.rest)}</b> — {who(s.rest)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {draft && perms.create && <Button size="sm" variant="outline" disabled={recalc.isPending} onClick={() => recalc.mutate()}>{recalc.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Recalculate / save lines', 'احسب تاني / احفظ البنود')}</Button>}
        {draft && perms.approve && <Button size="sm" disabled={approve.isPending} onClick={() => confirm(L('Approve? The numbers will be frozen.', 'تعتمد؟ الأرقام هتتقفل.')) && approve.mutate()}><CheckCircle2 className="me-1 h-4 w-4" />{L('Approve', 'اعتمد')}</Button>}
        <a href={`/reports/partner-statement/${s.id}`} target="_blank" rel="noopener"><Button size="sm" variant="outline">{L('Print / PDF', 'اطبع / PDF')}</Button></a>
        {draft && perms.create && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => confirm(L('Delete this draft?', 'تمسح المسودة دي؟')) && del.mutate()}><Trash2 className="h-4 w-4" /></Button>}
      </div>
      {s.payments.length > 0 && (
        <ul className="space-y-1">
          {s.payments.map((x) => (
            <li key={x.id} className="flex flex-wrap gap-2"><Wallet className="h-3.5 w-3.5 text-slate-400" />{d10(x.paidAt)} · {x.direction === 'PARTNER_TO_TECHNOVA' ? L('Partner → TechNova', 'الشريك ← TechNova') : L('TechNova → partner', 'TechNova ← الشريك')} · <b>{money(x.amount)}</b> · {x.method}{x.reference ? ` · ${x.reference}` : ''}</li>
          ))}
        </ul>
      )}
      {['APPROVED', 'PARTIAL'].includes(s.status) && perms.update && Math.abs(s.rest) > 0.009 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
          <span className="text-xs font-semibold">{s.rest > 0 ? L('The partner paid TechNova', 'الشريك دفع لـ TechNova') : L('TechNova paid the partner', 'TechNova دفعت للشريك')}:</span>
          <Input type="number" min={0} className="h-8 w-28" placeholder={String(Math.abs(s.rest))} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <Input className="h-8 w-32" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} />
          <DateInput className="h-8 w-36" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />
          <Input className="h-8 w-32" placeholder={L('Reference', 'رقم العملية')} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          <Button size="sm" disabled={addPay.isPending || !Number(pay.amount)} onClick={() => addPay.mutate()}>{L('Record payment', 'سجّل الدفعة')}</Button>
        </div>
      )}
    </div>
  )
}
