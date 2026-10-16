'use client'

/**
 * Student / parent portal (2026-10-17): the coming sessions on their real dates — a holiday shows "postponed",
 * a cancelled session shows "cancelled", a makeup session is marked. Data: /api/students/[id|me]/upcoming-sessions.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { CalendarClock } from 'lucide-react'

interface Row {
  groupId: string; group: string; course: string | null; date: string; time: string
  status: 'SCHEDULED' | 'NOT_STARTED' | 'CANCELLED' | 'HOLIDAY' | 'HELD' | 'MISSING'
  sessionNumber: number | null; totalSessions: number; isExtra: boolean; cancelReason: string | null
}

const time12 = (t: string, ar: boolean) => {
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return t
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? (ar ? 'ص' : 'AM') : (ar ? 'م' : 'PM')}`
}

export function UpcomingSessionsCard({ studentId }: { studentId?: string }) {
  const ar = useI18n().locale === 'ar'
  const { data } = useQuery({
    queryKey: ['upcoming-sessions', studentId ?? 'me'],
    queryFn: () => fetchApi<{ today: string | null; sessions: Row[] }>(`/api/students/${studentId ?? 'me'}/upcoming-sessions`),
    retry: false,
  })
  const rows = data?.sessions ?? []
  if (!rows.length) return null
  const dayText = (d: string) => (d === data?.today ? L('Today', 'النهارده')
    : new Date(`${d}T00:00:00Z`).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }))
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-5 w-5 text-indigo-600" />{L('Next sessions', 'الحصص الجاية')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {rows.map((r) => {
          const off = r.status === 'HOLIDAY' || r.status === 'CANCELLED'
          return (
            <div key={`${r.groupId}-${r.date}-${r.time}`}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${r.status === 'HOLIDAY' ? 'border-sky-200 bg-sky-50' : r.status === 'CANCELLED' ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
              <div className="min-w-0">
                <p className={`font-semibold ${off ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{dayText(r.date)} · {time12(r.time, ar)}</p>
                <p className="truncate text-xs text-slate-500">{r.course ? `${r.course} · ` : ''}{r.group}</p>
              </div>
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                {r.status === 'HOLIDAY' && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">{L('Holiday — postponed', 'إجازة — اتأجلت')}</span>}
                {r.status === 'CANCELLED' && <span className="rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600">{L('Cancelled — will be made up', 'اتلغت — هتتعوّض')}</span>}
                {r.isExtra && !off && <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">{L('Makeup session', 'حصة تعويضية')}</span>}
                {r.status === 'NOT_STARTED' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{L('First session', 'أول حصة')}</span>}
                {r.sessionNumber && !off && <span className="text-slate-400">{L('Session', 'حصة')} {r.sessionNumber}/{r.totalSessions}</span>}
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
