'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'

export interface AffectedInvoice {
  id: string
  challanNumber: string
  month: string
  totalAmount: number | string
  paidAmount: number | string
  student?: { firstName: string; lastName: string } | null
}

/**
 * The "ask" step (owner's choice): a new discount is active and the student
 * still has unpaid invoices — apply it to them too, or only to future ones?
 */
export function ApplyToInvoicesDialog({
  assignmentId,
  invoices,
  onDone,
}: {
  assignmentId: string | null
  invoices: AffectedInvoice[]
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => setSelected(invoices.map((i) => i.id)), [invoices])

  const apply = useMutation({
    mutationFn: () =>
      fetchApi<{ results: { invoiceId: string; ok: boolean; reason?: string }[] }>(`/api/discounts/${assignmentId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ invoiceIds: selected }),
      }),
    onSuccess: (r) => {
      const ok = r.results.filter((x) => x.ok).length
      const failed = r.results.filter((x) => !x.ok)
      if (ok) notify.success(`Discount applied to ${ok} invoice(s)`)
      if (failed.length) notify.error(failed[0].reason || 'Some invoices could not be changed')
      qc.invalidateQueries()
      onDone()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not apply'),
  })

  return (
    <Dialog open={!!assignmentId && invoices.length > 0} onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply to the current invoice too?</DialogTitle>
          <DialogDescription>
            The discount will be applied to every new invoice. These invoices are not fully paid yet — choose if they should get it too.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {invoices.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(i.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))}
              />
              <span className="min-w-0">
                <span className="font-medium">{i.month}</span>
                {i.student && <span className="text-muted-foreground"> · {i.student.firstName} {i.student.lastName}</span>}
                <span className="block text-xs text-muted-foreground">
                  {i.challanNumber} · total {Number(i.totalAmount).toLocaleString()} EGP · paid {Number(i.paidAmount).toLocaleString()}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onDone}>No, only future invoices</Button>
          <Button onClick={() => apply.mutate()} disabled={selected.length === 0 || apply.isPending}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, apply to {selected.length} invoice(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
