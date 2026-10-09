'use client'

/**
 * Language for the dashboard / portal (docs/plan-learning-platform.md §14.1).
 * The choice is kept in the `tn-lang` cookie (read by the server too). With no choice yet, the default comes from
 * settings (i18n.defaults: one for staff, one for the portal: parents / students). Arabic switches the page to
 * right-to-left.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { translate, pick, type Locale, type MessageKey } from './messages'

const COOKIE = 'tn-lang'
const PORTAL_ROLES = ['STUDENT', 'PARENT', 'GUARDIAN']

function readCookie(): Locale | null {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(/(?:^|; )tn-lang=(en|ar)/)
  return (m?.[1] as Locale) ?? null
}

interface Ctx {
  locale: Locale
  dir: 'ltr' | 'rtl'
  setLocale: (l: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  pick: (enText?: string | null, arText?: string | null) => string
}

const I18nContext = createContext<Ctx>({
  locale: 'en', dir: 'ltr', setLocale: () => undefined,
  t: (k, v) => translate('en', k, v), pick: (e, a) => pick('en', e, a),
})

export function I18nProvider({ children, defaults }: { children: React.ReactNode; defaults?: { staff: Locale; portal: Locale } }) {
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const fallback: Locale = PORTAL_ROLES.includes(role) ? defaults?.portal ?? 'en' : defaults?.staff ?? 'en'
  const [chosen, setChosen] = useState<Locale | null>(null)
  useEffect(() => { setChosen(readCookie()) }, [])
  const locale: Locale = chosen ?? fallback
  const dir = locale === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    const html = document.documentElement
    const prev = { lang: html.lang, dir: html.dir }
    html.lang = locale
    html.dir = dir
    return () => { html.lang = prev.lang || 'en'; html.dir = prev.dir || 'ltr' }
  }, [locale, dir])

  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
    setChosen(l)
  }, [])

  const value = useMemo<Ctx>(() => ({
    locale, dir, setLocale,
    t: (k, v) => translate(locale, k, v),
    pick: (e, a) => pick(locale, e, a),
  }), [locale, dir, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)

/** Small EN / عربي switch for the header. */
export function LanguageSwitch() {
  const { locale, setLocale } = useI18n()
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      title={locale === 'ar' ? 'English' : 'العربية'}
      aria-label="Language"
    >
      {locale === 'ar' ? 'EN' : 'عربي'}
    </button>
  )
}
