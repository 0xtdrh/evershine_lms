'use client'

import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FACES } from './ParentRatingsCard'

interface Pending { classSectionId: string; group: string; date: string }

/** Phase C: "How was the session?" — one tap, on the student's dashboard. */
export function StudentRatingCard() {
  const { data: session } = useSession()
  const qc = useQueryClient()
  const isStudent = session?.user?.role === 'STUDENT'
  const { data } = useQuery({ queryKey: ['student-ratings'], queryFn: () => fetchApi<{ sessions: Pending[] }>('/api/ratings/student'), enabled: isStudent })
  const rate = useMutation({
    mutationFn: (p: { classSectionId: string; sessionDate: string; rating: number }) => fetchApi('/api/ratings/student', { method: 'POST', body: JSON.stringify(p) }),
    onSuccess: () => { notify.success('Thank you!'); qc.invalidateQueries({ queryKey: ['student-ratings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!isStudent || !data?.sessions.length) return null
  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2"><CardTitle className="text-base">How was your session?</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {data.sessions.map((s) => (
          <div key={`${s.classSectionId}|${s.date}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <span>{s.group} · {new Date(`${s.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</span>
            <div className="flex gap-1">
              {FACES.map((x) => (
                <button key={x.v} type="button" title={x.l} className="rounded-lg px-1.5 text-3xl hover:bg-slate-100" disabled={rate.isPending}
                  onClick={() => rate.mutate({ classSectionId: s.classSectionId, sessionDate: s.date, rating: x.v })}>{x.f}</button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
