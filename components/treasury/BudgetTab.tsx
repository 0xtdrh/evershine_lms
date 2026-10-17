'use client'

/** FIN-2: monthly budget per expense category (company or one branch) vs what was actually spent. */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { Loader2 } from 'lucide-react'

interface Row { categoryId: string; nameEn: string; nameAr: string; budget: number; actual: number; pct: number | null; status: 'OK' | 'NEAR' | 'OVER' | 'NO_BUDGET' | 'NONE' }
interface Data { rows: Row[]; totals: { budget: number; actual: number } }

const TONE: Record<Row['status'], string> = { OK: 'bg-emerald-500', NEAR: 'bg-amber-500', OVER: 'bg-rose-600', NO_BUDGET: 'bg-slate-300', NONE: 'bg-slate-200' }

export function BudgetTab({ campuses, allPlaces, canEdit }: { campuses: { id: string; name: string }[]; allPlaces: boolean; canEdit: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const now = new Date()
  const [ym, setYm] = useState(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
  const [campusId, setCampusId] = useState(allPlaces ? '' : campuses[0]?.id ?? '')
  const [year, month] = ym.split('-').map(Number)
  const { data, isLoading } = useQuery({ queryKey: ['budget', ym, campusId], queryFn: () => fetchApi<Data>(`/api/budgets?year=${year}&month=${month}${campusId ? `&campusId=${campusId}` : ''}`) })
  const save = useMutation({
    mutationFn: (v: { categoryId: string; amount: number }) => fetchApi('/api/budgets', { method: 'PUT', body: JSON.stringify({ year, month, campusId: campusId || null, ...v }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['budget'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${ar ? 'ج.م' : 'EGP'}`
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" className="h-9 w-44" value={ym} onChange={(e) => setYm(e.target.value)} />
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={campusId} onChange={(e) => setCampusId(e.target.value)}>
          {allPlaces && <option value="">{L('Whole company', 'الشركة كلها')}</option>}
          {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {data && <span className="text-slate-600">{L('Total', 'الإجمالي')}: {money(data.totals.actual)} / {money(data.totals.budget)}</span>}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="p-2 text-start">{L('Category', 'البند')}</th><th className="p-2 text-start">{L('Budget', 'الميزانية')}</th>
              <th className="p-2 text-start">{L('Spent', 'اتصرف')}</th><th className="p-2 text-start">%</th>
            </tr></thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.categoryId} className="border-t">
                  <td className="p-2 font-medium">{ar ? r.nameAr : r.nameEn}</td>
                  <td className="p-2">{canEdit
                    ? <Input key={`${ym}-${campusId}-${r.categoryId}-${r.budget}`} type="number" min={0} className="h-8 w-28" defaultValue={r.budget || ''} placeholder="—" onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== r.budget) save.mutate({ categoryId: r.categoryId, amount: v }) }} />
                    : r.budget ? money(r.budget) : '—'}</td>
                  <td className="p-2">{money(r.actual)}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded bg-slate-100"><div className={`h-2 ${TONE[r.status]}`} style={{ width: `${Math.min(100, r.pct ?? (r.actual > 0 ? 100 : 0))}%` }} /></div>
                      <span className={r.status === 'OVER' ? 'font-bold text-rose-700' : r.status === 'NEAR' ? 'text-amber-700' : 'text-slate-500'}>{r.pct === null ? (r.actual > 0 ? L('no budget', 'مالوش ميزانية') : '') : `${r.pct}%`}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
