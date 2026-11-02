/** a02 M4 batch 3: PUT one encrypted piece to the local store. Only on the e2e copy (VIDEO_STORAGE=local); the live site uploads to the storage directly. */

import { errors, successResponse } from '@/lib/api-response'
import { curriculumViewer } from '@/lib/curriculum/api'
import { saveLocalPiece } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  const { id, name } = await params
  try { saveLocalPiece(id, name, Buffer.from(await request.arrayBuffer())); return successResponse({ ok: true }) } catch (e) { return videoError(e) }
}
