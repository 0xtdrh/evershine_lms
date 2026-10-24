'use client'

/**
 * Partners part 1: a group's price (own price → place price → level price) and "class without names" (e.g. a nursery
 * class): number of children + recording each session as held / cancelled by the partner.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BadgeDollarSign, Baby, Loader2, Trash2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { cairoToday } from '@/lib/dates/cairo'

interface Log { id: string; sessionDate: string; status: string; headcount: number | null; note: string | null }

const STATUS: Record<string, [string, string, string]> = {
  HELD: ['Held', 'اتعملت', 'bg-emerald-50 text-emerald-700'],
  CANCELLED_PARTNER: ['Cancelled by the partner', 'لغاها الشريك', 'bg-amber-50 text-amber-700'],
  CANCELLED_TECHNOVA: ['Cancelled by TechNova', 'لغتها TechNova', 'bg-slate-100 text-slate-600'],
}

export function GroupPricePanel({ groupId, priceOverride, effectivePrice, unnamedHeadcount, canEditGroup, canEditPrice, canRecord }: {
  groupId: string; priceOverride: number | null; effectivePrice: number | null; unnamedHeadcount: number | null
  canEditGroup: boolean; canEditPrice: boolean; canRecord: boolean
}) {
  const qc = useQueryClient()
  const [price, setPrice] = useState(priceOverride === null ? '' : String(priceOverride))
  const [unnamed, setUnnamed] = useState(unnamedHeadcount !== null)
  const [kids, setKids] = useState(unnamedHeadcount === null ? '' : String(unnamedHeadcount))
  const [log, setLog] = useState({ date: cairoToday(), status: 'HELD', headcount: '', note: '' })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['group-detail'] }); qc.invalidateQueries({ queryKey: ['groups'] }); qc.invalidateQueries({ queryKey: ['group-sessions', groupId] }) }
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchApi(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const { data: logs = [] } = useQuery({ queryKey: ['group-sessions', groupId], queryFn: () => fetchApi<Log[]>(`/api/groups/${groupId}/sessions`), enabled: canRecord })
  const add = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/sessions`, { method: 'POST', body: JSON.stringify({ date: log.date, status: log.status, headcount: log.headcount ? Number(log.headcount) : null, note: log.note || null }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/groups/${groupId}/sessions?logId=${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeDollarSign className="h-4 w-4 text-indigo-600" />
        <span className="font-medium">{L('Price of a cycle', 'سعر الدورة')}:</span>
        <span>{effectivePrice === null ? '-' : `${effectivePrice} EGP`}</span>
        <span className="text-xs text-slate-500">{priceOverride !== null ? L('(this group’s own price)', '(سعر خاص بالجروب)') : L('(place / level price)', '(سعر المكان / المستوى)')}</span>
        {canEditPrice && (
          <span className="ms-auto flex items-center gap-1">
            <Input type="number" min={0} className="h-8 w-28" placeholder={L('Own price', 'سعر خاص')} value={price} onChange={(e) => setPrice(e.target.value)} />
            <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ priceOverride: price.trim() ? Number(price) : null })}>{L('Save', 'احفظ')}</Button>
          </span>
        )}
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Baby className="h-4 w-4 text-indigo-600" />
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canEditGroup} checked={unnamed} onChange={(e) => setUnnamed(e.target.checked)} />
            {L('Class without names (e.g. a nursery class)', 'فصل من غير أسماء (زي فصل حضانة)')}
          </label>
          {unnamed && <Input type="number" min={1} disabled={!canEditGroup} className="h-8 w-24" placeholder={L('Children', 'عدد الأطفال')} value={kids} onChange={(e) => setKids(e.target.value)} />}
          {canEditGroup && (unnamed !== (unnamedHeadcount !== null) || (unnamed && kids !== String(unnamedHeadcount ?? ''))) && (
            <Button size="sm" variant="outline" disabled={patch.isPending || (unnamed && !Number(kids))} onClick={() => patch.mutate({ unnamedHeadcount: unnamed ? Number(kids) : null })}>{L('Save', 'احفظ')}</Button>
          )}
        </div>
        <p className="text-xs text-slate-500">{unnamedHeadcount !== null
          ? L('Record each session below (no attendance per child). Sessions count for the calendar, instructor pay and the partner statement.', 'سجّل كل حصة تحت (من غير حضور لكل طفل). الحصص بتتحسب في الجدول وأجر المدرب وكشف حساب الشريك.')
          : L('Named group: sessions come from attendance. You can still record a session the partner cancelled.', 'جروب بأسماء: الحصص بتيجي من الحضور. وتقدر تسجّل حصة الشريك لغاها.')}</p>
        {canRecord && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
            <DateInput className="h-8 w-40" value={log.date} onChange={(e) => setLog({ ...log, date: e.target.value })} />
            <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={log.status} onChange={(e) => setLog({ ...log, status: e.target.value })}>
              {(unnamedHeadcount !== null ? ['HELD', 'CANCELLED_PARTNER', 'CANCELLED_TECHNOVA'] : ['CANCELLED_PARTNER', 'CANCELLED_TECHNOVA']).map((s) => <option key={s} value={s}>{L(STATUS[s][0], STATUS[s][1])}</option>)}
            </select>
            {log.status === 'HELD' && <Input type="number" min={0} className="h-8 w-24" placeholder={L('Children today', 'الأطفال النهارده')} value={log.headcount} onChange={(e) => setLog({ ...log, headcount: e.target.value })} />}
            <Input className="h-8 w-40" placeholder={L('Note', 'ملاحظة')} value={log.note} onChange={(e) => setLog({ ...log, note: e.target.value })} />
            <Button size="sm" disabled={add.isPending || (unnamedHeadcount === null && log.status === 'HELD')} onClick={() => add.mutate()}>{add.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Record', 'سجّل')}</Button>
          </div>
        )}
        {logs.length > 0 && (
          <ul className="space-y-1 text-xs">
            {logs.slice(0, 20).map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="w-24">{l.sessionDate.slice(0, 10)}</span>
                <span className={`rounded-full px-2 py-0.5 ${STATUS[l.status]?.[2] ?? ''}`}>{L(STATUS[l.status]?.[0] ?? l.status, STATUS[l.status]?.[1] ?? l.status)}</span>
                {l.headcount !== null && <span>{l.headcount} {L('children', 'طفل')}</span>}
                {l.note && <span className="text-slate-500">{l.note}</span>}
                {canRecord && <button type="button" className="ms-auto text-slate-400 hover:text-rose-600" onClick={() => del.mutate(l.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
