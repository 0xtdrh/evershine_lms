'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { Loader2, Clock, AlertTriangle } from 'lucide-react'

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.hasFieldErrors) return err.fieldErrors[0].message
    return err.message
  }
  return err instanceof Error ? err.message : fallback
}

interface AbsenceRow {
  id: string
  date: string
  scope: 'FULL_DAY' | 'SINGLE_SESSION'
  reason: string
  isForceMajeure: boolean
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedAt: string
  teacher: { id: string; firstName: string; lastName: string }
  classSection: { id: string; className: string; sectionName: string } | null
  substitutes: { status: string; substituteTeacher: { firstName: string; lastName: string } }[]
}

interface SuggestionGroup {
  classSectionId: string
  groupLabel: string
  time: string
  courseName: string | null
  levelName: string | null
  candidates: { id: string; name: string }[]
  existingAssignment: { substituteTeacherId: string; status: string } | null
}

function isUrgent(row: AbsenceRow): boolean {
  if (row.status !== 'PENDING') return false
  const hoursSinceRequest = (Date.now() - new Date(row.requestedAt).getTime()) / (1000 * 60 * 60)
  // Rough heuristic: still pending and requested date is today or tomorrow.
  const hoursUntilDate = (new Date(row.date).getTime() - Date.now()) / (1000 * 60 * 60)
  return hoursUntilDate < 24 && hoursUntilDate > -24
}

