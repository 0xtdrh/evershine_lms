/** L5: sites added to the tools list — GET (staff who read the curriculum), PUT { extra } (curriculum:approve). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { cleanHost, TOOL_CATALOG } from '@/lib/lms/tools'
import { getToolSettings, saveToolSettings } from '@/lib/lms/tool-settings'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'curriculum', 'read')) return errors.forbidden()
  return successResponse(await getToolSettings())
}

const site = z.object({ host: z.string().min(3).max(200), nameEn: z.string().trim().min(1).max(60), nameAr: z.string().trim().max(60).default(''), mode: z.enum(['INLINE', 'NEW_TAB']) })

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'curriculum', 'approve')) return errors.forbidden()
  const parsed = z.object({ extra: z.array(site).max(50) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const known = new Set(TOOL_CATALOG.flatMap((t) => t.hosts))
  const extra = []
  for (const s of parsed.data.extra ?? []) {
    const host = cleanHost(s.host ?? '')
    if (!host) return errors.badRequest(`"${s.host}" is not a website address`)
    if (known.has(host)) continue // already in the built-in list
    if (!extra.some((e) => e.host === host)) extra.push({ host, nameEn: s.nameEn!, nameAr: s.nameAr ?? '', mode: s.mode! })
  }
  await saveToolSettings({ extra }, session.user.id)
  return successResponse({ extra })
}
