'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'

/**
 * What to do after staff record a payment (Settings > Payments):
 * open the receipt, open it and print, or just show a link.
 */
export function useAfterPayment() {
  const router = useRouter()
  const { data } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => fetchApi<{ receiptAfterPayment?: 'OPEN' | 'PRINT' | 'NONE' }>('/api/payment-accounts'),
    staleTime: 60_000,
  })
  return (paymentId: string | undefined | null, receiptNumber?: string | null) => {
    if (!paymentId) return
    const mode = data?.receiptAfterPayment ?? 'OPEN'
    if (mode === 'NONE') {
      notify.success(`Receipt ${receiptNumber ?? ''} ready`, {
        action: { label: 'Open', onClick: () => router.push(`/receipts/${paymentId}`) },
      } as never)
      return
    }
    router.push(`/receipts/${paymentId}${mode === 'PRINT' ? '?print=1' : ''}`)
  }
}
