/** GET / PUT /api/cards/settings — 2026-10-19 ID card settings (read: documents:read, change: documents:update). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { cardUser } from '@/lib/cards/http'
import { getCardSettings, saveCardSettings } from '@/lib/cards/engine'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const u = await cardUser('read')
  if ('error' in u) return u.error
  const feeTypes = await prisma.feeType.findMany({ where: { isActive: true }, select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: 'asc' } })
  return successResponse({ settings: await getCardSettings(), feeTypes })
}

export async function PUT(request: NextRequest) {
  const u = await cardUser('update')
  if ('error' in u) return u.error
  const p = z.object({
    validityMonths: z.number().int().min(1).max(60).optional(), emergencyOnBack: z.boolean().optional(), replacementFeeTypeId: z.string().nullable().optional(),
    digitalForParents: z.boolean().optional(), digitalForStudents: z.boolean().optional(),
  }).safeParse(await request.json().catch(() => null))
  if (!p.success) return errors.validation(p.error)
  return successResponse(await saveCardSettings(p.data, u.user.id), 'Saved')
}
