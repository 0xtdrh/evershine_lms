'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { paymentDetailsRowsFromSnapshot } from '@/lib/fees/payment-details'
import { L, useI18n } from '@/lib/i18n/client'
import { notify } from '@/lib/notify'

/** "Send the money to…" box from Settings > Payments (parents and staff). */
export function PaymentAccountsList({ className = '' }: { className?: string }) {
  useI18n() // final test 14/11: was English only
  const { data, isLoading } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => fetchApi<{ snapshot: string | null }>('/api/payment-accounts'),
    staleTime: 60_000,
  })
  if (isLoading) return null
  const rows = paymentDetailsRowsFromSnapshot(data?.snapshot)
  return (
    <div className={`rounded-lg border border-blue-100 bg-blue-50 p-3 ${className}`}>
      <p className="mb-2 text-sm font-semibold text-blue-900">{L('Send the money to', 'حوّل الفلوس على')}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-blue-900">{L('Please pay at the branch, or call the branch for the transfer details.', 'ادفع في الفرع، أو كلّم الفرع ياخدك بيانات التحويل.')}</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={`${r.label}-${r.value}`} className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-slate-600">{r.label}</span>
              <span className="flex items-center gap-2">
                <span dir="auto" className="select-all font-mono font-semibold text-slate-900">{r.value}</span>
                <button type="button" className="rounded border border-blue-200 bg-white px-1.5 text-xs text-blue-700" onClick={() => { void navigator.clipboard?.writeText(r.value).then(() => notify.success(L('Copied', 'اتنسخ'))).catch(() => undefined) }}>{L('Copy', 'انسخ')}</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
