'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PaymentMethodSelect } from '@/components/fees/PaymentMethodSelect'
import { Loader2 } from 'lucide-react'

interface Suggestion {
  allowed: boolean
  netPaid: number
  perSession: number
  sessionsCounted: number
  sessionsInCycle: number | null
  basis: 'ATTENDED' | 'HELD'
  deduction: number
  adminFee: number
  suggested: number
  pending: number
  maxRefundable: number
}

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`

/** Refund for one invoice: the system suggests the amount, staff confirm. */
export function RefundDialog({ invoiceId, open, onOpenChange }: { invoiceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { data: s, isLoading } = useQuery({
    queryKey: ['refund-suggest', invoiceId],
    queryFn: () => fetchApi<Suggestion>(`/api/refunds/suggest?invoiceId=${invoiceId}`),
    enabled: open,
  })
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'WALLET'>('WALLET')
  const [payout, setPayout] = useState('Cash')
  const [withdraw, setWithdraw] = useState(true)
  const [reason, setReason] = useState('')
  useEffect(() => { if (s) setAmount(String(s.suggested)) }, [s])

  const send = useMutation({
    mutationFn: () =>
      fetchApi<{ refundId: string; status: string; refundNumber: string | null }>('/api/refunds', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId,
          amount: Number(amount),
          method,
          payoutMethod: method === 'CASH' ? payout : null,
          reason: reason.trim() || null,
          withdrawStudent: withdraw,
        }),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries()
      onOpenChange(false)
      if (r.status === 'APPROVED') {
        notify.success(`Refund ${r.refundNumber} done`)
        router.push(`/refunds/${r.refundId}`)
      } else {
        notify.success('Refund sent for approval')
      }
    },
    onError: (err: Error) => notify.error(err.message || 'Could not create the refund'),
  })

  const n = Number(amount)
  const valid = s?.allowed && n > 0 && n <= (s?.maxRefundable ?? 0) && (method === 'WALLET' || !!payout)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Refund</DialogTitle>
          <DialogDescription>Money back, or credit in the student&apos;s wallet for the next invoices.</DialogDescription>
        </DialogHeader>
        {isLoading || !s ? (
          <p className="text-sm text-muted-foreground">Calculating…</p>
        ) : !s.allowed ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Refunds are not allowed for this group (Refunds › Rules).
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3">
              <div className="flex justify-between"><span>Paid on this invoice</span><span className="font-mono">{money(s.netPaid)}</span></div>
              <div className="flex justify-between">
                <span>
                  {s.sessionsCounted} session(s) {s.basis === 'HELD' ? 'held' : 'attended'}
                  {s.sessionsInCycle ? ` × ${money(s.perSession)}` : ''}
                </span>
                <span className="font-mono">- {money(s.deduction)}</span>
              </div>
              <div className="flex justify-between"><span>Admin fee</span><span className="font-mono">- {money(s.adminFee)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Suggested</span><span className="font-mono">{money(s.suggested)}</span></div>
              {s.pending > 0 && <p className="text-xs text-amber-700">{money(s.pending)} already waiting for approval on this invoice.</p>}
            </div>
            <div className="space-y-1">
              <Label>Amount to refund (max {money(s.maxRefundable)})</Label>
              <Input type="number" min={0} max={s.maxRefundable} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>How</Label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2"><input type="radio" checked={method === 'WALLET'} onChange={() => setMethod('WALLET')} /> Credit in the student wallet</label>
                <label className="flex items-center gap-2"><input type="radio" checked={method === 'CASH'} onChange={() => setMethod('CASH')} /> Give the money back</label>
              </div>
            </div>
            {method === 'CASH' && (
              <div className="space-y-1">
                <Label>Given back by</Label>
                <PaymentMethodSelect value={payout} onValueChange={setPayout} />
              </div>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} />
              Also remove the student from this group
            </label>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => send.mutate()} disabled={!valid || send.isPending}>
                {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Refund {n > 0 ? money(n) : ''}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
