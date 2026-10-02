'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { paymentDetailsRowsFromSnapshot } from '@/lib/fees/payment-details'

/** "Send the money to…" box from Settings > Payments (parents and staff). */
export function PaymentAccountsList({ className = '' }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => fetchApi<{ snapshot: string | null }>('/api/payment-accounts'),
    staleTime: 60_000,
  })
  if (isLoading) return null
  const rows = paymentDetailsRowsFromSnapshot(data?.snapshot)
  return (
    <div className={`rounded-lg border border-blue-100 bg-blue-50 p-3 ${className}`}>
      <p className="mb-2 text-sm font-semibold text-blue-900">Send the money to</p>
      {rows.length === 0 ? (
        <p className="text-sm text-blue-900">Please pay at the branch.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={`${r.label}-${r.value}`} className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-slate-600">{r.label}</span>
              <span dir="auto" className="select-all font-mono font-semibold text-slate-900">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
