'use client'

/**
 * a02 M1 batch 5 (2026-10-31): beside PRESENT in the attendance sheet — for an online session the detail (part of the
 * session / camera off) and the minutes in the meeting; for a recorded session it just says "watched". Branch sessions
 * show nothing (unchanged). Saved with the attendance (records[].detail / minutes).
 */

import { L } from '@/lib/i18n/client'

export interface Presence { detail: string | null; minutes: number | null }

export function PresenceInputs({ mode, present, value, onChange }: { mode: string | null | undefined; present: boolean; value: Presence; onChange: (v: Presence) => void }) {
  if (!present || !mode || mode === 'BRANCH') return null
  if (mode === 'RECORDED') return <p className="mt-1 text-xs font-semibold text-amber-700">🎬 {L('Recorded session — present = watched', 'حصة مسجلة — حاضر = اتفرج')}</p>
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-indigo-700">💻</span>
      <select aria-label={L('Online attendance', 'حضور الأونلاين')} className="h-7 rounded border px-1" value={value.detail ?? ''} onChange={(e) => onChange({ ...value, detail: e.target.value || null })}>
        <option value="">{L('Present online', 'حاضر أونلاين')}</option>
        <option value="PARTIAL">{L('Part of the session', 'حضور جزئي')}</option>
        <option value="CAMERA_OFF">{L('Camera off', 'الكاميرا مقفولة')}</option>
      </select>
      <input type="number" min={0} max={300} aria-label={L('Minutes in the session', 'دقايق الحضور')} placeholder={L('min', 'دقيقة')} className="h-7 w-16 rounded border px-1"
        value={value.minutes ?? ''} onChange={(e) => onChange({ ...value, minutes: e.target.value === '' ? null : Number(e.target.value) })} />
      <span className="text-slate-500">{L('min', 'دقيقة')}</span>
    </div>
  )
}
