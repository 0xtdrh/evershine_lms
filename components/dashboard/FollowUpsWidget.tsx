'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { PhoneCall } from 'lucide-react'

/** "You have N parent follow-ups today" banner (phase A). Hidden when there is nothing to do. */
export function FollowUpsWidget() {
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const can = !!perms?.permissions?.contact_logs?.includes('read')
  const { data } = useQuery({
    queryKey: ['follow-ups'],
    queryFn: () => fetchApi<{ counts: { overdue: number; today: number; upcoming: number } }>('/api/contact-logs/follow-ups'),
    enabled: can,
  })
  const c = data?.counts
  if (!can || !c || (c.today === 0 && c.overdue === 0)) return null
  return (
    <Link href="/dashboard/follow-ups" className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 hover:bg-indigo-100">
      <PhoneCall className="h-5 w-5 text-indigo-600" />
      <span>
        You have <strong>{c.today}</strong> parent follow-up{c.today === 1 ? '' : 's'} today
        {c.overdue > 0 && <> and <strong className="text-rose-700">{c.overdue} overdue</strong></>}.
      </span>
      <span className="ml-auto text-xs font-semibold">Open →</span>
    </Link>
  )
}
