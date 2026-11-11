/** x01 analytics: pure maths for the "Website visitors" screen (tested). */

import { isBounce, type VisitSource } from './visit-rules'

export interface VisitRow {
  sessionId: string; visitorId: string | null; startedAt: Date; seconds: number; pages: number; landing: string
  source: string; device: string; city: string | null; utmCampaign: string | null; converted: boolean
}
export interface EventRow { sessionId: string; kind: string; label: string | null }
export interface RequestRow { kind: string | null; visitSessionId: string | null }

export const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0)

function countBy<T>(rows: T[], key: (r: T) => string | null, limit = 0) {
  const m = new Map<string, number>()
  for (const r of rows) { const k = key(r) ?? '—'; m.set(k, (m.get(k) ?? 0) + 1) }
  const out = [...m.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return limit ? out.slice(0, limit) : out
}

export function summarize(visits: VisitRow[], events: EventRow[], requests: RequestRow[], days: string[]) {
  const n = visits.length
  const visitors = new Set(visits.map((v) => v.visitorId ?? `s:${v.sessionId}`)).size
  const converted = visits.filter((v) => v.converted).length
  const perDay = new Map(days.map((d) => [d, 0]))
  for (const v of visits) { const d = cairoDay(v.startedAt); if (perDay.has(d)) perDay.set(d, (perDay.get(d) ?? 0) + 1) }

  const sourceOf = new Map(visits.map((v) => [v.sessionId, v.source]))
  const bySource = countBy(visits, (v) => v.source).map((s) => ({
    ...s,
    converted: visits.filter((v) => v.source === s.key && v.converted).length,
    requests: requests.filter((r) => r.visitSessionId && sourceOf.get(r.visitSessionId) === s.key).length,
  }))
  const ev = (kind: string) => events.filter((e) => e.kind === kind)
  const formKind = (label: string | null) => (label ?? '').split(':')[0] || '—'

  return {
    totals: {
      visits: n,
      visitors,
      avgSeconds: n ? Math.round(visits.reduce((a, v) => a + v.seconds, 0) / n) : 0,
      pagesPerVisit: n ? Math.round((visits.reduce((a, v) => a + v.pages, 0) / n) * 10) / 10 : 0,
      bounceRate: pct(visits.filter(isBounce).length, n),
      converted,
      conversionRate: pct(converted, n),
      requests: requests.length,
      requestsTracked: requests.filter((r) => r.visitSessionId && sourceOf.has(r.visitSessionId)).length,
    },
    byDay: days.map((d) => ({ day: d, visits: perDay.get(d) ?? 0 })),
    bySource: bySource as (typeof bySource[number] & { key: VisitSource | string })[],
    byDevice: countBy(visits, (v) => v.device),
    byCity: countBy(visits, (v) => v.city, 10),
    byLanding: countBy(visits, (v) => v.landing.split('?')[0], 10),
    byCampaign: countBy(visits.filter((v) => v.utmCampaign), (v) => v.utmCampaign, 10),
    audience: countBy(ev('AUDIENCE'), (e) => e.label),
    nav: countBy(ev('NAV'), (e) => e.label, 10),
    forms: {
      opened: ev('FORM_OPEN').length,
      sent: ev('FORM_SENT').length,
      byKind: [...new Set([...ev('FORM_OPEN'), ...ev('FORM_SENT')].map((e) => formKind(e.label)))]
        .map((key) => ({ key, count: ev('FORM_OPEN').filter((e) => formKind(e.label) === key).length, sent: ev('FORM_SENT').filter((e) => formKind(e.label) === key).length }))
        .sort((a, b) => b.count + b.sent - (a.count + a.sent) || a.key.localeCompare(b.key)),
    },
    whatsapp: ev('WHATSAPP').length,
    requestsByKind: countBy(requests, (r) => r.kind),
  }
}

/** The last `count` Cairo days ending today, oldest first. */
export function lastDays(count: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(cairoDay(new Date(now.getTime() - i * 86_400_000)))
  return [...new Set(out)]
}
