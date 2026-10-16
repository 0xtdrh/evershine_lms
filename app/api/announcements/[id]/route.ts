/**
 * 5-D announcement (lib/announcements/engine.ts).
 * GET    /api/announcements/[id] — sender / approver: text + every recipient with read / "I read it"
 * PATCH  /api/announcements/[id] — { action: 'approve' | 'reject' | 'stop' | 'pin' | 'unpin', reason? }
 * DELETE /api/announcements/[id] — stop showing it (soft: isActive = false); the sender or an approver of that place
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { AnnouncementError, decide, detailFor } from '@/lib/announcements/engine'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({ action: z.enum(['approve', 'reject', 'stop', 'pin', 'unpin']), reason: z.string().max(300).optional().nullable() })

async function who() {
  const session = await auth()
  if (!session?.user) return null
  const role = normalizeRole(session.user.role)
  return role ? { id: session.user.id, role } : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const { id } = await params
  const d = await detailFor(user, id)
  return d ? successResponse(d) : errors.notFound('Announcement')
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { action, reason } = parsed.data
  try {
    if (action === 'approve' || action === 'reject') {
      await decide(user, id, action, reason)
    } else {
      // stop / pin: the sender or someone who manages it (detailFor checks the place)
      if (!(await detailFor(user, id))) return errors.notFound('Announcement')
      if (action !== 'stop' && !checkPermission(user.role, 'announcements', 'approve')) return errors.forbidden()
      await prisma.announcement.update({ where: { id }, data: action === 'stop' ? { isActive: false } : { pinned: action === 'pin' } })
    }
    return successResponse({ id, action })
  } catch (e) {
    if (e instanceof AnnouncementError) return errors.badRequest(e.message)
    throw e
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await who()
  if (!user) return errors.unauthorized()
  const { id } = await params
  const a = await prisma.announcement.findUnique({ where: { id }, select: { createdBy: true, audiences: true } })
  if (!a) return errors.notFound('Announcement')
  // old announcements: delete permission; new ones: the sender or an approver of that place
  const allowed = a.audiences ? !!(await detailFor(user, id)) : checkPermission(user.role, 'announcements', 'delete') && (user.role === 'SUPER_ADMIN' || a.createdBy === user.id)
  if (!allowed) return errors.forbidden()
  await prisma.announcement.update({ where: { id }, data: { isActive: false } })
  return successResponse({ id }, { message: 'Announcement removed' })
}
