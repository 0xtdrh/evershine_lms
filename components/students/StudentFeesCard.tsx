'use client'

/** FIN-2 (student page): the extra fees charged to this student, and "add a fee" (an optional fee, a kit, a certificate…). */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { Receipt } from 'lucide-react'

interface Charge { id: string; amount: number; periodKey: string; createdAt: string; fee: { nameEn: string; nameAr: string } | null; invoice: { id: string; challanNumber: string; status: string } | null }
interface FeeType { id: string; nameEn: string; nameAr: string; amount: number; isActive: boolean }

export function StudentFeesCard({ studentId }: { studentId: string }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { can } = useMyPermissions()
  const { data } = useQuery({ queryKey: ['student-fees', studentId], queryFn: () => fetchApi<Charge[]>(`/api/students/${studentId}/fees`), retry: false })
  const { data: types } = useQuery({ queryKey: ['fee-types'], queryFn: () => fetchApi<FeeType[]>('/api/fee-types'), enabled: can('fees', 'create') })
  const [pick, setPick] = useState('')
  const add = useMutation({
    mutationFn: () => fetchApi(`/api/students/${studentId}/fees`, { method: 'POST', body: JSON.stringify({ feeTypeId: pick }) }),
    onSuccess: () => { notify.success(L('Fee added (its own invoice)', 'الرسم اتضاف (في فاتورة لوحده)')); setPick(''); qc.invalidateQueries({ queryKey: ['student-fees', studentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const active = (types ?? []).filter((t) => t.isActive)
  if (!data?.length && !active.length) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4 text-indigo-600" />{L('Extra fees', 'الرسوم الإضافية')}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {(data ?? []).map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1.5 text-xs">
            <span>{c.fee ? (ar ? c.fee.nameAr : c.fee.nameEn) : '—'} · {c.amount.toLocaleString()} {L('EGP', 'ج.م')}</span>
            {c.invoice && <Link href={`/dashboard/fees/${c.invoice.id}`} className={c.invoice.status === 'PAID' ? 'text-emerald-700' : 'text-amber-700'}>{c.invoice.challanNumber} · {c.invoice.status === 'PAID' ? L('paid', 'مدفوعة') : L('not paid', 'مش مدفوعة')}</Link>}
          </div>
        ))}
        {can('fees', 'create') && active.length > 0 && (
          <div className="flex gap-2">
            <select className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{L('Add a fee…', 'إضافة رسم…')}</option>
              {active.map((t) => <option key={t.id} value={t.id}>{ar ? t.nameAr : t.nameEn} · {t.amount} {L('EGP', 'ج.م')}</option>)}
            </select>
            <Button size="sm" className="h-8" disabled={!pick || add.isPending} onClick={() => add.mutate()}>{L('Add', 'إضافة')}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
