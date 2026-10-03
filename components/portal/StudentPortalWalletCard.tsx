'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { WalletLedger, type LedgerRow } from '@/components/wallet/WalletLedger'
import { Wallet } from 'lucide-react'

/** The student's own wallet (read only), when the parent allows it (phase B). */
export function StudentPortalWalletCard() {
  const { data: session } = useSession()
  const { data } = useQuery({
    queryKey: ['student-portal-wallet'],
    queryFn: () => fetchApi<{ hidden: boolean; studentId?: string; balance?: number; transactions?: LedgerRow[] }>('/api/student-portal/wallet'),
    enabled: session?.user?.role === 'STUDENT',
  })
  if (session?.user?.role !== 'STUDENT' || !data || data.hidden) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> My wallet</span>
          <span className="font-mono text-base">{(data.balance ?? 0).toLocaleString()} EGP</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <WalletLedger rows={data.transactions ?? []} max={6} />
        <Link href={`/wallet-statement/${data.studentId}`} target="_blank" className="text-xs text-indigo-600 underline">Statement</Link>
      </CardContent>
    </Card>
  )
}
