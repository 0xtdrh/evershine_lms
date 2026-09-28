'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { Loader2, Clock } from 'lucide-react'

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

interface DaySession {
  classSectionId: string
  className: string
  sectionName: string
  time: string
  courseName: string | null
  levelName: string | null
  absenceStatus: string | null
  isSubstituteCoverageHere: boolean
  coveringForName: string | null
  isCancelled?: boolean
  cancelledReason?: string | null
  hasNotStarted?: boolean
  sessionNumber?: number | null
  totalSessions?: number | null
}

interface DayEntry { date: string; sessions: DaySession[] }

interface RemainingSession { date: string; time: string; sessionNumber: number; totalSessions: number }

interface MyAbsenceRow {
  id: string
  date: string
  scope: 'FULL_DAY' | 'SINGLE_SESSION'
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  reason: string
  classSection: { className: string; sectionName: string } | null
}

export default function MySchedulePage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  const { data: myProfile } = useQuery<{ id: string }>({
    queryKey: ['my-teacher-profile'],
    queryFn: () => fetchApi('/api/teachers/profile'),
    enabled: session?.user?.role === 'TEACHER',
  })
  const teacherId = myProfile?.id

  const { data: days = [], isLoading } = useQuery<DayEntry[]>({
    queryKey: ['my-week', teacherId],
    queryFn: () => fetchApi(`/api/teachers/${teacherId}/my-week?days=7`),
    enabled: !!teacherId,
  })

  const { data: myAbsences = [] } = useQuery<MyAbsenceRow[]>({
    queryKey: ['my-absences'],
    queryFn: () => fetchApi('/api/teacher-absences'),
    enabled: !!teacherId,
  })

  // ── Step 1: pick which specific session to excuse ────────────────────
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null)
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const { data: remainingSessions = [], isLoading: remainingLoading } = useQuery<RemainingSession[]>({
    queryKey: ['remaining-sessions', pickerGroupId],
    queryFn: () => fetchApi(`/api/groups/${pickerGroupId}/remaining-sessions`),
    enabled: !!pickerGroupId,
  })

  // ── Step 2: reason + submit ────────────────────────────────────────────
  const [excuseTarget, setExcuseTarget] = useState<{ date: string; classSectionId: string | null; wholeDay: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [isForceMajeure, setIsForceMajeure] = useState(false)

  const submitMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/teacher-absences', {
        method: 'POST',
        body: JSON.stringify({
          date: excuseTarget?.date,
          scope: excuseTarget?.wholeDay ? 'FULL_DAY' : 'SINGLE_SESSION',
          classSectionId: excuseTarget?.wholeDay ? undefined : excuseTarget?.classSectionId,
          reason,
          isForceMajeure,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-week', teacherId] })
      queryClient.invalidateQueries({ queryKey: ['my-absences'] })
      notify.success('Absence request submitted')
      setExcuseTarget(null)
      setPickerGroupId(null)
      setPickedDate(null)
      setReason('')
      setIsForceMajeure(false)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to submit')),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/teacher-absences/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-absences'] })
      queryClient.invalidateQueries({ queryKey: ['my-week', teacherId] })
      notify.success('Request cancelled')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to cancel')),
  })

  if (!teacherId) {
    return <p className="p-6 text-sm text-slate-400 text-center">This page is for teacher accounts.</p>
  }

  const openWholeDay = (date: string) => setExcuseTarget({ date, classSectionId: null, wholeDay: true })
  const openSessionPicker = (classSectionId: string) => { setPickerGroupId(classSectionId); setPickedDate(null) }
  const proceedToReason = () => {
    if (!pickerGroupId || !pickedDate) return
    setExcuseTarget({ date: pickedDate, classSectionId: pickerGroupId, wholeDay: false })
    setPickerGroupId(null)
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-900">My Schedule</h1>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-3">
          {days.map((day) => (
            <Card key={day.date}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <CardTitle className="text-sm">{new Date(day.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</CardTitle>
                {day.sessions.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openWholeDay(day.date)}>
                    Excuse whole day
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {day.sessions.length === 0 ? (
                  <p className="text-xs text-slate-400">No sessions.</p>
                ) : (
                  day.sessions.map((s) => (
                    <div key={`${s.classSectionId}-${s.time}`} className={`flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${s.isCancelled ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100'}`}>
                      <div>
                        <p className="font-medium text-slate-800 flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-400" /> {s.time} · {s.className} {s.sectionName}
                          {s.isSubstituteCoverageHere && (
                            <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-200">
                              Substitute{s.coveringForName ? ` for ${s.coveringForName}` : ''}
                              {s.sessionNumber ? ` · Session ${s.sessionNumber} of ${s.totalSessions}` : ''}
                            </Badge>
                          )}
                          {s.isCancelled && <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-200">Cancelled</Badge>}
                        </p>
                        <p className="text-xs text-slate-400">{s.courseName} — {s.levelName}</p>
                      </div>
                      {s.isCancelled || s.isSubstituteCoverageHere ? null : s.hasNotStarted ? (
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">Not started yet</Badge>
                      ) : s.absenceStatus ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <Badge variant="outline" className="text-[10px]">{s.absenceStatus}</Badge>
                          <button
                            className="text-[10px] text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                            onClick={() => openSessionPicker(s.classSectionId)}
                          >
                            Excuse another session
                          </button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openSessionPicker(s.classSectionId)}>
                          Excuse
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">My requests</h2>
        {myAbsences.length === 0 ? (
          <p className="text-sm text-slate-400">None yet.</p>
        ) : (
          <div className="space-y-2">
            {myAbsences.map((a) => (
              <div key={a.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                <div>
                  <p className="text-slate-800">{a.date.slice(0, 10)} — {a.scope === 'FULL_DAY' ? 'Whole day' : a.classSection ? `${a.classSection.className} ${a.classSection.sectionName}` : 'Session'}</p>
                  <p className="text-xs text-slate-400">{a.reason}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{a.status}</Badge>
                  {(a.status === 'PENDING' || a.status === 'APPROVED') && (
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-red-600" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(a.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 1: pick a specific remaining session */}
      <Dialog open={!!pickerGroupId} onOpenChange={(open) => !open && setPickerGroupId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Which session?</DialogTitle>
            <DialogDescription>Pick exactly one remaining session in this group&apos;s current cycle.</DialogDescription>
          </DialogHeader>
          {remainingLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : remainingSessions.length === 0 ? (
            <p className="text-sm text-slate-400">No upcoming sessions found for this cycle.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {remainingSessions.map((rs) => (
                <label key={rs.date} className="flex items-center gap-2 border border-slate-100 rounded-lg px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="radio" name="session-pick" checked={pickedDate === rs.date} onChange={() => setPickedDate(rs.date)} />
                  Session {rs.sessionNumber} of {rs.totalSessions} — {rs.date} · {rs.time}
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button disabled={!pickedDate} onClick={proceedToReason}>Next</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: reason */}
      <Dialog open={!!excuseTarget} onOpenChange={(open) => !open && setExcuseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{excuseTarget?.wholeDay ? 'Excuse whole day' : 'Excuse this session'}</DialogTitle>
            <DialogDescription>
              {excuseTarget?.date} — needs at least 6 hours notice unless force-majeure.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <Checkbox checked={isForceMajeure} onCheckedChange={setIsForceMajeure} />
            This is a force-majeure emergency (severe illness, bereavement)
          </label>
          <DialogFooter>
            <Button disabled={!reason || submitMutation.isPending} onClick={() => submitMutation.mutate()}>
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
