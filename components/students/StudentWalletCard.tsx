'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Wallet } from 'lucide-react'

interface WalletData {
  balance: number
  transactions: { id: string; amount: number; type: string; note: string | null; createdAt: string }[]
}

/** Student wallet: credit from refunds, spent on invoices ("Pay from wallet" on an invoice). */
export function StudentWalletCard({ studentId }: { studentId: string }) {
  const { data, error } = useQuery({
    queryKey: ['wallet', studentId],
    queryFn: () => fetchApi<WalletData>(`/api/students/${studentId}/wallet`),
    retry: false,
  })
  if (error || !data) return null
  if (data.balance === 0 && data.transactions.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Wallet</span>
          <span className="font-mono text-base">{data.balance.toLocaleString()} EGP</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.transactions.slice(0, 8).map((t) => (
          <div key={t.id} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{new Date(t.createdAt).toLocaleDateString('en-GB')} · {t.note ?? t.type}</span>
            <span className={`font-mono ${t.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
