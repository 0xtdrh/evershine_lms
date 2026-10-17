'use client'

/**
 * FIN-1 — Accounts & cash boxes: the balance of every account (and money not placed yet), every movement in / out,
 * transfers between accounts (another person approves), the end-of-day cash count, expense categories and settings.
 * Tabs open from links (?tab=) — today's tasks, settings / reports centres.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { L, useI18n } from '@/lib/i18n/client'
import { useUrlTab } from '@/hooks/use-url-tab'
import { DataExchangeButtons } from '@/components/data/DataExchangeButtons'
import { BudgetTab } from '@/components/treasury/BudgetTab'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { ACCOUNT_KIND_LABEL, MOVEMENT_KIND_LABEL, type AccountKind, type MovementKind } from '@/lib/treasury/rules'
import { ArrowDownLeft, ArrowUpRight, Landmark, Loader2 } from 'lucide-react'

interface Account { id: string; name: string; kind: AccountKind; campus: string | null; balance: number; in: number; out: number; isActive: boolean; countedToday: string | null }
interface Overview { accounts: Account[]; unplaced: { count: number; in: number; out: number } }
interface Movement { id: string; date: string; direction: 'IN' | 'OUT'; amount: number; kind: MovementKind; method: string | null; note: string | null; account: string | null }
interface Transfer { id: string; number: string | null; from: string; to: string; amount: number; date: string; note: string | null; status: string; mine: boolean }
interface Count { id: string; account: string; date: string; expected: number; counted: number; difference: number; note: string | null; status: string; mine: boolean }

const money = (n: number, ar: boolean) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${ar ? 'ج.م' : 'EGP'}`
const STATUS: Record<string, [string, string, string]> = {
  PENDING: ['Waiting approval', 'مستني موافقة', 'bg-amber-50 text-amber-700 border-amber-200'],
  APPROVED: ['Approved', 'اتوافق عليه', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  REJECTED: ['Rejected', 'اترفض', 'bg-rose-50 text-rose-700 border-rose-200'],
  CANCELLED: ['Cancelled', 'اتلغى', 'bg-slate-50 text-slate-500 border-slate-200'],
}

export default function TreasuryPage() {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [tab, setTab] = useUrlTab()
  const { can, role } = useMyPermissions()
  const { data, isLoading } = useQuery({ queryKey: ['treasury'], queryFn: () => fetchApi<Overview>('/api/treasury') })
  const [selected, setSelected] = useState<string | null>(null)
  const refresh = () => ['treasury', 'treasury-moves', 'treasury-transfers', 'treasury-counts', 'today-tasks'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const accounts = (data?.accounts ?? []).filter((a) => a.isActive)
  const status = (s: string) => { const x = STATUS[s] ?? STATUS.PENDING; return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${x[2]}`}>{ar ? x[1] : x[0]}</span> }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Landmark className="h-7 w-7 text-indigo-600" /> {L('Accounts & cash boxes', 'الحسابات والخزن')}</h1>
        <div className="mt-2 print:hidden"><DataExchangeButtons dataset="movements" /></div>
        <p className="mt-1 text-sm text-slate-500">{L('Where the money is now: every payment, expense, salary and refund is recorded on its account automatically.', 'الفلوس فين دلوقتي: كل دفعة ومصروف ومرتب واسترداد بيتسجل على حسابه لوحده.')}</p>
      </div>
      <Tabs value={tab ?? 'accounts'} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="accounts">{L('Balances', 'الأرصدة')}</TabsTrigger>
          <TabsTrigger value="transfers">{L('Transfers', 'التحويلات')}</TabsTrigger>
          <TabsTrigger value="counts">{L('Daily cash count', 'جرد الخزنة')}</TabsTrigger>
          {can('expenses', 'read') && <TabsTrigger value="budget">{L('Budget', 'الميزانية')}</TabsTrigger>}
          {can('expenses', 'update') && <TabsTrigger value="categories">{L('Expense categories', 'بنود المصاريف')}</TabsTrigger>}
          {['SUPER_ADMIN', 'ADMIN'].includes(role) && can('treasury', 'update') && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="accounts" className="mt-4 space-y-4">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
          {data && !accounts.length && (
            <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">{L('No accounts yet.', 'لسه مفيش حسابات.')} {can('treasury', 'update') && <Link className="font-semibold text-indigo-700 hover:underline" href="/dashboard/admin/finance-settings#accounts">{L('Add them in Settings → Payments', 'ضيفها من الإعدادات ← الدفع')}</Link>}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <button key={a.id} type="button" onClick={() => setSelected(selected === a.id ? null : a.id)} className={`rounded-xl border p-3 text-start transition hover:shadow-sm ${selected === a.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 bg-white'}`}>
                <p className="text-xs text-slate-500">{ar ? ACCOUNT_KIND_LABEL[a.kind][1] : ACCOUNT_KIND_LABEL[a.kind][0]} · {a.campus ?? L('company', 'الشركة')}</p>
                <p className="font-semibold text-slate-800">{a.name}</p>
                <p className={`mt-1 text-2xl font-bold ${a.balance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(a.balance, ar)}</p>
                <p className="text-[11px] text-slate-500">↓ {money(a.in, ar)} · ↑ {money(a.out, ar)}{a.kind === 'CASH' && <> · {a.countedToday ? L('counted today', 'اتجردت النهارده') : L('not counted today', 'ماتجردتش النهارده')}</>}</p>
              </button>
            ))}
            {!!data?.unplaced.count && (
              <button type="button" onClick={() => setSelected(selected === 'unplaced' ? null : 'unplaced')} className={`rounded-xl border p-3 text-start ${selected === 'unplaced' ? 'border-amber-400 ring-2 ring-amber-100' : 'border-amber-200 bg-amber-50'}`}>
                <p className="text-xs text-amber-700">{L('Not placed in an account', 'مش متسجلة على حساب')}</p>
                <p className="font-semibold text-amber-900">{data.unplaced.count} {L('movements', 'حركة')}</p>
                <p className="text-[11px] text-amber-800">↓ {money(data.unplaced.in, ar)} · ↑ {money(data.unplaced.out, ar)}</p>
                <p className="mt-1 text-[11px] text-amber-800">{L('Set the account of the payment method in Settings → Payments.', 'حدد حساب طريقة الدفع من الإعدادات ← الدفع.')}</p>
              </button>
            )}
          </div>
          {selected && <Movements id={selected} ar={ar} />}
        </TabsContent>

        <TabsContent value="transfers" className="mt-4"><Transfers accounts={accounts} ar={ar} canCreate={can('treasury', 'create')} canApprove={can('treasury', 'approve')} onDone={refresh} status={status} /></TabsContent>
        <TabsContent value="counts" className="mt-4"><Counts accounts={accounts.filter((a) => a.kind === 'CASH')} ar={ar} canCreate={can('treasury', 'create')} canApprove={can('treasury', 'approve')} onDone={refresh} status={status} /></TabsContent>
        {can('expenses', 'read') && <TabsContent value="budget" className="mt-4"><BudgetsLoader canEdit={can('finance_settings', 'update')} /></TabsContent>}
        {can('expenses', 'update') && <TabsContent value="categories" className="mt-4"><Categories /></TabsContent>}
        {['SUPER_ADMIN', 'ADMIN'].includes(role) && <TabsContent value="settings" className="mt-4"><TreasurySettingsCard /></TabsContent>}
      </Tabs>
    </div>
  )
}

/** The budget tab needs the branches the person may pick (same list as the payment routes). */
function BudgetsLoader({ canEdit }: { canEdit: boolean }) {
  const { data } = useQuery({ queryKey: ['treasury-routes'], queryFn: () => fetchApi<{ campuses: { id: string; name: string }[] }>('/api/treasury/routes') })
  const { data: rights } = useQuery({ queryKey: ['treasury'], queryFn: () => fetchApi<Overview>('/api/treasury') })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  // company budgets only for people with every place (they see company accounts)
  const allPlaces = (rights?.accounts ?? []).some((a) => !a.campus) || data.campuses.length > 1
  return <BudgetTab campuses={data.campuses} allPlaces={allPlaces} canEdit={canEdit} />
}

