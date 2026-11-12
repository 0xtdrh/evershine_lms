/**
 * GET  /api/website/items?kind= — x01: products / achievements / media for the Website screen (website:read).
 * POST /api/website/items — add one (website:update).
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { ITEM_KINDS, itemSchema, type ItemKind } from '@/lib/site/items'
import { createItem, listItems } from '@/lib/site/items-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', 'read')) return errors.forbidden()
  const k = request.nextUrl.searchParams.get('kind')
  return successResponse(await listItems(ITEM_KINDS.includes(k as ItemKind) ? (k as ItemKind) : undefined))
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', 'update')) return errors.forbidden()
  const parsed = itemSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return createdResponse(await createItem(session.user.id, parsed.data))
}
