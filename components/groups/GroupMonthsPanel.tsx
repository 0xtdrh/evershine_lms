'use client'

/** b03: the months of a group inside its window. Each one opens its attendance, invoices and session reports. Hidden while the group has one month only. */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { Button } from '@/components/ui/button'
import { CalendarRange } from 'lucide-react'

interface Month { id: string; current: boolean; name: string; level: string | null; status: string; firstSession: string | null; lastSession: string | null; sessions: number; students: number; attendancePct: number | null; continued: number | null; stopped: { id: string; name: string }[]; expected?: number; collected?: number; outstanding?: number }
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
const n = (x: number | undefined) => (x ?? 0).toLocaleString('en-US')

export function GroupMonthsPanel({ groupId, onOpen, onInvoices }: { groupId: string; onOpen: (id: string) => void; onInvoices: (id: string) => void }) {
  useI18n()
  const { can } = useMyPermissions()
  const { data } = useQuery({ queryKey: ['group-months', groupId], queryFn: () => fetchApi<{ seeMoney: boolean; months: Month[] }>(`/api/groups/${groupId}/months`), retry: false })
  if (!data || data.months.length < 2) return null
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700"><CalendarRange className="h-4 w-4 text-indigo-600" /> {L('Months of this group', 'شهور الجروب')} ({data.months.length})</p>
      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100">
        {data.months.map((m, i) => (
          <div key={m.id} className={`space-y-1.5 p-3 text-sm ${m.current ? 'bg-indigo-50' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-800">{L('Month', 'شهر')} {i + 1}{m.level ? ` · ${m.level}` : ''} {m.current && <span className="text-xs font-normal text-indigo-700">({L('open now', 'المفتوح دلوقتي')})</span>}</p>
              <span className="text-xs text-slate-500">{m.firstSession ? day(m.firstSession) : L('Not started', 'لسه مبدأش')}{m.lastSession && m.lastSession !== m.firstSession ? ` ← ${day(m.lastSession)}` : ''}</span>
            </div>
            <p className="text-xs text-slate-600">{m.sessions} {L('session(s)', 'حصة')} · {m.students} {L('student(s)', 'طالب')} · {L('attendance', 'الحضور')} {m.attendancePct == null ? '-' : `${m.attendancePct}%`}{data.seeMoney && <> · {L('collected', 'اتحصّل')} {n(m.collected)} {L('of', 'من')} {n(m.expected)} · {L('left', 'باقي')} {n(m.outstanding)}</>}</p>
            {m.continued != null && (
              <p className="text-xs text-slate-600">
                {L('Continued', 'كمّلوا')} {m.continued} · {L('stopped', 'وقفوا')} {m.stopped.length}
                {m.stopped.length > 0 && <>: {m.stopped.map((s, k) => <span key={s.id}>{k > 0 && '، '}{can('students', 'read') ? <Link href={`/dashboard/students/${s.id}`} className="text-indigo-700 underline">{s.name}</Link> : s.name}</span>)}</>}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {!m.current && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onOpen(m.id)}>{L('Open', 'افتحه')}</Button>}
              <Link href={`/dashboard/attendance/sections?classSectionId=${m.id}`}><Button size="sm" variant="outline" className="h-7 text-xs">{L('Attendance', 'الحضور')}</Button></Link>
              {data.seeMoney && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onInvoices(m.id)}>{L('Invoices', 'الفواتير')}</Button>}
              {can('session_reports', 'read') && m.firstSession && <Link href={`/dashboard/session-reports?groupId=${m.id}&from=${m.firstSession}&to=${m.lastSession ?? m.firstSession}`}><Button size="sm" variant="outline" className="h-7 text-xs">{L('Reports', 'التقارير')}</Button></Link>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
