/**
 * Staff-only exception flag (docs/plan-learning-platform.md §17): "do not use this child in marketing", agreed
 * offline with the parent. GET → { noMarketing }, PUT { noMarketing } (students:update). Parents never see it.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'

async function guard(id: string, action: 'read' | 'update') {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  const role = session.user.role as Role
  const denied = requirePermission(role, 'students', action)
  if (denied) return { err: denied }
  const s = await prisma.student.findUnique({ where: { id }, select: { campusId: true, noMarketing: true } })
  if (!s) return { err: errors.notFound('Student') }
  const scoped = campusScope(role, session.user.campusId, null)
  if (scoped && s.campusId !== scoped) return { err: errors.forbidden() }
  return { s }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id, 'read')
  if (g.err) return g.err
  return successResponse({ noMarketing: g.s!.noMarketing })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await guard(id, 'update')
  if (g.err) return g.err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ noMarketing: z.boolean() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  await prisma.student.update({ where: { id }, data: { noMarketing: parsed.data.noMarketing! } })
  return successResponse({ noMarketing: parsed.data.noMarketing }, 'Saved')
}
