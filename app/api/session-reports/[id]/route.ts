/**
 * R1: GET ?student=<id> — one student's session report (staff of the group / branch, the parent, the student; families
 * only once sent). PATCH — instructor extras { groupNote?, students?: [{ studentId, star?, phrases?, comment? }] } (draft only).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { extrasSchema } from '@/lib/session-reports/rules'
import { studentReport, updateExtras } from '@/lib/session-reports/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const studentId = new URL(request.url).searchParams.get('student')
  if (!studentId) return errors.badRequest('student is required')
  const r = await studentReport({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, id, studentId)
  if (!r) return errors.notFound('Report')
  return successResponse(r)
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const parsed = extrasSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await updateExtras({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, id, parsed.data as Parameters<typeof updateExtras>[2])
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound('Report') : r.code === 'FORBIDDEN' ? errors.forbidden(r.message) : errors.conflict(r.message ?? 'Cannot change')
  return successResponse({ saved: true })
}
