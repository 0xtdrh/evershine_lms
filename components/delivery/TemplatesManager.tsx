'use client'

/**
 * a02 M1 batch 2 (2026-10-31): ready mixes of ways for groups' weekly sessions (Course Structure → "Templates of ways").
 * A template is one way per weekly session in week order (repeats when a group meets more often).
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { MODES, MODE_LABEL, type Mode } from '@/lib/delivery/modes'
import { patternText } from '@/lib/delivery/templates'
import { LayoutTemplate, Plus, Trash2, X } from 'lucide-react'

export interface DeliveryTemplate { id: string; name: string; nameAr: string | null; pattern: Mode[]; isActive: boolean }

export const MODE_ICON: Record<Mode, string> = { BRANCH: '🏫', ONLINE: '💻', RECORDED: '🎬' }

export function useTemplates() {
  return useQuery<DeliveryTemplate[]>({ queryKey: ['delivery-templates'], queryFn: () => fetchApi('/api/delivery/templates') })
}

export function TemplatesManager({ canEdit }: { canEdit: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data: templates = [] } = useTemplates()
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [pattern, setPattern] = useState<Mode[]>([])
  const refresh = () => qc.invalidateQueries({ queryKey: ['delivery-templates'] })
  const add = useMutation({
    mutationFn: () => fetchApi('/api/delivery/templates', { method: 'POST', body: JSON.stringify({ name, nameAr: nameAr || null, pattern }) }),
    onSuccess: () => { notify.success(L('Template added', 'القالب اتضاف')); setName(''); setNameAr(''); setPattern([]); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/delivery/templates/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e: Error) => notify.error(e.message),
  })
  const show = (p: Mode[]) => p.map((m) => MODE_ICON[m]).join(' ')
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><LayoutTemplate className="h-4 w-4 text-indigo-600" />{L('Templates of ways', 'قوالب الحضور')}</CardTitle>
        <CardDescription>{L('A ready mix for a group\'s weekly sessions, e.g. 1 online + 1 in a branch. Pick it when you set a group\'s schedule; a course / level can have its default.', 'خليط جاهز لحصص الجروب في الأسبوع، مثلاً حصة أونلاين + حصة فرع. بتختاره لما تظبط مواعيد الجروب، وللكورس أو المستوى قالب أساسي.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!templates.length && <p className="text-xs text-slate-500">{L('No templates yet.', 'لسه مفيش قوالب.')}</p>}
        {templates.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <span><b>{ar && t.nameAr ? t.nameAr : t.name}</b> <span className="ms-2 text-base">{show(t.pattern)}</span> <span className="text-xs text-slate-500">({patternText(t.pattern, ar ? 'ar' : 'en')})</span></span>
            {canEdit && <button type="button" aria-label={L('Remove', 'شيل')} className="text-rose-600" onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {canEdit && (
          <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
            <div className="flex flex-wrap gap-2">
              <Input className="h-8 w-48" aria-label={L('Name (English)', 'الاسم (إنجليزي)')} placeholder={L('Name (e.g. Hybrid 1+1)', 'الاسم (مثلاً Hybrid 1+1)')} value={name} onChange={(e) => setName(e.target.value)} />
              <Input className="h-8 w-48" dir="rtl" aria-label="الاسم بالعربي" placeholder="الاسم بالعربي" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">{L('Weekly sessions in order:', 'حصص الأسبوع بالترتيب:')}</span>
              {pattern.map((m, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs">
                  {i + 1}. {MODE_ICON[m]} {MODE_LABEL[m][ar ? 'ar' : 'en']}
                  <button type="button" aria-label={L('Remove', 'شيل')} onClick={() => setPattern(pattern.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              {pattern.length < 7 && MODES.map((m) => (
                <Button key={m} size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setPattern([...pattern, m])}><Plus className="h-3 w-3" />{MODE_ICON[m]} {MODE_LABEL[m][ar ? 'ar' : 'en']}</Button>
              ))}
            </div>
            <Button size="sm" disabled={name.trim().length < 2 || !pattern.length || add.isPending} onClick={() => add.mutate()}>{L('Add template', 'ضيف القالب')}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
