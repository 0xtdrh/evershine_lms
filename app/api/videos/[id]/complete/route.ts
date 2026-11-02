/** a02 M4 batch 3: POST { manifest, sizeBytes } — every piece is up: the video becomes READY. */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { curriculumViewer } from '@/lib/curriculum/api'
import { completeUpload } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

const schema = z.object({ manifest: z.string().min(10).max(2_000_000), sizeBytes: z.number().min(0) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return successResponse(await completeUpload((await params).id, parsed.data as { manifest: string; sizeBytes: number })) } catch (e) { return videoError(e) }
}
