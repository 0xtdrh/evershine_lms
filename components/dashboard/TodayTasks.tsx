'use client'

/**
 * 5-C "Your work today" on the home page: one line per job waiting for this person (count + a button to the page).
 * Urgent ones first (red). Data: /api/today (lib/today/*). Refreshes every 2 minutes.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { CheckCircle2, ChevronLeft, ChevronRight, ListTodo } from 'lucide-react'

interface Task { key: string; en: string; ar: string; href: string; urgent: boolean; count: number }

export function TodayTasks() {
  const ar = useI18n().locale === 'ar'
  const { data, isLoading } = useQuery({
    queryKey: ['today-tasks'],
    queryFn: () => fetchApi<{ tasks: Task[] }>('/api/today'),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  })
  if (isLoading || !data) return null
  const tasks = data.tasks
  const Arrow = ar ? ChevronLeft : ChevronRight
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900"><ListTodo className="h-5 w-5 text-indigo-600" />{L('Your work today', 'المطلوب منك النهارده')}</h2>
      {!tasks.length ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{L('Nothing waiting for you. Great!', 'مفيش حاجة مستنياك. عظيم!')}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {tasks.map((t) => (
            <Link key={t.key} href={t.href}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition hover:shadow-sm ${t.urgent ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-slate-200 text-slate-700'}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-bold ${t.urgent ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{t.count > 99 ? '99+' : t.count}</span>
                <span className="truncate">{ar ? t.ar : t.en}</span>
              </span>
              <Arrow className="h-4 w-4 flex-shrink-0 opacity-50" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
