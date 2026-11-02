/** a02 M4 batch 3: video protection settings (devices at once, paid courses refuse unprotected videos). */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { getVideoSettings, saveVideoSettings } from '@/lib/videos/engine'
import { STUDENT_DEVICE_MAX } from '@/lib/videos/rules'
import { videoAdmin } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ deviceLimit: z.number().int().min(1).max(STUDENT_DEVICE_MAX).optional(), blockUnprotectedPaid: z.boolean().optional() })

export async function GET() {
  const u = await videoAdmin('read')
  if ('error' in u) return u.error
  return successResponse(await getVideoSettings())
}

export async function PUT(request: Request) {
  const u = await videoAdmin('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveVideoSettings(parsed.data, u.user.id))
}
