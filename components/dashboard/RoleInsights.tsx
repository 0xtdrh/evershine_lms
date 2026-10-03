'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'

interface Metric { key: string; label: string; value: number | string; hint?: string; href?: string; tone?: 'good' | 'warn' | 'bad' }

const TONE: Record<string, string> = { good: 'text-emerald-700', warn: 'text-amber-600', bad: 'text-rose-600' }

/** Phase C: the numbers that matter for this role, at the top of the dashboard. */
export function RoleInsights() {
  const { data } = useQuery({ queryKey: ['dashboard-insights'], queryFn: () => fetchApi<{ role: string; metrics: Metric[] }>('/api/dashboard/insights'), staleTime: 2 * 60 * 1000, refetchInterval: 5 * 60 * 1000 })
  if (!data?.metrics.length) return null
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {data.metrics.map((m) => {
        const inner = (
          <div className="h-full rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow-md">
            <p className="text-xs text-slate-500">{m.label}</p>
            <p className={`mt-1 text-xl font-bold sm:text-2xl ${m.tone ? TONE[m.tone] : 'text-slate-900'}`}>{m.value}</p>
            {m.hint && <p className="mt-0.5 text-[11px] text-slate-400">{m.hint}</p>}
          </div>
        )
        return m.href ? <Link key={m.key} href={m.href}>{inner}</Link> : <div key={m.key}>{inner}</div>
      })}
    </div>
  )
}
