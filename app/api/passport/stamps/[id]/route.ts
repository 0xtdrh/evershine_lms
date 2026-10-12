/** P1: PATCH — edit a stamp; DELETE — remove a stamp nobody has yet (otherwise switch it off). passport:approve. */

import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { stampSchema } from '@/lib/passport/rules'

async function guard() {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!checkPermission(session.user.role as Role, 'passport', 'approve')) return { err: errors.forbidden() }
  return { session }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (g.err) return g.err
  const { id } = await params
  const s = await prisma.passportStamp.findUnique({ where: { id } })
  if (!s) return errors.notFound('Stamp')
  const parsed = stampSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  // a built-in stamp keeps its kind and rule (other things can change)
  const kind = s.code ? s.kind : d.kind!
  await prisma.passportStamp.update({
    where: { id },
    data: {
      nameEn: d.nameEn!, nameAr: d.nameAr ?? '', descriptionEn: d.descriptionEn ?? null, descriptionAr: d.descriptionAr ?? null, kind,
      rule: kind === 'AUTO' ? (s.code ? s.rule : d.rule ?? null) : null, threshold: kind === 'AUTO' ? d.threshold ?? s.threshold : null,
      shape: d.shape ?? s.shape, color: d.color ?? s.color, icon: d.icon ?? '', givers: (kind === 'AUTO' ? [] : d.givers ?? []) as Prisma.InputJsonValue,
      repeatable: !!d.repeatable, secret: !!d.secret, active: d.active !== false,
      eventFrom: d.eventFrom ? new Date(d.eventFrom) : null, eventTo: d.eventTo ? new Date(d.eventTo) : null,
    },
  })
  return successResponse({ saved: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard()
  if (g.err) return g.err
  const { id } = await params
  const s = await prisma.passportStamp.findUnique({ where: { id }, include: { _count: { select: { awards: true } } } })
  if (!s) return errors.notFound('Stamp')
  if (s.code || s._count.awards > 0) {
    await prisma.passportStamp.update({ where: { id }, data: { active: false } })
    return successResponse({ removed: false, switchedOff: true })
  }
  await prisma.passportStamp.delete({ where: { id } })
  return successResponse({ removed: true })
}
