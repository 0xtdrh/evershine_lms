'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BadgePercent, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { GiveDiscountDialog, valueText, type DiscountTypeOption } from '@/components/discounts/GiveDiscountDialog'
import { ApplyToInvoicesDialog, type AffectedInvoice } from '@/components/discounts/ApplyToInvoicesDialog'

interface TypeRow extends DiscountTypeOption {
  scopeType: string
  scopeId: string | null
  validFrom: string | null
  validTo: string | null
  stackable: boolean
  _count?: { assignments: number; invoiceDiscounts: number }
}
interface Assignment {
  id: string
  status: string
  value: number
  reason: string | null
  rejectedReason: string | null
  discountType: { name: string; valueType: string; duration: string; approvalMode: string }
  student: { id: string; firstName: string; lastName: string; registrationNumber: string } | null
  group: { id: string; name: string } | null
  track: { id: string; name: string } | null
  requestedBy: string | null
  approvedBy: string | null
  createdAt: string
}
interface Options {
  tracks: { id: string; name: string }[]
  courses: { id: string; name: string; trackId: string | null }[]
  levels: { id: string; name: string; subjectId: string }[]
  groups: { id: string; name: string; detail: string }[]
}
interface Rules { allowStacking: boolean; maxTotalPercent: number | null; siblingAppliesTo: 'SECOND_AND_LATER' | 'ALL'; earlyRenewalTypeId: string | null }
interface Report { total: number; byType: Row[]; byGroup: Row[]; byStaff: Row[] }
interface Row { name: string; amount: number; count: number }

const KIND = { MANUAL: 'Manual', SIBLING: 'Siblings', PROMO: 'Limited-time offer', OTHER: 'Other' } as Record<string, string>
const DURATION = { EVERY_CYCLE: 'Every month', FIRST_CYCLE: 'First month only', ONE_TIME: 'One time' } as Record<string, string>
const APPROVAL = { STAFF: 'Any staff member', MANAGER: 'Manager only', STAFF_WITH_APPROVAL: 'Staff requests, manager approves' } as Record<string, string>
const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  ENDED: 'bg-slate-100 text-slate-600 border-slate-200',
}

const emptyType = (): Partial<TypeRow> => ({
  name: '', kind: 'MANUAL', valueType: 'PERCENT', value: 10, editableValue: false, maxValue: null,
  duration: 'EVERY_CYCLE', autoApply: false, approvalMode: 'STAFF', scopeType: 'ALL', scopeId: null,
  validFrom: null, validTo: null, stackable: true, isActive: true,
})

export default function DiscountsPage() {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    enabled: status === 'authenticated' && !!role,
  })
  const p = perms?.permissions ?? {}
  const can = {
    read: !!p.discounts?.includes('read') || !!p.discount_approvals?.includes('read'),
    give: !!p.discounts?.includes('create') || !!p.discount_approvals?.includes('approve'),
    approve: !!p.discount_approvals?.includes('approve'),
    end: !!p.discounts?.includes('update') || !!p.discount_approvals?.includes('approve'),
    types: !!p.discount_types?.includes('read'),
    editTypes: !!p.discount_types?.includes('update') || !!p.discount_types?.includes('create'),
    rules: !!p.finance_settings?.includes('read'),
    editRules: !!p.finance_settings?.includes('update'),
  }

  if (status === 'loading' || (status === 'authenticated' && !perms)) return null
  if (!can.read && !can.types) return <AccessDenied />

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><BadgePercent className="h-6 w-6" /> Discounts</h1>
        <p className="text-sm text-muted-foreground">Discount types, discounts given, approvals and the monthly report.</p>
      </div>
      <Tabs defaultValue={can.approve ? 'requests' : 'given'}>
        <TabsList className="flex-wrap">
          {can.approve && <TabsTrigger value="requests">Requests</TabsTrigger>}
          {can.read && <TabsTrigger value="given">Discounts</TabsTrigger>}
          {can.types && <TabsTrigger value="types">Types</TabsTrigger>}
          {can.read && <TabsTrigger value="report">Report</TabsTrigger>}
          {can.rules && <TabsTrigger value="rules">Rules</TabsTrigger>}
        </TabsList>
        {can.approve && <TabsContent value="requests"><Requests /></TabsContent>}
        {can.read && <TabsContent value="given"><Given canGive={can.give} canEnd={can.end} /></TabsContent>}
        {can.types && <TabsContent value="types"><Types canEdit={can.editTypes} /></TabsContent>}
        {can.read && <TabsContent value="report"><ReportTab /></TabsContent>}
        {can.rules && <TabsContent value="rules"><RulesTab canEdit={can.editRules} /></TabsContent>}
      </Tabs>
    </div>
  )
}

