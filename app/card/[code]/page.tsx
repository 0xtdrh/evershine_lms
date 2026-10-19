'use client'

/**
 * 2026-10-19 public ID card check (the QR on the back of every card opens this). Anyone: "card valid / not valid" only;
 * signed-in staff who may see the person: who it is + a link.
 */

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, L, LanguageSwitch } from '@/lib/i18n/client'

interface Check { state: 'VALID' | 'EXPIRED' | 'LEFT' | 'UNKNOWN'; kind: 'STUDENT' | 'STAFF' | null; validUntil: string | null; person?: { name: string; number: string; place: string; photo: string | null; href: string } }

const STATE: Record<Check['state'], { ok: boolean; text: () => string }> = {
  VALID: { ok: true, text: () => L('Card valid', 'كارنيه شغال') },
  EXPIRED: { ok: false, text: () => L('Card expired', 'الكارنيه منتهي') },
  LEFT: { ok: false, text: () => L('Card not valid', 'الكارنيه مش شغال') },
  UNKNOWN: { ok: false, text: () => L('Card not valid', 'الكارنيه مش شغال') },
}

function View({ code }: { code: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['card-check', code], queryFn: () => fetchApi<Check>(`/api/card-check?code=${encodeURIComponent(code)}`), retry: false })
  const st = data ? STATE[data.state] : null
  return (
    <div className="keep-light min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
          <LanguageSwitch />
        </div>
        {isLoading ? <p className="text-sm text-slate-500">…</p> : error || !st ? (
          <p className="text-sm text-red-600">{L('Could not check the card. Try again.', 'معرفناش نتأكد من الكارنيه. جرب تاني.')}</p>
        ) : (
          <div data-state={data!.state} className={`rounded-xl border p-6 text-center ${st.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            <div className={`text-5xl ${st.ok ? 'text-emerald-600' : 'text-red-600'}`}>{st.ok ? '✓' : '✕'}</div>
            <div className={`mt-2 text-xl font-bold ${st.ok ? 'text-emerald-800' : 'text-red-800'}`}>{st.text()}</div>
            {data!.validUntil && st.ok && <div className="mt-1 text-sm text-slate-600">{L('Valid until', 'صالح لحد')} {new Date(data!.validUntil).toLocaleDateString('en-GB')}</div>}
            {data!.person && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-white p-3 text-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {data!.person.photo && <img src={data!.person.photo} alt="" className="h-14 w-14 rounded-lg object-cover" />}
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{data!.person.name}</div>
                  <div className="text-sm text-slate-600">{data!.person.number}{data!.person.place ? ` · ${data!.person.place}` : ''}</div>
                  <Link href={data!.person.href} className="text-sm text-indigo-700 underline">{L('Open in the system', 'افتح في السيستم')}</Link>
                </div>
              </div>
            )}
          </div>
        )}
        <p className="text-center text-xs text-slate-500">TechNova · Hurghada</p>
      </div>
    </div>
  )
}

export default function CardCheckPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  return <I18nProvider><View code={decodeURIComponent(code)} /></I18nProvider>
}
