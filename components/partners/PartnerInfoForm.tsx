'use client'

/** M1: a partner's details — edit, stop / start again, delete (only while it has no places and no contracts). */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PARTNER_KINDS } from '@/lib/partners/rules'
import { kindLabel } from './bits'
import type { PartnerDetail } from './types'
import { Loader2 } from 'lucide-react'

export function PartnerInfoForm({ p, canEdit, canDelete }: { p: PartnerDetail; canEdit: boolean; canDelete: boolean }) {
  const qc = useQueryClient()
  const router = useRouter()
  const pick = (x: PartnerDetail) => ({ name: x.name, kind: x.kind, contactName: x.contactName ?? '', contactPhone: x.contactPhone ?? '', contactEmail: x.contactEmail ?? '', address: x.address ?? '', notes: x.notes ?? '', isActive: x.isActive })
  const [f, setF] = useState(pick(p))
  useEffect(() => setF(pick(p)), [p])
  const refresh = () => { qc.invalidateQueries({ queryKey: ['partner', p.id] }); qc.invalidateQueries({ queryKey: ['partners'] }); qc.invalidateQueries({ queryKey: ['places-mine'] }) }
  const save = useMutation({
    mutationFn: (body: typeof f) => fetchApi(`/api/partners/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({
    mutationFn: () => fetchApi(`/api/partners/${p.id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Deleted', 'اتمسح')); qc.invalidateQueries({ queryKey: ['partners'] }); router.push('/dashboard/partners') },
    onError: (e: Error) => notify.error(e.message),
  })
  const field = (k: keyof typeof f, label: string) => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label><Input className="h-9" disabled={!canEdit} value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  )
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        {field('name', L('Name', 'الاسم'))}
        <div className="space-y-1"><Label className="text-xs">{L('Type', 'النوع')}</Label>
          <select disabled={!canEdit} className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {PARTNER_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
        </div>
        {field('contactName', L('Contact person', 'الشخص المسؤول'))}
        {field('contactPhone', L('Phone', 'التليفون'))}
        {field('contactEmail', L('Email', 'الإيميل'))}
        {field('address', L('Address', 'العنوان'))}
        <div className="space-y-1 sm:col-span-2"><Label className="text-xs">{L('Notes', 'ملاحظات')}</Label><Textarea disabled={!canEdit} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(f)}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
          <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => {
            if (f.isActive && !confirm(L('Stop this partner? Its places stop too.', 'توقف الشريك ده؟ أماكنه هتتوقف كمان.'))) return
            save.mutate({ ...f, isActive: !f.isActive })
          }}>{f.isActive ? L('Stop partner', 'وقّف الشريك') : L('Start again', 'شغّله تاني')}</Button>
          {canDelete && p.places.length === 0 && p.contracts.length === 0 && (
            <Button size="sm" variant="outline" className="text-rose-600" disabled={del.isPending} onClick={() => confirm(L('Delete this partner?', 'تمسح الشريك ده؟')) && del.mutate()}>{L('Delete', 'امسح')}</Button>
          )}
        </div>
      )}
    </div>
  )
}
