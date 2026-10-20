'use client'

/**
 * FIN-2 — Fees & charges: extra fees (registration, kit, book, certificate…) and the platform fee. Each has an amount,
 * how often it is charged, required / optional for everyone, what happens when it is not paid, and exceptions for a
 * place / partner / track / course / level / group / student (the most specific wins). Plus what the wallet pays first.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { L, useI18n } from '@/lib/i18n/client'
import { useUrlTab } from '@/hooks/use-url-tab'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import {
  FEE_FREQUENCIES, FEE_MODES, FEE_SCOPES, FREQUENCY_LABEL, MODE_LABEL, ON_UNPAID, ON_UNPAID_LABEL, SCOPE_LABEL,
  type FeeFrequency, type FeeMode, type FeeScope, type OnUnpaid,
} from '@/lib/fees-extra/rules'
import { Plus, Receipt, Trash2, X } from 'lucide-react'

interface Rule { id: string; scopeType: FeeScope; scopeId: string; mode: FeeMode; amount: number | null; frequency: FeeFrequency | null; onUnpaid: OnUnpaid | null }
interface FeeType { id: string; nameEn: string; nameAr: string; amount: number; frequency: FeeFrequency; isPlatform: boolean; defaultMode: 'REQUIRED' | 'OPTIONAL'; onUnpaid: OnUnpaid; isActive: boolean; sortOrder: number; rules: Rule[] }
type Opt = Partial<Record<FeeScope, { id: string; name: string }[]>>

const blank = { nameEn: '', nameAr: '', amount: '0', frequency: 'MONTHLY' as FeeFrequency, isPlatform: false, defaultMode: 'OPTIONAL' as 'REQUIRED' | 'OPTIONAL', onUnpaid: 'REMIND' as OnUnpaid, isActive: true }

export default function FeeTypesPage() {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [tab, setTab] = useUrlTab()
  const { can } = useMyPermissions()
  const canEdit = can('finance_settings', 'update')
  const { data } = useQuery({ queryKey: ['fee-types'], queryFn: () => fetchApi<FeeType[]>('/api/fee-types') })
  const { data: opt } = useQuery({ queryKey: ['fee-type-options'], queryFn: () => fetchApi<Opt>('/api/fee-types/options'), enabled: canEdit })
  const [form, setForm] = useState<typeof blank | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const lab = (x: [string, string]) => (ar ? x[1] : x[0])
  const refresh = () => qc.invalidateQueries({ queryKey: ['fee-types'] })
  const save = useMutation({
    mutationFn: () => fetchApi(editId ? `/api/fee-types/${editId}` : '/api/fee-types', { method: editId ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, amount: Number(form!.amount) || 0 }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setForm(null); setEditId(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Receipt className="h-7 w-7 text-indigo-600" /> {L('Fees & charges', 'الرسوم الإضافية')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Registration, kit, book, certificate, platform use… Charged on their own invoice when a monthly invoice is made (or by hand), never twice for the same period.', 'رسوم تسجيل، كيت، كتاب، شهادة، استخدام المنصة… بتتعمل في فاتورة لوحدها مع فاتورة الشهر (أو بالإيد)، ومابتتكررش لنفس الفترة.')}</p>
      </div>
      <Tabs value={tab ?? 'fees'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="fees">{L('Fees', 'الرسوم')}</TabsTrigger>
          {canEdit && <TabsTrigger value="settings">{L('Pay first', 'الأولوية في الدفع')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="fees" className="mt-4 space-y-3">
          {(data ?? []).map((t) => (
            <Card key={t.id} className={t.isActive ? '' : 'opacity-60'}><CardContent className="space-y-2 pt-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{ar ? t.nameAr : t.nameEn} {t.isPlatform && <span className="ms-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">{L('platform', 'منصة')}</span>}{!t.isActive && <span className="ms-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{L('stopped — not charged', 'متوقف — مش بيتحسب')}</span>}</p>
                   <p className="text-xs text-slate-500"><bdi className="font-semibold text-slate-700">{t.amount.toLocaleString()} {L('EGP', 'ج.م')}</bdi> · {lab(FREQUENCY_LABEL[t.frequency])} · {lab(MODE_LABEL[t.defaultMode])} {L('for everyone', 'للكل')} · {L('if unpaid:', 'لو مااتدفعتش:')} {lab(ON_UNPAID_LABEL[t.onUnpaid])}</p>
                </div>
                {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(t.id); setForm({ nameEn: t.nameEn, nameAr: t.nameAr, amount: String(t.amount), frequency: t.frequency, isPlatform: t.isPlatform, defaultMode: t.defaultMode, onUnpaid: t.onUnpaid, isActive: t.isActive }) }}>{L('Edit', 'تعديل')}</Button>}
              </div>
              <Rules type={t} opt={opt} canEdit={canEdit} onDone={refresh} />
            </CardContent></Card>
          ))}
          {!data?.length && <p className="text-sm text-slate-500">{L('No fees yet.', 'لسه مفيش رسوم.')}</p>}
          {canEdit && !form && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditId(null); setForm(blank) }}><Plus className="h-4 w-4" />{L('Add a fee', 'إضافة رسم')}</Button>}
          {canEdit && form && (
            <Card><CardContent className="grid gap-2 pt-4 text-sm sm:grid-cols-2">
              <Input dir="rtl" placeholder="الاسم بالعربي (مثلاً: رسوم المنصة)" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
              <Input dir="ltr" placeholder={L('English name (e.g. Platform fee)', 'الاسم بالإنجليزي (مثلاً: Platform fee)')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
              <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Amount (EGP)', 'المبلغ (ج.م)')}</span><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
              <label className="space-y-1"><span className="block text-xs text-slate-500">{L('How often', 'كل إمتى')}</span>
                <select className={`${sel} w-full`} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as FeeFrequency })}>{FEE_FREQUENCIES.map((f) => <option key={f} value={f}>{lab(FREQUENCY_LABEL[f])}</option>)}</select></label>
              <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Required or optional?', 'إجباري ولا اختياري؟')}</span>
                <select className={`${sel} w-full`} value={form.defaultMode} onChange={(e) => setForm({ ...form, defaultMode: e.target.value as 'REQUIRED' | 'OPTIONAL' })}><option value="REQUIRED">{lab(MODE_LABEL.REQUIRED)}</option><option value="OPTIONAL">{lab(MODE_LABEL.OPTIONAL)}</option></select></label>
              <label className="space-y-1"><span className="block text-xs text-slate-500">{L('If not paid', 'لو مااتدفعتش')}</span>
                <select className={`${sel} w-full`} value={form.onUnpaid} onChange={(e) => setForm({ ...form, onUnpaid: e.target.value as OnUnpaid })}>{ON_UNPAID.map((o) => <option key={o} value={o}>{lab(ON_UNPAID_LABEL[o])}</option>)}</select></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.isPlatform} onChange={(e) => setForm({ ...form, isPlatform: e.target.checked })} />{L('This is the platform fee', 'دي رسوم المنصة')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />{L('Active (untick to stop it — fees are never deleted, so old invoices stay right)', 'شغال (شيل العلامة علشان توقفه — الرسوم مابتتمسحش علشان الفواتير القديمة تفضل سليمة)')}</label>
              <div className="flex gap-2 sm:col-span-2">
                <Button size="sm" disabled={form.nameEn.trim().length < 2 || form.nameAr.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{L('Save', 'حفظ')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setForm(null); setEditId(null) }}>{L('Cancel', 'إلغاء')}</Button>
              </div>
            </CardContent></Card>
          )}
        </TabsContent>
        {canEdit && <TabsContent value="settings" className="mt-4"><PayFirst /></TabsContent>}
      </Tabs>
    </div>
  )

}

function Rules({ type, opt, canEdit, onDone }: { type: FeeType; opt?: Opt; canEdit: boolean; onDone: () => void }) {
  const ar = useI18n().locale === 'ar'
  const lab = (x: [string, string]) => (ar ? x[1] : x[0])
  const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'
  const [open, setOpen] = useState(false)
  const [r, setR] = useState({ scopeType: 'CAMPUS' as FeeScope, scopeId: '', mode: 'EXEMPT' as FeeMode, amount: '', frequency: '', onUnpaid: '' })
  const [studentQ, setStudentQ] = useState('')
  const { data: hits } = useQuery({
    queryKey: ['fee-rule-student', studentQ],
    queryFn: () => fetchApi<{ id: string; firstName: string; lastName: string }[] | { items?: { id: string; firstName: string; lastName: string }[] }>(`/api/students?search=${encodeURIComponent(studentQ)}&limit=8`),
    enabled: r.scopeType === 'STUDENT' && studentQ.trim().length >= 2,
  })
  const students = (Array.isArray(hits) ? hits : (hits as { items?: { id: string; firstName: string; lastName: string }[] } | undefined)?.items ?? []).map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }))
  const add = useMutation({
    mutationFn: () => fetchApi(`/api/fee-types/${type.id}/rules`, { method: 'POST', body: JSON.stringify({ scopeType: r.scopeType, scopeId: r.scopeId, mode: r.mode, amount: r.amount === '' ? null : Number(r.amount), frequency: r.frequency || null, onUnpaid: r.onUnpaid || null }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setOpen(false); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({ mutationFn: (id: string) => fetchApi(`/api/fee-rules/${id}`, { method: 'DELETE' }), onSuccess: onDone })
  const nameOf = (rule: Rule) => (opt?.[rule.scopeType] ?? []).find((x) => x.id === rule.scopeId)?.name ?? (rule.scopeType === 'STUDENT' ? L('a student', 'طالب') : rule.scopeId.slice(0, 8))
  const items = r.scopeType === 'STUDENT' ? students : opt?.[r.scopeType] ?? []
  return (
    <div className="space-y-1.5">
      {type.rules.map((rule) => (
        <div key={rule.id} className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs">
          <span>{lab(SCOPE_LABEL[rule.scopeType])}: <b>{nameOf(rule)}</b> → {lab(MODE_LABEL[rule.mode])}{rule.amount !== null ? ` · ${rule.amount} ${L('EGP', 'ج.م')}` : ''}{rule.frequency ? ` · ${lab(FREQUENCY_LABEL[rule.frequency])}` : ''}{rule.onUnpaid ? ` · ${lab(ON_UNPAID_LABEL[rule.onUnpaid])}` : ''}</span>
          {canEdit && <button type="button" className="text-rose-500" onClick={() => del.mutate(rule.id)} aria-label="remove"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {canEdit && !open && <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setOpen(true)}>+ {L('Add an exception', 'إضافة استثناء')}</button>}
      {canEdit && open && (
        <div className="flex flex-wrap items-end gap-1.5 rounded-lg border border-indigo-100 p-2 text-xs">
          <select className={sel} value={r.scopeType} onChange={(e) => setR({ ...r, scopeType: e.target.value as FeeScope, scopeId: '' })}>{FEE_SCOPES.map((s) => <option key={s} value={s}>{lab(SCOPE_LABEL[s])}</option>)}</select>
          {r.scopeType === 'STUDENT' && <Input className="h-9 w-40" placeholder={L('Search a student', 'دوّر على طالب')} value={studentQ} onChange={(e) => setStudentQ(e.target.value)} />}
          <select className={sel} value={r.scopeId} onChange={(e) => setR({ ...r, scopeId: e.target.value })}><option value="">—</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className={sel} value={r.mode} onChange={(e) => setR({ ...r, mode: e.target.value as FeeMode })}>{FEE_MODES.map((m) => <option key={m} value={m}>{lab(MODE_LABEL[m])}</option>)}</select>
          <Input type="number" className="h-9 w-24" placeholder={L('amount', 'مبلغ')} value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} title={L('Empty = the fee amount', 'فاضي = مبلغ الرسم')} />
          <select className={sel} value={r.frequency} onChange={(e) => setR({ ...r, frequency: e.target.value })}><option value="">{L('same frequency', 'نفس التكرار')}</option>{FEE_FREQUENCIES.map((f) => <option key={f} value={f}>{lab(FREQUENCY_LABEL[f])}</option>)}</select>
          <select className={sel} value={r.onUnpaid} onChange={(e) => setR({ ...r, onUnpaid: e.target.value })}><option value="">{L('same if unpaid', 'نفس اللي بيحصل')}</option>{ON_UNPAID.map((o) => <option key={o} value={o}>{lab(ON_UNPAID_LABEL[o])}</option>)}</select>
          <Button size="sm" className="h-9" disabled={!r.scopeId || add.isPending} onClick={() => add.mutate()}>{L('Save', 'حفظ')}</Button>
          <button type="button" onClick={() => setOpen(false)} aria-label="close"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
      )}
    </div>
  )
}

function PayFirst() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['fees-settings'], queryFn: () => fetchApi<{ payFirst: 'FEES' | 'TUITION' }>('/api/fee-types/settings') })
  const save = useMutation({
    mutationFn: (payFirst: 'FEES' | 'TUITION') => fetchApi('/api/fee-types/settings', { method: 'PUT', body: JSON.stringify({ payFirst }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['fees-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">{L('When the wallet pays automatically and both are open, pay first:', 'لما المحفظة تدفع لوحدها والاتنين مفتوحين، ادفع الأول:')}</p>
      {(['TUITION', 'FEES'] as const).map((v) => (
        <label key={v} className="flex items-center gap-2"><input type="radio" checked={data?.payFirst === v} onChange={() => save.mutate(v)} />{v === 'TUITION' ? L('the monthly price', 'الشهر') : L('the fees', 'الرسوم')}</label>
      ))}
    </div>
  )
}
