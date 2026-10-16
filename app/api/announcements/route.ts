/**
 * 5-D targeted announcements (lib/announcements/*).
 * GET  /api/announcements                      — my announcements (sent to me + old ones for my role), pinned first
 * GET  /api/announcements?mode=manage&tab=sent|pending — sender / approver list with reach numbers
 * POST /api/announcements                      — send: { title, body, titleAr?, contentAr?, audiences[], scopeType,
 *       scopeIds[], attachmentUrl?, attachmentName?, pinned?, requireAck?, publishAt?, expiresAt? }
 *       PUBLISHED when the sender has announcements:approve, otherwise PENDING (approvers are told).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, createdResponse, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { AUDIENCES, SCOPES } from '@/lib/announcements/rules'
import { AnnouncementError, createAnnouncement, feedFor, manageList, type AnnouncementInput } from '@/lib/announcements/engine'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  title: z.string().trim().min(2).max(190),
  body: z.string().trim().min(2).max(10000),
  titleAr: z.string().trim().max(190).optional().nullable(),
  contentAr: z.string().trim().max(10000).optional().nullable(),
  audiences: z.array(z.enum(AUDIENCES)).min(1),
  scopeType: z.enum(SCOPES),
  scopeIds: z.array(z.string().min(1)).max(2000).default([]),
  attachmentUrl: z.string().url().max(500).optional().nullable(),
  attachmentName: z.string().max(200).optional().nullable(),
  pinned: z.boolean().optional(),
  requireAck: z.boolean().optional(),
  publishAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'announcements', 'read')) return errors.forbidden()
  const sp = new URL(request.url).searchParams
  if (sp.get('mode') === 'manage') {
    if (!checkPermission(role, 'announcements', 'create') && !checkPermission(role, 'announcements', 'approve')) return errors.forbidden()
    return successResponse(await manageList({ id: session.user.id, role }, sp.get('tab') === 'pending' ? 'pending' : 'sent'))
  }
  return successResponse(await feedFor({ id: session.user.id, role }))
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'announcements', 'create')) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    const row = await createAnnouncement({ id: session.user.id, role }, parsed.data as AnnouncementInput)
    await logAudit({ prismaClient: prisma, userId: session.user.id, action: 'CREATE', entityType: 'Announcement', entityId: row.id, changes: { title: row.title, audiences: row.audiences, scopeType: row.scopeType, status: row.status }, request }).catch(() => undefined)
    return createdResponse({ id: row.id, status: row.status }, row.status === 'PENDING' ? 'Sent for approval' : 'Announcement published')
  } catch (e) {
    if (e instanceof AnnouncementError) return errors.badRequest(e.message)
    throw e
  }
}
