'use client'

/** Six phases 2: a student's video watching (family page / the student's learning page): minutes this week, videos watched, recent. */

import { useQuery } from '@tanstack/react-query'
import { PlayCircle } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'

type Row = { groupId: string; group: string; course: string | null; level: string | null; totalVideos: number; watchedVideos: number; minutes: number; weekMinutes: number; lastAt: string | null; recent: { title: { en: string; ar: string }; session: number | null; percent: number; done: boolean }[] }

export function StudentWatchCard({ studentId }: { studentId?: string }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { data } = useQuery({ queryKey: ['student-watch', studentId ?? 'me'], queryFn: () => fetchApi<Row[]>(`/api/students/${studentId ?? 'me'}/watch`), retry: false })
  if (!data?.length) return null
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900"><PlayCircle className="h-5 w-5 text-indigo-600" aria-hidden /> {L('Lesson videos', 'فيديوهات الدروس')}</h3>
      <div className="mt-2 space-y-3">
        {data.map((g) => (
          <div key={g.groupId} className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-900">{g.course ? `${g.course} · ` : ''}{g.level ?? g.group}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-slate-700">
              <span>{L(`${g.weekMinutes} min this week`, `${g.weekMinutes} دقيقة الأسبوع ده`)}</span>
              <span>{L(`${g.watchedVideos} of ${g.totalVideos} videos watched`, `${g.watchedVideos} من ${g.totalVideos} فيديو اتشافوا`)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden><div className="h-full rounded-full bg-indigo-500" style={{ width: `${g.totalVideos ? Math.round((g.watchedVideos / g.totalVideos) * 100) : 0}%` }} /></div>
            {g.recent.length ? (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {g.recent.slice(0, 3).map((r, i) => <li key={i}>{r.session ? `${L('Session', 'حصة')} ${r.session}: ` : ''}{ar ? r.title.ar : r.title.en} — {r.done ? L('watched ✓', 'اتشاف ✓') : `${r.percent}%`}</li>)}
              </ul>
            ) : <p className="mt-2 text-xs text-slate-500">{L('No video watched yet.', 'لسه مفيش فيديو اتشاف.')}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