function who(a: Assignment) {
  if (a.student) return `${a.student.firstName} ${a.student.lastName} (${a.student.registrationNumber})`
  if (a.group) return `Whole group ${a.group.name}`
  return '—'
}
function where(a: Assignment) {
  if (a.student && a.group) return `group ${a.group.name}`
  if (a.track) return `track ${a.track.name}`
  return a.student ? 'all groups' : ''
}

function Requests() {
  const qc = useQueryClient()
  const [ask, setAsk] = useState<{ id: string; invoices: AffectedInvoice[] } | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['discounts', 'PENDING'], queryFn: () => fetchApi<Assignment[]>('/api/discounts?status=PENDING') })
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      fetchApi<{ assignment: { id: string }; affectedInvoices: AffectedInvoice[] }>(`/api/discounts/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }),
    onSuccess: (r, v) => {
      notify.success(v.action === 'approve' ? 'Approved' : 'Rejected')
      qc.invalidateQueries({ queryKey: ['discounts'] })
      if (v.action === 'approve' && r.affectedInvoices?.length) setAsk({ id: r.assignment.id, invoices: r.affectedInvoices })
    },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Waiting for approval</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No requests.</p>}
        {data?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{a.discountType.name} · {a.discountType.valueType === 'PERCENT' ? `${a.value}%` : `${a.value} EGP`}</div>
              <div className="text-xs text-muted-foreground">{who(a)} {where(a) && `· ${where(a)}`} · by {a.requestedBy ?? '—'}{a.reason ? ` · ${a.reason}` : ''}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => act.mutate({ id: a.id, action: 'approve' })} disabled={act.isPending}><Check className="mr-1 h-4 w-4" /> Approve</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const reason = window.prompt('Reason for rejecting (optional)') ?? undefined
                  act.mutate({ id: a.id, action: 'reject', reason })
                }}
                disabled={act.isPending}
              >
                <X className="mr-1 h-4 w-4" /> Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
      <ApplyToInvoicesDialog assignmentId={ask?.id ?? null} invoices={ask?.invoices ?? []} onDone={() => setAsk(null)} />
    </Card>
  )
}

function Given({ canGive, canEnd }: { canGive: boolean; canEnd: boolean }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('ACTIVE')
  const [groupDialog, setGroupDialog] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['discounts', 'list', filter],
    queryFn: () => fetchApi<Assignment[]>(`/api/discounts${filter === 'ALL' ? '' : `?status=${filter}`}`),
  })
  const end = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/discounts/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'end' }) }),
    onSuccess: () => { notify.success('Stopped from the next invoice'); qc.invalidateQueries({ queryKey: ['discounts'] }) },
    onError: (err: Error) => notify.error(err.message || 'Could not stop it'),
  })
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Discounts given</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['ACTIVE', 'PENDING', 'ENDED', 'REJECTED', 'ALL'].map((s) => <SelectItem key={s} value={s}>{s === 'ALL' ? 'All' : s}</SelectItem>)}
              </SelectContent>
            </Select>
            {canGive && <Button variant="outline" onClick={() => setGroupDialog(true)}><Plus className="mr-1 h-4 w-4" /> Whole-group discount</Button>}
          </div>
        </div>
        <CardDescription>For one student, open the student page › Discounts › Add.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
        {data?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {a.discountType.name} · {a.discountType.valueType === 'PERCENT' ? `${a.value}%` : `${a.value} EGP`}
                <span className={`ml-2 rounded border px-1.5 py-0.5 text-xs ${STATUS_CLASS[a.status] ?? ''}`}>{a.status}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {who(a)} {where(a) && `· ${where(a)}`} · by {a.requestedBy ?? '—'}
                {a.approvedBy && a.approvedBy !== a.requestedBy ? ` · approved by ${a.approvedBy}` : ''}
                {a.reason ? ` · ${a.reason}` : ''}{a.rejectedReason ? ` · rejected: ${a.rejectedReason}` : ''}
              </div>
            </div>
            {canEnd && (a.status === 'ACTIVE' || a.status === 'PENDING') && (
              <Button size="sm" variant="ghost" onClick={() => end.mutate(a.id)} disabled={end.isPending}>Stop</Button>
            )}
          </div>
        ))}
      </CardContent>
      <GiveDiscountDialog open={groupDialog} onOpenChange={setGroupDialog} student={null} />
    </Card>
  )
}

function Types({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<TypeRow> | null>(null)
  const { data } = useQuery({ queryKey: ['discount-types'], queryFn: () => fetchApi<TypeRow[]>('/api/discount-types') })
  const { data: options } = useQuery({ queryKey: ['discount-options'], queryFn: () => fetchApi<Options>('/api/discounts/options') })
  const remove = useMutation({
    mutationFn: (id: string) => fetchApi<{ deactivated?: boolean }>(`/api/discount-types/${id}`, { method: 'DELETE' }),
    onSuccess: (r) => { notify.success(r?.deactivated ? 'Already used: switched off instead of deleted' : 'Deleted'); qc.invalidateQueries({ queryKey: ['discount-types'] }) },
    onError: (err: Error) => notify.error(err.message || 'Could not delete'),
  })
  const scopeName = (t: TypeRow) => {
    if (t.scopeType === 'ALL' || !t.scopeId) return 'Everywhere'
    const list = t.scopeType === 'TRACK' ? options?.tracks : t.scopeType === 'COURSE' ? options?.courses : t.scopeType === 'LEVEL' ? options?.levels : options?.groups
    return `${t.scopeType.toLowerCase()} ${list?.find((x) => x.id === t.scopeId)?.name ?? ''}`
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Discount types</CardTitle>
          {canEdit && <Button onClick={() => setEditing(emptyType())}><Plus className="mr-1 h-4 w-4" /> New type</Button>}
        </div>
        <CardDescription>Editing a type changes NEW invoices only; issued invoices keep their discount.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.length === 0 && <p className="text-sm text-muted-foreground">No types yet. Start with e.g. “Siblings 10%”, “Manual”, “Summer offer”.</p>}
        {data?.map((t) => (
          <div key={t.id} className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${t.isActive ? '' : 'opacity-60'}`}>
            <div className="min-w-0">
              <div className="font-medium">{t.name} · {valueText(t)}{t.editableValue ? ` (editable${t.maxValue != null ? `, max ${Number(t.maxValue)}` : ''})` : ''}{!t.isActive && ' · off'}</div>
              <div className="text-xs text-muted-foreground">
                {KIND[t.kind]} · {DURATION[t.duration]} · {t.autoApply ? 'automatic' : APPROVAL[t.approvalMode]} · {scopeName(t)}
                {t.stackable ? ' · combines with others' : ' · not combined with others'}
                {(t.validFrom || t.validTo) && ` · ${t.validFrom ? t.validFrom.slice(0, 10) : '…'} → ${t.validTo ? t.validTo.slice(0, 10) : '…'}`}
                {t._count ? ` · used on ${t._count.invoiceDiscounts} invoice(s)` : ''}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(t)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => { if (window.confirm(`Delete "${t.name}"?`)) remove.mutate(t.id) }} aria-label="Delete"><Trash2 className="h-4 w-4 text-red-600" /></Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
      {editing && <TypeDialog value={editing} options={options} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function TypeDialog({ value, options, onClose }: { value: Partial<TypeRow>; options?: Options; onClose: () => void }) {
  const qc = useQueryClient()
  const [t, setT] = useState<Partial<TypeRow>>(value)
  const set = (patch: Partial<TypeRow>) => setT({ ...t, ...patch })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...t,
        value: Number(t.value),
        maxValue: t.editableValue && t.maxValue !== null && t.maxValue !== undefined && t.maxValue !== '' ? Number(t.maxValue) : null,
        validFrom: t.validFrom || null,
        validTo: t.validTo || null,
        scopeId: t.scopeType === 'ALL' ? null : t.scopeId,
      }
      return t.id
        ? fetchApi(`/api/discount-types/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : fetchApi('/api/discount-types', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['discount-types'] }); onClose() },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })
  const scopeList = useMemo(() => {
    if (t.scopeType === 'TRACK') return options?.tracks ?? []
    if (t.scopeType === 'COURSE') return options?.courses ?? []
    if (t.scopeType === 'LEVEL') return (options?.levels ?? []).map((l) => ({ id: l.id, name: `${options?.courses.find((c) => c.id === l.subjectId)?.name ?? ''} — ${l.name}` }))
    if (t.scopeType === 'GROUP') return options?.groups ?? []
    return []
  }, [t.scopeType, options])
  useEffect(() => { if (t.kind === 'SIBLING' && t.autoApply === undefined) set({ autoApply: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (label: string, v: string | undefined, onChange: (v: string) => void, items: { value: string; label: string }[]) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={v} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
  const check = (label: string, v: boolean | undefined, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t.id ? 'Edit discount type' : 'New discount type'}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>Name</Label>
            <Input value={t.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Siblings, Summer offer, Manual" />
          </div>
          {pick('Kind', t.kind, (v) => set({ kind: v, ...(v === 'SIBLING' ? { autoApply: true } : {}) }), Object.entries(KIND).map(([value, label]) => ({ value, label })))}
          {pick('Value type', t.valueType, (v) => set({ valueType: v as 'PERCENT' | 'FIXED' }), [{ value: 'PERCENT', label: 'Percentage (%)' }, { value: 'FIXED', label: 'Fixed amount (EGP)' }])}
          <div className="space-y-1">
            <Label>Value ({t.valueType === 'PERCENT' ? '%' : 'EGP'})</Label>
            <Input type="number" min={0} value={t.value ?? ''} onChange={(e) => set({ value: e.target.value })} />
          </div>
          {pick('How long', t.duration, (v) => set({ duration: v }), Object.entries(DURATION).map(([value, label]) => ({ value, label })))}
          <div className="sm:col-span-2">
            {check('Staff may change the value when giving it', t.editableValue, (v) => set({ editableValue: v }))}
          </div>
          {t.editableValue && (
            <div className="space-y-1">
              <Label>Maximum value</Label>
              <Input type="number" min={0} value={t.maxValue ?? ''} onChange={(e) => set({ maxValue: e.target.value === '' ? null : e.target.value })} />
            </div>
          )}
          <div className="sm:col-span-2">
            {check('Automatic (the system applies it, no one gives it by hand)', t.autoApply, (v) => set({ autoApply: v }),
              t.kind === 'SIBLING' ? 'Siblings: who gets it is set in the Rules tab.' : 'Applies to everyone in "Where" during its dates.')}
          </div>
          {!t.autoApply && pick('Who can give it', t.approvalMode, (v) => set({ approvalMode: v }), Object.entries(APPROVAL).map(([value, label]) => ({ value, label })))}
          {pick('Where', t.scopeType, (v) => set({ scopeType: v, scopeId: null }), [
            { value: 'ALL', label: 'Everywhere' }, { value: 'TRACK', label: 'A track' }, { value: 'COURSE', label: 'A course' }, { value: 'LEVEL', label: 'A level' }, { value: 'GROUP', label: 'A group' },
          ])}
          {t.scopeType !== 'ALL' && pick('Which one', t.scopeId ?? undefined, (v) => set({ scopeId: v }), scopeList.map((x) => ({ value: x.id, label: x.name })))}
          <div className="space-y-1">
            <Label>From (optional)</Label>
            <Input type="date" value={t.validFrom ? String(t.validFrom).slice(0, 10) : ''} onChange={(e) => set({ validFrom: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label>To (optional)</Label>
            <Input type="date" value={t.validTo ? String(t.validTo).slice(0, 10) : ''} onChange={(e) => set({ validTo: e.target.value || null })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            {check('Can be combined with other discounts', t.stackable, (v) => set({ stackable: v }), 'If not, it only applies alone (when it is the better deal). Combining must also be allowed in Rules.')}
            {check('Active', t.isActive, (v) => set({ isActive: v }))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!t.name || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ReportTab() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const [from, setFrom] = useState(iso(first))
  const [to, setTo] = useState(iso(today))
  const { data, isLoading } = useQuery({
    queryKey: ['discounts-report', from, to],
    queryFn: () => fetchApi<Report>(`/api/discounts/report?from=${from}&to=${to}`),
  })
  const table = (title: string, rows: Row[] = []) => (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : rows.map((r) => (
        <div key={r.name} className="flex justify-between border-b py-1 text-sm">
          <span>{r.name} <span className="text-xs text-muted-foreground">({r.count})</span></span>
          <span className="font-mono">{r.amount.toLocaleString()} EGP</span>
        </div>
      ))}
    </div>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Discounts on invoices issued in the period</CardTitle>
        <div className="flex flex-wrap items-end gap-2 pt-2">
          <div className="space-y-1"><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <p className="text-lg font-semibold">Total: {data?.total.toLocaleString() ?? 0} EGP</p>
            <div className="grid gap-4 md:grid-cols-3">
              {table('By type', data?.byType)}
              {table('By group', data?.byGroup)}
              {table('Given by', data?.byStaff)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function RulesTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['discount-rules'], queryFn: () => fetchApi<Rules>('/api/discounts/rules') })
  const [r, setR] = useState<Rules | null>(null)
  useEffect(() => { if (data) setR(data) }, [data])
  const { data: types } = useQuery({ queryKey: ['discount-types'], queryFn: () => fetchApi<TypeRow[]>('/api/discount-types') })
  const save = useMutation({
    mutationFn: (v: Rules) => fetchApi<Rules>('/api/discounts/rules', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success('Rules saved'); qc.invalidateQueries({ queryKey: ['discount-rules'] }) },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })
  if (!r) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={r.allowStacking} disabled={!canEdit} onChange={(e) => setR({ ...r, allowStacking: e.target.checked })} />
          <span>A student can get more than one discount on the same invoice
            <span className="block text-xs text-muted-foreground">Off: only the biggest discount applies. On: discounts marked “can be combined” add up.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={r.maxTotalPercent !== null} disabled={!canEdit} onChange={(e) => setR({ ...r, maxTotalPercent: e.target.checked ? 50 : null })} />
            Maximum total discount
          </label>
          {r.maxTotalPercent !== null && (
            <>
              <Input type="number" min={0} max={100} className="w-24" value={r.maxTotalPercent} disabled={!canEdit} onChange={(e) => setR({ ...r, maxTotalPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
              <span>% of the price</span>
            </>
          )}
        </div>
        <div className="space-y-1 text-sm">
          <Label>Sibling discount goes to</Label>
          <Select value={r.siblingAppliesTo} onValueChange={(v) => setR({ ...r, siblingAppliesTo: v as Rules['siblingAppliesTo'] })} disabled={!canEdit}>
            <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SECOND_AND_LATER">Every brother/sister except the first registered</SelectItem>
              <SelectItem value="ALL">All brothers and sisters</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Siblings = same parent phone, both in an active group now. Whether it is automatic is set on the sibling discount type.</p>
        </div>
        <div className="space-y-1 text-sm">
          <Label>Early renewal discount</Label>
          <Select value={r.earlyRenewalTypeId ?? 'none'} onValueChange={(v) => setR({ ...r, earlyRenewalTypeId: v === 'none' ? null : v })} disabled={!canEdit}>
            <SelectTrigger className="max-w-md"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Off</SelectItem>
              {(types ?? []).filter((t) => t.isActive).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            When a parent confirms “continuing next month” before the last session, the student gets this discount on next month&apos;s invoice.
            Create the type in “Discount types” first (for example “Early renewal 5%”, duration “once”). Changing it later does not touch discounts already given.
          </p>
        </div>
        {canEdit && <Button onClick={() => save.mutate(r)} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save rules</Button>}
      </CardContent>
    </Card>
  )
}
