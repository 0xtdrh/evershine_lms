/**
 * a02 M1 batch 5 (2026-10-31) — attendance detail beside PRESENT / ABSENT. Pure (tests/presence.test.ts).
 * Status stays the same everywhere (attendance %, pay, reports keep working). Beside it:
 *   mode            how the session was attended — BRANCH / ONLINE / RECORDED (the student's own way that day, else the session's)
 *   presenceDetail  PARTIAL (online, below the % of the session — still counts as a session for him and for the
 *                   instructor's pay, owner) · CAMERA_OFF (online, present with the camera off) · WATCHED (recorded, watched)
 *   minutes         minutes in the online session (typed by the instructor now; from Zoom / Meet in M2)
 */

import type { Mode } from '@/lib/delivery/modes'

export const DETAILS = ['PARTIAL', 'CAMERA_OFF', 'WATCHED'] as const
export type Detail = (typeof DETAILS)[number]
export interface PresenceSettings { onlinePresentPct: number; recordedWatchedPct: number }
export const DEFAULT_PRESENCE: PresenceSettings = { onlinePresentPct: 70, recordedWatchedPct: 80 }

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'

/**
 * What is stored beside the status. Details that do not fit the way are dropped (WATCHED only for recorded,
 * PARTIAL / CAMERA_OFF only online); online minutes below the % of the session make a PRESENT student PARTIAL.
 */
export function presenceFields(i: { status: Status; mode: Mode; detail?: string | null; minutes?: number | null; sessionMinutes: number; settings?: PresenceSettings }) {
  const s = i.settings ?? DEFAULT_PRESENCE
  const present = i.status === 'PRESENT' || i.status === 'LATE'
  const minutes = i.mode === 'ONLINE' && Number.isFinite(i.minutes) && (i.minutes as number) >= 0 ? Math.round(i.minutes as number) : null
  let detail: Detail | null = (DETAILS as readonly string[]).includes(String(i.detail)) ? (i.detail as Detail) : null
  if (!present) detail = null
  if (detail === 'WATCHED' && i.mode !== 'RECORDED') detail = null
  if ((detail === 'PARTIAL' || detail === 'CAMERA_OFF') && i.mode !== 'ONLINE') detail = null
  if (present && i.mode === 'ONLINE' && minutes != null && !detail && minutes < (s.onlinePresentPct / 100) * i.sessionMinutes) detail = 'PARTIAL'
  if (present && i.mode === 'RECORDED' && !detail) detail = 'WATCHED'
  return { mode: i.mode, presenceDetail: detail, minutes }
}

/** Words for families / staff ("present online — left early"). */
export function presenceText(status: string, mode: string | null, detail: string | null, lang: 'en' | 'ar'): string | null {
  if (status !== 'PRESENT' && status !== 'LATE') return null
  const t = {
    ONLINE: ['present online', 'حضر أونلاين'], RECORDED: ['watched the recorded session', 'اتفرج على الحصة المسجلة'],
    PARTIAL: ['part of the session', 'حضور جزئي'], CAMERA_OFF: ['camera off', 'الكاميرا كانت مقفولة'],
  } as const
  const k = lang === 'ar' ? 1 : 0
  const bits: string[] = []
  if (mode === 'ONLINE') bits.push(t.ONLINE[k])
  if (mode === 'RECORDED' || detail === 'WATCHED') bits.push(t.RECORDED[k])
  if (detail === 'PARTIAL') bits.push(t.PARTIAL[k])
  if (detail === 'CAMERA_OFF') bits.push(t.CAMERA_OFF[k])
  return bits.length ? bits.join(' — ') : null
}
