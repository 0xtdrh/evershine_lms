'use client'

/**
 * a02 (2026-10-31): the curricula of one level (same sessions / price, different content). The main curriculum is
 * always there; others say for which ways (branch / online / recorded) and places (branches, partner places, online)
 * they are used — a group of such a place / way reads it automatically. API /api/curriculum/variants.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { MODES, MODE_LABEL, type Mode } from '@/lib/delivery/modes'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

export interface Variant { id: string; name: string; modes: Mode[] | null; campusIds: string[] | null }
interface Place { id: string; name: string; label?: string }

function VariantForm({ levelId, v, places, onDone }: { levelId: string; v: Variant | null; places: Place[]; onDone: () => void }) {
  const ar = useI18n().locale === 'ar'
  const [name, setName] = useState(v?.name ?? '')
  const [modes, setModes] = useState<Mode[]>(v?.modes ?? [])
  const [campusIds, setCampusIds] = useState<string[]>(v?.campusIds ?? [])
  const save = useMutation({
    mutationFn: () => fetchApi(v ? `/api/curriculum/variants/${v.id}` : '/api/curriculum/variants', {
      method: v ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...(v ? {} : { levelId }), name, modes: modes.length ? modes : null, campusIds: campusIds.length ? campusIds : null }),
    }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm">
      <Input aria-label={L('Curriculum name', 'اسم المنهج')} placeholder={L('Name (e.g. Online curriculum, Al Nour school)', 'الاسم (مثلاً منهج الأونلاين، مدرسة النور)')} value={name} onChange={(e) => setName(e.target.value)} />
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-600">{L('Used for these ways (none = any way)', 'بيتستخدم للطرق دي (من غير علامة = أي طريقة)')}</p>
        <div className="flex flex-wrap gap-3">
          {MODES.map((m) => <label key={m} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={modes.includes(m)} onChange={() => setModes(MODES.filter((x) => (x === m ? !modes.includes(m) : modes.includes(x))))} />{MODE_LABEL[m][ar ? 'ar' : 'en']}</label>)}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-slate-600">{L('Used in these places (none = any place)', 'بيتستخدم في الأماكن دي (من غير علامة = أي مكان)')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {places.map((p) => <label key={p.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={campusIds.includes(p.id)} onChange={() => setCampusIds(toggle(campusIds, p.id))} />{p.label ?? p.name}</label>)}
        </div>
      </div>
      {!modes.length && !campusIds.length && <p className="text-xs text-amber-700">{L('With no way and no place it is only used when a group chooses it by hand.', 'من غير طريقة ولا مكان بيتستخدم بس لو جروب اختاره بإيده.')}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'احفظ')}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{L('Cancel', 'إلغاء')}</Button>
      </div>
    </div>
  )
}

export function VariantsManager({ levelId, variants, selected, onSelect, canEdit, canDelete }: {
  levelId: string; variants: Variant[]; selected: string; onSelect: (id: string) => void; canEdit: boolean; canDelete: boolean
}) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data: places = [] } = useQuery<Place[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses'), enabled: canEdit })
  const [form, setForm] = useState<Variant | 'new' | null>(null)
  const refresh = () => { setForm(null); qc.invalidateQueries({ queryKey: ['curriculum-level', levelId] }) }
  const del = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/curriculum/variants/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Removed', 'اتشال')); onSelect(''); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const where = (v: Variant) => {
    const bits = [
      v.modes?.length ? v.modes.map((m) => MODE_LABEL[m][ar ? 'ar' : 'en']).join(ar ? ' / ' : ' / ') : '',
      v.campusIds?.length ? v.campusIds.map((id) => places.find((p) => p.id === id)?.name ?? '…').join('، ') : '',
    ].filter(Boolean)
    return bits.length ? bits.join(' · ') : L('chosen by hand only', 'بالاختيار اليدوي بس')
  }
  const tab = (id: string, label: string) => (
    <button key={id || 'main'} type="button" onClick={() => onSelect(id)}
      className={`rounded-full border px-3 py-1 text-sm ${selected === id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>{label}</button>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">{L('Curricula of this level:', 'مناهج المستوى ده:')}</span>
        {tab('', L('Main curriculum', 'المنهج الأساسي'))}
        {variants.map((v) => tab(v.id, v.name))}
        {canEdit && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setForm('new')}><Plus className="h-3.5 w-3.5" />{L('Another curriculum', 'منهج تاني')}</Button>}
      </div>
      {selected && (() => {
        const v = variants.find((x) => x.id === selected)
        if (!v) return null
        return (
          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            {L('Used for:', 'بيتستخدم لـ:')} <b>{where(v)}</b>
            {canEdit && <button type="button" className="text-indigo-700" onClick={() => setForm(v)} aria-label={L('Edit', 'تعديل')}><Pencil className="h-3.5 w-3.5" /></button>}
            {canDelete && <button type="button" className="text-rose-600" onClick={() => del.mutate(v.id)} aria-label={L('Remove', 'شيل')}><Trash2 className="h-3.5 w-3.5" /></button>}
          </p>
        )
      })()}
      {form && <VariantForm key={form === 'new' ? 'new' : form.id} levelId={levelId} v={form === 'new' ? null : form} places={places} onDone={refresh} />}
    </div>
  )
}
