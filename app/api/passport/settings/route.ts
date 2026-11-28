/** P1: passport settings — GET (staff who read passports), PUT (passport:approve). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { webUrl } from '@/lib/validation/web-url'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { isOwnCloudinaryUrl } from '@/lib/cloudinary'
import { getPassportSettings, savePassportSettings, type PassportSettings } from '@/lib/passport/engine'
import { normalizeFields } from '@/lib/passport/book'

const schema = z.object({
  trackRequired: z.record(z.array(z.string()).max(50)).default({}),
  trackColors: z.record(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  shareDays: z.number().int().min(1).max(365).default(30),
  bookletPrice: z.number().min(0).max(100000).nullable().default(null),
  companyStampUrl: webUrl.nullable().default(null),
  signatureUrl: webUrl.nullable().default(null),
  signatureName: z.string().max(80).default(''),
  // owner 28/11 (S49): the new passport
  coverTitleEn: z.string().trim().min(1).max(40).default('TechNova Passport'),
  coverTitleAr: z.string().trim().min(1).max(40).default('جواز سفر TechNova'),
  sealMode: z.enum(['DRAWN', 'IMAGE', 'NONE']).default('DRAWN'),
  sealTop: z.string().trim().max(34).default('TECHNOVA · HURGHADA'),
  sealBottom: z.string().trim().max(34).default('تكنوفا · الغردقة'),
  fields: z.record(z.object({ passport: z.boolean(), share: z.boolean() })).default({}),
  seasons: z.array(z.object({
    en: z.string().trim().min(1).max(40), ar: z.string().trim().min(1).max(40), icon: z.string().max(8), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    from: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/), to: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/), moves: z.boolean().optional(),
  })).max(40).optional(),
  stampsPerBook: z.number().int().min(6).max(200).default(24),
  sessionMinutes: z.number().int().min(15).max(480).default(60),
  youngUntil: z.number().int().min(0).max(18).default(8),
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
  // an older screen that does not send the seasons keeps the saved list
  const v = { ...parsed.data, fields: normalizeFields(parsed.data.fields), seasons: parsed.data.seasons ?? (await getPassportSettings()).seasons } as unknown as PassportSettings
  if (v.sealMode === 'IMAGE' && !v.companyStampUrl) return errors.badRequest('Upload the stamp image first · ارفع صورة الختم الأول')
  for (const u of [v.companyStampUrl, v.signatureUrl]) if (u && !isOwnCloudinaryUrl(u)) return errors.badRequest('Upload the image here (our own storage)')
  await savePassportSettings(v, session.user.id)
  return successResponse(v)
}
