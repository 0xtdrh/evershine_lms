'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ArrowRightLeft, Loader2, Search, Check } from 'lucide-react'
import { L, dayName } from '@/lib/i18n/client'

interface GroupRow {
  id: string
  label: string
  campus?: { id: string; name: string } | null
  maxStudents?: number | null
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
  toSeats: { max: number | null; count: number; free: number | null; full: boolean }
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

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${L('EGP', 'ج.م')}`
const slots = (s: GroupRow['scheduleSlots']) => (Array.isArray(s) && s.length ? s.map((x) => `${dayName(x.dayOfWeek)} ${x.time}`).join(', ') : '')
const ACTION_LABEL = (a: Action) => ({ MOVE: L('Move it to the new group', 'ينتقل مع الطالب للجروب الجديد'), KEEP: L('Keep it', 'يفضل زي ما هو'), END: L('Stop it', 'يتوقف') })[a]
const SCOPE_LABEL = (s: 'GROUP' | 'TRACK' | 'STUDENT') => ({ GROUP: L('on this student in the old group', 'على الطالب في الجروب القديم'), TRACK: L('on this student in a track', 'على الطالب في تراك'), STUDENT: L('on this student everywhere', 'على الطالب في كل مكان') })[s]

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
  const [overrideCapacity, setOverrideCapacity] = useState(false)

  useEffect(() => {
    if (!open) { setToId(''); setCreditTo(''); setDecisions({}); setReason(''); setOverrideCapacity(false) }
  }, [open])

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['groups-for-transfer'],
    queryFn: () => fetchApi<GroupRow[]>('/api/groups'),
    enabled: open,
  })
  const targets = useMemo(() => (groups ?? []).filter((g) => g.id !== fromGroupId && g.status === 'ACTIVE'), [groups, fromGroupId])
  // owner 15/11: the list in parts — suggested (same level, same branch first), same course, the rest — with a search
  const [q, setQ] = useState('')
  useEffect(() => { if (!open) setQ('') }, [open])
  const from = useMemo(() => (groups ?? []).find((g) => g.id === fromGroupId), [groups, fromGroupId])
  const sections = useMemo(() => {
    const norm = (x: string) => x.toLowerCase()
    const n = norm(q.trim())
    const hit = (g: GroupRow) => !n || [g.label, g.course?.name, g.level?.name, g.teacher?.name, g.campus?.name].some((v) => v && norm(v).includes(n))
    const list = targets.filter(hit)
    const sameBranchFirst = (a: GroupRow, b: GroupRow) => Number(b.campus?.id === from?.campus?.id) - Number(a.campus?.id === from?.campus?.id)
    const suggested = list.filter((g) => from?.level && g.level?.id === from.level.id).sort(sameBranchFirst)
    const sameCourse = list.filter((g) => !suggested.includes(g) && from?.course && g.course?.id === from.course.id).sort(sameBranchFirst)
    const rest = list.filter((g) => !suggested.includes(g) && !sameCourse.includes(g)).sort(sameBranchFirst)
    return [
      { key: 'suggested', title: L('Suggested: same level', 'مقترح: نفس المستوى'), rows: suggested },
      { key: 'course', title: L('Same course, another level', 'نفس الكورس، مستوى تاني'), rows: sameCourse },
      { key: 'rest', title: L('Other groups', 'جروبات تانية'), rows: rest },
    ].filter((x) => x.rows.length)
  }, [targets, q, from])

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
          overrideCapacity: overrideCapacity || undefined,
        }),
      }),
    onSuccess: (r) => {
      const credit = r.credit > 0
        ? r.creditApplied > 0
          ? ` ${money(r.creditApplied)} ${L('paid onto the new invoice', 'اتدفعوا على الفاتورة الجديدة')}${r.creditLeftInWallet > 0 ? `، ${money(r.creditLeftInWallet)} ${L('left in the wallet', 'فضلوا في المحفظة')}` : ''}.`
          : ` ${money(r.credit)} ${L('added to the wallet', 'اتضافوا للمحفظة')}.`
        : ''
      notify.success(`${studentName} ${L('moved to', 'اتنقل لـ')} ${preview?.to.label ?? L('the new group', 'الجروب الجديد')}.${credit}`)
      if (r.warning) notify.error(r.warning)
      for (const k of ['group-detail', 'groups', 'student', 'students', 'student-fees', 'student-extra-fees', 'discounts', 'wallet', 'fees', 'student-transfers', 'refunds']) qc.invalidateQueries({ queryKey: [k] })
      onOpenChange(false)
      onDone?.()
    },
    onError: (err: Error) => notify.error(err.message || L('Could not move the student', 'النقل ماحصلش')),
  })

  const { data: perms } = useQuery({
    queryKey: ['my-permissions-transfer'],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: open,
  })
  const canOverride = !!perms?.permissions?.group_capacity?.includes('approve')
  const full = !!preview?.toSeats?.full
  const ready = !!preview && (!hasCredit || !!creditTo) && preview.discounts.every((d) => decisions[d.assignmentId]) && (!full || overrideCapacity)
  const inv = preview?.invoice

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> {L('Move', 'نقل')} {studentName} {L('to another group', 'لجروب تاني')}</DialogTitle>
          <DialogDescription>{L('Any course, level or time. Attendance history stays with the student.', 'أي كورس أو مستوى أو ميعاد. سجل الحضور بيفضل مع الطالب.')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <Label>{L('New group', 'الجروب الجديد')}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-8" placeholder={L('Search group, course, level, instructor…', 'دوّر بالجروب أو الكورس أو المستوى أو المدرب…')} />
            </div>
            {groupsLoading ? (
              <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{L('Loading groups…', 'بيحمّل الجروبات…')}</p>
            ) : !sections.length ? (
              <p className="text-slate-500">{L('No group matches.', 'مفيش جروب بالاسم ده.')}</p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto pe-1">
                {sections.map((sec) => (
                  <div key={sec.key} className="space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500">{sec.title} ({sec.rows.length})</p>
                    {sec.rows.map((g) => {
                      const isFull = g.maxStudents != null && g.studentCount >= g.maxStudents
                      const picked = toId === g.id
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setToId(g.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-start transition ${picked ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800">{picked && <Check className="me-1 inline h-3.5 w-3.5 text-indigo-600" />}{g.label}</span>
                            <span className={`text-xs ${isFull ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>
                              {g.studentCount}{g.maxStudents != null ? `/${g.maxStudents}` : ''} {L('students', 'طالب')}{isFull ? ` · ${L('full', 'مليان')}` : ''}
                            </span>
                          </span>
                          <span className="block text-xs text-slate-500">
                            {[g.course?.name, g.level?.name].filter(Boolean).join(' · ')}{g.campus && g.campus.id !== from?.campus?.id ? ` · ${g.campus.name}` : ''}
                          </span>
                          {(slots(g.scheduleSlots) || g.teacher) && (
                            <span className="block text-xs text-slate-400">{[slots(g.scheduleSlots), g.teacher?.name].filter(Boolean).join(' · ')}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {toId && previewLoading && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {L('Calculating…', 'بيحسب…')}</p>}
          {toId && previewError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{(previewError as Error).message}</p>}

          {preview && !previewLoading && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-800">{preview.from.label} → {preview.to.label}</p>
                <p className="text-xs text-slate-500">
                  {preview.to.course?.name} · {preview.to.level?.name}{preview.to.teacher ? ` · ${preview.to.teacher.name}` : ''} {L('· price', '· السعر')} {money(preview.to.price)}
                </p>
                {preview.toSeats && (
                  <p className={`mt-1 text-xs ${full ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                    {preview.toSeats.count}{preview.toSeats.max != null ? `/${preview.toSeats.max}` : ''} {L('students', 'طالب')}{full ? ` · ${L('this group is full', 'الجروب ده مليان')}` : preview.toSeats.free != null ? ` · ${preview.toSeats.free} ${L('free', 'فاضي')}` : ''}
                  </p>
                )}
                {full && (canOverride ? (
                  <label className="mt-1 flex items-center gap-2 text-xs text-rose-700"><input type="checkbox" checked={overrideCapacity} onChange={(e) => setOverrideCapacity(e.target.checked)} /> {L('Move anyway (over the limit)', 'انقل برضه (فوق الحد)')}</label>
                ) : (
                  <p className="mt-1 text-xs text-rose-700">{L('Choose another group, or ask someone with the “Group capacity” permission.', 'اختار جروب تاني، أو اطلب من حد عنده صلاحية «سعة الجروب».')}</p>
                ))}
                {preview.newGroupInvoice && (
                  <p className="mt-1 text-xs text-amber-700">{L('The student already has invoice', 'الطالب عنده فاتورة')} {preview.newGroupInvoice.challanNumber} {L('in the new group; it is used instead of a new one.', 'في الجروب الجديد، وهتتستخدم بدل فاتورة جديدة.')}</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-slate-700">{L('Money (old group)', 'الفلوس (الجروب القديم)')}</p>
                {!inv ? (
                  <p className="text-slate-500">{L('No invoice in the old group: nothing to move.', 'مفيش فاتورة في الجروب القديم: مفيش حاجة تتنقل.')}</p>
                ) : (
                  <div className="space-y-0.5 rounded-lg border border-slate-200 px-3 py-2">
                    <Row k={`${L('Paid on', 'المدفوع على')} ${inv.challanNumber}`} v={money(inv.netPaid)} />
                    <Row
                      k={`${inv.sessionsCounted} ${L('session(s)', 'حصة')} ${inv.basis === 'HELD' ? L('held', 'اتعملت') : L('attended', 'حضرها')} × ${money(inv.perSession)}${inv.sessionsInCycle ? ` (${L('of', 'من')} ${inv.sessionsInCycle})` : ''}`}
                      v={`− ${money(inv.consumed)}`}
                    />
                    <Row k={L('Credit left over', 'الباقي له')} v={money(inv.credit)} strong />
                    {inv.owed > 0 && <p className="text-xs text-amber-700">{money(inv.owed)} {L('is still due on the old invoice for the sessions counted.', 'لسه مستحق على الفاتورة القديمة للحصص المحسوبة.')}</p>}
                    {inv.cancelled > 0 && <p className="text-xs text-slate-500">{money(inv.cancelled)} {L('unpaid on the old invoice will be cancelled.', 'مش مدفوع على الفاتورة القديمة هيتلغي.')}</p>}
                  </div>
                )}
                {hasCredit && (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-slate-600">{L('Where does the', 'الـ')} {money(inv!.credit)} {L('go?', 'تروح فين؟')}</p>
                    <label className="flex items-center gap-2"><input type="radio" checked={creditTo === 'NEW_INVOICE'} onChange={() => setCreditTo('NEW_INVOICE')} /> {L('Take it off the new group’s invoice', 'اخصمها من فاتورة الجروب الجديد')}</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={creditTo === 'WALLET'} onChange={() => setCreditTo('WALLET')} /> {L('Put it in the student wallet', 'حطها في محفظة الطالب')}</label>
                  </div>
                )}
              </div>

              {preview.discounts.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold text-slate-700">{L('Discounts: what happens to each?', 'الخصومات: كل واحد يحصله إيه؟')}</p>
                  {preview.discounts.map((d) => (
                    <div key={d.assignmentId} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-slate-800">
                        {d.typeName} · {d.valueType === 'PERCENT' ? `${d.value}%` : money(d.value)}
                        <span className="text-xs text-slate-500"> · {SCOPE_LABEL(d.scope)}{d.status === 'PENDING' ? ` · ${L('waiting for approval', 'مستني موافقة')}` : ''}</span>
                      </p>
                      {!d.typeFitsNewGroup && <p className="text-xs text-amber-700">{L('This discount type is limited to another track/course/level, so it will not apply in the new group.', 'نوع الخصم ده لتراك / كورس / مستوى تاني، فمش هيتطبّق في الجروب الجديد.')}</p>}
                      <Select value={decisions[d.assignmentId] ?? ''} onValueChange={(v) => setDecisions((s) => ({ ...s, [d.assignmentId]: v as Action }))}>
                        <SelectTrigger className="mt-1 h-8"><SelectValue placeholder={L('Choose', 'اختار')} /></SelectTrigger>
                        <SelectContent>
                          {d.options.map((o) => <SelectItem key={o} value={o}>{ACTION_LABEL(o)}{o === d.suggested ? ` (${L('suggested', 'مقترح')})` : ''}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>{L('Reason (optional)', 'السبب (اختياري)')}</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('e.g. another time suits the family', 'مثلاً: ميعاد تاني مناسب للأسرة')} />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>{L('Cancel', 'إلغاء')}</Button>
                <Button onClick={() => send.mutate()} disabled={!ready || send.isPending} className="gap-2">
                  {send.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {L('Move the student', 'انقل الطالب')}
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
