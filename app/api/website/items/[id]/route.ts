/** PATCH / DELETE /api/website/items/[id] — x01: change or remove a website item (website:update). */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { itemSchema } from '@/lib/site/items'
import { deleteItem, updateItem } from '@/lib/site/items-store'

async function allowed() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', 'update')) return errors.forbidden()
  return null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const no = await allowed()
  if (no) return no
  const { id } = await params
  if (!(await prisma.siteItem.findUnique({ where: { id }, select: { id: true } }))) return errors.notFound('Item')
  const parsed = itemSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await updateItem(id, parsed.data))
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const no = await allowed()
  if (no) return no
  const { id } = await params
  if (!(await prisma.siteItem.findUnique({ where: { id }, select: { id: true } }))) return errors.notFound('Item')
  await deleteItem(id)
  return successResponse({ deleted: true })
}
