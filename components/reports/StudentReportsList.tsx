'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Loader2 } from 'lucide-react'

interface Entry { kind: 'MONTHLY' | 'LEVEL'; classSectionId: string; title: string; subtitle: string; date: string | null }

/** Phase C: the student's monthly and level reports (portal tab + student page). */
export function StudentReportsList({ studentId }: { studentId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['student-reports', studentId], queryFn: () => fetchApi<Entry[]>(`/api/students/${studentId}/reports`), enabled: !!studentId })
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
        <CardDescription>A report is ready at the end of each month and of each level. Open one to print or save it as PDF.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : !data?.length ? <p className="text-sm text-slate-500">No reports yet — the first one is ready when the first month ends.</p> : (
          <>
            {level.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold uppercase text-slate-500">Level reports</p>{level.map(item)}</div>}
            {monthly.length > 0 && <div className="space-y-2"><p className="text-xs font-semibold uppercase text-slate-500">Monthly reports</p>{monthly.map(item)}</div>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
