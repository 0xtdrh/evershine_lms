/** P1: passport settings — GET (staff who read passports), PUT (passport:approve). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { isOwnCloudinaryUrl } from '@/lib/cloudinary'
import { getPassportSettings, savePassportSettings, type PassportSettings } from '@/lib/passport/engine'

const schema = z.object({
  trackRequired: z.record(z.array(z.string()).max(50)).default({}),
  trackColors: z.record(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  shareDays: z.number().int().min(1).max(365).default(30),
  bookletPrice: z.number().min(0).max(100000).nullable().default(null),
  companyStampUrl: z.string().url().nullable().default(null),
  signatureUrl: z.string().url().nullable().default(null),
  signatureName: z.string().max(80).default(''),
})

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'passport', 'read')) return errors.forbidden()
  return successResponse(await getPassportSettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'passport', 'approve')) return errors.forbidden()
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data as unknown as PassportSettings
  for (const u of [v.companyStampUrl, v.signatureUrl]) if (u && !isOwnCloudinaryUrl(u)) return errors.badRequest('Upload the image here (our own storage)')
  await savePassportSettings(v, session.user.id)
  return successResponse(v)
}
