/** a02 M4 batch 3. GET — the protected videos (video_protection:read). POST { name } — start an upload: gives the key to the uploader's browser (curriculum writers only). */

import { z } from 'zod'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { curriculumViewer } from '@/lib/curriculum/api'
import { createUpload, listVideos } from '@/lib/videos/engine'
import { videoAdmin, videoError } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await videoAdmin('read')
  if ('error' in u) return u.error
  return successResponse(await listVideos())
}

export async function POST(request: Request) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const parsed = z.object({ name: z.string().min(1).max(300) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await createUpload(v!.userId, parsed.data.name)) } catch (e) { return videoError(e) }
}