export default function AbsenceRequestsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')
  const [rejectDialogId, setRejectDialogId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [substituteDialogId, setSubstituteDialogId] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery<AbsenceRow[]>({
    queryKey: ['teacher-absences', tab],
    queryFn: () => fetchApi(`/api/teacher-absences?status=${tab}`),
  })

  const respondMutation = useMutation({
    mutationFn: ({ id, decision, rejectionReason }: { id: string; decision: 'APPROVE' | 'REJECT'; rejectionReason?: string }) =>
      fetchApi(`/api/teacher-absences/${id}/respond`, { method: 'POST', body: JSON.stringify({ decision, rejectionReason }) }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['teacher-absences'] })
      notify.success(vars.decision === 'APPROVE' ? 'Approved' : 'Rejected')
      setRejectDialogId(null)
      setRejectionReason('')
      if (vars.decision === 'APPROVE') setSubstituteDialogId(vars.id)
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to respond')),
  })

  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery<SuggestionGroup[]>({
    queryKey: ['substitute-suggestions', substituteDialogId],
    queryFn: () => fetchApi(`/api/teacher-absences/${substituteDialogId}/substitute-suggestions`),
    enabled: !!substituteDialogId,
  })

  const assignMutation = useMutation({
    mutationFn: ({ classSectionId, substituteTeacherId }: { classSectionId: string; substituteTeacherId: string }) =>
      fetchApi(`/api/teacher-absences/${substituteDialogId}/assign-substitute`, {
        method: 'POST',
        body: JSON.stringify({ classSectionId, substituteTeacherId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['substitute-suggestions', substituteDialogId] })
      queryClient.invalidateQueries({ queryKey: ['teacher-absences'] })
      notify.success('Substitute requested — awaiting their acceptance')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to assign substitute')),
  })

  const noSubstituteMutation = useMutation({
    mutationFn: ({ classSectionId, action }: { classSectionId: string; action: 'CONTINUE' | 'CANCEL_SESSION' }) =>
      fetchApi(`/api/teacher-absences/${substituteDialogId}/no-substitute-action`, {
        method: 'POST',
        body: JSON.stringify({ classSectionId, action }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['substitute-suggestions', substituteDialogId] })
      queryClient.invalidateQueries({ queryKey: ['teacher-absences'] })
      notify.success(vars.action === 'CANCEL_SESSION' ? 'Session cancelled' : 'Marked as continuing without a substitute')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to save')),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/teacher-absences/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-absences'] })
      notify.success('Request cancelled')
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to cancel')),
  })

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Absence Requests</h1>
        <CardDescription>Teacher absence requests awaiting a decision, and their outcomes.</CardDescription>
      </div>

      <div className="flex gap-2">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No {tab.toLowerCase()} requests.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className={isUrgent(row) ? 'border-amber-300 bg-amber-50/40' : ''}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800 flex items-center gap-1.5">
                      {row.teacher.firstName} {row.teacher.lastName}
                      {row.isForceMajeure && <Badge variant="outline" className="text-rose-600 border-rose-200 text-[10px]">Force majeure</Badge>}
                      {isUrgent(row) && <Badge variant="outline" className="text-amber-700 border-amber-300 text-[10px] gap-1"><AlertTriangle className="w-3 h-3" /> Urgent</Badge>}
                    </p>
                    <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {row.date.slice(0, 10)} · {row.scope === 'FULL_DAY' ? 'Whole day' : row.classSection ? `${row.classSection.className} ${row.classSection.sectionName}` : 'One session'}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600">{row.reason}</p>

                {row.status === 'PENDING' && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={respondMutation.isPending} onClick={() => respondMutation.mutate({ id: row.id, decision: 'APPROVE' })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => setRejectDialogId(row.id)}>
                      Reject
                    </Button>
                    <Button size="sm" variant="ghost" className="text-slate-500" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(row.id)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {row.status === 'APPROVED' && (
                  <div className="pt-1 space-y-1">
                    {row.substitutes.length === 0 ? (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSubstituteDialogId(row.id)}>
                          Find a substitute
                        </Button>
                        <Button size="sm" variant="ghost" className="text-slate-500" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate(row.id)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      row.substitutes.map((s, i) => (
                        <p key={i} className="text-xs text-slate-500">
                          Substitute: {s.substituteTeacher.firstName} {s.substituteTeacher.lastName} — <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                        </p>
                      ))
                    )}
                  </div>
                )}

                {row.status === 'REJECTED' && (
                  <Badge variant="outline" className="text-rose-600 border-rose-200">Rejected</Badge>
                )}
                {row.status === 'CANCELLED' && (
                  <Badge variant="outline" className="text-slate-500 border-slate-200">Cancelled</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(open) => !open && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this request</DialogTitle>
            <DialogDescription>Optional — let the teacher know why.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (optional)" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={respondMutation.isPending}
              onClick={() => rejectDialogId && respondMutation.mutate({ id: rejectDialogId, decision: 'REJECT', rejectionReason })}
            >
              {respondMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Substitute suggestions dialog */}
      <Dialog open={!!substituteDialogId} onOpenChange={(open) => !open && setSubstituteDialogId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>Find a substitute</DialogTitle>
            <DialogDescription>Qualified and free at that time. You can still pick anyone else if needed.</DialogDescription>
          </DialogHeader>
          {suggestionsLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-slate-400">No affected sessions found.</p>
          ) : (
            <div className="space-y-3">
              {suggestions.map((sg) => (
                <div key={sg.classSectionId} className="border border-slate-100 rounded-xl p-3">
                  <p className="text-sm font-medium text-slate-800">{sg.groupLabel} · {sg.time}</p>
                  <p className="text-xs text-slate-400 mb-2">{sg.courseName} — {sg.levelName}</p>
                  {sg.existingAssignment ? (
                    <Badge variant="outline">Substitute {sg.existingAssignment.status === 'CONFIRMED' ? 'confirmed' : 'pending'}</Badge>
                  ) : sg.candidates.length === 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-500">No qualified & available teacher found — pick manually from Staff Directory, or:</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="outline"
                          disabled={noSubstituteMutation.isPending}
                          onClick={() => noSubstituteMutation.mutate({ classSectionId: sg.classSectionId, action: 'CONTINUE' })}
                        >
                          Continue anyway
                        </Button>
                        <Button
                          size="sm" variant="outline" className="text-red-600 border-red-200"
                          disabled={noSubstituteMutation.isPending}
                          onClick={() => noSubstituteMutation.mutate({ classSectionId: sg.classSectionId, action: 'CANCEL_SESSION' })}
                        >
                          Cancel session
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {sg.candidates.map((c) => (
                        <Button
                          key={c.id} size="sm" variant="outline"
                          disabled={assignMutation.isPending}
                          onClick={() => assignMutation.mutate({ classSectionId: sg.classSectionId, substituteTeacherId: c.id })}
                        >
                          {c.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
