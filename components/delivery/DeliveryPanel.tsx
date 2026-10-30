'use client'

/**
 * a02 M1 (2026-10-30): on a track / course / level of the Course Structure page — the ways its sessions may be attended
 * (branch / live online / recorded; nothing ticked = take it from above) and where it is offered (no place ticked =
 * everywhere). API /api/delivery/catalog.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { L, useI18n } from '@/lib/i18n/client'
import { MODES, MODE_LABEL, modesText, type CatalogKind, type Mode } from '@/lib/delivery/modes'
import type { CatalogDelivery } from '@/lib/delivery/catalog'
import { Building2, Film, Loader2, MonitorPlay } from 'lucide-react'

interface Place { id: string; label?: string; name: string; kind?: string }

const ICON: Record<Mode, typeof Building2> = { BRANCH: Building2, ONLINE: MonitorPlay, RECORDED: Film }
const FROM: Record<string, [string, string]> = {
  TRACK: ['from the track', 'من التراك'], COURSE: ['from the course', 'من الكورس'], LEVEL: ['from the level', 'من المستوى'],
}

export function DeliveryPanel({ kind, id, canEdit }: { kind: CatalogKind; id: string; canEdit: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['delivery', kind, id], queryFn: () => fetchApi<CatalogDelivery>(`/api/delivery/catalog?kind=${kind}&id=${id}`) })
  const { data: places = [] } = useQuery<Place[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses') })
  const [modes, setModes] = useState<Mode[]>([])
  const [offered, setOffered] = useState<string[]>([])
  useEffect(() => { if (data) { setModes(data.allowedModes ?? []); setOffered(data.offeredIn) } }, [data])

  const save = useMutation({
    mutationFn: () => fetchApi('/api/delivery/catalog', { method: 'PUT', body: JSON.stringify({ kind, id, allowedModes: modes.length ? modes : null, offeredIn: offered }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); ['delivery', 'tracks', 'academic-subjects', 'levels'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })) },
    onError: (e: Error) => notify.error(e.message),
  })

  if (!data) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  const changed = JSON.stringify(modes) !== JSON.stringify(data.allowedModes ?? []) || JSON.stringify([...offered].sort()) !== JSON.stringify([...data.offeredIn].sort())
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm">
      <div>
        <p className="mb-1.5 font-semibold text-slate-800">{L('How its sessions may be attended', 'طرق الحضور المسموحة')}</p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => {
            const Icon = ICON[m]
            const on = modes.includes(m)
            return (
              <button key={m} type="button" disabled={!canEdit} onClick={() => setModes(MODES.filter((x) => (x === m ? !on : modes.includes(x))))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'} disabled:opacity-70`}>
                <Icon className="h-3.5 w-3.5" />{MODE_LABEL[m][ar ? 'ar' : 'en']}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {modes.length
            ? L('Only these ways are allowed here (the closest setting wins).', 'الطرق دي بس المسموحة هنا (الأقرب للحصة هو اللي بيكسب).')
            : data.inherited.from === 'DEFAULT'
              ? L('Nothing ticked — every way is allowed.', 'مفيش حاجة متعلّمة — كل الطرق مسموحة.')
              : `${L('Nothing ticked — it follows', 'مفيش حاجة متعلّمة — ماشي على')} ${FROM[data.inherited.from]?.[ar ? 1 : 0] ?? ''}: ${modesText(data.inherited.modes, ar ? 'ar' : 'en')}`}
        </p>
      </div>
      <div>
        <p className="mb-1.5 font-semibold text-slate-800">{L('Where it is offered', 'متاح فين')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {places.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" disabled={!canEdit} checked={offered.includes(p.id)} onChange={() => setOffered(toggle(offered, p.id))} />
              {p.label ?? p.name}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {offered.length === 1 && offered[0] === 'NONE'
            ? L('Closed in every place now (unticked from the places\' pages). Tick places, or save with none ticked to offer it everywhere.', 'مقفول في كل الأماكن دلوقتي (اتشال من صفحات الأماكن). علّم أماكن، أو احفظ من غير علامة علشان يبقى متاح في كل مكان.')
            : offered.length
            ? L('Only these places can make groups of it or see it in their lists.', 'الأماكن دي بس تقدر تعمل جروبات منه أو تشوفه في القوايم.')
            : L('No place ticked — offered everywhere.', 'مفيش مكان متعلّم — متاح في كل الأماكن.')}
        </p>
      </div>
      {canEdit && changed && (
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}
        </Button>
      )}
    </div>
  )
}
