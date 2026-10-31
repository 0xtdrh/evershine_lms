'use client'

/**
 * a02 (2026-10-31) "Copy for a partner / place": for a level or a whole course whose STRUCTURE differs in some places
 * (other number of sessions, months, price). Makes a copy with its curriculum, offered only there. API /api/delivery/copy.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { Copy, Loader2 } from 'lucide-react'

interface Place { id: string; name: string; label?: string }

export function CopyForPlaces({ kind, id }: { kind: 'LEVEL' | 'COURSE'; id: string }) {
  useI18n()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: places = [] } = useQuery<Place[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses'), enabled: open })
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [sessions, setSessions] = useState('')
  const [months, setMonths] = useState('')
  const [price, setPrice] = useState('')
  const [close, setClose] = useState(true)
  const copy = useMutation({
    mutationFn: () => fetchApi('/api/delivery/copy', {
      method: 'POST',
      body: JSON.stringify({
        kind, id, campusIds: picked, name: name || null, closeOriginalThere: close,
        numberOfSessions: kind === 'LEVEL' && sessions ? Number(sessions) : null,
        numberOfMonths: kind === 'LEVEL' && months ? Number(months) : null,
        price: kind === 'LEVEL' && price ? Number(price) : null,
      }),
    }),
    onSuccess: () => {
      notify.success(L('Copy made — it is offered only in the chosen places', 'النسخة اتعملت — متاحة في الأماكن اللي اخترتها بس'))
      setOpen(false); setPicked([]);
      ['academic-subjects-for-config', 'levels', 'tracks', 'delivery', 'place-catalog'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    },
    onError: (e: Error) => notify.error(e.message),
  })

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
        <Copy className="h-3.5 w-3.5" />{kind === 'LEVEL' ? L('Copy this level for a partner / place', 'انسخ المستوى لشريك أو مكان') : L('Copy the whole course for a partner / place', 'انسخ الكورس كله لشريك أو مكان')}
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-indigo-200 bg-white p-3 text-sm">
      <p className="text-xs text-slate-600">{kind === 'LEVEL'
        ? L('For a place where this level has a different structure (sessions, months, price). The curriculum is copied too.', 'لمكان المستوى فيه هيكل مختلف (عدد الحصص، الشهور، السعر). المنهج بيتنسخ كمان.')
        : L('A copy of the course with all its levels and their curricula, for these places only.', 'نسخة من الكورس بكل مستوياته ومناهجها، للأماكن دي بس.')}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {places.map((p) => <label key={p.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id])} />{p.label ?? p.name}</label>)}
      </div>
      <Input className="h-8" aria-label={L('Name of the copy', 'اسم النسخة')} placeholder={L('Name of the copy (empty = name — places)', 'اسم النسخة (فاضي = الاسم — الأماكن)')} value={name} onChange={(e) => setName(e.target.value)} />
      {kind === 'LEVEL' && (
        <div className="flex flex-wrap gap-2">
          <Input className="h-8 w-32" type="number" min={1} placeholder={L('Sessions', 'عدد الحصص')} value={sessions} onChange={(e) => setSessions(e.target.value)} />
          <Input className="h-8 w-28" type="number" min={1} placeholder={L('Months', 'شهور')} value={months} onChange={(e) => setMonths(e.target.value)} />
          <Input className="h-8 w-32" type="number" min={0} placeholder={L('Price (EGP)', 'السعر (ج.م)')} value={price} onChange={(e) => setPrice(e.target.value)} />
          <span className="self-center text-[11px] text-slate-500">{L('empty = same as the original', 'فاضي = زي الأصلي')}</span>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />{L('Close the original in these places (they see their copy only)', 'اقفل الأصلي في الأماكن دي (يشوفوا نسختهم بس)')}</label>
      <div className="flex gap-2">
        <Button size="sm" disabled={!picked.length || copy.isPending} onClick={() => copy.mutate()}>{copy.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Make the copy', 'اعمل النسخة')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{L('Cancel', 'إلغاء')}</Button>
      </div>
    </div>
  )
}
