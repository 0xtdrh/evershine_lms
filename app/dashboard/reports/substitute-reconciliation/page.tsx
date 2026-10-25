'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { Loader2 } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

interface RecordedAdjustment { id: string; amount: number }

interface ReconciliationRow {
  id: string
  date: string
  groupLabel: string
  classSectionId: string
  reason: string
  sessionNumber: number | null
  totalSessions: number | null
  substituteTeacher: { id: string; name: string }
  originalTeacher: { id: string; name: string }
  substituteAdjustment: RecordedAdjustment | null
  originalAdjustment: RecordedAdjustment | null
  suggestedBonusAmount: number | null
  suggestedDeductionAmount: number | null
  /** the session is already left out of the absent instructor's per-session pay (substitute recorded it) */
  deductionAlreadyExcluded?: boolean
}

export default function SubstituteReconciliationPage() {
  useI18n() // re-render on a language switch
  const queryClient = useQueryClient()

  const { data: rows = [], isLoading } = useQuery<ReconciliationRow[]>({
    queryKey: ['substitute-reconciliation'],
    queryFn: () => fetchApi('/api/reports/substitute-reconciliation'),
  })

  const [dialog, setDialog] = useState<{ row: ReconciliationRow; kind: 'bonus' | 'deduction' } | null>(null)
  const [amount, setAmount] = useState('')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['substitute-reconciliation'] })
    queryClient.invalidateQueries({ queryKey: ['group-financials'] })
  }

  const openDialog = (row: ReconciliationRow, kind: 'bonus' | 'deduction') => {
    const suggested = kind === 'bonus' ? row.suggestedBonusAmount : row.suggestedDeductionAmount
    setDialog({ row, kind })
    setAmount(suggested != null && suggested > 0 ? String(suggested) : '')
  }

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!dialog) throw new Error('No target')
      const { row, kind } = dialog
      const date = row.date.slice(0, 10)
      const sessionText = row.sessionNumber ? `session ${row.sessionNumber} of ${row.totalSessions}` : 'a session'
      const teacherId = kind === 'bonus' ? row.substituteTeacher.id : row.originalTeacher.id
      const signedAmount = kind === 'bonus' ? Math.abs(Number(amount)) : -Math.abs(Number(amount))
      return fetchApi(`/api/groups/${row.classSectionId}/pay-adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          teacherId,
          amount: signedAmount,
          substituteAssignmentId: row.id,
          reason: kind === 'bonus'
            ? `Covered ${sessionText} as a substitute on ${date} (${row.groupLabel}) for ${row.originalTeacher.name}`
            : `Missed ${sessionText} on ${date} (${row.groupLabel}) - ${row.reason}`,
        }),
      })
    },
    onSuccess: () => {
      refresh()
      notify.success(dialog?.kind === 'bonus' ? 'Bonus recorded' : 'Deduction recorded')
      setDialog(null)
      setAmount('')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to record')),
  })

  const removeMutation = useMutation({
    mutationFn: ({ classSectionId, adjustmentId }: { classSectionId: string; adjustmentId: string }) =>
      fetchApi(`/api/groups/${classSectionId}/pay-adjustments?adjustmentId=${adjustmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh()
      notify.success(L('Removed', 'اتشال'))
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to remove')),
  })

  const confirmRemove = (row: ReconciliationRow, adj: RecordedAdjustment, label: string) => {
    if (window.confirm(L(`Remove this ${label} (${Math.abs(adj.amount)})?`, `تشيل ${label === 'bonus' ? 'المكافأة' : 'الخصم'} (${Math.abs(adj.amount)})؟`))) {
      removeMutation.mutate({ classSectionId: row.classSectionId, adjustmentId: adj.id })
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{L('Substitute Reconciliation', 'تسوية الحصص البديلة')}</h1>
        <CardDescription>{L('Every confirmed substitute-covered session — settle the extra pay and the missed pay here.', 'كل حصة غطاها بديل — سوّي الأجر الزيادة والخصم هنا.')}</CardDescription>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">{L('No substitute-covered sessions yet.', 'لسه مفيش حصص بديلة.')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-800 flex flex-wrap items-center gap-1.5">
                    {row.groupLabel} — {row.date.slice(0, 10)}
                    {row.sessionNumber && (
                      <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-200">
                        {L('Session', 'حصة')} {row.sessionNumber} {L('of', 'من')} {row.totalSessions}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{row.reason}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="border border-emerald-100 bg-emerald-50/40 rounded-lg p-2.5 space-y-1">
                    <p className="text-xs text-emerald-700 font-medium">{L('Extra session —', 'حصة زيادة —')} {row.substituteTeacher.name}</p>
                    {row.substituteAdjustment ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-emerald-700">
                          {L('Bonus: +', 'مكافأة: +')}{Math.abs(row.substituteAdjustment.amount).toLocaleString()}
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-6 text-[11px] text-red-600"
                          disabled={removeMutation.isPending}
                          onClick={() => confirmRemove(row, row.substituteAdjustment!, 'bonus')}
                        >
                          {L('Remove', 'شيل')}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog(row, 'bonus')}>
                        {L('+ Bonus', '+ مكافأة')}{row.suggestedBonusAmount ? ` (${row.suggestedBonusAmount})` : ''}
                      </Button>
                    )}
                  </div>

                  <div className="border border-rose-100 bg-rose-50/40 rounded-lg p-2.5 space-y-1">
                    <p className="text-xs text-rose-700 font-medium">{L('Missed session —', 'حصة فايتة —')} {row.originalTeacher.name}</p>
                    {row.originalAdjustment ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-rose-700">
                          {L('Deduction: -', 'خصم: -')}{Math.abs(row.originalAdjustment.amount).toLocaleString()}
                        </span>
                        <Button
                          size="sm" variant="ghost" className="h-6 text-[11px] text-red-600"
                          disabled={removeMutation.isPending}
                          onClick={() => confirmRemove(row, row.originalAdjustment!, 'deduction')}
                        >
                          {L('Remove', 'شيل')}
                        </Button>
                      </div>
                    ) : row.deductionAlreadyExcluded ? (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-600">{L('No deduction needed: the session was recorded by the substitute, so it is not counted in this instructor’s per-session pay.', 'مفيش خصم: الحصة اتسجلت باسم البديل، فهي مش محسوبة في أجر المدرب ده بالحصة أصلًا.')}</p>
                        <Button size="sm" variant="ghost" className="h-6 text-[11px] text-red-600" onClick={() => openDialog(row, 'deduction')}>
                          {L('Extra deduction (penalty)…', 'خصم زيادة (عقوبة)…')}
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200" onClick={() => openDialog(row, 'deduction')}>
                        {L('+ Deduction', '+ خصم')}{row.suggestedDeductionAmount ? ` (${row.suggestedDeductionAmount})` : ''}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === 'bonus' ? L('Add bonus', 'ضيف مكافأة') : L('Add deduction', 'ضيف خصم')}</DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'bonus' ? dialog.row.substituteTeacher.name : dialog?.row.originalTeacher.name} — {dialog?.row.groupLabel} {L('on', 'يوم')} {dialog?.row.date.slice(0, 10)}
            </DialogDescription>
          </DialogHeader>
          <Input type="number" placeholder={L('Amount', 'المبلغ')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-slate-400">
            {amount
              ? L('Filled in from this group\u2019s per-session rate \u2014 adjust if needed.', '\u0627\u0644\u0645\u0628\u0644\u063a \u0645\u0646 \u0633\u0639\u0631 \u0627\u0644\u062d\u0635\u0629 \u0641\u064a \u0627\u0644\u062c\u0631\u0648\u0628 \u062f\u0647 \u2014 \u0639\u062f\u0651\u0644\u0647 \u0644\u0648 \u0645\u062d\u062a\u0627\u062c.')
              : L('No per-session rate is set for this group or this teacher \u2014 enter the amount manually.', '\u0645\u0641\u064a\u0634 \u0633\u0639\u0631 \u062d\u0635\u0629 \u0645\u062a\u062d\u062f\u062f \u0644\u0644\u062c\u0631\u0648\u0628 \u0623\u0648 \u0627\u0644\u0645\u062f\u0631\u0628 \u2014 \u0627\u0643\u062a\u0628 \u0627\u0644\u0645\u0628\u0644\u063a \u0628\u0625\u064a\u062f\u0643.')}
          </p>
          <DialogFooter>
            <Button disabled={!amount || Number(amount) === 0 || submitMutation.isPending} onClick={() => submitMutation.mutate()}>
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : L('Save', 'احفظ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
