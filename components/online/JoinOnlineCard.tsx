'use client'

/** L5: today's online sessions for the student / parent with the "Join" button (opens the meeting, logs the join). */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Video } from 'lucide-react'

interface Row { groupId: string; group: string; start: string; opensAt: string; canJoin: boolean; joinedAt: string | null; sessionNumber: number | null }
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function JoinOnlineCard({ studentId }: { studentId?: string | null }) {
  const qc = useQueryClient()
  const qs = studentId ? `?s=${studentId}` : ''
  const { data } = useQuery({ queryKey: ['online-my', studentId ?? 'me'], queryFn: () => fetchApi<Row[]>(`/api/online/my${qs}`), refetchInterval: 60_000, retry: false })
  const [busy, setBusy] = useState<string | null>(null)
  if (!data?.length) return null
  const join = async (r: Row) => {
    // open the tab first (pop-up blockers allow it only straight after the click), then send it to the meeting
    const tab = window.open('about:blank', '_blank')
    setBusy(r.groupId)
    try {
      const res = await fetchApi<{ url: string }>('/api/online/join', { method: 'POST', body: JSON.stringify({ groupId: r.groupId, s: studentId ?? undefined }) })
      if (tab) tab.location.href = res.url; else window.location.href = res.url
      qc.invalidateQueries({ queryKey: ['online-my'] })
    } catch (e) { tab?.close(); notify.error((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
      <p className="flex items-center gap-2 font-semibold text-indigo-800"><Video className="h-5 w-5" /> {L('Online class today', 'حصة أونلاين النهارده')}</p>
      {data.map((r) => (
        <div key={r.groupId + r.start} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 text-sm">
          <span><span className="font-medium text-slate-800">{r.group}</span> · {time(r.start)}{r.sessionNumber ? ` · ${L('session', 'حصة')} ${r.sessionNumber}` : ''}{r.joinedAt ? ` · ✅ ${L('joined', 'دخلت')} ${time(r.joinedAt)}` : ''}</span>
          {r.canJoin
            ? <button type="button" disabled={busy === r.groupId} onClick={() => join(r)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{L('Join the class', 'ادخل الحصة')}</button>
            : <span className="text-xs text-slate-500">{L('Join opens at', 'الدخول هيفتح الساعة')} {time(r.opensAt)}</span>}
        </div>
      ))}
    </div>
  )
}
