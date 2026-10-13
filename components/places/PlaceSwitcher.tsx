'use client'

/**
 * M0: header place filter for staff who see more than one place. Branches and partner places are listed apart; the
 * choice narrows every screen (cookie set by the server, it can never widen what the person may see).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { MapPin } from 'lucide-react'

interface Mine { all: boolean; places: { id: string; name: string; kind: string }[]; singleGroups: number; selected: string }

export function PlaceSwitcher() {
  const qc = useQueryClient()
  const router = useRouter()
  const { data } = useQuery({ queryKey: ['places-mine'], queryFn: () => fetchApi<Mine>('/api/places/mine'), staleTime: 60_000, retry: false })
  if (!data || (!data.all && data.places.length < 2)) return null
  const branches = data.places.filter((p) => p.kind !== 'PARTNER')
  const partners = data.places.filter((p) => p.kind === 'PARTNER')
  const choose = async (v: string) => {
    try {
      await fetchApi('/api/places/mine', { method: 'POST', body: JSON.stringify({ campusId: v }) })
      await qc.invalidateQueries()
      router.refresh()
    } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <label className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 md:flex" title={L('Place', 'المكان')}>
      <MapPin className="h-3.5 w-3.5 text-indigo-600" />
      <select className="max-w-[11rem] bg-transparent text-xs outline-none" value={data.selected} onChange={(e) => choose(e.target.value)}>
        <option value="ALL">{L('All my places', 'كل أماكني')}</option>
        {branches.length > 0 && <optgroup label={L('Branches', 'الفروع')}>{branches.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
        {partners.length > 0 && <optgroup label={L('Partners', 'الشركاء')}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
      </select>
    </label>
  )
}
