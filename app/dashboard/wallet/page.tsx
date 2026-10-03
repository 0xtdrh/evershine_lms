'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PaymentMethodSelect } from '@/components/fees/PaymentMethodSelect'
import { Wallet, Search, Check, X, Plus, Trash2 } from 'lucide-react'

interface TopUpRow { id: string; topUpNumber: string | null; amount: number; method: string; source: string; status: string; proofUrl: string | null; remarks: string | null; transactionId: string | null; createdAt: string; approvedAt: string | null; student: { id: string; name: string; registrationNumber: string } }
interface WithdrawalRow { id: string; amount: number; fee: number; payoutMethod: string; reason: string | null; status: string; requestedVia: string; createdAt: string; student: { id: string; name: string; registrationNumber: string } }
interface StudentHit { id: string; firstName: string; lastName: string; registrationNumber: string }
interface Settings { paymobFeePercent: number; paymobFeeFixed: number; withdrawFees: Record<string, { type: 'FIXED' | 'PERCENT'; value: number }>; lowBalanceDays: number; promos: { id?: string; minAmount: number; bonus: number; from: string | null; to: string | null; active: boolean }[] }
interface Rule { kind: 'MIN_TOPUP' | 'WITHDRAW'; scopeType: string; scopeId: string | null; minAmount: number | null; allowed: boolean }
interface Ref { id: string; name: string }

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

/** Wallet & top-ups (phase B): top up a student, approve uploaded receipts and withdrawals, wallet settings. */
export default function WalletPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const p = perms?.permissions ?? {}
  const canTopUp = !!p.wallet?.includes('create')
  const canApprove = !!p.wallet?.includes('approve')
  const canSettings = !!p.finance_settings?.includes('update')
  const { data: summary } = useQuery({ queryKey: ['wallet-summary'], queryFn: () => fetchApi<{ prepaidTotal: number; pendingTopUps: number; pendingWithdrawals: number }>('/api/wallet/summary') })
  const refresh = () => { for (const k of ['wallet-summary', 'wallet-topups', 'wallet-withdrawals', 'wallet']) qc.invalidateQueries({ queryKey: [k] }) }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Wallet className="h-5 w-5 text-indigo-600" /> Wallet &amp; top-ups</h1>
        <p className="text-sm text-slate-500">All money goes into the student&apos;s wallet first; the wallet pays the invoices automatically, oldest first.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-3"><p className="text-xs text-slate-500">Prepaid money (all wallets)</p><p className="text-lg font-bold text-indigo-700">{money(summary?.prepaidTotal ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-slate-500">Uploaded receipts to check</p><p className={`text-lg font-bold ${summary?.pendingTopUps ? 'text-amber-700' : 'text-slate-700'}`}>{summary?.pendingTopUps ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-slate-500">Withdrawals to approve</p><p className={`text-lg font-bold ${summary?.pendingWithdrawals ? 'text-amber-700' : 'text-slate-700'}`}>{summary?.pendingWithdrawals ?? 0}</p></CardContent></Card>
      </div>
      <Tabs defaultValue={canTopUp ? 'topup' : 'approve'}>
        <TabsList>
          {canTopUp && <TabsTrigger value="topup">Top up a student</TabsTrigger>}
          <TabsTrigger value="approve">Receipts to check</TabsTrigger>
          <TabsTrigger value="withdrawals">Withdrawals</TabsTrigger>
          {canSettings && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>
        {canTopUp && <TabsContent value="topup" className="mt-4"><TopUpTab onDone={refresh} /></TabsContent>}
        <TabsContent value="approve" className="mt-4"><ApproveTab canApprove={canApprove} onDone={refresh} /></TabsContent>
        <TabsContent value="withdrawals" className="mt-4"><WithdrawalsTab canApprove={canApprove} onDone={refresh} /></TabsContent>
        {canSettings && <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>}
      </Tabs>
    </div>
  )
}

