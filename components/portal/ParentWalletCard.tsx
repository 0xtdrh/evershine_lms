'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WalletLedger, type LedgerRow } from '@/components/wallet/WalletLedger'
import { Wallet, Plus, ArrowRightLeft, Undo2, FileText } from 'lucide-react'

interface ChildWallet { studentId: string; name: string; balance: number; visibleToStudent: boolean; minimumTopUp: number; withdrawalAllowed: boolean; pendingTopUps: { id: string; amount: number; createdAt: string }[]; transactions: LedgerRow[] }
interface Data { wallets: ChildWallet[]; online: { enabled: boolean; feePercent: number; feeFixed: number }; accounts: { label: string; accountNumber?: string | null; accountName?: string | null; kind?: string }[]; payoutMethods: string[] }
type Mode = { kind: 'topup' | 'transfer' | 'withdraw'; child: ChildWallet } | null

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

/** Parent portal wallets (phase B): each child's balance, top up (receipt or online), move between children, withdraw, show/hide for the child. */
export function ParentWalletCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['parent-wallet'], queryFn: () => fetchApi<Data>('/api/guardian-portal/wallet') })
  const [mode, setMode] = useState<Mode>(null)
  const [amount, setAmount] = useState('')
  const [way, setWay] = useState<'PROOF' | 'ONLINE'>('PROOF')
  const [file, setFile] = useState<File | null>(null)
  const [remarks, setRemarks] = useState('')
  const [toId, setToId] = useState('')
  const [payout, setPayout] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['parent-wallet'] })
  const close = () => { setMode(null); setAmount(''); setFile(null); setRemarks(''); setToId(''); setPayout('') }
  const fee = data && way === 'ONLINE' && Number(amount) > 0 ? Math.round(((Number(amount) * data.online.feePercent) / 100 + data.online.feeFixed) * 100) / 100 : 0

  const visibility = useMutation({
    mutationFn: ({ studentId, visible }: { studentId: string; visible: boolean }) => fetchApi('/api/guardian-portal/wallet/visibility', { method: 'PATCH', body: JSON.stringify({ studentId, visible }) }),
    onSuccess: () => { notify.success('Saved'); refresh() },
  })
  const send = useMutation({
    mutationFn: async () => {
      const c = mode!.child
      const n = Number(amount)
      if (mode!.kind === 'topup' && way === 'ONLINE') {
        return fetchApi<{ checkoutUrl: string }>('/api/guardian-portal/wallet/topups', { method: 'POST', body: JSON.stringify({ studentId: c.studentId, amount: n, mode: 'ONLINE' }) })
      }
      if (mode!.kind === 'topup') {
        const fd = new FormData()
        fd.append('studentId', c.studentId); fd.append('amount', String(n)); fd.append('file', file!); if (remarks) fd.append('remarks', remarks)
        const res = await fetch('/api/guardian-portal/wallet/topups', { method: 'POST', body: fd })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error?.message || 'Could not send the receipt')
        return body.data
      }
      if (mode!.kind === 'transfer') return fetchApi('/api/guardian-portal/wallet/transfer', { method: 'POST', body: JSON.stringify({ fromId: c.studentId, toId, amount: n }) })
      return fetchApi('/api/guardian-portal/wallet/withdrawals', { method: 'POST', body: JSON.stringify({ studentId: c.studentId, amount: n, payoutMethod: payout }) })
    },
    onSuccess: (r) => {
      const online = r as { checkoutUrl?: string }
      if (online?.checkoutUrl) { window.location.href = online.checkoutUrl; return }
      notify.success(mode?.kind === 'topup' ? 'Receipt sent — the wallet is topped up once it is checked' : mode?.kind === 'transfer' ? 'Moved' : 'Request sent — you will be notified')
      close(); refresh()
    },
    onError: (e: Error) => notify.error(e.message || 'Could not do it'),
  })

  if (!data?.wallets.length) return null
  const others = (c: ChildWallet) => data.wallets.filter((w) => w.studentId !== c.studentId)
  const valid = mode && Number(amount) > 0 && (
    mode.kind === 'topup' ? (way === 'ONLINE' || !!file) && Number(amount) + 0.001 >= mode.child.minimumTopUp
      : mode.kind === 'transfer' ? !!toId && Number(amount) <= mode.child.balance
        : !!payout && Number(amount) <= mode.child.balance
  )
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-indigo-600" /> Wallets</CardTitle>
        <CardDescription>Top up the wallet; it pays the invoices automatically, oldest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.wallets.map((c) => (
          <div key={c.studentId} className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{c.name}</span>
              <span className="font-mono text-base font-bold text-indigo-700">{money(c.balance)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => { setWay(data.online.enabled ? 'ONLINE' : 'PROOF'); setMode({ kind: 'topup', child: c }) }}><Plus className="h-3.5 w-3.5" /> Top up</Button>
              {others(c).length > 0 && c.balance > 0 && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode({ kind: 'transfer', child: c })}><ArrowRightLeft className="h-3.5 w-3.5" /> To another child</Button>}
              {c.withdrawalAllowed && c.balance > 0 && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode({ kind: 'withdraw', child: c })}><Undo2 className="h-3.5 w-3.5" /> Withdraw</Button>}
              <Link href={`/wallet-statement/${c.studentId}`} target="_blank"><Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"><FileText className="h-3.5 w-3.5" /> Statement</Button></Link>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={c.visibleToStudent} onChange={(e) => visibility.mutate({ studentId: c.studentId, visible: e.target.checked })} />
              {c.name.split(' ')[0]} can see this wallet in their own portal
            </label>
            {c.pendingTopUps.map((t) => <p key={t.id} className="text-xs text-amber-700">Top-up of {money(t.amount)} waiting to be checked.</p>)}
            <WalletLedger rows={c.transactions} max={6} />
          </div>
        ))}
      </CardContent>

      <Dialog open={!!mode} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode?.kind === 'topup' ? `Top up ${mode.child.name}` : mode?.kind === 'transfer' ? 'Move to another child' : 'Ask for money back'}</DialogTitle>
            <DialogDescription>
              {mode?.kind === 'topup' && (mode.child.minimumTopUp ? `Minimum ${money(mode.child.minimumTopUp)}.` : 'Any amount.')}
              {mode?.kind === 'transfer' && `Balance ${money(mode.child.balance)}.`}
              {mode?.kind === 'withdraw' && 'Needs approval. A fee may apply depending on how the money goes back.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1"><Label>Amount (EGP)</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            {mode?.kind === 'topup' && (
              <>
                <div className="flex gap-2">
                  {data.online.enabled && <button type="button" onClick={() => setWay('ONLINE')} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${way === 'ONLINE' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>Card / wallet (online)</button>}
                  <button type="button" onClick={() => setWay('PROOF')} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${way === 'PROOF' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>Transfer + upload the receipt</button>
                </div>
                {way === 'ONLINE' && Number(amount) > 0 && <p className="rounded bg-slate-50 px-2 py-1 text-xs">You pay {money(Number(amount) + fee)} ({money(Number(amount))} + online fee {money(fee)}); the wallet gets {money(Number(amount))}.</p>}
                {way === 'PROOF' && (
                  <>
                    {data.accounts.length > 0 && (
                      <div className="rounded bg-slate-50 px-2 py-1 text-xs">
                        <p className="font-semibold">Send the money to:</p>
                        {data.accounts.map((a, i) => <p key={i}>{a.label}{a.accountNumber ? ` · ${a.accountNumber}` : ''}{a.accountName ? ` · ${a.accountName}` : ''}</p>)}
                      </div>
                    )}
                    <div className="space-y-1"><Label>Transfer receipt (photo or PDF)</Label><Input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
                    <div className="space-y-1"><Label>Note (optional)</Label><Input value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
                  </>
                )}
              </>
            )}
            {mode?.kind === 'transfer' && (
              <div className="space-y-1">
                <Label>To</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{others(mode.child).map((w) => <SelectItem key={w.studentId} value={w.studentId}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {mode?.kind === 'withdraw' && (
              <div className="space-y-1">
                <Label>Money goes back by</Label>
                <Select value={payout} onValueChange={setPayout}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{data.payoutMethods.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button disabled={!valid || send.isPending} onClick={() => send.mutate()}>{mode?.kind === 'topup' && way === 'ONLINE' ? 'Pay online' : 'Send'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
