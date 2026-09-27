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
}

interface DayEntry { date: string; sessions: DaySession[] }

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

  const [excuseTarget, setExcuseTarget] = useState<{ date: string; session: DaySession | null; wholeDay: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [isForceMajeure, setIsForceMajeure] = useState(false)

  const submitMutation = useMutation({
    mutationFn: () =>
      fetchApi('/api/teacher-absences', {
        method: 'POST',
        body: JSON.stringify({
          date: excuseTarget?.date,
          scope: excuseTarget?.wholeDay ? 'FULL_DAY' : 'SINGLE_SESSION',
          classSectionId: excuseTarget?.wholeDay ? undefined : excuseTarget?.session?.classSectionId,
          reason,
          isForceMajeure,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-week', teacherId] })
      notify.success('Absence request submitted')
      setExcuseTarget(null)
      setReason('')
      setIsForceMajeure(false)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to submit')),
  })

  if (!teacherId) {
    return <p className="p-6 text-sm text-slate-400 text-center">This page is for teacher accounts.</p>
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
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
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setExcuseTarget({ date: day.date, session: null, wholeDay: true })}>
                    Excuse whole day
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {day.sessions.length === 0 ? (
                  <p className="text-xs text-slate-400">No sessions.</p>
                ) : (
                  day.sessions.map((s) => (
                    <div key={`${s.classSectionId}-${s.time}`} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-800 flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-slate-400" /> {s.time} · {s.className} {s.sectionName}
                          {s.isSubstituteCoverageHere && (
                            <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-200">
                              Substitute {s.coveringForName ? `for ${s.coveringForName}` : ''}
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{s.courseName} — {s.levelName}</p>
                      </div>
                      {s.absenceStatus ? (
                        <Badge variant="outline" className="text-[10px]">{s.absenceStatus}</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExcuseTarget({ date: day.date, session: s, wholeDay: false })}>
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

      <Dialog open={!!excuseTarget} onOpenChange={(open) => !open && setExcuseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{excuseTarget?.wholeDay ? 'Excuse whole day' : 'Excuse this session'}</DialogTitle>
            <DialogDescription>
              {excuseTarget?.wholeDay ? excuseTarget.date : `${excuseTarget?.session?.time} · ${excuseTarget?.session?.className} ${excuseTarget?.session?.sectionName}`}
              {' '}— needs at least 6 hours notice unless force-majeure.
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