function TopUpTab({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('')
  const [student, setStudent] = useState<StudentHit | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [ref, setRef] = useState('')
  const [remarks, setRemarks] = useState('')
  const { data: hits } = useQuery({
    queryKey: ['wallet-student-search', q],
    queryFn: async () => (await fetchPaginatedApi<StudentHit>(`/api/students?search=${encodeURIComponent(q)}&limit=8`)).data,
    enabled: q.trim().length >= 2 && !student,
  })
  const { data: wallet } = useQuery({
    queryKey: ['wallet', student?.id],
    queryFn: () => fetchApi<{ balance: number; minimumTopUp?: number }>(`/api/students/${student!.id}/wallet`),
    enabled: !!student,
  })
  const { data: today } = useQuery({ queryKey: ['wallet-topups', 'TODAY'], queryFn: () => fetchApi<{ topUps: TopUpRow[] }>('/api/wallet/topups?status=TODAY') })
  const send = useMutation({
    mutationFn: () => fetchApi<{ topUpId: string; topUpNumber: string; payments: unknown[]; bonus: number | null; balance: number }>('/api/wallet/topups', { method: 'POST', body: JSON.stringify({ studentId: student!.id, amount: Number(amount), method, transactionId: ref.trim() || null, remarks: remarks.trim() || null }) }),
    onSuccess: (r) => {
      notify.success(`Topped up (${r.topUpNumber})${r.payments.length ? ` · ${r.payments.length} invoice(s) paid` : ''}${r.bonus ? ` · bonus ${r.bonus} EGP` : ''} · balance ${r.balance} EGP`)
      window.open(`/topups/${r.topUpId}`, '_blank')
      setAmount(''); setRef(''); setRemarks(''); onDone()
    },
    onError: (e: Error) => notify.error(e.message || 'Could not top up'),
  })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top up a student</CardTitle><CardDescription>Cash or transfer at the branch. Open invoices are paid automatically and a top-up receipt opens.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!student ? (
            <div className="space-y-1">
              <Label>Student</Label>
              <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" /><Input className="pl-8" placeholder="Name, registration no. or parent phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              {(hits ?? []).map((h) => (
                <button key={h.id} type="button" className="block w-full rounded border border-slate-200 px-2 py-1 text-left hover:bg-slate-50" onClick={() => setStudent(h)}>
                  {h.firstName} {h.lastName} <span className="text-xs text-slate-400">{h.registrationNumber}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
              <span><strong>{student.firstName} {student.lastName}</strong> <span className="text-xs text-slate-500">{student.registrationNumber}</span><span className="block text-xs text-slate-600">Wallet: {money(wallet?.balance ?? 0)}{wallet?.minimumTopUp ? ` · minimum top-up ${wallet.minimumTopUp} EGP` : ''}</span></span>
              <Button size="sm" variant="ghost" onClick={() => { setStudent(null); setQ('') }}>Change</Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Amount (EGP)</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>Paid by</Label><PaymentMethodSelect value={method} onValueChange={setMethod} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label>Transaction no. (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <div className="space-y-1"><Label>Note (optional)</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
          </div>
          <Button disabled={!student || !(Number(amount) > 0) || send.isPending} onClick={() => send.mutate()}>Top up</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Today&apos;s top-ups</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {(today?.topUps ?? []).length === 0 && <p className="text-slate-500">None yet today.</p>}
          {(today?.topUps ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
              <span><Link href={`/dashboard/students/${t.student.id}`} className="hover:underline">{t.student.name}</Link> <span className="text-xs text-slate-400">· {t.method} · {t.source === 'ONLINE' ? 'online' : t.source === 'PROOF' ? 'receipt' : 'branch'}</span></span>
              <Link href={`/topups/${t.id}`} className="font-mono text-xs text-indigo-600 underline">{money(t.amount)} · {t.topUpNumber}</Link>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ApproveTab({ canApprove, onDone }: { canApprove: boolean; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['wallet-topups', 'PENDING'], queryFn: () => fetchApi<{ topUps: TopUpRow[] }>('/api/wallet/topups?status=PENDING') })
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) => fetchApi<{ topUpNumber?: string; payments?: unknown[] }>(`/api/wallet/topups/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }),
    onSuccess: (r, v) => { notify.success(v.action === 'approve' ? `Approved (${r?.topUpNumber})${r?.payments?.length ? ` · ${r.payments.length} invoice(s) paid` : ''}` : 'Rejected'); onDone() },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const rows = data?.topUps ?? []
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Transfer receipts uploaded by parents</CardTitle><CardDescription>Check the money arrived, then approve: the wallet is topped up and pays the invoices.</CardDescription></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length === 0 && <p className="text-slate-500">Nothing to check.</p>}
        {rows.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span>
              <Link href={`/dashboard/students/${t.student.id}`} className="font-medium hover:underline">{t.student.name}</Link> <span className="text-xs text-slate-400">{t.student.registrationNumber}</span>
              <span className="block text-xs text-slate-500">{money(t.amount)} · {new Date(t.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{t.remarks ? ` · ${t.remarks}` : ''}</span>
            </span>
            <span className="flex gap-1.5">
              {t.proofUrl && <a href={t.proofUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="h-7 text-xs">View receipt</Button></a>}
              {canApprove && (
                <>
                  <Button size="sm" className="h-7 gap-1 text-xs" disabled={act.isPending} onClick={() => act.mutate({ id: t.id, action: 'approve' })}><Check className="h-3.5 w-3.5" /> Approve</Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={act.isPending} onClick={() => { const reason = window.prompt('Why is it rejected?') ?? undefined; act.mutate({ id: t.id, action: 'reject', reason }) }}><X className="h-3.5 w-3.5" /> Reject</Button>
                </>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function WithdrawalsTab({ canApprove, onDone }: { canApprove: boolean; onDone: () => void }) {
  const [all, setAll] = useState(false)
  const { data } = useQuery({ queryKey: ['wallet-withdrawals', all], queryFn: () => fetchApi<WithdrawalRow[]>(`/api/wallet/withdrawals?status=${all ? 'ALL' : 'PENDING'}`) })
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) => fetchApi(`/api/wallet/withdrawals/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }),
    onSuccess: (_r, v) => { notify.success(v.action === 'approve' ? 'Approved — pay the money back' : 'Rejected'); onDone() },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">Withdrawals <label className="flex items-center gap-1 text-xs font-normal"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show all</label></CardTitle>
        <CardDescription>Money taken back out of a wallet. The parent receives the amount minus the fee.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {(data ?? []).length === 0 && <p className="text-slate-500">Nothing here.</p>}
        {(data ?? []).map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span>
              <Link href={`/dashboard/students/${w.student.id}`} className="font-medium hover:underline">{w.student.name}</Link> <span className="text-xs text-slate-400">{w.student.registrationNumber} · asked by {w.requestedVia === 'PARENT' ? 'the parent' : 'staff'}</span>
              <span className="block text-xs text-slate-500">{money(w.amount)} by {w.payoutMethod} · fee {money(w.fee)} · parent gets {money(w.amount - w.fee)}{w.reason ? ` · ${w.reason}` : ''} · {w.status}</span>
            </span>
            {canApprove && w.status === 'PENDING' && (
              <span className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" disabled={act.isPending} onClick={() => act.mutate({ id: w.id, action: 'approve' })}>Approve</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={act.isPending} onClick={() => { const reason = window.prompt('Why is it rejected?') ?? undefined; act.mutate({ id: w.id, action: 'reject', reason }) }}>Reject</Button>
              </span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function SettingsTab() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['wallet-settings'], queryFn: () => fetchApi<Settings>('/api/wallet/settings') })
  const { data: rulesData } = useQuery({ queryKey: ['wallet-rules'], queryFn: () => fetchApi<Rule[]>('/api/wallet/rules') })
  const { data: methods } = useQuery({ queryKey: ['payment-methods'], queryFn: () => fetchApi<{ name: string }[]>('/api/payment-methods') })
  const { data: opts } = useQuery({ queryKey: ['discount-options'], queryFn: () => fetchApi<{ tracks: Ref[]; courses: Ref[]; levels: (Ref & { subjectId: string })[]; groups?: Ref[] }>('/api/discounts/options') })
  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: () => fetchApi<{ id: string; label: string }[]>('/api/groups') })
  const [s, setS] = useState<Settings | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  useEffect(() => { if (settings) setS(settings) }, [settings])
  useEffect(() => { if (rulesData) setRules(rulesData) }, [rulesData])
  const save = useMutation({
    mutationFn: async () => {
      await fetchApi('/api/wallet/settings', { method: 'PUT', body: JSON.stringify(s) })
      await fetchApi('/api/wallet/rules', { method: 'PUT', body: JSON.stringify({ rules }) })
    },
    onSuccess: () => { notify.success('Wallet settings saved'); qc.invalidateQueries({ queryKey: ['wallet-settings'] }); qc.invalidateQueries({ queryKey: ['wallet-rules'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  if (!s) return <p className="text-sm text-slate-500">Loading…</p>
  const scopeOptions = (type: string): { id: string; name: string }[] =>
    type === 'TRACK' ? opts?.tracks ?? [] : type === 'COURSE' ? opts?.courses ?? [] : type === 'LEVEL' ? (opts?.levels ?? []).map((l) => ({ id: l.id, name: l.name })) : type === 'GROUP' ? (groups ?? []).map((g) => ({ id: g.id, name: g.label })) : []
  const ruleRow = (r: Rule, i: number) => (
    <div key={i} className="flex flex-wrap items-center gap-2">
      <Select value={r.scopeType} onValueChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, scopeType: v, scopeId: null } : x)))}>
        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
        <SelectContent>{['ALL', 'TRACK', 'COURSE', 'LEVEL', 'GROUP'].map((t) => <SelectItem key={t} value={t}>{t === 'ALL' ? 'Everyone' : t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
      </Select>
      {r.scopeType !== 'ALL' && (
        <Select value={r.scopeId ?? ''} onValueChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, scopeId: v } : x)))}>
          <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>{scopeOptions(r.scopeType).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {r.kind === 'MIN_TOPUP'
        ? <Input className="h-8 w-28" type="number" min={0} value={r.minAmount ?? 0} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, minAmount: Number(e.target.value) } : x)))} />
        : <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.allowed} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, allowed: e.target.checked } : x)))} /> allowed</label>}
      <button type="button" className="text-rose-500" onClick={() => setRules(rules.filter((_x, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
    </div>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Online top-up fee (paid by the parent, on top)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <label className="text-xs">Percent<Input className="h-8 w-24" type="number" min={0} step="0.1" value={s.paymobFeePercent} onChange={(e) => setS({ ...s, paymobFeePercent: Number(e.target.value) })} /></label>
          <label className="text-xs">+ fixed (EGP)<Input className="h-8 w-24" type="number" min={0} value={s.paymobFeeFixed} onChange={(e) => setS({ ...s, paymobFeeFixed: Number(e.target.value) })} /></label>
          <label className="text-xs">Low-balance alert (days before the month ends)<Input className="h-8 w-24" type="number" min={0} max={30} value={s.lowBalanceDays} onChange={(e) => setS({ ...s, lowBalanceDays: Number(e.target.value) })} /></label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Withdrawal fee by payout method</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {(methods ?? []).map((m) => {
            const f = s.withdrawFees[m.name] ?? { type: 'FIXED' as const, value: 0 }
            return (
              <div key={m.name} className="flex items-center gap-2">
                <span className="w-36 text-xs">{m.name}</span>
                <Select value={f.type} onValueChange={(v) => setS({ ...s, withdrawFees: { ...s.withdrawFees, [m.name]: { ...f, type: v as 'FIXED' | 'PERCENT' } } })}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="FIXED">EGP</SelectItem><SelectItem value="PERCENT">%</SelectItem></SelectContent>
                </Select>
                <Input className="h-8 w-24" type="number" min={0} value={f.value} onChange={(e) => setS({ ...s, withdrawFees: { ...s.withdrawFees, [m.name]: { ...f, value: Number(e.target.value) } } })} />
              </div>
            )
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Minimum top-up</CardTitle><CardDescription>A student in several groups gets the largest minimum. The most specific rule wins inside a group.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {rules.map((r, i) => (r.kind === 'MIN_TOPUP' ? ruleRow(r, i) : null))}
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setRules([...rules, { kind: 'MIN_TOPUP', scopeType: 'ALL', scopeId: null, minAmount: 0, allowed: true }])}><Plus className="h-3.5 w-3.5" /> Add rule</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Withdrawals allowed?</CardTitle><CardDescription>No rule = allowed (with approval). A student needs every group to allow it.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {rules.map((r, i) => (r.kind === 'WITHDRAW' ? ruleRow(r, i) : null))}
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setRules([...rules, { kind: 'WITHDRAW', scopeType: 'ALL', scopeId: null, minAmount: null, allowed: false }])}><Plus className="h-3.5 w-3.5" /> Add rule</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top-up offers</CardTitle><CardDescription>“Top up X or more, get Y” — the gift is a discount on the next invoice (not real money in the wallet).</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {s.promos.map((pr, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="text-xs">Top up at least<Input className="h-8 w-28" type="number" min={1} value={pr.minAmount} onChange={(e) => setS({ ...s, promos: s.promos.map((x, j) => (j === i ? { ...x, minAmount: Number(e.target.value) } : x)) })} /></label>
              <label className="text-xs">Gift (EGP)<Input className="h-8 w-24" type="number" min={1} value={pr.bonus} onChange={(e) => setS({ ...s, promos: s.promos.map((x, j) => (j === i ? { ...x, bonus: Number(e.target.value) } : x)) })} /></label>
              <label className="text-xs">From<Input className="h-8 w-36" type="date" value={pr.from ?? ''} onChange={(e) => setS({ ...s, promos: s.promos.map((x, j) => (j === i ? { ...x, from: e.target.value || null } : x)) })} /></label>
              <label className="text-xs">To<Input className="h-8 w-36" type="date" value={pr.to ?? ''} onChange={(e) => setS({ ...s, promos: s.promos.map((x, j) => (j === i ? { ...x, to: e.target.value || null } : x)) })} /></label>
              <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" checked={pr.active} onChange={(e) => setS({ ...s, promos: s.promos.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) })} /> active</label>
              <button type="button" className="pb-2 text-rose-500" onClick={() => setS({ ...s, promos: s.promos.filter((_x, j) => j !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setS({ ...s, promos: [...s.promos, { minAmount: 3000, bonus: 100, from: null, to: null, active: true }] })}><Plus className="h-3.5 w-3.5" /> Add offer</Button>
        </CardContent>
      </Card>
      <div className="lg:col-span-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>Save wallet settings</Button></div>
    </div>
  )
}
