'use client'

/** M1: the places of a partner (each one works like a branch: groups, students, staff). Add / edit / stop. */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PartnerDetail, PartnerPlace } from './types'
import { PlacePrices } from './PlacePrices'
import { Loader2, MapPin, Pencil, Plus } from 'lucide-react'

const blank = { name: '', address: '', phone: '', email: '', principalName: '' }

export function PartnerPlaces({ p, canEdit }: { p: PartnerDetail; canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<string | 'NEW' | null>(null)
  const [pricesFor, setPricesFor] = useState<string | null>(null)
  const [f, setF] = useState(blank)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['partner', p.id] }); qc.invalidateQueries({ queryKey: ['partners'] }); qc.invalidateQueries({ queryKey: ['places-mine'] }); qc.invalidateQueries({ queryKey: ['campuses'] }) }
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => editing === 'NEW'
      ? fetchApi(`/api/partners/${p.id}/places`, { method: 'POST', body: JSON.stringify(body) })
      : fetchApi(`/api/partners/${p.id}/places/${editing}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setEditing(null); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (pl: PartnerPlace) => fetchApi(`/api/partners/${p.id}/places/${pl.id}`, { method: 'PATCH', body: JSON.stringify({ name: pl.name, isActive: !pl.isActive }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const open = (pl: PartnerPlace | null) => {
    setEditing(pl ? pl.id : 'NEW')
    setF(pl ? { name: pl.name, address: pl.address === '-' ? '' : pl.address, phone: pl.phone === '-' ? '' : pl.phone, email: pl.email === '-' ? '' : pl.email, principalName: pl.principalName === '-' ? '' : pl.principalName } : blank)
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">{L('A place works like a branch: groups, students and staff belong to it. Staff see it only if it is one of their places (Credential management).', 'المكان بيشتغل زي الفرع: الجروبات والطلاب والموظفين تبعه. الموظف بيشوفه بس لو من ضمن أماكنه (Credential management).')}</p>
      {p.places.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">{L('No places yet.', 'لسه مفيش أماكن.')}</p>}
      <ul className="space-y-2">
        {p.places.map((pl) => (
          <li key={pl.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 ${pl.isActive ? '' : 'opacity-60'}`}>
            <MapPin className="h-4 w-4 text-indigo-600" />
            <Link href={`/dashboard/campuses/${pl.id}`} className="font-medium text-slate-900 hover:underline">{pl.name}</Link>
            <span className="text-xs text-slate-500">{pl.code}</span>
            <span className="text-xs text-slate-600">· {pl.activeGroups} {L('active groups', 'جروب شغال')} · {pl.students} {L('students', 'طالب')}</span>
            {!pl.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{L('Stopped', 'موقوف')}</span>}
            {canEdit && (
              <span className="ms-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setPricesFor(pricesFor === pl.id ? null : pl.id)}>{L('Special prices', 'أسعار خاصة')}</Button>
                <Button size="sm" variant="ghost" onClick={() => open(pl)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(pl)}>{pl.isActive ? L('Stop', 'وقّف') : L('Start', 'شغّل')}</Button>
              </span>
            )}
            {pricesFor === pl.id && <div className="w-full pt-2"><PlacePrices campusId={pl.id} canEdit={canEdit} /></div>}
          </li>
        ))}
      </ul>
      {canEdit && editing === null && <Button size="sm" variant="outline" onClick={() => open(null)}><Plus className="me-1 h-4 w-4" />{L('Add place', 'ضيف مكان')}</Button>}
      {canEdit && editing !== null && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{L('Place name (unique, e.g. "Al Nour School – Kawther")', 'اسم المكان (مايتكررش، مثلًا "مدرسة النور – الكوثر")')}</Label><Input className="h-9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Address', 'العنوان')}</Label><Input className="h-9" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Person in charge there', 'المسؤول هناك')}</Label><Input className="h-9" value={f.principalName} onChange={(e) => setF({ ...f, principalName: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Phone', 'التليفون')}</Label><Input className="h-9" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">{L('Email', 'الإيميل')}</Label><Input className="h-9" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <p className="text-xs text-slate-500 sm:col-span-2">{L('Empty fields take the partner details.', 'الخانات الفاضية بتاخد بيانات الشريك.')}</p>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate(f)}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>{L('Cancel', 'إلغاء')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
