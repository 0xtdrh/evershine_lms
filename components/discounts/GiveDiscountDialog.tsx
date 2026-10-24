'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { ApplyToInvoicesDialog, type AffectedInvoice } from './ApplyToInvoicesDialog'
import { L } from '@/lib/i18n/client'

export interface DiscountTypeOption {
  id: string
  name: string
  kind: string
  valueType: 'PERCENT' | 'FIXED'
  value: number | string
  editableValue: boolean
  maxValue: number | string | null
  duration: string
  autoApply: boolean
  approvalMode: string
  isActive: boolean
}

const DURATION: Record<string, string> = { EVERY_CYCLE: 'every month', FIRST_CYCLE: 'first month only', ONE_TIME: 'one time' }
export const valueText = (t: { valueType: string; value: number | string }) =>
  t.valueType === 'PERCENT' ? `${Number(t.value)}%` : `${Number(t.value).toLocaleString()} EGP`

/**
 * Give a discount. `student` fixed -> optional group/track; no student -> a
 * whole-group discount (pick the group).
 */
export function GiveDiscountDialog({
  open,
  onOpenChange,
  student,
  studentGroups = [],
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  student?: { id: string; name: string } | null
  studentGroups?: { id: string; name: string }[]
}) {
  const qc = useQueryClient()
  const [typeId, setTypeId] = useState('')
  const [target, setTarget] = useState('ALL') // ALL | group:<id> | track:<id>
  const [groupId, setGroupId] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [ask, setAsk] = useState<{ id: string; invoices: AffectedInvoice[] } | null>(null)

  const { data: types } = useQuery({
    queryKey: ['discount-types'],
    queryFn: () => fetchApi<DiscountTypeOption[]>('/api/discount-types'),
    enabled: open,
  })
  const { data: options } = useQuery({
    queryKey: ['discount-options'],
    queryFn: () => fetchApi<{ tracks: { id: string; name: string }[]; groups: { id: string; name: string; detail: string }[] }>('/api/discounts/options'),
    enabled: open,
  })
  const manualTypes = useMemo(() => (types ?? []).filter((t) => t.isActive && !t.autoApply), [types])
  const type = manualTypes.find((t) => t.id === typeId)

  const reset = () => {
    setTypeId('')
    setTarget('ALL')
    setGroupId('')
    setValue('')
    setReason('')
  }

  const give = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { discountTypeId: typeId, reason: reason.trim() || null }
      if (student) {
        body.studentId = student.id
        if (target.startsWith('group:')) body.classSectionId = target.slice(6)
        if (target.startsWith('track:')) body.trackId = target.slice(6)
      } else {
        body.classSectionId = groupId
      }
      if (type?.editableValue && value !== '') body.value = Number(value)
      return fetchApi<{ assignment: { id: string; status: string }; affectedInvoices: AffectedInvoice[] }>('/api/discounts', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['discounts'] })
      if (r.assignment.status === 'PENDING') notify.success(L('Sent to a manager for approval', 'اتبعت لمدير للموافقة'))
      else notify.success(L('Discount added', 'الخصم اتضاف'))
      onOpenChange(false)
      reset()
      if (r.affectedInvoices?.length) setAsk({ id: r.assignment.id, invoices: r.affectedInvoices })
    },
    onError: (err: Error) => notify.error(err.message || L('Could not add the discount', 'الخصم ماتضافش')),
  })

  const max = type?.maxValue != null ? Number(type.maxValue) : type?.valueType === 'PERCENT' ? 100 : undefined
  const ready = !!typeId && (student ? true : !!groupId)

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{student ? `Discount for ${student.name}` : 'Discount for a whole group'}</DialogTitle>
            <DialogDescription>
              {L('Applied automatically to new invoices. Students added to the group later get a group discount too.', 'بيتطبّق لوحده على الفواتير الجديدة. والطلاب اللي هيتضافوا للجروب بعدين هياخدوه برضه.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{L('Discount type', 'نوع الخصم')}</Label>
              <Select value={typeId} onValueChange={(v) => { setTypeId(v); setValue('') }}>
                <SelectTrigger><SelectValue placeholder={L('Choose…', 'اختار…')} /></SelectTrigger>
                <SelectContent>
                  {manualTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {valueText(t)} · {DURATION[t.duration] ?? t.duration}
                      {t.approvalMode === 'STAFF_WITH_APPROVAL' ? ' · needs approval' : t.approvalMode === 'MANAGER' ? ' · manager only' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {types && manualTypes.length === 0 && (
                <p className="text-xs text-muted-foreground">{L('No discount types yet. Create them in Discounts › Types.', 'لسه مفيش أنواع خصم. اعملها من الخصومات › الأنواع.')}</p>
              )}
            </div>

            {type?.editableValue && (
              <div className="space-y-1">
                <Label>{L('Value (', 'القيمة (')}{type.valueType === 'PERCENT' ? '%' : 'EGP'}){max !== undefined ? ` — max ${max}` : ''}</Label>
                <Input type="number" min={0} max={max} value={value} placeholder={String(Number(type.value))} onChange={(e) => setValue(e.target.value)} />
              </div>
            )}

            {student ? (
              <div className="space-y-1">
                <Label>{L('Where', 'فين')}</Label>
                <Select value={target} onValueChange={setTarget}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All the student&apos;s groups</SelectItem>
                    {studentGroups.map((g) => <SelectItem key={g.id} value={`group:${g.id}`}>{L('Only in group', 'في جروب بس')} {g.name}</SelectItem>)}
                    {(options?.tracks ?? []).map((t) => <SelectItem key={t.id} value={`track:${t.id}`}>{L('Only in track', 'في تراك بس')} {t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>{L('Group', 'الجروب')}</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger><SelectValue placeholder={L('Choose a group…', 'اختار جروب…')} /></SelectTrigger>
                  <SelectContent>
                    {(options?.groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}{g.detail ? ` — ${g.detail}` : ''}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label>{L('Reason', 'السبب')}</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('Why this discount (kept in the record)', 'سبب الخصم (بيتسجل)')} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{L('Cancel', 'إلغاء')}</Button>
              <Button onClick={() => give.mutate()} disabled={!ready || give.isPending}>
                {give.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {type?.approvalMode === 'STAFF_WITH_APPROVAL' ? 'Send for approval' : 'Add discount'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ApplyToInvoicesDialog assignmentId={ask?.id ?? null} invoices={ask?.invoices ?? []} onDone={() => setAsk(null)} />
    </>
  )
}
