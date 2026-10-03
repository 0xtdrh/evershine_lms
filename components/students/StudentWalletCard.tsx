'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaymentMethodSelect } from '@/components/fees/PaymentMethodSelect'
import { WalletLedger, type LedgerRow } from '@/components/wallet/WalletLedger'
import { Wallet, Plus, ArrowRightLeft, Undo2, FileText } from 'lucide-react'

interface WalletData {
  balance: number
  transactions: LedgerRow[]
  siblings?: { id: string; name: string }[]
  minimumTopUp?: number
  withdrawalAllowed?: boolean
  pendingTopUps?: number
  pendingWithdrawals?: { id: string; amount: number; payoutMethod: string; createdAt: string }[]
}

type Mode = 'topup' | 'transfer' | 'withdraw' | null

/** Student wallet (phase B): every payment passes through it; staff top up, move to a sibling, ask for a withdrawal. */
export function StudentWalletCard({ studentId }: { studentId: string }) {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canTopUp = !!perms?.permissions?.wallet?.includes('create')
  const { data, error } = useQuery({
    queryKey: ['wallet', studentId],
    queryFn: () => fetchApi<WalletData>(`/api/students/${studentId}/wallet`),
    retry: false,
  })
  const [mode, setMode] = useState<Mode>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Cash')
  const [ref, setRef] = useState('')
  const [toId, setToId] = useState('')
  const refresh = () => { for (const k of ['wallet', 'student-fees', 'student', 'fees']) qc.invalidateQueries({ queryKey: [k] }) }
  const close = () => { setMode(null); setAmount(''); setRef(''); setToId('') }

  const send = useMutation({
    mutationFn: async () => {
      const n = Number(amount)
      if (mode === 'topup') return fetchApi<{ topUpId: string; topUpNumber: string; payments: unknown[]; bonus: number | null }>('/api/wallet/topups', { method: 'POST', body: JSON.stringify({ studentId, amount: n, method, transactionId: ref.trim() || null }) })
      if (mode === 'transfer') return fetchApi(`/api/students/${studentId}/wallet/transfer`, { method: 'POST', body: JSON.stringify({ toStudentId: toId, amount: n }) })
      return fetchApi('/api/wallet/withdrawals', { method: 'POST', body: JSON.stringify({ studentId, amount: n, payoutMethod: method }) })
    },
    onSuccess: (r) => {
      const t = r as { topUpId?: string; topUpNumber?: string; payments?: unknown[]; bonus?: number | null }
      if (mode === 'topup') {
        notify.success(`Topped up (${t.topUpNumber})${t.payments?.length ? ` · ${t.payments.length} invoice(s) paid` : ''}${t.bonus ? ` · bonus ${t.bonus} EGP on the next invoice` : ''}`)
        if (t.topUpId) window.open(`/topups/${t.topUpId}`, '_blank')
      } else notify.success(mode === 'transfer' ? 'Moved to the sibling' : 'Withdrawal requested — waiting for approval')
      close(); refresh()
    },
    onError: (e: Error) => notify.error(e.message || 'Could not do it'),
  })

  if (error || !data) return null
  const title = mode === 'topup' ? 'Top up the wallet' : mode === 'transfer' ? 'Move to a sibling' : 'Ask for a withdrawal'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Wallet</span>
          <span className="font-mono text-base">{data.balance.toLocaleString()} EGP</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canTopUp && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setMode('topup')}><Plus className="h-3.5 w-3.5" /> Top up</Button>
            {(data.siblings?.length ?? 0) > 0 && data.balance > 0 && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode('transfer')}><ArrowRightLeft className="h-3.5 w-3.5" /> To a sibling</Button>}
            {data.withdrawalAllowed && data.balance > 0 && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode('withdraw')}><Undo2 className="h-3.5 w-3.5" /> Withdraw</Button>}
            <Link href={`/wallet-statement/${studentId}`} target="_blank"><Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"><FileText className="h-3.5 w-3.5" /> Statement</Button></Link>
          </div>
        )}
        {(data.pendingTopUps ?? 0) > 0 && <p className="text-xs text-amber-700">{data.pendingTopUps} uploaded top-up(s) waiting for approval (Wallet page).</p>}
        {(data.pendingWithdrawals ?? []).map((w) => <p key={w.id} className="text-xs text-amber-700">Withdrawal of {w.amount} EGP by {w.payoutMethod} waiting for approval.</p>)}
        <WalletLedger rows={data.transactions} />
      </CardContent>

      <Dialog open={!!mode} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === 'topup' && `The wallet then pays open invoices automatically, oldest first.${data.minimumTopUp ? ` Minimum ${data.minimumTopUp} EGP.` : ''}`}
              {mode === 'transfer' && `Balance ${data.balance} EGP.`}
              {mode === 'withdraw' && 'Needs approval. The fee depends on how the money goes back.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1"><Label>Amount (EGP)</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            {(mode === 'topup' || mode === 'withdraw') && (
              <div className="space-y-1"><Label>{mode === 'topup' ? 'Paid by' : 'Money goes back by'}</Label><PaymentMethodSelect value={method} onValueChange={setMethod} /></div>
            )}
            {mode === 'topup' && <div className="space-y-1"><Label>Transaction no. (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>}
            {mode === 'transfer' && (
              <div className="space-y-1">
                <Label>To</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue placeholder="Choose the sibling" /></SelectTrigger>
                  <SelectContent>{(data.siblings ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button disabled={!(Number(amount) > 0) || (mode === 'transfer' && !toId) || send.isPending} onClick={() => send.mutate()}>Confirm</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
