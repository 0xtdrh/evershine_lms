/** a02 M4 batch 3: DELETE — removes a video and its pieces. A video a lesson uses is refused. An unfinished upload may also be removed by a curriculum writer (the uploader cleans up after a failure). */

import { errors, successResponse } from '@/lib/api-response'
import { curriculumViewer } from '@/lib/curriculum/api'
import { prisma } from '@/lib/prisma'
import { removeVideo } from '@/lib/videos/engine'
import { videoAdmin, videoError } from '@/lib/videos/http'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await prisma.protectedVideo.findUnique({ where: { id }, select: { status: true } })
  if (!v) return errors.notFound('Video')
  if (v.status === 'UPLOADING') {
    const c = await curriculumViewer()
    if (c.err) return c.err
    if (!c.v!.canEdit) return errors.forbidden()
  } else {
    const u = await videoAdmin('update')
    if ('error' in u) return u.error
  }
  try { await removeVideo(id); return successResponse({ ok: true }) } catch (e) { return videoError(e) }
}