function Movements({ id, ar }: { id: string; ar: boolean }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = id === 'unplaced' ? 'unplaced=1' : `accountId=${id}`
  const { data, isLoading } = useQuery({ queryKey: ['treasury-moves', id, from, to], queryFn: () => fetchApi<Movement[]>(`/api/treasury/movements?${q}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`) })
  return (
    <Card><CardContent className="space-y-2 pt-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-700">{L('Movements', 'الحركات')}</span>
        <Input type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><span>→</span><Input type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="max-h-[28rem] overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>
              <th className="p-2 text-start">{L('Date', 'التاريخ')}</th><th className="p-2 text-start">{L('What', 'إيه')}</th><th className="p-2 text-start">{L('Method', 'الطريقة')}</th>
              <th className="p-2 text-start">{L('Note', 'ملاحظة')}</th><th className="p-2 text-end">{L('Amount', 'المبلغ')}</th>
            </tr></thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-2">{new Date(m.date).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}</td>
                  <td className="p-2">{ar ? MOVEMENT_KIND_LABEL[m.kind]?.[1] : MOVEMENT_KIND_LABEL[m.kind]?.[0]}</td>
                  <td className="p-2">{m.method ?? '—'}</td>
                  <td className="p-2 text-slate-500">{m.note ?? ''}</td>
                  <td className={`p-2 text-end font-semibold ${m.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    <span className="inline-flex items-center gap-1">{m.direction === 'IN' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{money(m.amount, ar)}</span>
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">{L('No movements.', 'مفيش حركات.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </CardContent></Card>
  )
}

function Transfers({ accounts, ar, canCreate, canApprove, onDone, status }: { accounts: Account[]; ar: boolean; canCreate: boolean; canApprove: boolean; onDone: () => void; status: (s: string) => React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['treasury-transfers'], queryFn: () => fetchApi<Transfer[]>('/api/treasury/transfers') })
  const [f, setF] = useState({ fromAccountId: '', toAccountId: '', amount: '', note: '' })
  const create = useMutation({
    mutationFn: () => fetchApi<{ status: string }>('/api/treasury/transfers', { method: 'POST', body: JSON.stringify({ ...f, amount: Number(f.amount) }) }),
    onSuccess: (r) => { notify.success(r.status === 'PENDING' ? L('Sent for approval', 'اتبعت للموافقة') : L('Transfer done', 'التحويل اتعمل')); setF({ fromAccountId: '', toAccountId: '', amount: '', note: '' }); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => fetchApi(`/api/treasury/transfers/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
    onSuccess: () => { notify.success(L('Done', 'تم')); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  const sel = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm'
  return (
    <div className="space-y-4">
      {canCreate && accounts.length > 1 && (
        <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4 text-sm">
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('From', 'من')}</span>
            <select className={sel} value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance, ar)})</option>)}</select></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('To', 'إلى')}</span>
            <select className={sel} value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}><option value="">—</option>{accounts.filter((a) => a.id !== f.fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Amount', 'المبلغ')}</span><Input type="number" className="h-9 w-32" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="flex-1 space-y-1"><span className="block text-xs text-slate-500">{L('Note', 'ملاحظة')}</span><Input className="h-9" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={L('e.g. deposit to the bank', 'مثلاً: توريد للبنك')} /></label>
          <Button disabled={!f.fromAccountId || !f.toAccountId || !(Number(f.amount) > 0) || create.isPending} onClick={() => create.mutate()}>{L('Transfer', 'حوّل')}</Button>
        </CardContent></Card>
      )}
      <div className="space-y-2">
        {(data ?? []).map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <div>
              <p className="font-semibold">{t.from} → {t.to} · {money(t.amount, ar)}</p>
              <p className="text-xs text-slate-500">{t.number} · {new Date(t.date).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}{t.note ? ` · ${t.note}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {status(t.status)}
              {t.status === 'PENDING' && canApprove && !t.mine && <>
                <Button size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => act.mutate({ id: t.id, action: 'approve' })}>{L('Approve', 'موافقة')}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => act.mutate({ id: t.id, action: 'reject' })}>{L('Reject', 'رفض')}</Button>
              </>}
              {t.status === 'PENDING' && t.mine && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => act.mutate({ id: t.id, action: 'cancel' })}>{L('Cancel', 'إلغاء')}</Button>}
            </div>
          </div>
        ))}
        {!data?.length && <p className="py-6 text-center text-sm text-slate-500">{L('No transfers yet.', 'لسه مفيش تحويلات.')}</p>}
      </div>
    </div>
  )
}

function Counts({ accounts, ar, canCreate, canApprove, onDone, status }: { accounts: Account[]; ar: boolean; canCreate: boolean; canApprove: boolean; onDone: () => void; status: (s: string) => React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['treasury-counts'], queryFn: () => fetchApi<Count[]>('/api/treasury/counts') })
  const [f, setF] = useState({ accountId: '', counted: '', note: '' })
  const create = useMutation({
    mutationFn: () => fetchApi<{ status: string; difference: number }>('/api/treasury/counts', { method: 'POST', body: JSON.stringify({ ...f, counted: Number(f.counted) }) }),
    onSuccess: (r) => { notify.success(r.difference === 0 ? L('Matches — closed', 'مظبوط — اتقفلت') : r.status === 'PENDING' ? L(`Difference ${r.difference} — sent for approval`, `فيه فرق ${r.difference} — اتبعت للموافقة`) : L('Closed', 'اتقفلت')); setF({ accountId: '', counted: '', note: '' }); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => fetchApi(`/api/treasury/counts/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
    onSuccess: () => { notify.success(L('Done', 'تم')); onDone() }, onError: (e: Error) => notify.error(e.message),
  })
  const box = accounts.find((a) => a.id === f.accountId)
  return (
    <div className="space-y-4">
      {canCreate && accounts.length > 0 && (
        <Card><CardContent className="flex flex-wrap items-end gap-2 pt-4 text-sm">
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Cash box', 'الخزنة')}</span>
            <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {box && <p className="pb-2 text-xs text-slate-500">{L('The system expects', 'المفروض يكون فيها')} <b>{money(box.balance, ar)}</b></p>}
          <label className="space-y-1"><span className="block text-xs text-slate-500">{L('Counted now', 'العدّ الفعلي')}</span><Input type="number" className="h-9 w-32" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} /></label>
          <label className="flex-1 space-y-1"><span className="block text-xs text-slate-500">{L('Note (if there is a difference)', 'ملاحظة (لو فيه فرق)')}</span><Input className="h-9" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <Button disabled={!f.accountId || f.counted === '' || create.isPending} onClick={() => create.mutate()}>{L('Close the day', 'اقفل اليوم')}</Button>
        </CardContent></Card>
      )}
      <div className="space-y-2">
        {(data ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <div>
              <p className="font-semibold">{c.account} · {new Date(c.date).toLocaleDateString(ar ? 'ar-EG' : 'en-GB')}</p>
              <p className="text-xs text-slate-500">{L('expected', 'المفروض')} {money(c.expected, ar)} · {L('counted', 'الفعلي')} {money(c.counted, ar)} · <b className={c.difference ? 'text-rose-700' : 'text-emerald-700'}>{L('difference', 'الفرق')} {money(c.difference, ar)}</b>{c.note ? ` · ${c.note}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {status(c.status)}
              {c.status === 'PENDING' && canApprove && !c.mine && <>
                <Button size="sm" className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => act.mutate({ id: c.id, action: 'approve' })}>{L('Approve the difference', 'وافق على الفرق')}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={() => act.mutate({ id: c.id, action: 'reject' })}>{L('Reject', 'رفض')}</Button>
              </>}
            </div>
          </div>
        ))}
        {!data?.length && <p className="py-6 text-center text-sm text-slate-500">{L('No counts yet.', 'لسه مفيش جرد.')}</p>}
      </div>
    </div>
  )
}

function Categories() {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['expense-categories-all'], queryFn: () => fetchApi<{ id: string; nameEn: string; nameAr: string; isActive: boolean; sortOrder: number }[]>('/api/expense-categories?all=1') })
  const [f, setF] = useState({ nameEn: '', nameAr: '' })
  const save = useMutation({
    mutationFn: (v: { id?: string; nameEn: string; nameAr: string; isActive?: boolean; sortOrder?: number }) => fetchApi(v.id ? `/api/expense-categories/${v.id}` : '/api/expense-categories', { method: v.id ? 'PATCH' : 'POST', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setF({ nameEn: '', nameAr: '' }); qc.invalidateQueries({ queryKey: ['expense-categories-all'] }); qc.invalidateQueries({ queryKey: ['expense-categories'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3 text-sm">
      {(data ?? []).map((c) => (
        <div key={c.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${c.isActive ? 'border-slate-200' : 'border-slate-200 opacity-50'}`}>
          <span>{ar ? c.nameAr : c.nameEn} <span className="text-xs text-slate-400">· {ar ? c.nameEn : c.nameAr}</span></span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => save.mutate({ id: c.id, nameEn: c.nameEn, nameAr: c.nameAr, isActive: !c.isActive, sortOrder: c.sortOrder })}>{c.isActive ? L('Hide', 'إخفاء') : L('Show', 'إظهار')}</Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-56" placeholder="English name" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        <Input className="h-9 w-56" dir="rtl" placeholder="الاسم بالعربي" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <Button size="sm" className="h-9" disabled={f.nameEn.trim().length < 2 || f.nameAr.trim().length < 2 || save.isPending} onClick={() => save.mutate(f)}>{L('Add category', 'إضافة بند')}</Button>
      </div>
    </div>
  )
}

function TreasurySettingsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['treasury-settings'], queryFn: () => fetchApi<{ dailyCloseRequired: boolean; closeAfterHour: number; tolerance: number; transferNeedsApproval: boolean }>('/api/treasury/settings') })
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => fetchApi('/api/treasury/settings', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['treasury-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={data.dailyCloseRequired} onChange={(e) => save.mutate({ dailyCloseRequired: e.target.checked })} />{L('Cash boxes are counted every day', 'الخزن بتتجرد كل يوم')}</label>
      <label className="flex items-center gap-2">{L('Remind after (hour, Cairo)', 'التذكير بعد الساعة (توقيت القاهرة)')}<Input type="number" min={0} max={23} className="h-8 w-20" defaultValue={data.closeAfterHour} onBlur={(e) => save.mutate({ closeAfterHour: Number(e.target.value) })} /></label>
      <label className="flex items-center gap-2">{L('Differences approved automatically up to', 'الفرق اللي بيتوافق عليه لوحده لحد')}<Input type="number" min={0} className="h-8 w-24" defaultValue={data.tolerance} onBlur={(e) => save.mutate({ tolerance: Number(e.target.value) })} />{L('EGP', 'ج.م')}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={data.transferNeedsApproval} onChange={(e) => save.mutate({ transferNeedsApproval: e.target.checked })} />{L('Transfers between accounts need a second person', 'التحويل بين الحسابات محتاج موافقة شخص تاني')}</label>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{L('Who counts, approves and manages accounts is set on the Permissions page ("Money accounts": create / approve / update).', 'مين يجرد ومين يوافق ومين يدير الحسابات بيتظبط من صفحة الصلاحيات («الحسابات والخزن»: create / approve / update).')}</p>
    </div>
  )
}
