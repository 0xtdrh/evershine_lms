'use client'

/**
 * Birthday look for the whole portal (owner, 2026-10-03): on the birthday of the
 * signed-in student / staff member, or of a parent's child:
 *  - confetti once a day on the first open, then a big welcome card (once a day)
 *  - small balloons floating at the side all day (✕ hides them for today)
 *  - the header turns pink/gold (layout-client, via useBirthdayToday)
 * No sound. Nothing moves when the device asks for reduced motion. Not printed.
 */

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface Me { self: { name: string; turns: number; studentId?: string } | null; children: { studentId: string; name: string; turns: number }[] }

/** Shared query: is today a birthday for this user (or one of their children)? */
export function useBirthdayToday() {
  const { data: session } = useSession()
  const { data } = useQuery({ queryKey: ['birthday-me'], queryFn: () => fetchApi<Me>('/api/birthdays/me'), staleTime: 60 * 60 * 1000, enabled: !!session?.user })
  const active = !!data && (!!data.self || data.children.length > 0)
  return { data, active, userId: session?.user?.id ?? '' }
}

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Lightweight canvas confetti (no library), ~3 seconds. */
function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const w = (c.width = window.innerWidth)
    const h = (c.height = window.innerHeight)
    const colors = ['#ec4899', '#f59e0b', '#6366f1', '#10b981', '#f43f5e', '#facc15']
    const parts = Array.from({ length: 160 }, () => ({
      x: Math.random() * w, y: -20 - Math.random() * h * 0.5, r: 4 + Math.random() * 5,
      vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 3, a: Math.random() * Math.PI, va: -0.2 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.a += p.va
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a)
        ctx.fillStyle = p.color; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6)
        ctx.restore()
      }
      if (t - start < 3200) raf = requestAnimationFrame(tick)
      else onDone()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [onDone])
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[90] print:hidden" aria-hidden />
}

function Balloons({ onClose }: { onClose: () => void }) {
  const items = ['🎈', '🎈', '🎉', '🎈', '🎁']
  return (
    <div className="pointer-events-none fixed bottom-0 right-2 z-40 h-full w-14 overflow-hidden print:hidden sm:right-4" aria-hidden>
      <style>{'@keyframes tn-balloon { 0% { transform: translateY(0) rotate(-4deg); opacity: 0 } 10% { opacity: 1 } 50% { transform: translateY(-55vh) rotate(4deg) } 100% { transform: translateY(-110vh) rotate(-4deg); opacity: 0.9 } }'}</style>
      {items.map((b, i) => (
        <span key={i} className="absolute bottom-[-3rem] text-3xl" style={{ left: `${(i * 37) % 70}%`, animation: `tn-balloon ${11 + i * 2}s linear ${i * 2.3}s infinite` }}>{b}</span>
      ))}
      <button type="button" onClick={onClose} title="Hide the balloons for today" className="pointer-events-auto absolute right-1 top-20 rounded-full bg-white/90 p-1 text-slate-500 shadow hover:text-slate-800">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function BirthdayCelebration() {
  const { data, active, userId } = useBirthdayToday()
  const [confetti, setConfetti] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [balloons, setBalloons] = useState(false)
  const day = todayKey()

  useEffect(() => {
    if (!active || !userId) return
    const seenKey = `tn-bday-welcome-${userId}-${day}`
    const still = !reducedMotion()
    if (!store.get(seenKey)) {
      store.set(seenKey, '1')
      if (still) setConfetti(true)
      setWelcome(true)
    }
    if (still && !store.get(`tn-bday-balloons-off-${userId}-${day}`)) setBalloons(true)
  }, [active, userId, day])

  if (!active || !data) return null
  const self = data.self
  const kids = data.children
  const title = self ? `Happy Birthday, ${self.name}! 🎂` : `Today is ${kids.map((k) => k.name).join(' & ')}'s birthday! 🎉`
  const sub = self
    ? (self.turns ? `You are ${self.turns} today. ` : '') + 'Everyone at TechNova wishes you a wonderful year full of joy, learning and new inventions.'
    : kids.map((k) => `${k.name} turns ${k.turns} today.`).join(' ') + ' All of us at TechNova wish them a wonderful year.'
  const cards = [...(self?.studentId ? [{ id: self.studentId, name: self.name }] : []), ...kids.map((k) => ({ id: k.studentId, name: k.name }))]

  return (
    <>
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {balloons && <Balloons onClose={() => { setBalloons(false); store.set(`tn-bday-balloons-off-${userId}-${day}`, '1') }} />}
      {welcome && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 print:hidden" role="dialog" aria-modal="true" onClick={() => setWelcome(false)}>
          <div className="keep-light relative w-full max-w-md overflow-hidden rounded-3xl border-4 border-amber-300 bg-gradient-to-br from-pink-50 via-white to-amber-50 p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="absolute right-3 top-3 text-slate-400 hover:text-slate-700" onClick={() => setWelcome(false)} aria-label="Close"><X className="h-5 w-5" /></button>
            <div className="text-6xl">🎂</div>
            <h2 className="mt-3 text-2xl font-black text-pink-700">{title}</h2>
            <p className="mt-2 text-sm text-slate-700">{sub}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {cards.map((c) => (
                <Button key={c.id} asChild className="bg-pink-600 hover:bg-pink-700">
                  <a href={`/birthday-card/${c.id}`} target="_blank" rel="noopener noreferrer">Open {cards.length > 1 ? `${c.name}'s ` : 'the '}birthday certificate</a>
                </Button>
              ))}
              <Button variant="outline" onClick={() => setWelcome(false)}>Let&apos;s go</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
