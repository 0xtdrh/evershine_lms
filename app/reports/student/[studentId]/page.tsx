'use client'

/** Phase C: printable monthly / level report (outside the dashboard so it prints clean). ?kind=MONTHLY|LEVEL&group=<id> */

import { use } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Printer } from 'lucide-react'

interface Row { n: number; of: number; date: string; status: string; excuseReason: string | null }
interface Stats { sessions: number; present: number; late: number; absent: number; excused: number; pct: number | null }
interface Result { homeworkScore: number | null; taskScore: number | null; instructorScore: number | null; projectScore: number | null; mcqScore: number | null; finalScore: number | null; passed: boolean | null; instructorFeedback: string | null; certificate: string | null }
interface GroupSummary { label: string; course: string | null; level: string | null; cycleNumber: number; cyclesInLevel: number }
interface Report {
  kind: 'MONTHLY' | 'LEVEL'
  student: { name: string; registrationNumber: string; campus: string }
  group?: GroupSummary
  sessions?: Row[]
  stats: Stats
  perfect?: boolean
  sessionRatings: { average: number | null; count: number; outOf: number }
  result: Result | null
  course?: string | null
  level?: string
  months?: (GroupSummary & { stats: Stats; perfect: boolean; sessions: Row[] })[]
  recommendation?: { action: string; text: string } | null
}

const STATUS: Record<string, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Absent (excused)' }
const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
const score = (v: number | null) => (v == null ? '—' : `${Math.round(v)}`)

function SessionsTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead><tr className="border-b border-black text-left"><th className="py-1">Session</th><th>Date</th><th>Attendance</th></tr></thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.date} className="border-b border-gray-200">
            <td className="py-1">{s.n} of {s.of}</td>
            <td>{fmt(s.date)}</td>
            <td>{STATUS[s.status] ?? s.status}{s.excuseReason ? ` — ${s.excuseReason}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatsLine({ s, perfect }: { s: Stats; perfect?: boolean }) {
  return (
    <p className="my-2 text-sm">
      Attendance <strong>{s.pct ?? '—'}%</strong> · present {s.present} · late {s.late} · absent {s.absent} · excused {s.excused}
      {perfect && <span className="ml-2 rounded-full border border-amber-500 px-2 py-0.5 text-xs font-bold text-amber-700">★ Perfect attendance</span>}
    </p>
  )
}

export default function StudentReportPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  const sp = useSearchParams()
  const kind = sp.get('kind') ?? 'MONTHLY'
  const group = sp.get('group') ?? ''
  const { data: r, error, isLoading } = useQuery({
    queryKey: ['student-report', studentId, kind, group],
    queryFn: () => fetchApi<Report>(`/api/students/${studentId}/reports?kind=${kind}&group=${group}`),
    retry: false,
  })
  if (error) return <div className="p-6 text-sm"><p className="mb-2 text-red-600">{(error as Error).message}</p><Link href="/login" className="text-blue-600 underline">Sign in</Link></div>
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap justify-center gap-2 px-4 print:hidden">
        <Button variant="outline" onClick={() => (history.length > 1 ? history.back() : (window.location.href = '/dashboard'))}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print / save as PDF</Button>
      </div>
      {isLoading || !r ? <p className="text-center text-sm text-gray-500">Loading…</p> : (
        <div className="mx-auto max-w-3xl bg-white p-6 text-sm text-black shadow print:shadow-none">
          <div className="mb-3 flex items-start justify-between border-b-2 border-black pb-2">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
              <div><div className="text-lg font-bold">TechNova</div><div className="text-xs">STEM · Robotics · Programming</div></div>
            </div>
            <div className="text-right">
              <div className="font-bold">{r.kind === 'LEVEL' ? 'LEVEL REPORT · تقرير المستوى' : 'MONTHLY REPORT · التقرير الشهري'}</div>
              <div className="text-xs">{new Date().toLocaleDateString('en-GB')}</div>
            </div>
          </div>
          <p className="mb-1 text-base"><strong>{r.student.name}</strong> · {r.student.registrationNumber} · {r.student.campus}</p>

          {r.kind === 'MONTHLY' && r.group && (
            <>
              <p className="mb-2 text-gray-700">{r.group.course}{r.group.level ? ` · ${r.group.level}` : ''} · month {r.group.cycleNumber} of {r.group.cyclesInLevel} · {r.group.label}</p>
              <StatsLine s={r.stats} perfect={r.perfect} />
              <SessionsTable rows={r.sessions ?? []} />
            </>
          )}

          {r.kind === 'LEVEL' && (
            <>
              <p className="mb-2 text-gray-700">{r.course} · {r.level}</p>
              <h3 className="mt-3 border-b border-gray-400 font-bold">Attendance</h3>
              <StatsLine s={r.stats} />
              {(r.months ?? []).map((m) => (
                <div key={m.label + m.cycleNumber} className="mb-3">
                  <p className="text-xs font-semibold">{m.cyclesInLevel > 1 ? `Month ${m.cycleNumber}` : m.label} — {m.stats.pct ?? '—'}%{m.perfect ? ' ★ perfect attendance' : ''}</p>
                  <SessionsTable rows={m.sessions} />
                </div>
              ))}
            </>
          )}

          <h3 className="mt-4 border-b border-gray-400 font-bold">How the sessions felt</h3>
          <p className="my-1">{r.sessionRatings.count ? `Average ${r.sessionRatings.average} / ${r.sessionRatings.outOf} from ${r.sessionRatings.count} session rating(s).` : 'No session ratings yet.'}</p>

          {r.result && (
            <>
              <h3 className="mt-4 border-b border-gray-400 font-bold">Result</h3>
              <table className="my-1 w-full text-xs">
                <tbody>
                  <tr><td>Homework</td><td>{score(r.result.homeworkScore)}</td><td>Tasks</td><td>{score(r.result.taskScore)}</td><td>Project</td><td>{score(r.result.projectScore)}</td></tr>
                  <tr><td>Instructor</td><td>{score(r.result.instructorScore)}</td><td>Quiz</td><td>{score(r.result.mcqScore)}</td><td className="font-bold">Final</td><td className="font-bold">{score(r.result.finalScore)}{r.result.passed != null ? (r.result.passed ? ' — passed' : ' — not passed') : ''}</td></tr>
                </tbody>
              </table>
              {r.result.instructorFeedback && <p className="my-1"><strong>Instructor:</strong> {r.result.instructorFeedback}</p>}
              {r.result.certificate && <p className="my-1"><strong>Certificate:</strong> {r.result.certificate}</p>}
            </>
          )}

          {r.recommendation && (
            <>
              <h3 className="mt-4 border-b border-gray-400 font-bold">Recommendation</h3>
              <p className="my-1">{r.recommendation.text}</p>
            </>
          )}
          <p className="mt-4 text-[11px] text-gray-500">This report is prepared automatically from attendance, ratings and results. Session reports, homework and skills will be added with the online learning platform.</p>
        </div>
      )}
    </div>
  )
}
