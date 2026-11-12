/** PATCH / DELETE /api/website/campaigns/[id] — x01: change or remove a campaign page (website:update). */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { campaignSchema } from '@/lib/site/campaigns'
import { deleteCampaign, slugTaken, updateCampaign } from '@/lib/site/campaigns-store'

async function allowed(id: string) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', 'update')) return errors.forbidden()
  if (!(await prisma.siteCampaign.findUnique({ where: { id }, select: { id: true } }))) return errors.notFound('Campaign')
  return null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const no = await allowed(id)
  if (no) return no
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  if (await slugTaken(parsed.data.slug, id)) return errors.badRequest('This link name is used by another campaign · اسم اللينك ده مستخدم في حملة تانية')
  return successResponse(await updateCampaign(id, parsed.data))
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const no = await allowed(id)
  if (no) return no
  await deleteCampaign(id)
  return successResponse({ deleted: true })
}
