'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Star } from 'lucide-react'

interface Avg { average: number | null; count: number; outOf: number }
interface Data { sessionFaces: Avg; parentsOnInstructor: Avg; parentsOnSessions: Avg }

/** Phase C: an instructor's own averages (last 6 months), anonymous. */
export function TeacherRatingsCard() {
  const { data } = useQuery({ queryKey: ['my-ratings'], queryFn: () => fetchApi<Data>('/api/ratings/overview?mine=1') })
  if (!data || (!data.sessionFaces.count && !data.parentsOnInstructor.count)) return null
  const item = (label: string, a: Avg) => (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-800">{a.average ?? '—'}<span className="text-sm font-normal text-slate-400"> / {a.outOf}</span></p>
      <p className="text-xs text-slate-400">{a.count} answers</p>
    </div>
  )
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Your ratings (last 6 months)</CardTitle></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-3">
        {item('Students on your sessions', data.sessionFaces)}
        {item('Parents on you', data.parentsOnInstructor)}
        {item('Parents on the sessions', data.parentsOnSessions)}
      </CardContent>
    </Card>
  )
}
