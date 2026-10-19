'use client'

/** 2026-10-19 the digital ID card in the portal (parent: a child's card; student: own card). Hidden when switched off. */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { CardBack, CardFront, type IdCardData } from './IdCard'

export function PortalIdCard({ studentId }: { studentId?: string }) {
  useI18n()
  const { data } = useQuery({
    queryKey: ['portal-id-card', studentId ?? 'me'],
    queryFn: () => fetchApi<IdCardData | null>(`/api/cards/portal${studentId ? `?studentId=${studentId}` : ''}`),
    staleTime: 300_000,
  })
  if (!data) return null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="font-semibold text-slate-900">{L('ID card', 'الكارنيه')}</h3>
        <div className="flex flex-wrap gap-3">
          <CardFront c={data} />
          <CardBack c={data} origin={origin} />
        </div>
        <p className="text-xs text-slate-500">{L('Show it at the door or for attendance. If the card is lost, tell the branch: a new one is made and the old one stops working.', 'اعرضه على الباب أو في الحضور. لو الكارنيه ضاع بلّغ الفرع: هيتعمل واحد جديد والقديم يبطل يشتغل.')}</p>
      </CardContent>
    </Card>
  )
}
