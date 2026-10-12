'use client'

/** P2: "A year at TechNova" — the last 12 months in numbers (sessions, hours, projects, stamps, certificates, quotes). */

import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { StampBadge } from '@/components/passport/StampBadge'
import { Loader2 } from 'lucide-react'

interface Recap { name: string; years: number; sessions: number; hours: number; projects: number; certificates: number; stamps: { nameEn: string; nameAr: string; icon: string; shape: string; color: string; label: string | null; awardedAt: string }[]; quotes: string[] }

export default function RecapPage() {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const s = useSearchParams().get('s') ?? ''
  const { data, isLoading, error } = useQuery({ queryKey: ['recap', s], queryFn: () => fetchApi<Recap>(`/api/profile/${s}?view=recap`), enabled: !!s, retry: false })
  if (error) return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const tiles: [string, number, string][] = [
    ['📅', data.sessions, L('sessions', 'حصة')], ['⏱️', data.hours, L('hours of learning', 'ساعة تعلّم')],
    ['🖼️', data.projects, L('projects', 'مشروع')], ['📜', data.certificates, L('certificates', 'شهادة')], ['🏅', data.stamps.length, L('stamps', 'ختم')],
  ]
  return (
    <div className="space-y-5" dir={dir}>
      <div className="rounded-3xl bg-gradient-to-br from-pink-500 via-indigo-600 to-slate-900 p-6 text-center text-white">
        <p className="text-sm uppercase tracking-[0.3em] text-white/70">TechNova</p>
        <h1 className="mt-2 text-3xl font-bold">{L(`${data.name}'s year at TechNova`, `سنة ${data.name} في TechNova`)} 🎉</h1>
        <p className="mt-1 text-white/80">{L(`${data.years} year(s) with us`, `${data.years} سنة معانا`)}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([icon, n, label], i) => (
          <div key={i} className="animate-[stampIn_0.8s_ease-out] rounded-2xl border border-slate-200 bg-white p-4 text-center" style={{ animationDelay: `${i * 120}ms`, animationFillMode: 'both' }}>
            <p className="text-3xl">{icon}</p><p className="text-3xl font-bold text-slate-900">{n}</p><p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>
      {data.stamps.length > 0 && (
        <div className="rounded-2xl bg-white p-4">
          <p className="mb-3 font-semibold text-slate-800">{L('Stamps of the year', 'أختام السنة')}</p>
          <div className="flex flex-wrap justify-center gap-3">{data.stamps.map((st, i) => <StampBadge key={i} stamp={{ ...st, date: st.awardedAt }} ar={ar} size={110} />)}</div>
        </div>
      )}
      {data.quotes.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-white p-4 text-sm">
          <p className="font-semibold text-slate-800">{L('What the instructors said', 'المدربين قالوا')}</p>
          {data.quotes.map((q, i) => <p key={i} className="rounded-lg bg-slate-50 p-2">“{q}”</p>)}
        </div>
      )}
    </div>
  )
}
