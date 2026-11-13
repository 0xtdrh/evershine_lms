'use client'

/** Six phases 2: lessons × students of a group — how much of each lesson video each student really watched. */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlayCircle } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'

type Data = {
  videos: { blockId: string; session: number; title: { en: string; ar: string } }[]
  students: { id: string; name: string; minutes: number; completed: number; lastAt: string | null; fastPercent: number; maxSpeed: number; cells: Record<string, { percent: number; minutes: number; done: boolean; fastPercent: number; maxSpeed: number }> }[]
}

export function GroupWatchPanel({ groupId }: { groupId: string }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: ['group-watch', groupId], queryFn: () => fetchApi<Data>(`/api/groups/${groupId}/watch`), enabled: open, retry: false })
  const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' }) : '—')
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full items-center gap-2 text-sm font-medium text-slate-700">
        <PlayCircle className="h-4 w-4 text-indigo-600" aria-hidden /> {L('Video watching', 'مشاهدة الفيديوهات')}
      </button>
      {open ? (
        !data ? <p className="mt-2 text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
          : !data.videos.length ? <p className="mt-2 text-sm text-slate-500">{L('The lessons of this group have no videos.', 'دروس الجروب ده مفيهاش فيديوهات.')}</p>
          : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500"><tr>
                  <th className="p-1.5 text-start">{L('Student', 'الطالب')}</th>
                  <th className="p-1.5 text-start">{L('Minutes', 'دقايق')}</th>
                  <th className="p-1.5 text-start">{L('Last', 'آخر مرة')}</th>
                  <th className="p-1.5 text-start">{L('Speed', 'السرعة')}</th>
                  {data.videos.map((v) => <th key={v.blockId} className="p-1.5 text-center" title={ar ? v.title.ar : v.title.en}>{L('S', 'ح')}{v.session}</th>)}
                </tr></thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="p-1.5 font-medium text-slate-900">{s.name}<span className="block text-[11px] text-slate-500">{s.completed}/{data.videos.length} {L('watched', 'اتشافوا')}</span></td>
                      <td className="p-1.5">{s.minutes}</td>
                      <td className="p-1.5">{day(s.lastAt)}</td>
                      <td className={`p-1.5 ${s.fastPercent >= 30 ? 'font-semibold text-red-700' : s.fastPercent > 0 ? 'text-amber-700' : 'text-slate-400'}`} title={L('Share of the watching faster than 1×', 'نسبة المشاهدة بسرعة أعلى من 1×')}>{s.fastPercent > 0 ? `⚡ ${s.fastPercent}% · ${s.maxSpeed}×` : '1×'}</td>
                      {data.videos.map((v) => {
                        const c = s.cells[v.blockId]
                        return <td key={v.blockId} className={`p-1.5 text-center ${c?.done ? 'bg-emerald-50 font-semibold text-emerald-700' : c ? 'text-amber-700' : 'text-slate-300'}`} title={c ? `${c.minutes} ${L('min', 'د')}${c.fastPercent ? ` · ⚡ ${c.fastPercent}% (${c.maxSpeed}×)` : ''}` : ''}>{c ? `${c.percent}%${c.fastPercent >= 30 ? ' ⚡' : ''}` : '—'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-slate-500">{L('Green = watched (counts as done in the lesson). The minutes count each part once, even when watched again or on two devices. ⚡ = watched faster than 1× (share of the watching, and the fastest speed).', 'الأخضر = اتشاف (بيتحسب «تم» في الدرس). الدقايق بتعدّ كل جزء مرة واحدة حتى لو اتشاف تاني أو على جهازين. ⚡ = اتفرج بسرعة أعلى من 1× (النسبة من وقت المشاهدة، وأعلى سرعة).')}</p>
            </div>
          )
      ) : null}
    </div>
  )
}
