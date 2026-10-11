'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Loader2 } from 'lucide-react'
import { L } from '@/lib/i18n/client'

interface SessionEntry { id: string; date: string; status: string; sessionNumber: number | null; star: boolean; group: string; course: string; level: string }
interface Entry { kind: 'MONTHLY' | 'LEVEL'; classSectionId: string; title: string; subtitle: string; date: string | null }

/** Phase C: the student's monthly and level reports (portal tab + student page). */
export function StudentReportsList({ studentId }: { studentId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['student-reports', studentId], queryFn: () => fetchApi<Entry[]>(`/api/students/${studentId}/reports`), enabled: !!studentId })
  const { data: sessions } = useQuery({ queryKey: ['student-session-reports', studentId], queryFn: () => fetchApi<SessionEntry[]>(`/api/students/${studentId}/session-reports`), enabled: !!studentId })
  const monthly = (data ?? []).filter((e) => e.kind === 'MONTHLY')
  const level = (data ?? []).filter((e) => e.kind === 'LEVEL')
  const item = (e: Entry) => (
    <a key={`${e.kind}-${e.classSectionId}`} href={`/reports/student/${studentId}?kind=${e.kind}&group=${e.classSectionId}`} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
      <div><p className="font-medium text-slate-800">{e.title}</p><p className="text-xs text-slate-500">{e.subtitle}{e.date ? ` · ${new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-GB')}` : ''}</p></div>
      <span className="text-xs font-semibold text-indigo-700">Open</span>
    </a>
  )
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-5 w-5 text-indigo-600" /> Reports</CardTitle>
        <CardDescription>{L('A report after each session, at the end of each month and of each level. Open one to print or save it as PDF.', 'تقرير بعد كل حصة، وفي آخر كل شهر وكل مستوى. افتح أي واحد تطبعه أو تحفظه PDF.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!!sessions?.length && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase text-slate-500">{L('Session reports', 'تقارير الحصص')}</p>
            {sessions.slice(0, 20).map((e) => (
              <a key={e.id} href={`/reports/session/${e.id}?student=${studentId}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                <div>
                  <p className="font-medium text-slate-800">{e.star && '⭐ '}{e.course}{e.level ? ` · ${e.level}` : ''}{e.sessionNumber ? ` — ${L('session', 'حصة')} ${e.sessionNumber}` : ''}</p>
                  <p className="text-xs text-slate-500">{e.group} · {new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-GB')}{e.status !== 'SENT' ? ` · ${L('draft', 'مسودة')}` : ''}</p>
                </div>
                <span className="text-xs font-semibold text-indigo-700">{L('Open', 'افتح')}</span>
              </a>
            ))}
          </div>
        )}
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : !data?.length ? (sessions?.length ? null : <p className="text-sm text-slate-500">{L('No reports yet.', 'لسه مفيش تقارير.')}</p>) : (
          <>
            {level.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold uppercase text-slate-500">Level reports</p>{level.map(item)}</div>}
            {monthly.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold uppercase text-slate-500">Monthly reports</p>{monthly.map(item)}</div>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
