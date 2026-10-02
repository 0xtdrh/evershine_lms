'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** Payment methods from Settings > Payments (Cash, InstaPay, Vodafone Cash...). */
export function PaymentMethodSelect({ value, onValueChange }: { value: string; onValueChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => fetchApi<{ name: string }[]>('/api/payment-methods'),
    staleTime: 60_000,
  })
  const methods = data?.length ? data : [{ name: 'Cash' }]
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {methods.map((m) => (
          <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
