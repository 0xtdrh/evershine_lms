'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Undo2, Wallet } from 'lucide-react'
import { RefundDialog } from './RefundDialog'
import { useAfterPayment } from '@/lib/fees/use-after-payment'

/** "Pay from wallet" and "Refund" buttons for one invoice (shown only to staff allowed to). */
export function InvoiceMoneyActions({
  invoiceId,
  studentId,
  status,
  paidAmount,
  refundedAmount,
}: {
  invoiceId: string
  studentId: string
  status: string
  paidAmount: number
  refundedAmount: number
}) {
  const { data: session, status: authStatus } = useSession()
  const role = session?.user?.role
  const qc = useQueryClient()
  const afterPayment = useAfterPayment()
  const [refundOpen, setRefundOpen] = useState(false)
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: authStatus === 'authenticated' && !!role,
  })
  const p = perms?.permissions ?? {}
  const isPortal = ['STUDENT', 'PARENT', 'GUARDIAN'].includes(String(role))
  const canRefund = !isPortal && (!!p.refunds?.includes('create') || !!p.refunds?.includes('approve'))
  const canPay = !isPortal && (!!p.fees?.includes('update') || !!p.fee_collection?.includes('create'))
  const unpaid = status !== 'PAID' && status !== 'CANCELLED'

  const { data: wallet } = useQuery({
    queryKey: ['wallet', studentId],
    queryFn: () => fetchApi<{ balance: number }>(`/api/students/${studentId}/wallet`),
    enabled: canPay && unpaid,
  })
  const pay = useMutation({
    mutationFn: () => fetchApi<{ id: string; receiptNumber: string; amount: number }>(`/api/fees/${invoiceId}/pay-from-wallet`, { method: 'POST', body: '{}' }),
    onSuccess: (r) => {
      notify.success(`Paid ${r.amount} EGP from the wallet`)
      qc.invalidateQueries()
      afterPayment(r.id, r.receiptNumber)
    },
    onError: (err: Error) => notify.error(err.message || 'Could not pay from the wallet'),
  })

  const netPaid = paidAmount - refundedAmount
  return (
    <>
      {canPay && unpaid && (wallet?.balance ?? 0) > 0 && (
        <Button onClick={() => pay.mutate()} disabled={pay.isPending} variant="outline" className="h-9 gap-2 border-emerald-300 text-xs font-bold text-emerald-700">
          <Wallet className="h-3.5 w-3.5" /> Pay from wallet ({wallet!.balance.toLocaleString()} EGP)
        </Button>
      )}
      {canRefund && netPaid > 0 && (
        <Button onClick={() => setRefundOpen(true)} variant="outline" className="h-9 gap-2 border-rose-300 text-xs font-bold text-rose-700">
          <Undo2 className="h-3.5 w-3.5" /> Refund
        </Button>
      )}
      {refundOpen && <RefundDialog invoiceId={invoiceId} open={refundOpen} onOpenChange={setRefundOpen} />}
    </>
  )
}
