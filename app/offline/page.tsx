'use client'

/**
 * "No connection" page (final test X18, 22/11): Arabic first with a language switch, TechNova look (light, brand logo),
 * and it tries again by itself every few seconds — the person does not have to press anything once the network is back.
 */

import { useCallback, useEffect, useState } from 'react'
import { RotateCw, WifiOff } from 'lucide-react'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'

function Offline() {
  useI18n()
  const [trying, setTrying] = useState(false)
  const [tries, setTries] = useState(0)

  const retry = useCallback(async () => {
    setTrying(true)
    try {
      const r = await fetch('/api/health', { cache: 'no-store' })
      if (r.ok || r.status < 500) {
        // back: return to where the person was (the page they asked for), else the home
        const back = document.referrer && new URL(document.referrer).origin === window.location.origin ? document.referrer : '/dashboard'
        window.location.href = back
        return
      }
    } catch { /* still offline */ }
    setTries((n) => n + 1)
    setTrying(false)
  }, [])

  useEffect(() => {
    const t = setInterval(() => { void retry() }, 6000)
    const online = () => { void retry() }
    window.addEventListener('online', online)
    return () => { clearInterval(t); window.removeEventListener('online', online) }
  }, [retry])

  return (
    <div className="keep-light flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50 to-white px-4">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="flex justify-end"><LanguageSwitch /></div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/bglogo.png" alt="TechNova" className="mx-auto h-16 w-auto" />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500"><WifiOff className="h-7 w-7" /></div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">{L('No connection', 'مفيش اتصال')}</h1>
          <p className="text-sm leading-relaxed text-slate-500">{L('We could not reach the server. Your work on this page is safe on your screen; we will try again by ourselves.', 'مش قادرين نوصل للسيرفر. شغلك على الشاشة دي لسه قدامك، وهنحاول تاني لوحدنا.')}</p>
        </div>
        <ul className="space-y-2 text-start text-sm text-slate-600">
          <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />{L('Check your Wi-Fi or mobile data.', 'اتأكد من الواي فاي أو النت.')}</li>
          <li className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />{L('Turn airplane mode off.', 'اقفل وضع الطيران.')}</li>
        </ul>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={trying}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white shadow transition hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60"
        >
          <RotateCw className={`h-4 w-4 ${trying ? 'animate-spin' : ''}`} />
          {trying ? L('Trying…', 'بنحاول…') : L('Try again now', 'حاول دلوقتي')}
        </button>
        {tries > 0 && <p className="text-xs text-slate-400">{L(`Tried ${tries} time(s) — still offline.`, `حاولنا ${tries} مرة — لسه مفيش اتصال.`)}</p>}
      </div>
    </div>
  )
}

export default function OfflinePage() {
  return <I18nProvider><Offline /></I18nProvider>
}
