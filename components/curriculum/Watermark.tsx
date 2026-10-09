'use client'

/**
 * LMS L2: the student's name over lesson content, so a photo / screen recording shows who it came from.
 * `moving` = one label that jumps to a new place every few seconds (videos, embeds, PDFs);
 * otherwise a light repeated pattern (text, images, code). Never catches clicks.
 */

import { useEffect, useState } from 'react'

export function Watermark({ text, moving = false }: { text: string; moving?: boolean }) {
  const [pos, setPos] = useState({ top: 12, left: 10 })
  useEffect(() => {
    if (!moving) return
    const t = setInterval(() => setPos({ top: 5 + Math.random() * 80, left: 5 + Math.random() * 60 }), 4000)
    return () => clearInterval(t)
  }, [moving])
  if (moving) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none" aria-hidden>
        <span className="absolute whitespace-nowrap rounded bg-black/20 px-2 py-0.5 text-xs font-semibold text-white/70 transition-all duration-1000" style={{ top: `${pos.top}%`, left: `${pos.left}%` }}>{text}</span>
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid select-none grid-cols-2 content-around overflow-hidden opacity-[0.08] sm:grid-cols-3" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => <span key={i} className="-rotate-12 whitespace-nowrap text-center text-sm font-bold text-slate-900">{text}</span>)}
    </div>
  )
}
