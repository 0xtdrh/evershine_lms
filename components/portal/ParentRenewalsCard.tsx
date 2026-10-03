'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RefreshCcw } from 'lucide-react'

interface Row { id: string; studentName: string; group: string; course: string | null; level: string | null; status: 'PENDING' | 'YES' | 'NO'; reason: string | null; earlyDiscount: boolean }

const REASONS: Record<string, string> = { PRICE: 'Price', TIME: 'Time / schedule', LEVEL: 'Level / content', TRAVEL: 'Travel / moving', OTHER: 'Other' }

/** Parent portal: "is your child continuing next month?" (phase A). */
export function ParentRenewalsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['parent-renewals'], queryFn: () => fetchApi<Row[]>('/api/guardian-portal/renewals') })
  const [noFor, setNoFor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const answer = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 'YES' | 'NO' }) =>
      fetchApi<{ earlyDiscount?: boolean }>(`/api/guardian-portal/renewals/${id}`, { method: 'POST', body: JSON.stringify({ answer: value, reason: value === 'NO' ? reason : null, note: note.trim() || null }) }),
    onSuccess: (r, v) => {
      notify.success(v.value === 'YES' ? (r?.earlyDiscount ? 'Thank you! An early-confirmation discount was added to next month.' : 'Thank you! See you next month.') : 'Thank you for letting us know.')
      setNoFor(null); setReason(''); setNote('')
      qc.invalidateQueries({ queryKey: ['parent-renewals'] })
    },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const rows = data ?? []
  if (!rows.length) return null
  return (
    <Card className="border-indigo-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><RefreshCcw className="h-4 w-4 text-indigo-600" /> Continuing next month?</CardTitle>
        <CardDescription>The current month is ending soon. Please let us know.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="font-medium text-slate-800">{r.studentName} <span className="text-xs font-normal text-slate-500">· {r.course} {r.level} · {r.group}</span></p>
            {r.status === 'PENDING' && noFor !== r.id && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" className="h-8" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'YES' })}>Yes, continuing</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setNoFor(r.id)}>No</Button>
              </div>
            )}
            {noFor === r.id && (
              <div className="mt-1.5 space-y-2">
                <p className="text-xs text-slate-600">Sorry to hear that. Why? (it helps us improve)</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(REASONS).map((k) => (
                    <button key={k} type="button" onClick={() => setReason(k)} className={`rounded-full border px-2.5 py-1 text-xs ${reason === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>{REASONS[k]}</button>
                  ))}
                </div>
                <Textarea rows={2} placeholder="Anything else? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNoFor(null)}>Back</Button>
                  <Button size="sm" disabled={!reason || answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'NO' })}>Send</Button>
                </div>
              </div>
            )}
            {r.status !== 'PENDING' && (
              <p className="mt-1 text-xs text-slate-600">
                Your answer: <strong>{r.status === 'YES' ? 'continuing' : `not continuing${r.reason ? ` (${REASONS[r.reason] ?? r.reason})` : ''}`}</strong>
                {r.earlyDiscount && <span className="text-emerald-700"> · early-confirmation discount on next month</span>}
                {r.status === 'NO' && (
                  <button type="button" className="ml-2 underline" disabled={answer.isPending} onClick={() => answer.mutate({ id: r.id, value: 'YES' })}>Changed my mind: continuing</button>
                )}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
