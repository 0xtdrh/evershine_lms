'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, Loader2, Plus, Save, Trash2, Undo2, X } from 'lucide-react'

interface RefundRow {
  id: string
  refundNumber: string | null
  status: string
  amount: number
  suggestedAmount: number
  method: 'CASH' | 'WALLET'
  payoutMethod: string | null
  reason: string | null
  rejectedReason: string | null
  createdAt: string
  student: { id: string; firstName: string; lastName: string; registrationNumber: string } | null
  invoice: { id: string; challanNumber: string; month: string } | null
  requestedBy: string | null
  approvedBy: string | null
}
interface Rule { scopeType: string; scopeId: string | null; allowed: boolean; adminFeeType: 'FIXED' | 'PERCENT'; adminFeeValue: number; deductBasis: 'ATTENDED' | 'HELD'; note?: string | null }
interface Options {
  tracks: { id: string; name: string }[]
  courses: { id: string; name: string }[]
  levels: { id: string; name: string; subjectId: string }[]
  groups: { id: string; name: string; detail: string }[]
}

const STATUS_CLASS: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
}
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

export default function RefundsPage() {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    enabled: status === 'authenticated' && !!role,
  })
  const p = perms?.permissions ?? {}
  const can = {
    read: !!p.refunds?.includes('read'),
    approve: !!p.refunds?.includes('approve'),
    rules: !!p.refunds?.includes('read') || !!p.finance_settings?.includes('read'),
    editRules: !!p.finance_settings?.includes('update'),
  }
  if (status === 'loading' || (status === 'authenticated' && !perms)) return null
  if (!can.read) return <AccessDenied />
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Undo2 className="h-6 w-6" /> Refunds</h1>
        <p className="text-sm text-muted-foreground">To refund, open the invoice and press “Refund”. Approvals, history and the rules are here.</p>
      </div>
      <Tabs defaultValue={can.approve ? 'requests' : 'all'}>
        <TabsList>
          {can.approve && <TabsTrigger value="requests">Requests</TabsTrigger>}
          <TabsTrigger value="all">All refunds</TabsTrigger>
          {can.rules && <TabsTrigger value="rules">Rules</TabsTrigger>}
        </TabsList>
        {can.approve && <TabsContent value="requests"><RefundList status="PENDING" canApprove /></TabsContent>}
        <TabsContent value="all"><RefundList status="ALL" canApprove={false} /></TabsContent>
        {can.rules && <TabsContent value="rules"><Rules canEdit={can.editRules} /></TabsContent>}
      </Tabs>
    </div>
  )
}

