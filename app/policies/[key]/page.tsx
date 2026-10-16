'use client'

/** Rules & policies: one public policy (no login needed), Arabic / English. */

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, LanguageSwitch, useI18n } from '@/lib/i18n/client'

interface Policy { key: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; version: number; publishedAt: string }

function View({ k }: { k: string }) {
  const { pick, dir } = useI18n()
  const { data: p, isLoading, error } = useQuery({ queryKey: ['public-policy', k], queryFn: () => fetchApi<Policy>(`/api/public/policies/${k}`), retry: false })
  return (
    <div className="keep-light min-h-screen bg-slate-50 px-4 py-10" dir={dir}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/policies">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
          </Link>
          <LanguageSwitch />
        </div>
        {isLoading && <p className="text-sm text-slate-500">…</p>}
        {error && <p className="text-sm text-slate-500">{pick('This page is not available.', 'الصفحة دي مش متاحة.')}</p>}
        {p && (
          <article className="rounded-xl border border-slate-200 bg-white p-6">
            <h1 className="mb-1 text-2xl font-bold text-slate-900">{pick(p.titleEn, p.titleAr)}</h1>
            <p className="mb-4 text-xs text-slate-500">{pick('Version', 'النسخة')} {p.version} · {p.publishedAt.slice(0, 10)}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{pick(p.bodyEn, p.bodyAr)}</div>
          </article>
        )}
        <p className="text-center text-xs text-slate-400"><Link href="/policies" className="hover:underline">{pick('All policies', 'كل السياسات')}</Link></p>
      </div>
    </div>
  )
}

export default function PolicyPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  return <I18nProvider><View k={key} /></I18nProvider>
}
