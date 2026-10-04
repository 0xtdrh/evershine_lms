/**
 * Phase D complaints report + settings.
 * GET ?month=YYYY-MM — counts by topic / branch / kind, avg hours to resolve, solved rate (complaints:export)
 * PUT { replyHours, autoCloseDays } — settings (complaints:export)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { complaintsReport, getComplaintSettings, saveComplaintSettings } from '@/lib/complaints/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'complaints', 'export')
  if (denied) return denied
  const month = new URL(request.url).searchParams.get('month') ?? undefined
  const [report, settings] = await Promise.all([complaintsReport({ campusId: campusScope(role, session.user.campusId, null), month }), getComplaintSettings()])
  return successResponse({ report, settings })
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'complaints', 'export')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ replyHours: z.number().int().min(1).max(240), autoCloseDays: z.number().int().min(1).max(60) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  await saveComplaintSettings(parsed.data as { replyHours: number; autoCloseDays: number }, session.user.id)
  return successResponse(parsed.data, 'Saved')
}
