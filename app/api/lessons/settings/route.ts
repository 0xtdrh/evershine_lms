/**
 * LMS L2 settings. GET (curriculum:read): company settings + every level's own way of opening lessons.
 * PUT (curriculum:approve): { settings?: { unlockMode, watermark, kidModeMaxAge }, level?: { id, mode | null } }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { getLmsSettings, saveLmsSettings } from '@/lib/lms/settings'
import { UNLOCK_MODES } from '@/lib/lms/unlock'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'read')
  if (denied) return denied
  const levels = await prisma.level.findMany({
    where: { isActive: true }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }],
    select: { id: true, name: true, lessonUnlockMode: true, subject: { select: { name: true } } },
  })
  return successResponse({ settings: await getLmsSettings(), modes: UNLOCK_MODES, levels: levels.map((l) => ({ id: l.id, name: `${l.subject.name} — ${l.name}`, mode: l.lessonUnlockMode })) })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'approve')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    settings: z.object({ unlockMode: z.enum(UNLOCK_MODES), watermark: z.boolean(), kidModeMaxAge: z.number().int().min(0).max(18) }).optional(),
    level: z.object({ id: z.string().min(1), mode: z.enum(UNLOCK_MODES).nullable() }).optional(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  if (parsed.data.settings) await saveLmsSettings(parsed.data.settings as never, session.user.id)
  if (parsed.data.level) {
    const found = await prisma.level.findUnique({ where: { id: parsed.data.level.id }, select: { id: true } })
    if (!found) return errors.notFound('Level')
    await prisma.level.update({ where: { id: found.id }, data: { lessonUnlockMode: parsed.data.level.mode ?? null } })
  }
  return successResponse({ settings: await getLmsSettings() }, 'Saved')
}
