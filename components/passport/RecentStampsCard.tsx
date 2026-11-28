'use client'

/**
 * owner 28/11 (S42): «new stamp this week» on the parent's home (my-children) and the student's home (learning).
 * Hidden when there is nothing new, so the home stays short. Tapping opens the passport.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'

interface Recent { id: string; studentId: string; student: string; nameEn: string; nameAr: string; icon: string; awardedAt: string }

export function RecentStampsCard({ showNames = true }: { showNames?: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { data } = useQuery({ queryKey: ['passport-recent'], queryFn: () => fetchApi<Recent[]>('/api/passport/recent'), staleTime: 60_000 })
  if (!data?.length) return null
  return (
    <Link href="/dashboard/passport" className="block rounded-2xl border border-amber-200 bg-amber-50 p-4 transition active:scale-[0.99]">
      <p className="text-sm font-bold text-amber-900">🛂 {L('New stamps this week', 'أختام جديدة الأسبوع ده')}</p>
      <ul className="mt-2 space-y-1">
        {data.slice(0, 4).map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm text-amber-900">
            <span className="text-lg" aria-hidden>{s.icon}</span>
            <span className="font-medium">{ar ? s.nameAr : s.nameEn}</span>
            {showNames && <span className="text-xs text-amber-700">· {s.student}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-semibold text-amber-800">{L('Open the passport →', 'افتح الجواز ←')}</p>
    </Link>
  )
}
