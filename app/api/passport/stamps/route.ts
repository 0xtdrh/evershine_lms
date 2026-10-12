/**
 * P1 stamps library. GET — every stamp (staff who read passports; secret ones only for the library managers).
 * POST — a new stamp (passport:approve).
 */

import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { stampSchema } from '@/lib/passport/rules'
import { ensureBuiltinStamps } from '@/lib/passport/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!checkPermission(role, 'passport', 'read')) return errors.forbidden()
  await ensureBuiltinStamps()
  const manager = checkPermission(role, 'passport', 'approve')
  const rows = await prisma.passportStamp.findMany({
    where: manager ? {} : { active: true, secret: false },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { awards: true } } },
  })
  return successResponse(rows.map((r) => ({ ...r, awards: r._count.awards })))
}

export async function POST(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'passport', 'approve')) return errors.forbidden()
  const parsed = stampSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const last = await prisma.passportStamp.findFirst({ orderBy: { order: 'desc' }, select: { order: true } })
  const s = await prisma.passportStamp.create({
    data: {
      nameEn: d.nameEn!, nameAr: d.nameAr ?? '', descriptionEn: d.descriptionEn ?? null, descriptionAr: d.descriptionAr ?? null, kind: d.kind!,
      rule: d.kind === 'AUTO' ? d.rule ?? null : null, threshold: d.kind === 'AUTO' ? d.threshold ?? null : null, shape: d.shape ?? 'ROUND', color: d.color ?? '#4f46e5', icon: d.icon ?? '',
      givers: (d.kind === 'AUTO' ? [] : d.givers ?? []) as Prisma.InputJsonValue, repeatable: !!d.repeatable, secret: !!d.secret, active: d.active !== false,
      eventFrom: d.eventFrom ? new Date(d.eventFrom) : null, eventTo: d.eventTo ? new Date(d.eventTo) : null, order: (last?.order ?? 0) + 1, createdById: session.user.id,
    },
  })
  return createdResponse({ id: s.id })
}
