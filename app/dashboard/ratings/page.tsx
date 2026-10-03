'use client'

/** Phase C: student and parent ratings — averages per instructor, latest surveys, low ratings. */

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Star } from 'lucide-react'

interface Overview {
  since: string
  totals: { sessionFaces: number | null; sessionCount: number; instructor: number | null; sessionsQ: number | null; company: number | null; surveyCount: number }
  byTeacher: { teacherId: string; name: string; sessionFaces: number | null; sessionCount: number; instructor: number | null; sessionsQ: number | null; company: number | null; surveyCount: number }[]
  latestSurveys: { id: string; student: string; studentId: string; group: string; kind: string; instructor: string; sessionsRating: number; teacherRating: number; companyRating: number; comment: string | null; createdAt: string }[]
  lowSessions: { id: string; student: string; studentId: string; group: string; date: string; rating: number; comment: string | null; byRole: string }[]
}

const n = (v: number | null, of: number) => (v == null ? '—' : `${v} / ${of}`)
const tone = (v: number | null, of: number) => (v == null ? '' : v / of < 0.5 ? 'text-rose-600' : v / of < 0.75 ? 'text-amber-600' : 'text-emerald-700')

export default function RatingsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const [days, setDays] = useState('90')
  const allowed = !!role && checkPermission(role, 'ratings', 'read')
  const { data, isLoading } = useQuery({ queryKey: ['ratings-overview', days], queryFn: () => fetchApi<Overview>(`/api/ratings/overview?days=${days}`), enabled: allowed })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Ratings" message="You don't have access to ratings." />
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Star className="h-7 w-7 fill-amber-400 text-amber-400" /> Ratings</h1>
          <p className="mt-1 text-sm text-slate-500">Students rate each session (😀 4 · 🙂 3 · 😐 2 · 🙁 1). Parents rate the sessions, the instructor and TechNova at the end of each month (1–5). Instructors only see their own averages.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{[['30', 'Last 30 days'], ['90', 'Last 3 months'], ['180', 'Last 6 months'], ['365', 'Last year']].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Sessions (students)', data.totals.sessionFaces, 4, data.totals.sessionCount],
              ['Instructors (parents)', data.totals.instructor, 5, data.totals.surveyCount],
              ['Sessions (parents)', data.totals.sessionsQ, 5, data.totals.surveyCount],
              ['TechNova (parents)', data.totals.company, 5, data.totals.surveyCount],
            ].map(([label, v, of, count]) => (
              <Card key={label as string}><CardContent className="pt-5">
                <p className="text-xs text-slate-500">{label as string}</p>
                <p className={`text-2xl font-bold ${tone(v as number | null, of as number)}`}>{n(v as number | null, of as number)}</p>
                <p className="text-xs text-slate-400">{count as number} answers</p>
              </CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">By instructor</CardTitle><CardDescription>Lowest first.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Instructor</th><th>Sessions (students)</th><th>Instructor (parents)</th><th>Sessions (parents)</th><th>TechNova (parents)</th></tr></thead>
                <tbody>
                  {data.byTeacher.map((t) => (
                    <tr key={t.teacherId} className="border-t border-slate-100">
                      <td className="py-1.5 font-medium">{t.name}</td>
                      <td className={tone(t.sessionFaces, 4)}>{n(t.sessionFaces, 4)} <span className="text-xs text-slate-400">({t.sessionCount})</span></td>
                      <td className={tone(t.instructor, 5)}>{n(t.instructor, 5)} <span className="text-xs text-slate-400">({t.surveyCount})</span></td>
                      <td className={tone(t.sessionsQ, 5)}>{n(t.sessionsQ, 5)}</td>
                      <td className={tone(t.company, 5)}>{n(t.company, 5)}</td>
                    </tr>
                  ))}
                  {!data.byTeacher.length && <tr><td colSpan={5} className="py-4 text-center text-slate-500">No ratings yet.</td></tr>}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Latest parent surveys</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.latestSurveys.map((s) => (
                  <div key={s.id} className={`rounded-lg border p-2.5 text-sm ${Math.min(s.sessionsRating, s.teacherRating, s.companyRating) <= 2 ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100'}`}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <Link href={`/dashboard/students/${s.studentId}`} className="font-medium text-indigo-700 hover:underline">{s.student}</Link>
                      <span className="text-xs text-slate-400">{new Date(s.createdAt).toLocaleDateString('en-GB')} · {s.kind === 'LEVEL' ? 'level' : 'month'}</span>
                    </div>
                    <p className="text-xs text-slate-500">{s.group} · {s.instructor}</p>
                    <p className="text-xs">Sessions {s.sessionsRating}/5 · Instructor {s.teacherRating}/5 · TechNova {s.companyRating}/5</p>
                    {s.comment && <p className="mt-1 text-slate-700">“{s.comment}”</p>}
                  </div>
                ))}
                {!data.latestSurveys.length && <p className="text-sm text-slate-500">No surveys yet.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Sessions rated 🙁</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.lowSessions.map((s) => (
                  <div key={s.id} className="rounded-lg border border-rose-100 p-2.5 text-sm">
                    <Link href={`/dashboard/students/${s.studentId}`} className="font-medium text-indigo-700 hover:underline">{s.student}</Link>
                    <p className="text-xs text-slate-500">{s.group} · {s.date} · by {s.byRole === 'PARENT' ? 'parent' : 'student'}</p>
                    {s.comment && <p className="mt-1 text-slate-700">“{s.comment}”</p>}
                  </div>
                ))}
                {!data.lowSessions.length && <p className="text-sm text-slate-500">None. 👌</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
