'use client'

import { L, useI18n } from '@/lib/i18n/client'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'

interface Attempt {
  id: string
  status: string
  amount: number
  note: string | null
  providerTxnId: string | null
  createdAt: string
  invoice: { challanNumber: string; student: { firstName: string; lastName: string } } | null
}

/** Online payment (Paymob) status + payments that need a staff check. */
export function OnlinePaymentsCard({ connected }: { connected: boolean }) {
  useI18n() // follow the screen language
  const { data } = useQuery({
    queryKey: ['online-payments', 'REVIEW'],
    queryFn: () => fetchApi<Attempt[]>('/api/online-payments?status=REVIEW'),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4" /> {L('Online payment (cards / wallets)', 'الدفع الأونلاين (كروت / محافظ)')}</CardTitle>
        <CardDescription>
          {connected
            ? L('Connected to Paymob: parents see “Pay online” on their invoices; payments are recorded automatically with a receipt.', 'متوصل بـ Paymob: الأهالي بيشوفوا «ادفع أونلاين» على فواتيرهم، والدفعة بتتسجل لوحدها بإيصال.')
            : L('Not connected yet. When you have a Paymob account, the keys are added on the host and the “Pay online” button appears for parents.', 'لسه مش متوصل. لما يبقى عندكم حساب Paymob، المفاتيح بتتحط على السيرفر وزرار «ادفع أونلاين» يظهر للأهالي.')}
        </CardDescription>
      </CardHeader>
      {(data?.length ?? 0) > 0 && (
        <CardContent className="space-y-2">
          <p className="text-sm font-semibold text-amber-700">{L('Need a check (money received but not applied):', 'محتاجة مراجعة (فلوس وصلت ومااتسجلتش على فاتورة):')}</p>
          {data!.map((a) => (
            <div key={a.id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              {a.invoice ? `${a.invoice.student.firstName} ${a.invoice.student.lastName} · ${a.invoice.challanNumber}` : a.id} · {a.amount.toLocaleString()} {L('EGP', 'ج.م')}
              <div className="text-xs text-amber-800">{a.note}{a.providerTxnId ? ` · Paymob transaction ${a.providerTxnId}` : ''}</div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
