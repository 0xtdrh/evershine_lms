/** GET /api/website/campaigns — x01 campaign pages with their visits and requests (website:read). POST adds one (website:update). */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { campaignSchema } from '@/lib/site/campaigns'
import { createCampaign, listCampaigns, slugTaken } from '@/lib/site/campaigns-store'

export const dynamic = 'force-dynamic'

async function who(action: 'read' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', action)) return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET() {
  const w = await who('read')
  if (w.error) return w.error
  return successResponse(await listCampaigns())
}

export async function POST(request: NextRequest) {
  const w = await who('update')
  if (w.error) return w.error
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  if (await slugTaken(parsed.data.slug)) return errors.badRequest('This link name is used by another campaign · اسم اللينك ده مستخدم في حملة تانية')
  return createdResponse(await createCampaign(w.userId!, parsed.data))
}
