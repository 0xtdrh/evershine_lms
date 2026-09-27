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

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

interface ReconciliationRow {
  id: string
  date: string
  groupLabel: string
  classSectionId: string
  reason: string
  substituteTeacher: { id: string; name: string }
  originalTeacher: { id: string; name: string }
  substituteBonusRecorded: boolean
  originalDeductionRecorded: boolean
  suggestedBonusAmount: number | null
  suggestedDeductionAmount: number | null
}

export default function SubstituteReconciliationPage() {
  const queryClient = useQueryClient()

  const { data: rows = [], isLoading } = useQuery<ReconciliationRow[]>({
    queryKey: ['substitute-reconciliation'],
    queryFn: () => fetchApi('/api/reports/substitute-reconciliation'),
  })

  const [dialog, setDialog] = useState<{
    row: ReconciliationRow
    kind: 'bonus' | 'deduction'
  } | null>(null)
  const [amount, setAmount] = useState('')

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!dialog) throw new Error('No target')
      const teacherId = dialog.kind === 'bonus' ? dialog.row.substituteTeacher.id : dialog.row.originalTeacher.id
      const signedAmount = dialog.kind === 'bonus' ? Math.abs(Number(amount)) : -Math.abs(Number(amount))
      return fetchApi(`/api/groups/${dialog.row.classSectionId}/pay-adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          teacherId,
          amount: signedAmount,
          substituteAssignmentId: dialog.row.id,
          reason: dialog.kind === 'bonus'
            ? `Covered a substitute session on ${dialog.row.date.slice(0, 10)} for ${dialog.row.groupLabel}`
            : `Missed a session on ${dialog.row.date.slice(0, 10)} for ${dialog.row.groupLabel} (${dialog.row.reason})`,
        }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['substitute-reconciliation'] })
      notify.success(dialog?.kind === 'bonus' ? 'Bonus recorded' : 'Deduction recorded')
      setDialog(null)
      setAmount('')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to record')),
  })

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Substitute Reconciliation</h1>
        <CardDescription>Every confirmed substitute-covered session — settle the extra pay and the missed pay here.</CardDescription>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No substitute-covered sessions yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{row.groupLabel} — {row.date.slice(0, 10)}</p>
                  <p className="text-xs text-slate-400">{row.reason}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-emerald-100 bg-emerald-50/40 rounded-lg p-2.5">
                    <p className="text-xs text-emerald-700 font-medium">Extra session — {row.substituteTeacher.name}</p>
                    {row.substituteBonusRecorded ? (
                      <Badge variant="outline" className="text-[10px] mt-1 text-emerald-700 border-emerald-200">Bonus recorded</Badge>
                    ) : (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs mt-1"
                        onClick={() => { setDialog({ row, kind: 'bonus' }); setAmount(row.suggestedBonusAmount ? String(row.suggestedBonusAmount) : '') }}
                      >
                        + Bonus
                      </Button>
                    )}
                  </div>
                  <div className="border border-rose-100 bg-rose-50/40 rounded-lg p-2.5">
                    <p className="text-xs text-rose-700 font-medium">Missed session — {row.originalTeacher.name}</p>
                    {row.originalDeductionRecorded ? (
                      <Badge variant="outline" className="text-[10px] mt-1 text-rose-700 border-rose-200">Deduction recorded</Badge>
                    ) : (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs mt-1 text-red-600 border-red-200"
                        onClick={() => { setDialog({ row, kind: 'deduction' }); setAmount(row.suggestedDeductionAmount ? String(row.suggestedDeductionAmount) : '') }}
                      >
                        + Deduction
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
            <DialogTitle>{dialog?.kind === 'bonus' ? 'Add bonus' : 'Add deduction'}</DialogTitle>
            <DialogDescription>
              {dialog?.kind === 'bonus' ? dialog.row.substituteTeacher.name : dialog?.row.originalTeacher.name} — {dialog?.row.groupLabel} on {dialog?.row.date.slice(0, 10)}
            </DialogDescription>
          </DialogHeader>
          <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p className="text-xs text-slate-400">
            {amount ? 'Filled in from their per-session pay rule — adjust if needed.' : 'No per-session rate set for this teacher — enter the amount manually.'}
          </p>
          <DialogFooter>
            <Button disabled={!amount || submitMutation.isPending} onClick={() => submitMutation.mutate()}>
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
