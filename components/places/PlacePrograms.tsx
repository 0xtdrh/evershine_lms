'use client'

/**
 * a02 M1 (2026-10-30): "Programmes" on a branch / partner page — which tracks, courses and levels this place offers.
 * Same data as Course Structure → "where offered" (API /api/places/[campusId]/catalog). Unticking something offered
 * everywhere keeps it for every other place.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import type { PlaceCatalogItem } from '@/lib/delivery/catalog'
import { ChevronDown, Loader2 } from 'lucide-react'

const KIND: Record<string, [string, string]> = { TRACK: ['Track', 'تراك'], COURSE: ['Course', 'كورس'], LEVEL: ['Level', 'مستوى'] }

export function PlacePrograms({ campusId }: { campusId: string }) {
  useI18n()
  const qc = useQueryClient()
  const { can } = useMyPermissions()
  const { data, isLoading } = useQuery({ queryKey: ['place-catalog', campusId], queryFn: () => fetchApi<PlaceCatalogItem[]>(`/api/places/${campusId}/catalog`) })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const save = useMutation({
    mutationFn: (v: { kind: string; id: string; on: boolean }) => fetchApi<PlaceCatalogItem[]>(`/api/places/${campusId}/catalog`, { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: (rows) => { qc.setQueryData(['place-catalog', campusId], rows); ['delivery', 'tracks', 'academic-subjects', 'levels'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); notify.success(L('Saved', 'اتحفظ')) },
    onError: (e: Error) => notify.error(e.message),
  })

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  if (!data?.length) return <p className="text-sm text-slate-500">{L('No tracks or courses yet (Course Structure).', 'لسه مفيش تراكات أو كورسات (هيكل الكورسات).')}</p>

  const row = (it: PlaceCatalogItem, parentOn: boolean, depth: number) => {
    const editable = can(it.kind === 'COURSE' ? 'subject_offerings' : 'class_sections', 'update')
    const k = `${it.kind}:${it.id}`
    return (
      <div key={k}>
        <div className="flex flex-wrap items-center gap-2 py-1" style={{ paddingInlineStart: depth * 20 }}>
          {it.children.length > 0 ? (
            <button type="button" aria-label={L('Show what is inside', 'اعرض اللي جواه')} onClick={() => setOpen({ ...open, [k]: !open[k] })} className="text-slate-400 hover:text-slate-700">
              <ChevronDown className={`h-4 w-4 transition-transform ${open[k] ? '' : '-rotate-90 rtl:rotate-90'}`} />
            </button>
          ) : <span className="w-4" />}
          <label className={`flex items-center gap-2 text-sm ${parentOn ? 'text-slate-800' : 'text-slate-400'}`}>
            <input type="checkbox" checked={it.scope !== 'NOT_HERE'} disabled={!editable || !parentOn || save.isPending} onChange={(e) => save.mutate({ kind: it.kind, id: it.id, on: e.target.checked })} />
            <span className="text-[11px] text-slate-400">{L(...KIND[it.kind])}</span>
            <span className="font-medium">{it.name}</span>
          </label>
          {it.scope === 'EVERYWHERE' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{L('every place', 'كل الأماكن')}</span>}
          {it.scope === 'HERE' && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">{L('chosen places', 'أماكن مختارة')}</span>}
          {!parentOn && <span className="text-[11px] text-amber-700">{L('closed above it', 'مقفول من اللي فوقه')}</span>}
        </div>
        {open[k] && it.children.map((c) => row(c, parentOn && it.offered, depth + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{L('Ticked = this place can make groups of it and sees it in its lists. The same setting as Course Structure → "where offered".', 'المتعلّم = المكان ده يقدر يعمل منه جروبات ويشوفه في القوايم. نفس إعداد «متاح فين» في هيكل الكورسات.')}</p>
      <div className="divide-y rounded-lg border px-3">{data.filter((it) => it.kind === 'TRACK').map((it) => row(it, true, 0))}</div>
      {data.some((it) => it.kind === 'COURSE') && (
        <>
          <p className="pt-2 text-sm font-semibold text-slate-700">{L('Standalone courses (no track)', 'كورسات منفصلة (من غير تراك)')}</p>
          <div className="divide-y rounded-lg border px-3">{data.filter((it) => it.kind === 'COURSE').map((it) => row(it, true, 0))}</div>
        </>
      )}
    </div>
  )
}
