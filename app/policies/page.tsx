'use client'

/** Rules & policies: public list of TechNova policies (no login needed). */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, L, LanguageSwitch } from '@/lib/i18n/client'

function View() {
  const { data = [], isLoading } = useQuery({ queryKey: ['public-policies'], queryFn: () => fetchApi<{ key: string; titleEn: string; titleAr: string }[]>('/api/public/policies') })
  return (
    <div className="keep-light min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
          <LanguageSwitch />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{L('TechNova policies', 'سياسات TechNova')}</h1>
        {isLoading ? <p className="text-sm text-slate-500">…</p> : data.length === 0 ? <p className="text-sm text-slate-500">{L('No policies published yet.', 'لسه مفيش سياسات منشورة.')}</p> : (
          <ul className="space-y-2">
            {data.map((p) => <li key={p.key}><Link href={`/policies/${p.key}`} className="block rounded-lg border border-slate-200 bg-white p-4 font-medium text-indigo-700 hover:border-indigo-300">{L(p.titleEn, p.titleAr)}</Link></li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function PoliciesPage() {
  return <I18nProvider><View /></I18nProvider>
}
