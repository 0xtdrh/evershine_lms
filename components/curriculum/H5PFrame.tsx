'use client'

/**
 * L5: plays an H5P activity in a sandboxed frame (scripts only, no access to the page or the cookies). The frame sends
 * its height and the result with postMessage; for a student the result is saved (POST /api/h5p/result).
 */

import { useEffect, useRef, useState } from 'react'
import { L } from '@/lib/i18n/client'

export function H5PFrame({ blockId, groupId, height = 640, onSaved }: { blockId: string; groupId?: string | null; height?: number; onSaved?: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(height)
  const [last, setLast] = useState<{ score: number | null; max: number | null } | null>(null)
  const saved = useRef(0)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const m = e.data as { source?: string; blockId?: string; type?: string; height?: number; score?: number | null; max?: number | null; completed?: boolean }
      if (m?.source !== 'tn-h5p' || m.blockId !== blockId) return
      if (m.type === 'height' && m.height) setH(Math.min(Math.max(m.height + 16, 300), 4000))
      if (m.type === 'result') {
        setLast({ score: m.score ?? null, max: m.max ?? null })
        if (!groupId) return // staff preview: nothing is saved
        const now = Date.now()
        if (now - saved.current < 800) return
        saved.current = now
        fetch('/api/h5p/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId, blockId, score: m.score ?? null, maxScore: m.max ?? null, completed: !!m.completed }) })
          .then(() => onSaved?.()).catch(() => undefined)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [blockId, groupId, onSaved])
  const src = `/api/h5p/${blockId}/play${groupId ? `?g=${encodeURIComponent(groupId)}` : ''}`
  return (
    <div className="space-y-1">
      <iframe ref={ref} src={src} title="H5P" className="w-full rounded-lg border border-slate-200 bg-white" style={{ height: h }} sandbox="allow-scripts allow-popups allow-forms" allow="fullscreen; autoplay" />
      {last?.max ? <p className="text-xs font-medium text-emerald-700">{L('Score', 'الدرجة')}: {last.score ?? 0} / {last.max}{groupId ? ` · ${L('saved', 'اتسجّلت')}` : ` · ${L('preview — not saved', 'معاينة — مش بتتسجل')}`}</p> : null}
    </div>
  )
}
