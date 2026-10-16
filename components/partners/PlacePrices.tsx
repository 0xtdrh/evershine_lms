'use client'

/** Partners part 1: special prices of one place per level (empty = the normal level price). New invoices use them. */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'

interface Row {
  levelId: string; level: string; course: string; track: string; pricingType: string
  normal: { monthlyPrice: number | null; fullLevelPrice: number | null }
  place: { monthlyPrice: number | null; fullLevelPrice: number | null } | null
}

export function PlacePrices({ campusId, canEdit }: { campusId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['place-prices', campusId], queryFn: () => fetchApi<Row[]>(`/api/places/${campusId}/prices`) })
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    const v: Record<string, string> = {}
    for (const r of rows) {
      const p = r.place ? (r.pricingType === 'MONTHLY' ? r.place.monthlyPrice : r.place.fullLevelPrice) : null
      v[r.levelId] = p === null || p === undefined ? '' : String(p)
    }
    setVals(v)
  }, [rows])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/places/${campusId}/prices`, {
      method: 'PUT',
      body: JSON.stringify({ items: rows.map((r) => {
        const n = vals[r.levelId]?.trim() ? Number(vals[r.levelId]) : null
        return r.pricingType === 'MONTHLY' ? { levelId: r.levelId, monthlyPrice: n, fullLevelPrice: null } : { levelId: r.levelId, monthlyPrice: null, fullLevelPrice: n }
      }) }),
    }),
    onSuccess: () => { notify.success(L('Prices saved — new invoices use them', 'الأسعار اتحفظت — الفواتير الجديدة هتستخدمها')); qc.invalidateQueries({ queryKey: ['place-prices', campusId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (!rows.length) return <p className="text-xs text-slate-500">{L('No levels yet.', 'لسه مفيش مستويات.')}</p>
  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-500">{L('Leave empty to use the normal price. A group can still have its own price (group page).', 'سيبها فاضية عشان السعر العادي يتطبق. الجروب ممكن يبقى ليه سعر خاص بيه برضه (صفحة الجروب).')}</p>
      <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2 text-start">{L('Level', 'المستوى')}</th><th className="p-2 text-start">{L('Normal', 'العادي')}</th><th className="p-2 text-start">{L('This place', 'المكان ده')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const normal = r.pricingType === 'MONTHLY' ? r.normal.monthlyPrice : r.normal.fullLevelPrice
              return (
                <tr key={r.levelId} className="border-t border-slate-100">
                  <td className="p-2">{r.track ? `${r.track} › ` : ''}{r.course} › {r.level}</td>
                  <td className="p-2 text-slate-500">{normal ?? '-'} {r.pricingType === 'MONTHLY' ? L('/ month', '/ شهر') : L('/ level', '/ مستوى')}</td>
                  <td className="p-2"><Input type="number" min={0} disabled={!canEdit} className="h-8 w-28" value={vals[r.levelId] ?? ''} onChange={(e) => setVals({ ...vals, [r.levelId]: e.target.value })} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canEdit && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save prices', 'احفظ الأسعار')}</Button>}
    </div>
  )
}
