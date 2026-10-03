/**
 * Session Shift (Morning / Evening / Night) is switched off for TechNova
 * (owner, 2026-10-03): it does not exist in the UI any more — a group's real
 * time comes from its weekly schedule (scheduleSlots). The database still
 * needs a shift on every group, so the server picks it from the group's time:
 * before 15:00 Morning, 15:00–17:59 Evening, from 18:00 Night (Morning when
 * there is no schedule yet). The staff working shift (staff attendance) is a
 * different thing and is not touched.
 */

import type { Prisma, SessionShift } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SESSION_SHIFT_TIMES } from '@/lib/validation/shift'

type Db = Prisma.TransactionClient | typeof prisma
const NAMES: Record<SessionShift, string> = { MORNING: 'Morning', EVENING: 'Evening', NIGHT: 'Night' }

export function shiftCodeForTime(time?: string | null): SessionShift {
  const h = Number(String(time ?? '').split(':')[0])
  if (!Number.isFinite(h) || !time) return 'MORNING'
  if (h < 15) return 'MORNING'
  if (h < 18) return 'EVENING'
  return 'NIGHT'
}

/** The shift of a group's earliest weekly session. */
export function shiftCodeForSlots(slots: unknown): SessionShift {
  const times = Array.isArray(slots)
    ? (slots as { time?: unknown }[]).map((s) => (typeof s?.time === 'string' ? s.time : '')).filter(Boolean).sort()
    : []
  return shiftCodeForTime(times[0])
}

export async function shiftIdForCode(code: SessionShift, db: Db = prisma): Promise<string> {
  const found = await db.shift.findUnique({ where: { code }, select: { id: true } })
  if (found) return found.id
  try {
    const t = SESSION_SHIFT_TIMES[code]
    return (await db.shift.create({ data: { code, name: NAMES[code], startTime: t.start, endTime: t.end }, select: { id: true } })).id
  } catch {
    const again = await db.shift.findUnique({ where: { code }, select: { id: true } })
    if (again) return again.id
    throw new Error('Could not prepare the session shift')
  }
}

/** The shift sent (old screens), or the one matching the group's schedule. */
export async function resolveShiftId(shiftId?: string | null, slots?: unknown, db: Db = prisma): Promise<string> {
  if (shiftId) {
    const ok = await db.shift.findUnique({ where: { id: shiftId }, select: { id: true } })
    if (ok) return ok.id
  }
  return shiftIdForCode(shiftCodeForSlots(slots), db)
}
