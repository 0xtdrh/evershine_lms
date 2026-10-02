'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { CreditCard, Loader2 } from 'lucide-react'

/**
 * "Pay online" (card / wallet through Paymob) for the remaining balance.
 * Hidden until online payment is connected (Paymob keys on the host).
 */
export function PayOnlineButton({ invoiceId, className = '' }: { invoiceId: string; className?: string }) {
  const { data } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => fetchApi<{ onlinePayment?: boolean }>('/api/payment-accounts'),
    staleTime: 60_000,
  })
  const start = useMutation({
    mutationFn: () => fetchApi<{ checkoutUrl: string }>(`/api/fees/${invoiceId}/pay-online`, { method: 'POST', body: '{}' }),
    onSuccess: (r) => { window.location.href = r.checkoutUrl },
    onError: (err: Error) => notify.error(err.message || 'Could not start the online payment'),
  })
  if (!data?.onlinePayment) return null
  return (
    <Button onClick={() => start.mutate()} disabled={start.isPending} className={`h-9 gap-2 bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 ${className}`}>
      {start.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
      Pay online
    </Button>
  )
}
