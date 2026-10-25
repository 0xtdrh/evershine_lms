'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RefreshCcw } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface Row { id: string; studentName: string; group: string; course: string | null; level: string | null; status: 'PENDING' | 'YES' | 'NO'; reason: string | null; earlyDiscount: boolean }

const REASON_KEYS = ['PRICE', 'TIME', 'LEVEL', 'TRAVEL', 'OTHER'] as const
const reasonLabel = (k: string) => ({ PRICE: L('Price', 'السعر'), TIME: L('Time / schedule', 'المواعيد'), LEVEL: L('Level / content', 'المستوى / المحتوى'), TRAVEL: L('Travel / moving', 'سفر / نقل'), OTHER: L('Other', 'سبب تاني') } as Record<string, string>)[k] ?? k

/** Parent portal: "is your child continuing next month?" (phase A). */
export function ParentRenewalsCard() {
  useI18n() // re-render on a language switch
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['parent-renewals'], queryFn: () => fetchApi<Row[]>('/api/guardian-portal/renewals') })
  const [noFor, setNoFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const answer = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 'YES' | 'NO' }) =>
      fetchApi<{ earlyDiscount?: boolean }>(`/api/guardian-portal/renewals/${id}`, { method: 'POST', body: JSON.stringify({ answer: value, reason: value === 'NO' ? reason : null, note: note.trim() || null }) }),
    onSuccess: (r, v) => {
      notify.success(v.value === 'YES' ? (r?.earlyDiscount ? L('Thank you! An early-confirmation discount was added to next month.', 'شكرًا! اتضاف خصم التأكيد بدري على الشهر الجاي.') : L('Thank you! See you next month.', 'شكرًا! نشوفكم الشهر الجاي.')) : L('Thank you for letting us know.', 'شكرًا إنك قولتلنا.'))
      setNoFor(null); setReason(''); setNote('')
      qc.invalidateQueries({ queryKey: ['parent-renewals'] })
    },
    onError: (e: Error) => notify.error(e.message || L('Could not save', 'ماتحفظش')),
  })
  const rows = data ?? []
  if (!rows.length) return null
  return (
    <Card className="border-indigo-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><RefreshCcw className="h-4 w-4 text-indigo-600" /> {L('Continuing next month?', 'مكمّلين الشهر الجاي؟')}</CardTitle>
        <CardDescription>{L('The current month is ending soon. Please let us know.', 'الشهر الحالي قرّب يخلص. قولّنا لو سمحت.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="font-medium text-slate-800">{r.studentName} <span className="text-xs font-normal text-slate-500">· {r.course} {r.level} · {r.group}</span></p>
            {r.status === 'PENDING' && noFor !== r.id && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" className="h-8" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'YES' })}>{L('Yes, continuing', 'أيوه، مكمّلين')}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setNoFor(r.id)}>{L('No', 'لأ')}</Button>
              </div>
            )}
            {noFor === r.id && (
              <div className="mt-1.5 space-y-2">
                <p className="text-xs text-slate-600">{L('Sorry to hear that. Why? (it helps us improve)', 'خسارة! ممكن نعرف السبب؟ (بيساعدنا نتحسّن)')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {REASON_KEYS.map((k) => (
                    <button key={k} type="button" onClick={() => setReason(k)} className={`rounded-full border px-2.5 py-1 text-xs ${reason === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>{reasonLabel(k)}</button>
                  ))}
                </div>
                <Textarea rows={2} placeholder={L('Anything else? (optional)', 'حاجة تانية؟ (اختياري)')} value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNoFor(null)}>{L('Back', 'رجوع')}</Button>
                  <Button size="sm" disabled={!reason || answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'NO' })}>{L('Send', 'ابعت')}</Button>
                </div>
              </div>
            )}
            {r.status !== 'PENDING' && (
              <p className="mt-1 text-xs text-slate-600">
                {L('Your answer:', 'ردّك:')} <strong>{r.status === 'YES' ? L('continuing', 'مكمّلين') : `${L('not continuing', 'مش مكمّلين')}${r.reason ? ` (${reasonLabel(r.reason)})` : ''}`}</strong>
                {r.earlyDiscount && <span className="text-emerald-700"> {L('· early-confirmation discount on next month', '· خصم التأكيد بدري على الشهر الجاي')}</span>}
                {r.status === 'NO' && (
                  <button type="button" className="ms-2 underline" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'YES' })}>{L('Changed my mind: continuing', 'غيّرت رأيي: مكمّلين')}</button>
                )}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
