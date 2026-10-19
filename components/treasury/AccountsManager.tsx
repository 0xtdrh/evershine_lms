'use client'

/**
 * FIN-1 (Settings → Payments, #accounts): the money accounts (cash box per branch, bank, InstaPay, wallets, gateway)
 * and where each payment method lands — for every branch or one branch (a branch row wins).
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { ACCOUNT_KIND_LABEL, ACCOUNT_KINDS, type AccountKind } from '@/lib/treasury/rules'
import { Landmark, Plus } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Account { id: string; name: string; kind: AccountKind; campusId: string | null; campus: string | null; openingBalance: number; openingDate: string; isActive: boolean; balance: number }
interface Routes { methods: string[]; campuses: { id: string; name: string }[]; accounts: { id: string; name: string; campusId: string | null }[]; routes: { method: string; campusId: string | null; accountId: string }[] }

const blank = { name: '', kind: 'CASH' as AccountKind, campusId: '', openingBalance: '0', openingDate: new Date().toISOString().slice(0, 10) }

export function AccountsManager() {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['treasury'], queryFn: () => fetchApi<{ accounts: Account[] }>('/api/treasury') })
  const { data: rt } = useQuery({ queryKey: ['treasury-routes'], queryFn: () => fetchApi<Routes>('/api/treasury/routes') })
  const [form, setForm] = useState<typeof blank | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['treasury'] }); qc.invalidateQueries({ queryKey: ['treasury-routes'] }) }
  const save = useMutation({
    mutationFn: () => fetchApi(editId ? `/api/treasury/accounts/${editId}` : '/api/treasury/accounts', { method: editId ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, campusId: form!.campusId || null, openingBalance: Number(form!.openingBalance) || 0 }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setForm(null); setEditId(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (a: Account) => fetchApi(`/api/treasury/accounts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ name: a.name, kind: a.kind, campusId: a.campusId, openingBalance: a.openingBalance, openingDate: String(a.openingDate).slice(0, 10), isActive: !a.isActive }) }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  const route = useMutation({
    mutationFn: (v: { method: string; campusId: string | null; accountId: string | null }) => fetchApi('/api/treasury/routes', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success(L('Saved — waiting money placed', 'اتحفظ — الفلوس اللي كانت مستنية اتسجلت')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const accounts = data?.accounts ?? []
  const kind = (k: AccountKind) => (ar ? ACCOUNT_KIND_LABEL[k][1] : ACCOUNT_KIND_LABEL[k][0])
  const current = (method: string, campusId: string | null) => rt?.routes.find((r) => r.method === method && r.campusId === campusId)?.accountId ?? ''
  const sel = 'h-8 rounded-md border border-slate-200 bg-white px-2 text-xs'

  return (
    <Card id="accounts" className="scroll-mt-20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-5 w-5 text-indigo-600" />{L('Money accounts', 'الحسابات والخزن')}</CardTitle>
        <CardDescription>{L('Where money is kept, and which account each payment method lands in. Every payment, expense, salary and refund is then recorded on its account automatically.', 'الفلوس بتتشال فين، وكل طريقة دفع بتروح أنهي حساب. بعد كده كل دفعة ومصروف ومرتب واسترداد بيتسجل على حسابه لوحده.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${a.isActive ? 'border-slate-200' : 'border-slate-200 opacity-50'}`}>
              <div>
                <p className="font-semibold text-slate-800">{a.name}</p>
                <p className="text-xs text-slate-500">{kind(a.kind)} · {a.campus ?? L('company', 'الشركة')} · {L('balance', 'الرصيد')} {a.balance.toLocaleString()} {L('EGP', 'ج.م')}</p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditId(a.id); setForm({ name: a.name, kind: a.kind, campusId: a.campusId ?? '', openingBalance: String(a.openingBalance), openingDate: String(a.openingDate).slice(0, 10) }) }}>{L('Edit', 'تعديل')}</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggle.mutate(a)}>{a.isActive ? L('Hide', 'إخفاء') : L('Show', 'إظهار')}</Button>
              </div>
            </div>
          ))}
          {!accounts.length && <p className="text-xs text-slate-500">{L('No accounts yet — add the cash box of each branch, the bank account, InstaPay…', 'لسه مفيش حسابات — ضيف خزنة كل فرع، وحساب البنك، وInstaPay…')}</p>}
          {!form && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditId(null); setForm(blank) }}><Plus className="h-4 w-4" />{L('Add account', 'إضافة حساب')}</Button>}
          {form && (
            <div className="grid gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 sm:grid-cols-2">
              <Input placeholder={L('Name (e.g. Kawther cash box)', 'الاسم (مثلاً: خزنة الكوثر)')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className={`${sel} h-9`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}>
                {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{kind(k)}</option>)}
              </select>
              <select className={`${sel} h-9`} value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value })}>
                <option value="">{L('Company (no branch)', 'الشركة (مش فرع)')}</option>
                {(rt?.campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex gap-2">
                <Input type="number" placeholder={L('Opening balance', 'الرصيد الافتتاحي')} value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
                <DateInput value={form.openingDate} onChange={(e) => setForm({ ...form, openingDate: e.target.value })} title={L('Opening date', 'تاريخ الرصيد الافتتاحي')} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button size="sm" disabled={form.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{L('Save', 'حفظ')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setForm(null); setEditId(null) }}>{L('Cancel', 'إلغاء')}</Button>
              </div>
            </div>
          )}
        </div>

        {rt && accounts.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold text-slate-700">{L('Where each payment method lands', 'كل طريقة دفع بتروح فين')}</p>
            <p className="text-xs text-slate-500">{L('"Every branch" applies unless a branch has its own choice (e.g. Cash → each branch’s own cash box).', '«كل الفروع» بتتطبق إلا لو الفرع ليه اختيار خاص (مثلاً: كاش ← خزنة كل فرع).')}</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="p-2 text-start">{L('Payment method', 'طريقة الدفع')}</th>
                  <th className="p-2 text-start">{L('Every branch', 'كل الفروع')}</th>
                  {rt.campuses.map((c) => <th key={c.id} className="p-2 text-start">{c.name}</th>)}
                </tr></thead>
                <tbody>
                  {rt.methods.map((m) => (
                    <tr key={m} className="border-t">
                      <td className="p-2 font-medium">{m}</td>
                      {[null, ...rt.campuses.map((c) => c.id)].map((cid) => (
                        <td key={cid ?? 'all'} className="p-1.5">
                          <select className={sel} value={current(m, cid)} onChange={(e) => route.mutate({ method: m, campusId: cid, accountId: e.target.value || null })}>
                            <option value="">{cid ? L('— as every branch —', '— زي كل الفروع —') : L('— not set —', '— مش متحدد —')}</option>
                            {rt.accounts.filter((a) => !cid || !a.campusId || a.campusId === cid).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
