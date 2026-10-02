'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowDown, ArrowUp, Landmark, Loader2, Plus, Save, Trash2, Wallet } from 'lucide-react'

interface Account {
  id?: string
  kind: string
  label: string
  accountName: string | null
  accountNumber: string | null
  bankName: string | null
  iban: string | null
  instructions: string | null
  isActive: boolean
}
interface Method { id?: string; name: string; isActive: boolean; isSystem?: boolean }
interface Settings { finance: { invoiceDueDays: number }; accounts: Account[]; methods: Method[] }

const KINDS: { value: string; label: string }[] = [
  { value: 'INSTAPAY', label: 'InstaPay' },
  { value: 'VODAFONE_CASH', label: 'Vodafone Cash' },
  { value: 'BANK', label: 'Bank account' },
  { value: 'FAWRY', label: 'Fawry' },
  { value: 'OTHER', label: 'Other' },
]

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const copy = [...list]
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  return copy
}

export default function FinanceSettingsPage() {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const qc = useQueryClient()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    enabled: status === 'authenticated' && !!role,
  })
  const canRead = !!perms?.permissions?.finance_settings?.includes('read')
  const canEdit = !!perms?.permissions?.finance_settings?.includes('update')

  const { data, isLoading } = useQuery({
    queryKey: ['finance-settings'],
    queryFn: () => fetchApi<Settings>('/api/admin/finance-settings'),
    enabled: canRead,
  })
  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const save = useMutation({
    mutationFn: (body: Settings) => fetchApi<Settings>('/api/admin/finance-settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (res) => {
      notify.success('Payment settings saved')
      setForm(res)
      qc.invalidateQueries({ queryKey: ['finance-settings'] })
      qc.invalidateQueries({ queryKey: ['payment-methods'] })
      qc.invalidateQueries({ queryKey: ['payment-accounts'] })
    },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })

  if (status === 'loading' || (status === 'authenticated' && !perms)) return null
  if (!canRead) return <AccessDenied />
  if (isLoading || !form) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>

  const setAccount = (i: number, patch: Partial<Account>) =>
    setForm({ ...form, accounts: form.accounts.map((a, k) => (k === i ? { ...a, ...patch } : a)) })
  const setMethod = (i: number, patch: Partial<Method>) =>
    setForm({ ...form, methods: form.methods.map((m, k) => (k === i ? { ...m, ...patch } : m)) })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Wallet className="h-6 w-6" /> Payment settings</h1>
          <p className="text-sm text-muted-foreground">Where parents send money, the methods staff record, and when invoices are due.</p>
        </div>
        {canEdit && (
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Accounts for payments</CardTitle>
          <CardDescription>Shown on every invoice and in the parent portal. Parents transfer to these and upload the receipt.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.accounts.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No account yet: invoices will tell parents to pay at the branch.
            </p>
          )}
          {form.accounts.map((a, i) => (
            <div key={a.id ?? `new-${i}`} className="space-y-3 rounded-xl border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={a.kind} onValueChange={(v) => setAccount(i, { kind: v })} disabled={!canEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Name shown to parents</Label>
                  <Input value={a.label} onChange={(e) => setAccount(i, { label: e.target.value })} placeholder="e.g. InstaPay" disabled={!canEdit} />
                </div>
                <div className="space-y-1">
                  <Label>{a.kind === 'BANK' ? 'Account number' : 'Number / handle'}</Label>
                  <Input dir="ltr" value={a.accountNumber ?? ''} onChange={(e) => setAccount(i, { accountNumber: e.target.value })} placeholder={a.kind === 'INSTAPAY' ? 'name@instapay or 01…' : '01…'} disabled={!canEdit} />
                </div>
                <div className="space-y-1">
                  <Label>Account holder name</Label>
                  <Input value={a.accountName ?? ''} onChange={(e) => setAccount(i, { accountName: e.target.value })} disabled={!canEdit} />
                </div>
                {a.kind === 'BANK' && (
                  <>
                    <div className="space-y-1">
                      <Label>Bank</Label>
                      <Input value={a.bankName ?? ''} onChange={(e) => setAccount(i, { bankName: e.target.value })} disabled={!canEdit} />
                    </div>
                    <div className="space-y-1">
                      <Label>IBAN</Label>
                      <Input dir="ltr" value={a.iban ?? ''} onChange={(e) => setAccount(i, { iban: e.target.value })} disabled={!canEdit} />
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-1">
                <Label>Note for parents (optional)</Label>
                <Textarea rows={2} value={a.instructions ?? ''} onChange={(e) => setAccount(i, { instructions: e.target.value })} placeholder="e.g. Write the student name in the transfer note, then upload the screenshot." disabled={!canEdit} />
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={a.isActive} onChange={(e) => setAccount(i, { isActive: e.target.checked })} />
                    Shown to parents
                  </label>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: move(form.accounts, i, -1) })} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: move(form.accounts, i, 1) })} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: form.accounts.filter((_, k) => k !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => setForm({ ...form, accounts: [...form.accounts, { kind: 'INSTAPAY', label: 'InstaPay', accountName: null, accountNumber: null, bankName: null, iban: null, instructions: null, isActive: true }] })}
            >
              <Plus className="mr-2 h-4 w-4" /> Add account
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Online payment (cards / wallets) will be added here later as another account type.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment methods</CardTitle>
          <CardDescription>The list staff pick from when recording a payment. Old payments keep the name they were recorded with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {form.methods.map((m, i) => (
            <div key={m.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded border px-3 py-2">
              <Input className="max-w-xs" value={m.name} onChange={(e) => setMethod(i, { name: e.target.value })} disabled={!canEdit || m.isSystem} />
              {m.isSystem && <span className="text-xs text-muted-foreground">built-in</span>}
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" checked={m.isActive} onChange={(e) => setMethod(i, { isActive: e.target.checked })} disabled={!canEdit} />
                Active
              </label>
              {canEdit && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: move(form.methods, i, -1) })} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: move(form.methods, i, 1) })} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                  {!m.isSystem && (
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: form.methods.filter((_, k) => k !== i) })} aria-label="Remove"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <Button variant="outline" onClick={() => setForm({ ...form, methods: [...form.methods, { name: '', isActive: true }] })}>
              <Plus className="mr-2 h-4 w-4" /> Add method
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Label htmlFor="dueDays">A new group invoice is due after</Label>
          <Input
            id="dueDays"
            type="number"
            min={0}
            max={90}
            className="w-24"
            value={form.finance.invoiceDueDays}
            onChange={(e) => setForm({ ...form, finance: { invoiceDueDays: Math.max(0, Math.min(90, Number(e.target.value) || 0)) } })}
            disabled={!canEdit}
          />
          <span className="text-sm">days</span>
        </CardContent>
      </Card>
    </div>
  )
}
