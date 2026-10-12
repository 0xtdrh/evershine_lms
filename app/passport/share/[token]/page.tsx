'use client'

/** P1: public passport page of a parent's share link (identity, stamps, certificates; projects / photo if chosen). */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { StampBadge } from '@/components/passport/StampBadge'

interface Shared {
  number: string; name: string; campus: string; joinedAt: string; photo: string | null; expiresAt: string
  stamps: { nameEn: string; nameAr: string; icon: string; shape: string; color: string; label: string | null; awardedAt: string }[]
  certificates: { title: string; number: string; issuedAt: string }[]
  projects: { titleEn: string; titleAr: string }[] | null
}
const day = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function SharedView({ token }: { token: string }) {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const { data, error, isLoading } = useQuery({
    queryKey: ['passport-share', token],
    queryFn: async () => { const r = await fetch(`/api/passport/public/${token}`); const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message || 'Not found'); return j.data as Shared },
    retry: false,
  })
  return (
    <div className="keep-light min-h-screen bg-slate-100 px-4 py-6" dir={dir}>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
          <LanguageSwitch />
        </div>
        {isLoading ? <p className="text-sm text-slate-500">{L('Loading…', 'جاري التحميل…')}</p> : error || !data ? (
          <p className="rounded-xl bg-white p-6 text-center text-slate-600">{L('This link has ended or was stopped.', 'اللينك ده خلص أو اتوقف.')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-4 rounded-3xl bg-gradient-to-br from-indigo-800 to-slate-900 p-5 text-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {data.photo && <img src={data.photo} alt="" className="h-24 w-20 rounded-xl border-2 border-white/70 object-cover" />}
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.3em] text-white/70">{L('TechNova passport', 'جواز سفر TechNova')}</p>
                <p className="text-xl font-bold">{data.name}</p>
                <p className="font-mono text-sm">{data.number}</p>
                <p className="text-xs text-white/80">{data.campus} · {L('joined', 'انضم')} {day(data.joinedAt, ar)}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4">
              <p className="mb-3 font-semibold text-slate-800">{L('Stamps', 'الأختام')} ({data.stamps.length})</p>
              <div className="flex flex-wrap justify-center gap-3">{data.stamps.map((s, i) => <StampBadge key={i} stamp={{ ...s, date: s.awardedAt }} ar={ar} size={120} />)}</div>
            </div>
            {data.certificates.length > 0 && (
              <div className="space-y-1 rounded-2xl bg-white p-4 text-sm">
                <p className="font-semibold text-slate-800">{L('Certificates', 'الشهادات')}</p>
                {data.certificates.map((c) => <p key={c.number}>{c.title} · <a className="font-mono text-indigo-700 underline" href={`/verify/${c.number}`}>{c.number}</a> · {day(c.issuedAt, ar)}</p>)}
              </div>
            )}
            {data.projects && data.projects.length > 0 && (
              <div className="rounded-2xl bg-white p-4 text-sm">
                <p className="mb-2 font-semibold text-slate-800">{L('Projects', 'المشاريع')}</p>
                <div className="flex flex-wrap gap-2">{data.projects.map((x, i) => <span key={i} className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs text-orange-800">🖼️ {ar ? x.titleAr : x.titleEn}</span>)}</div>
              </div>
            )}
            <p className="text-center text-xs text-slate-400">{L('Shared by the parent · open until', 'شاركه ولي الأمر · مفتوح لحد')} {day(data.expiresAt, ar)}</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function SharedPassportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  return <I18nProvider><SharedView token={token} /></I18nProvider>
}
