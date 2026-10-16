'use client'

/**
 * Appearance (2026-10-16): light / dark / follow the device, and the dark-mode colours (graphite = default and softest,
 * blue-grey, or the first navy). Saved in this browser for this person; applied before the page paints (app/layout.tsx).
 */

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { L } from '@/lib/i18n/client'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'

const PALETTES = [
  { key: 'graphite', en: 'Graphite (soft)', ar: 'رمادي هادي', page: '#18181b', card: '#222226', text: '#d4d4d8', accent: '#93b4e8' },
  { key: 'dim', en: 'Blue-grey', ar: 'أزرق رمادي', page: '#1a1f2b', card: '#222938', text: '#d6dbe5', accent: '#9cb8ee' },
  { key: 'navy', en: 'Navy (strong)', ar: 'كحلي', page: '#0b1020', card: '#0f172a', text: '#f1f5f9', accent: '#60a5fa' },
] as const

export function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  const [palette, setPalette] = useState('graphite')
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    try { setPalette(localStorage.getItem('tn_palette') || 'graphite') } catch { /* private window */ }
  }, [])
  const choosePalette = (key: string) => {
    setPalette(key)
    try { localStorage.setItem('tn_palette', key) } catch { /* private window */ }
    if (key === 'graphite') document.documentElement.removeAttribute('data-palette')
    else document.documentElement.setAttribute('data-palette', key)
  }
  const modes = [
    { key: 'light', en: 'Light', ar: 'فاتح', icon: Sun },
    { key: 'dark', en: 'Dark', ar: 'غامق', icon: Moon },
    { key: 'system', en: 'Like the device', ar: 'زي الجهاز', icon: Monitor },
  ]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-5 w-5 text-indigo-600" />{L('Appearance', 'المظهر')}</CardTitle>
        <CardDescription>{L('Saved on this device for your account.', 'بيتحفظ على الجهاز ده لحسابك.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m.key} type="button" onClick={() => setTheme(m.key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${mounted && theme === m.key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <m.icon className="h-4 w-4" />{L(m.en, m.ar)}
            </button>
          ))}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-500">{L('Dark-mode colours', 'ألوان الوضع الغامق')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PALETTES.map((p) => (
              <button key={p.key} type="button" onClick={() => choosePalette(p.key)}
                className={`rounded-xl border p-2 text-start ${palette === p.key ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
                {/* a small preview of the palette (fixed colours on purpose: it shows what dark mode will look like) */}
                <div className="keep-light flex gap-2 rounded-lg p-2" style={{ background: p.page }}>
                  <div className="flex w-8 flex-col gap-1">{[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded" style={{ background: i === 1 ? p.accent : p.card }} />)}</div>
                  <div className="flex-1 rounded p-1.5" style={{ background: p.card }}>
                    <div className="h-1.5 w-10 rounded" style={{ background: p.text }} />
                    <div className="mt-1 h-2.5 w-6 rounded" style={{ background: p.accent }} />
                  </div>
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-xs font-medium">{palette === p.key && <Check className="h-3.5 w-3.5 text-indigo-600" />}{L(p.en, p.ar)}</p>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
