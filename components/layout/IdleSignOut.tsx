'use client'

/** Security part 2: signs a staff member out after the set minutes with no use (Settings → Sign-in security). One minute before, a warning. */

import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'

const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const

export function IdleSignOut() {
  const [minutes, setMinutes] = useState(0)
  const [warn, setWarn] = useState(false)
  const last = useRef(Date.now())
  useEffect(() => { fetchApi<{ idleMinutes: number }>('/api/security/policy').then((p) => setMinutes(p.idleMinutes)).catch(() => {}) }, [])
  useEffect(() => {
    if (!minutes) return
    const touch = () => { last.current = Date.now(); setWarn(false); try { localStorage.setItem('tn_last_use', String(last.current)) } catch { /* private window */ } }
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const t = setInterval(() => {
      // another tab of the same person counts as use
      try { last.current = Math.max(last.current, Number(localStorage.getItem('tn_last_use')) || 0) } catch { /* private window */ }
      const idle = Date.now() - last.current
      if (idle >= minutes * 60_000) void signOut({ callbackUrl: '/login?code=idle' })
      else setWarn(idle >= (minutes - 1) * 60_000)
    }, 10_000)
    return () => { EVENTS.forEach((e) => window.removeEventListener(e, touch)); clearInterval(t) }
  }, [minutes])
  if (!warn) return null
  return <div role="alert" className="fixed inset-x-0 top-0 z-[100] bg-amber-500 p-2 text-center text-sm font-semibold text-white">{L('You will be signed out in a minute because nothing was used. Move the mouse or press a key to stay.', 'هتخرج بعد دقيقة لأن مفيش استخدام. حرّك الماوس أو دوس أي زرار علشان تفضل.')}</div>
}
