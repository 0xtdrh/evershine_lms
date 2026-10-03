'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowRightLeft, Loader2 } from 'lucide-react'

interface GroupRow {
  id: string
  label: string
  course: { id: string; name: string } | null
  level: { id: string; name: string } | null
  teacher: { id: string; name: string } | null
  studentCount: number
  scheduleSlots: { dayOfWeek: number; time: string }[] | null
  status: string
}

type Action = 'MOVE' | 'KEEP' | 'END'
interface Preview {
  student: { id: string; name: string }
  from: { label: string }
  to: { label: string; price: number; course: { name: string } | null; level: { name: string } | null; teacher: { name: string } | null }
  invoice: {
    challanNumber: string
    netPaid: number
    perSession: number
    sessionsCounted: number
    sessionsInCycle: number | null
    basis: 'ATTENDED' | 'HELD'
    consumed: number
    credit: number
    owed: number
    cancelled: number
  } | null
  newGroupInvoice: { challanNumber: string; totalAmount: number; paidAmount: number } | null
  discounts: {
    assignmentId: string
    typeName: string
    valueType: string
    value: number
    scope: 'GROUP' | 'TRACK' | 'STUDENT'
    status: string
    options: Action[]
    suggested: Action
    typeFitsNewGroup: boolean
  }[]
}
interface Outcome {
  credit: number
  creditTo: 'NEW_INVOICE' | 'WALLET'
  creditApplied: number
  creditLeftInWallet: number
  warning: string | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
const slots = (s: GroupRow['scheduleSlots']) => (Array.isArray(s) && s.length ? s.map((x) => `${DAYS[x.dayOfWeek] ?? '?'} ${x.time}`).join(', ') : '')
const ACTION_LABEL: Record<Action, string> = { MOVE: 'Move it to the new group', KEEP: 'Keep it', END: 'Stop it' }
const SCOPE_LABEL = { GROUP: 'on this student in the old group', TRACK: 'on this student in a track', STUDENT: 'on this student everywhere' }

/** Move a student to another group: shows the money and asks about each discount before doing anything. */
export function TransferStudentDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  fromGroupId,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  studentId: string
  studentName: string
  fromGroupId: string
  onDone?: () => void
}) {
  const qc = useQueryClient()
  const [toId, setToId] = useState('')
  const [creditTo, setCreditTo] = useState<'NEW_INVOICE' | 'WALLET' | ''>('')
  const [decisions, setDecisions] = useState<Record<string, Action>>({})
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) { setToId(''); setCreditTo(''); setDecisions({}); setReason('') }
  }, [open])

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['groups-for-transfer'],
    queryFn: () => fetchApi<GroupRow[]>('/api/groups'),
    enabled: open,
  })
  const targets = useMemo(() => (groups ?? []).filter((g) => g.id !== fromGroupId && g.status === 'ACTIVE'), [groups, fromGroupId])

  const { data: preview, isFetching: previewLoading, error: previewError } = useQuery({
    queryKey: ['transfer-preview', studentId, fromGroupId, toId],
    queryFn: () => fetchApi<Preview>(`/api/students/${studentId}/transfer?from=${fromGroupId}&to=${toId}`),
    enabled: open && !!toId,
    retry: false,
  })
  useEffect(() => {
    if (preview) setDecisions(Object.fromEntries(preview.discounts.map((d) => [d.assignmentId, d.suggested])))
  }, [preview])

  const hasCredit = (preview?.invoice?.credit ?? 0) > 0
  const send = useMutation({
    mutationFn: () =>
      fetchApi<Outcome>(`/api/students/${studentId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          fromClassSectionId: fromGroupId,
          toClassSectionId: toId,
          creditTo: hasCredit ? creditTo : 'WALLET',
          discountDecisions: Object.entries(decisions).map(([assignmentId, action]) => ({ assignmentId, action })),
          reason: reason.trim() || null,
        }),
      }),
    onSuccess: (r) => {
      const credit = r.credit > 0
        ? r.creditApplied > 0
          ? ` ${money(r.creditApplied)} paid onto the new invoice${r.creditLeftInWallet > 0 ? `, ${money(r.creditLeftInWallet)} left in the wallet` : ''}.`
          : ` ${money(r.credit)} added to the wallet.`
        : ''
      notify.success(`${studentName} moved to ${preview?.to.label ?? 'the new group'}.${credit}`)
      if (r.warning) notify.error(r.warning)
      for (const k of ['group-detail', 'groups', 'student', 'students', 'student-fees', 'discounts', 'wallet', 'fees', 'student-transfers', 'refunds']) qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
      onDone?.()
    },
    onError: (err: Error) => notify.error(err.message || 'Could not move the student'),
  })

  const ready = !!preview && (!hasCredit || !!creditTo) && preview.discounts.every((d) => decisions[d.assignmentId])
  const inv = preview?.invoice

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Move {studentName} to another group</DialogTitle>
          <DialogDescription>Any course, level or time. Attendance history stays with the student.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label>New group</Label>
            <Select value={toId} onValueChange={setToId} disabled={groupsLoading}>
              <SelectTrigger><SelectValue placeholder={groupsLoading ? 'Loading groups…' : 'Choose the group'} /></SelectTrigger>
              <SelectContent>
                {targets.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} · {g.course?.name ?? '—'} · {g.level?.name ?? '—'}
                    {slots(g.scheduleSlots) ? ` · ${slots(g.scheduleSlots)}` : ''}
                    {` · ${g.studentCount} students`}{g.teacher ? ` · ${g.teacher.name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {toId && previewLoading && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculating…</p>}
          {toId && previewError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{(previewError as Error).message}</p>}

          {preview && !previewLoading && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-800">{preview.from.label} → {preview.to.label}</p>
                <p className="text-xs text-slate-500">
                  {preview.to.course?.name} · {preview.to.level?.name}{preview.to.teacher ? ` · ${preview.to.teacher.name}` : ''} · price {money(preview.to.price)}
                </p>
                {preview.newGroupInvoice && (
                  <p className="mt-1 text-xs text-amber-700">The student already has invoice {preview.newGroupInvoice.challanNumber} in the new group; it is used instead of a new one.</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-slate-700">Money (old group)</p>
                {!inv ? (
                  <p className="text-slate-500">No invoice in the old group: nothing to move.</p>
                ) : (
                  <div className="space-y-0.5 rounded-lg border border-slate-200 px-3 py-2">
                    <Row k={`Paid on ${inv.challanNumber}`} v={money(inv.netPaid)} />
                    <Row
                      k={`${inv.sessionsCounted} session(s) ${inv.basis === 'HELD' ? 'held' : 'attended'} × ${money(inv.perSession)}${inv.sessionsInCycle ? ` (of ${inv.sessionsInCycle})` : ''}`}
                      v={`− ${money(inv.consumed)}`}
                    />
                    <Row k="Credit left over" v={money(inv.credit)} strong />
                    {inv.owed > 0 && <p className="text-xs text-amber-700">{money(inv.owed)} is still due on the old invoice for the sessions counted.</p>}
                    {inv.cancelled > 0 && <p className="text-xs text-slate-500">{money(inv.cancelled)} unpaid on the old invoice will be cancelled.</p>}
                  </div>
                )}
                {hasCredit && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-slate-600">Where does the {money(inv!.credit)} go?</p>
                    <label className="flex items-center gap-2"><input type="radio" checked={creditTo === 'NEW_INVOICE'} onChange={() => setCreditTo('NEW_INVOICE')} /> Take it off the new group’s invoice</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={creditTo === 'WALLET'} onChange={() => setCreditTo('WALLET')} /> Put it in the student wallet</label>
                  </div>
                )}
              </div>

              {preview.discounts.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold text-slate-700">Discounts: what happens to each?</p>
                  {preview.discounts.map((d) => (
                    <div key={d.assignmentId} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-slate-800">
                        {d.typeName} · {d.valueType === 'PERCENT' ? `${d.value}%` : money(d.value)}
                        <span className="text-xs text-slate-500"> · {SCOPE_LABEL[d.scope]}{d.status === 'PENDING' ? ' · waiting for approval' : ''}</span>
                      </p>
                      {!d.typeFitsNewGroup && <p className="text-xs text-amber-700">This discount type is limited to another track/course/level, so it will not apply in the new group.</p>}
                      <Select value={decisions[d.assignmentId] ?? ''} onValueChange={(v) => setDecisions((s) => ({ ...s, [d.assignmentId]: v as Action }))}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Choose" /></SelectTrigger>
                        <SelectContent>
                          {d.options.map((o) => <SelectItem key={o} value={o}>{ACTION_LABEL[o]}{o === d.suggested ? ' (suggested)' : ''}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. another time suits the family" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={() => send.mutate()} disabled={!ready || send.isPending} className="gap-2">
                  {send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Move the student
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
      <span>{k}</span><span className="whitespace-nowrap">{v}</span>
    </div>
  )
}
