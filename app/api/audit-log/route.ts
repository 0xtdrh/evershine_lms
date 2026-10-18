/**
 * GET /api/audit-log?type&userId&entityId&from&to&action&cursor — 2026-10-18 change log: who changed what and when
 * (old → new value). audit_logs:read; someone without every place sees only changes made by people in their places.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { visibleUserIds } from '@/lib/places/server'
import { AUDITED_MODELS } from '@/lib/audit/auto'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PAGE = 50

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'audit_logs', 'read')) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const ids = await visibleUserIds({ id: session.user.id, role })
  const from = DATE.test(sp.get('from') ?? '') ? new Date(`${sp.get('from')}T00:00:00.000Z`) : null
  const to = DATE.test(sp.get('to') ?? '') ? new Date(new Date(`${sp.get('to')}T00:00:00.000Z`).getTime() + 86_400_000) : null
  const where = {
    ...(sp.get('type') ? { entityType: sp.get('type')! } : {}),
    ...(sp.get('entityId') ? { entityId: sp.get('entityId')! } : {}),
    ...(sp.get('action') ? { action: sp.get('action')! } : {}),
    ...(from || to ? { timestamp: { ...(from && { gte: from }), ...(to && { lt: to }) } } : {}),
    ...(sp.get('userId') ? { userId: ids && !ids.includes(sp.get('userId')!) ? '__none__' : sp.get('userId')! } : ids ? { userId: { in: ids.length ? ids : ['__none__'] } } : {}),
  }
  const cursor = sp.get('cursor')
  const rows = await prisma.auditLog.findMany({
    where, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, timestamp: true, action: true, entityType: true, entityId: true, changes: true, userId: true, user: { select: { displayName: true, email: true, role: true } } },
  })
  const more = rows.length > PAGE
  return successResponse({
    rows: rows.slice(0, PAGE).map((r) => ({ id: r.id, at: r.timestamp, action: r.action, entityType: r.entityType, entityId: r.entityId, changes: r.changes, userId: r.userId, who: r.user?.displayName || r.user?.email || '—', whoRole: r.user?.role ?? null })),
    next: more ? rows[PAGE - 1].id : null,
    types: [...AUDITED_MODELS].sort(),
  })
}
