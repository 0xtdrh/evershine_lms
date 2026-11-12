/** x01 / business growth: cost per website request and per new student, per ad source (pure, tested). */

import { SOURCES, type VisitSource } from '@/lib/site/visit-rules'

export interface AdSourceRow {
  source: VisitSource; spend: number; visits: number; requests: number; newStudents: number
  costPerRequest: number | null; costPerNew: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const div = (a: number, b: number) => (a > 0 && b > 0 ? r2(a / b) : null)

/** First website request per student wins (a student is counted once, for the source that brought the first request). */
export function firstSourcePerStudent(matches: { studentId: string; source: string; at: Date }[]): Map<string, string> {
  const best = new Map<string, { source: string; at: number }>()
  for (const m of matches) {
    const t = new Date(m.at).getTime()
    const cur = best.get(m.studentId)
    if (!cur || t < cur.at) best.set(m.studentId, { source: m.source, at: t })
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.source]))
}

export function adSources(input: {
  spend: Record<string, number>; visits: Record<string, number>; requests: Record<string, number>
  studentSource: Map<string, string>; newStudentsTotal: number
}) {
  const newBy: Record<string, number> = {}
  for (const s of input.studentSource.values()) newBy[s] = (newBy[s] ?? 0) + 1
  const rows: AdSourceRow[] = SOURCES.map((source) => {
    const spend = r2(input.spend[source] ?? 0)
    const requests = input.requests[source] ?? 0
    const newStudents = newBy[source] ?? 0
    return { source, spend, visits: input.visits[source] ?? 0, requests, newStudents, costPerRequest: div(spend, requests), costPerNew: div(spend, newStudents) }
  })
  const spend = r2(rows.reduce((a, r) => a + r.spend, 0))
  const fromWebsite = rows.reduce((a, r) => a + r.newStudents, 0)
  return {
    rows,
    totals: {
      spend, visits: rows.reduce((a, r) => a + r.visits, 0), requests: rows.reduce((a, r) => a + r.requests, 0),
      newFromWebsite: fromWebsite, newOther: Math.max(0, input.newStudentsTotal - fromWebsite), newStudentsTotal: input.newStudentsTotal,
      costPerNewAll: div(spend, input.newStudentsTotal),
    },
  }
}
