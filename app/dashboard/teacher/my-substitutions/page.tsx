'use client'

import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

interface SubstituteData {
  asSubstitute: {
    date: string
    sessions: { id: string; status: string; groupLabel: string; courseName: string | null; levelName: string | null; originalTeacherName: string; time?: string | null; sessionNumber: number | null; totalSessions: number | null }[]
  }[]
  asAbsent: {
    date: string
    items: {
      id: string; scope: string; status: string; reason: string; isForceMajeure: boolean
      groupLabel: string; sessionNumber: number | null; totalSessions: number | null
      substitutes: { status: string; name: string }[]
    }[]
  }[]
}

export default function MySubstitutionsPage() {
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  const { data: myProfile } = useQuery<{ id: string }>({
    queryKey: ['my-teacher-profile'],
    queryFn: () => fetchApi('/api/teachers/profile'),
    enabled: session?.user?.role === 'TEACHER',
  })
  const teacherId = myProfile?.id

  const { data, isLoading } = useQuery<SubstituteData>({
    queryKey: ['my-substitutions', teacherId],
    queryFn: () => fetchApi(`/api/teachers/${teacherId}/substitutions`),
    enabled: !!teacherId,
  })

  const respondMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'ACCEPT' | 'DECLINE' }) =>
      fetchApi(`/api/substitute-assignments/${id}/respond`, { method: 'POST', body: JSON.stringify({ decision }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-substitutions', teacherId] })
      notify.success(L('Response recorded', 'ردّك اتسجل'))
    },
    onError: (err: unknown) => notify.error(apiErrorMessage(err, 'Failed to respond')),
  })

  if (session?.user?.role !== 'TEACHER') {
    return <p className="p-6 text-sm text-slate-400 text-center">{L('This page is for teacher accounts.', 'الصفحة دي لحسابات المدربين.')}</p>
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-900">{L('My Substitutions', 'حصصي البديلة')}</h1>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-2">{L('Sessions I covered', 'الحصص اللي غطيتها')}</h2>
            {(!data || data.asSubstitute.length === 0) ? (
              <p className="text-sm text-slate-400">{L('Nothing yet.', 'لسه مفيش.')}</p>
            ) : (
              <div className="space-y-2">
                {data.asSubstitute.map((day) => (
                  <Card key={day.date}>
                    <CardHeader className="py-3"><CardTitle className="text-sm">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' })}</CardTitle></CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {day.sessions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                          <div>
                            <p className="text-slate-800">
                              {s.sessionNumber ? <span className="font-semibold text-indigo-600">{L('Session', 'حصة')} {s.sessionNumber} {L('of', 'من')} {s.totalSessions} · </span> : null}
                              {s.time && <span className="font-semibold">{s.time} · </span>}{s.groupLabel} {L('— covering for', '— بدل')} {s.originalTeacherName}
                            </p>
                            <p className="text-xs text-slate-400">{s.courseName} — {s.levelName}</p>
                          </div>
                          {s.status === 'PENDING_SUBSTITUTE_APPROVAL' ? (
                            <div className="flex gap-1.5">
                              <Button size="sm" className="h-7 text-xs" disabled={respondMutation.isPending} onClick={() => respondMutation.mutate({ id: s.id, decision: 'ACCEPT' })}>
                                {L('Accept', 'قبول')}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200" disabled={respondMutation.isPending} onClick={() => respondMutation.mutate({ id: s.id, decision: 'DECLINE' })}>
                                {L('Decline', 'رفض')}
                              </Button>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">{s.status === 'CONFIRMED' ? L('Accepted', 'موافق') : s.status === 'DECLINED' ? L('Declined', 'رفضت') : s.status}</Badge>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-2">{L('My absence requests', 'طلبات غيابي')}</h2>
            {(!data || data.asAbsent.length === 0) ? (
              <p className="text-sm text-slate-400">{L('Nothing yet.', 'لسه مفيش.')}</p>
            ) : (
              <div className="space-y-2">
                {data.asAbsent.map((day) => (
                  <Card key={day.date}>
                    <CardHeader className="py-3"><CardTitle className="text-sm">{new Date(day.date).toLocaleDateString('en-GB')}</CardTitle></CardHeader>
                    <CardContent className="space-y-2 pt-0">
                      {day.items.map((it) => (
                        <div key={it.id} className="border border-slate-100 rounded-lg px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <p className="text-slate-800">{it.scope === 'FULL_DAY' ? 'Whole day' : `${it.groupLabel}${it.sessionNumber ? ` · Session ${it.sessionNumber} of ${it.totalSessions}` : ''}`}</p>
                            <Badge variant="outline" className="text-[10px]">{it.status}</Badge>
                          </div>
                          <p className="text-xs text-slate-400">{it.reason}</p>
                          {it.substitutes.map((s, i) => (
                            <p key={i} className="text-xs text-indigo-600 mt-1">{L('Substitute:', 'البديل:')} {s.name} ({s.status === 'CONFIRMED' ? L('accepted', 'وافق') : s.status === 'DECLINED' ? L('declined', 'رفض') : L('waiting', 'لسه ماردّش')})</p>
                          ))}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
