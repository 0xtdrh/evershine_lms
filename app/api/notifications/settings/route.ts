/**
 * GET/PUT /api/notifications/settings — phase C: switch each notification type
 * on/off for everyone (notification_settings). Parents cannot switch them off.
 * PUT { switches: { ATTENDANCE_LATE: false, ... } }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { NOTIFICATION_EVENTS, getEventSwitches, saveEventSwitches } from '@/lib/notifications/events'
import { isAutoWhatsAppConfigured } from '@/lib/messaging/whatsapp'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'notification_settings', 'read')
  if (denied) return denied
  const s = await getEventSwitches()
  return successResponse({
    whatsappAuto: isAutoWhatsAppConfigured(),
    events: NOTIFICATION_EVENTS.map((e) => ({ ...e, on: s[e.key] !== false })),
  })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'notification_settings', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ switches: z.record(z.string(), z.boolean()) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveEventSwitches(parsed.data.switches as Record<string, boolean>, session.user.id), 'Saved')
}
