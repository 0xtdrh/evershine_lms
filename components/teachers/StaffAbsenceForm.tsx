'use client'

/**
 * 2026-10-24 (owner): the front desk records an instructor's absence on his behalf (he called / sent a message) —
 * pick the instructor, then one of his coming sessions or the whole day. Same rules as his own request
 * (6 hours notice unless force majeure). The request then appears in the list to approve and to pick a substitute.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { L } from '@/lib/i18n/client'

interface DaySession { classSectionId: string; className: string; sectionName: string; time: string; isCancelled?: boolean; isSubstituteCoverageHere?: boolean }
interface DayEntry { date: string; sessions: DaySession[] }
type Pick = { date: string; classSectionId: string | null }

export function StaffAbsenceForm() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [teacherId, setTeacherId] = useState('')
  const [pick, setPick] = useState<Pick | null>(null)
  const [reason, setReason] = useState('')
  const [force, setForce] = useState(false)

  const { data: teachers } = useQuery({
    queryKey: ['absence-form-teachers'],
    queryFn: () => fetchPaginatedApi<{ id: string; firstName: string; lastName: string }>('/api/teachers?limit=100'),
    enabled: open,
  })
  const { data: days = [] } = useQuery<DayEntry[]>({
    queryKey: ['absence-form-week', teacherId],
    queryFn: () => fetchApi(`/api/teachers/${teacherId}/my-week?days=14`),
    enabled: open && !!teacherId,
  })

  const reset = () => { setTeacherId(''); setPick(null); setReason(''); setForce(false) }
  const save = useMutation({
    mutationFn: () => fetchApi('/api/teacher-absences', {
      method: 'POST',
      body: JSON.stringify({ teacherId, date: pick!.date, scope: pick!.classSectionId ? 'SINGLE_SESSION' : 'FULL_DAY', classSectionId: pick!.classSectionId ?? undefined, reason, isForceMajeure: force }),
    }),
    onSuccess: () => {
      notify.success(L('Absence recorded — approve it and choose a substitute below', 'الغياب اتسجل — وافق عليه واختار البديل من القايمة'))
      qc.invalidateQueries({ queryKey: ['teacher-absences'] })
      setOpen(false); reset()
    },
    onError: (e: Error) => notify.error(e.message),
  })

  const sel = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm'
  const own = days.map((d) => ({ ...d, sessions: d.sessions.filter((s) => !s.isCancelled && !s.isSubstituteCoverageHere) })).filter((d) => d.sessions.length)

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{L('Record an instructor absence', 'سجّل غياب لمدرب')}</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{L('Record an instructor absence', 'سجّل غياب لمدرب')}</DialogTitle>
            <DialogDescription>{L('For an instructor who called or sent a message. Same rule as his own request: at least 6 hours before the session, unless it is an emergency.', 'لمدرب اتصل أو بعت رسالة. نفس قاعدة طلبه: قبل الحصة بـ 6 ساعات على الأقل، إلا لو ظرف طارئ.')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">{L('Instructor', 'المدرب')}</span>
              <select className={sel} value={teacherId} onChange={(e) => { setTeacherId(e.target.value); setPick(null) }}>
                <option value="">—</option>
                {(teachers?.data ?? []).map((t) => <option key={t.id} value={t.id}>{`${t.firstName} ${t.lastName}`.trim()}</option>)}
              </select>
            </label>
            {teacherId && (
              <div className="space-y-2">
                <span className="text-xs text-slate-500">{L('Which session? (next 14 days)', 'أنهي حصة؟ (الـ 14 يوم الجايين)')}</span>
                {!own.length && <p className="text-slate-500">{L('No sessions in the next 14 days.', 'مفيش حصص في الـ 14 يوم الجايين.')}</p>}
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {own.map((d) => (
                    <div key={d.date} className="rounded-lg border border-slate-200 p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <b className="text-slate-700">{d.date.split('-').reverse().join('/')}</b>
                        {d.sessions.length > 1 && (
                          <button type="button" className={`rounded px-2 py-0.5 text-xs ${pick?.date === d.date && !pick.classSectionId ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`} onClick={() => setPick({ date: d.date, classSectionId: null })}>{L('Whole day', 'اليوم كله')}</button>
                        )}
                      </div>
                      {d.sessions.map((s) => {
                        const active = pick?.date === d.date && pick.classSectionId === s.classSectionId
                        return (
                          <button key={`${s.classSectionId}-${s.time}`} type="button" onClick={() => setPick({ date: d.date, classSectionId: s.classSectionId })}
                            className={`mt-1 block w-full rounded px-2 py-1 text-start ${active ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50'}`}>
                            {s.time} · {`${s.className} ${s.sectionName}`.trim()}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">{L('Reason', 'السبب')}</span>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('e.g. sick, called this morning', 'مثلاً: تعبان، اتصل الصبح')} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {L('Emergency (severe illness, bereavement) — allowed with less than 6 hours', 'ظرف طارئ (مرض شديد، وفاة) — مسموح قبل الحصة بأقل من 6 ساعات')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{L('Cancel', 'إلغاء')}</Button>
            <Button disabled={!teacherId || !pick || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>{L('Record', 'سجّل')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
