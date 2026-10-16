'use client'

/** Rules & policies: links to the public policies (privacy, terms, refund, …) — for the login page and the portal footer. */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'

export function PolicyLinks({ className = '' }: { className?: string }) {
  const { data = [] } = useQuery({ queryKey: ['public-policies'], queryFn: () => fetchApi<{ key: string; titleEn: string; titleAr: string }[]>('/api/public/policies'), staleTime: 300_000, retry: false })
  if (!data.length) return null
  return (
    <nav className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500 print:hidden ${className}`}>
      {data.map((p) => <Link key={p.key} href={`/policies/${p.key}`} className="hover:text-slate-800 hover:underline">{L(p.titleEn, p.titleAr)}</Link>)}
    </nav>
  )
}
