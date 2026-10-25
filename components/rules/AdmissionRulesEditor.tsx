'use client'

/**
 * Rules of the public online application (2026-10-24, owner). Agreements page; agreements:update edits.
 * Each rule has an English and an Arabic line; the form shows the one in the visitor's language.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ClipboardList, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { DEFAULT_ADMISSION_RULES, MAX_ADMISSION_RULES, type AdmissionRule, type AdmissionRules } from '@/lib/admissions/rules'

export function AdmissionRulesEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admission-rules'], queryFn: () => fetchApi<AdmissionRules>('/api/admission-rules') })
  const [rows, setRows] = useState<AdmissionRule[]>([])
  useEffect(() => { if (data?.items) setRows(data.items) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi<AdmissionRules>('/api/admission-rules', { method: 'PUT', body: JSON.stringify({ items: rows }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['admission-rules'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const set = (i: number, k: keyof AdmissionRule, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> {L('Online application rules', 'شروط استمارة التقديم')}</CardTitle>
        <CardDescription>{L('Shown on the public application form (/admissions/apply); the family ticks "I accept". Write each rule in English and Arabic.', 'بتظهر في استمارة التقديم الأونلاين (/admissions/apply)، وولي الأمر بيعلّم «موافق». اكتب كل شرط بالإنجليزي والعربي.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[auto_1fr_1fr_auto]">
            <span className="pt-2 text-sm font-bold text-slate-500">{i + 1}.</span>
            <Textarea dir="ltr" rows={2} value={r.en} disabled={!canEdit} placeholder="English" onChange={(e) => set(i, 'en', e.target.value)} />
            <Textarea dir="rtl" rows={2} value={r.ar} disabled={!canEdit} placeholder="عربي" onChange={(e) => set(i, 'ar', e.target.value)} />
            {canEdit && <Button type="button" size="icon" variant="ghost" aria-label={L('Remove', 'امسح')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-600" /></Button>}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" disabled={rows.length >= MAX_ADMISSION_RULES} onClick={() => setRows((x) => [...x, { en: '', ar: '' }])}><Plus className="h-4 w-4" /> {L('Add a rule', 'ضيف شرط')}</Button>
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setRows(DEFAULT_ADMISSION_RULES.items)}><RotateCcw className="h-4 w-4" /> {L('Back to the default rules', 'رجّع الشروط الأصلية')}</Button>
            <Button type="button" size="sm" className="ms-auto" disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
          </div>
        )}
        <p className="text-xs text-slate-500">{L('To be reviewed by the owner / a lawyer.', 'لازم تتراجع منك أو من محامي.')}</p>
      </CardContent>
    </Card>
  )
}
