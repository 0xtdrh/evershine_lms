/**
 * PATCH  /api/delivery/templates/[id] { name?, nameAr?, pattern?, isActive? } — a02: change a template (groups already
 *        made keep their slots' ways). DELETE — remove it; courses / levels that used it as default fall back above.
 * class_sections:update.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { MODES } from '@/lib/delivery/modes'

type Ctx = { params: Promise<{ id: string }> }

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!checkPermission(session.user.role, 'class_sections', 'update')) return { err: errors.forbidden() }
  if (!(await prisma.deliveryTemplate.findUnique({ where: { id }, select: { id: true } }))) return { err: errors.notFound('Template') }
  return {}
}

const schema = z.object({ name: z.string().trim().min(2).max(120).optional(), nameAr: z.string().trim().max(120).nullish(), pattern: z.array(z.enum(MODES)).min(1).max(7).optional(), isActive: z.boolean().optional() })

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  return successResponse(await prisma.deliveryTemplate.update({
    where: { id },
    data: { ...(d.name && { name: d.name }), ...(d.nameAr !== undefined && { nameAr: d.nameAr || null }), ...(d.pattern && { pattern: d.pattern }), ...(d.isActive !== undefined && { isActive: d.isActive }) },
  }), 'Saved · اتحفظ')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  await prisma.$transaction([
    prisma.academicSubject.updateMany({ where: { deliveryTemplateId: id }, data: { deliveryTemplateId: null } }),
    prisma.level.updateMany({ where: { deliveryTemplateId: id }, data: { deliveryTemplateId: null } }),
    prisma.deliveryTemplate.delete({ where: { id } }),
  ])
  return successResponse(null, 'Removed · اتشال')
}
