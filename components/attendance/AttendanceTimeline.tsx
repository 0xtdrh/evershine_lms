'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ClipboardCheck, Award, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

interface Row { n: number; of: number; date: string; status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'; excuseReason: string | null }
interface Stats { sessions: number; present: number; late: number; absent: number; excused: number; pct: number | null }
interface Group { classSectionId: string; group: string; course: string | null; level: string | null; cycleNumber: number; cyclesInLevel: number; status: string; finished: boolean; sessions: Row[]; stats: Stats; perfect: boolean }
interface Data { groups: Group[]; overall: Stats }

const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  PRESENT: { label: 'Present', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LATE: { label: 'Late', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  ABSENT: { label: 'Absent', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  EXCUSED: { label: 'Absent (excused)', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
}

/** Phase C: attendance session by session (no instructor name), per month/group. */
export function AttendanceTimeline({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-timeline', studentId],
    queryFn: () => fetchApi<Data>(`/api/students/${studentId}/attendance-timeline`),
    enabled: !!studentId,
  })
  if (isLoading) return <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading attendance…</div>
  const groups = (data?.groups ?? []).filter((g) => g.sessions.length > 0)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-5 w-5 text-emerald-600" /> Attendance</CardTitle>
        <CardDescription>
          {data?.overall.pct != null ? `Overall attendance ${data.overall.pct}% (${data.overall.present + data.overall.late} of ${data.overall.sessions} sessions)` : 'No sessions recorded yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map((g, i) => {
          const isOpen = open[g.classSectionId] ?? i < 2
          return (
            <div key={g.classSectionId} className="rounded-lg border border-slate-200">
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen({ ...open, [g.classSectionId]: !isOpen })}>
                <div>
                  <p className="font-semibold text-slate-800">{g.course ?? g.group}{g.level ? ` · ${g.level}` : ''}</p>
                  <p className="text-xs text-slate-500">
                    {g.group}{g.cyclesInLevel > 1 ? ` · month ${g.cycleNumber} of ${g.cyclesInLevel}` : ''} · {g.finished ? 'finished' : 'in progress'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {g.perfect && <Badge className="gap-1 border-amber-300 bg-amber-50 text-amber-800" variant="outline"><Award className="h-3.5 w-3.5" /> Perfect attendance</Badge>}
                  <span className="font-mono text-sm font-bold text-slate-700">{g.stats.pct ?? '—'}%</span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-500"><th className="px-3 py-1.5">Session</th><th>Date</th><th>Status</th></tr></thead>
                    <tbody>
                      {g.sessions.map((s) => (
                        <tr key={s.date} className="border-t border-slate-100 align-top">
                          <td className="whitespace-nowrap px-3 py-1.5 font-medium">{s.n} of {s.of}</td>
                          <td className="whitespace-nowrap py-1.5">{new Date(`${s.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</td>
                          <td className="py-1.5 pr-3">
                            <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS[s.status]?.cls ?? ''}`}>{STATUS[s.status]?.label ?? s.status}</span>
                            {s.excuseReason && <p className="mt-0.5 text-xs text-slate-500">Reason: {s.excuseReason}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-3 py-2 text-xs text-slate-500">
                    Present {g.stats.present} · Late {g.stats.late} · Absent {g.stats.absent} · Excused {g.stats.excused}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
