/**
 * GET  /api/partners/[id]/join — six phases 1-C: the partner's join code, link and how many families / bookings came from it.
 * POST /api/partners/[id]/join { action: 'create' | 'regenerate' | 'on' | 'off' } (partners:update). A new code stops the old link.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { ensureJoinCode, joinStats } from '@/lib/partners/join'

type P = { params: Promise<{ id: string }> }

async function view(id: string) {
  const p = await prisma.partner.findUnique({ where: { id }, select: { id: true, name: true, joinCode: true, joinActive: true } })
  if (!p) return null
  return { ...p, path: p.joinCode ? `/join/p/${p.joinCode}` : null, ...(await joinStats(id)) }
}

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  const v = await view((await params).id)
  return v ? successResponse(v) : errors.notFound('Partner')
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { action?: string } | null
  if (body?.action === 'create' || body?.action === 'regenerate') {
    if (!(await ensureJoinCode(id, body.action === 'regenerate'))) return errors.notFound('Partner')
  } else if (body?.action === 'on' || body?.action === 'off') {
    await prisma.partner.update({ where: { id }, data: { joinActive: body.action === 'on' } })
  } else return errors.badRequest('action is required')
  return successResponse(await view(id))
}