function RefundList({ status, canApprove }: { status: string; canApprove: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['refunds', status],
    queryFn: () => fetchApi<RefundRow[]>(`/api/refunds${status === 'ALL' ? '' : `?status=${status}`}`),
  })
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      fetchApi(`/api/refunds/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }),
    onSuccess: (_r, v) => { notify.success(v.action === 'approve' ? 'Refund approved' : 'Refund rejected'); qc.invalidateQueries() },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
        {data?.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {money(r.amount)} · {r.method === 'WALLET' ? 'to wallet' : `money back (${r.payoutMethod ?? ''})`}
                <span className={`ml-2 rounded border px-1.5 py-0.5 text-xs ${STATUS_CLASS[r.status] ?? ''}`}>{r.status}</span>
                {r.refundNumber && <span className="ml-2 text-xs text-muted-foreground">{r.refundNumber}</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {r.student ? `${r.student.firstName} ${r.student.lastName} (${r.student.registrationNumber})` : '—'}
                {r.invoice ? ` · invoice ${r.invoice.challanNumber} (${r.invoice.month})` : ''}
                {` · suggested ${money(r.suggestedAmount)} · by ${r.requestedBy ?? '—'}`}
                {r.approvedBy ? ` · ${r.status === 'REJECTED' ? 'rejected' : 'approved'} by ${r.approvedBy}` : ''}
                {r.reason ? ` · ${r.reason}` : ''}{r.rejectedReason ? ` · ${r.rejectedReason}` : ''}
              </div>
            </div>
            <div className="flex gap-2">
              {r.status === 'APPROVED' && <Link href={`/refunds/${r.id}`} className="text-sm text-blue-600 hover:underline">Receipt</Link>}
              {canApprove && r.status === 'PENDING' && (
                <>
                  <Button size="sm" onClick={() => act.mutate({ id: r.id, action: 'approve' })} disabled={act.isPending}><Check className="mr-1 h-4 w-4" /> Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: r.id, action: 'reject', reason: window.prompt('Reason (optional)') ?? undefined })} disabled={act.isPending}><X className="mr-1 h-4 w-4" /> Reject</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function Rules({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['refund-rules'], queryFn: () => fetchApi<Rule[]>('/api/refunds/rules') })
  const { data: options } = useQuery({ queryKey: ['discount-options'], queryFn: () => fetchApi<Options>('/api/discounts/options') })
  const [rules, setRules] = useState<Rule[] | null>(null)
  useEffect(() => { if (data) setRules(data) }, [data])
  const save = useMutation({
    mutationFn: (rs: Rule[]) => fetchApi<Rule[]>('/api/refunds/rules', { method: 'PUT', body: JSON.stringify({ rules: rs }) }),
    onSuccess: (rs) => { notify.success('Refund rules saved'); setRules(rs); qc.invalidateQueries({ queryKey: ['refund-rules'] }) },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })
  const listFor = useMemo(() => (scope: string) => {
    if (scope === 'TRACK') return options?.tracks ?? []
    if (scope === 'COURSE') return options?.courses ?? []
    if (scope === 'LEVEL') return (options?.levels ?? []).map((l) => ({ id: l.id, name: `${options?.courses.find((c) => c.id === l.subjectId)?.name ?? ''} — ${l.name}` }))
    if (scope === 'GROUP') return options?.groups ?? []
    return []
  }, [options])
  if (!rules) return <p className="text-sm text-muted-foreground">Loading…</p>
  const set = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Refund rules</CardTitle>
        <CardDescription>
          The most specific rule wins (group › level › course › track › everywhere). With no rule, refunds are allowed with no admin fee and attended sessions are deducted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-6">
            <Select value={r.scopeType} onValueChange={(v) => set(i, { scopeType: v, scopeId: null })} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['ALL', 'TRACK', 'COURSE', 'LEVEL', 'GROUP'].map((s) => <SelectItem key={s} value={s}>{s === 'ALL' ? 'Everywhere' : s.toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
            {r.scopeType !== 'ALL' ? (
              <Select value={r.scopeId ?? undefined} onValueChange={(v) => set(i, { scopeId: v })} disabled={!canEdit}>
                <SelectTrigger className="sm:col-span-2"><SelectValue placeholder="Which one" /></SelectTrigger>
                <SelectContent>{listFor(r.scopeType).map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
              </Select>
            ) : <div className="sm:col-span-2" />}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.allowed} disabled={!canEdit} onChange={(e) => set(i, { allowed: e.target.checked })} /> Refunds allowed</label>
            <div className="flex items-center gap-1 sm:col-span-2">
              <span className="text-xs">Fee</span>
              <Input type="number" min={0} className="w-24" value={r.adminFeeValue} disabled={!canEdit || !r.allowed} onChange={(e) => set(i, { adminFeeValue: Number(e.target.value) || 0 })} />
              <Select value={r.adminFeeType} onValueChange={(v) => set(i, { adminFeeType: v as Rule['adminFeeType'] })} disabled={!canEdit || !r.allowed}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="FIXED">EGP</SelectItem><SelectItem value="PERCENT">%</SelectItem></SelectContent>
              </Select>
            </div>
            <Select value={r.deductBasis} onValueChange={(v) => set(i, { deductBasis: v as Rule['deductBasis'] })} disabled={!canEdit || !r.allowed}>
              <SelectTrigger className="sm:col-span-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ATTENDED">Deduct the sessions the student attended</SelectItem>
                <SelectItem value="HELD">Deduct every session the group held</SelectItem>
              </SelectContent>
            </Select>
            {canEdit && <Button size="icon" variant="ghost" onClick={() => setRules(rules.filter((_, k) => k !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-red-600" /></Button>}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRules([...rules, { scopeType: rules.some((r) => r.scopeType === 'ALL') ? 'TRACK' : 'ALL', scopeId: null, allowed: true, adminFeeType: 'FIXED', adminFeeValue: 0, deductBasis: 'ATTENDED' }])}>
              <Plus className="mr-1 h-4 w-4" /> Add rule
            </Button>
            <Button onClick={() => save.mutate(rules)} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save rules
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
