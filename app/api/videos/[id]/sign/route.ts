/** a02 M4 batch 3: POST — a signature for uploading this video's encrypted pieces straight to the storage. */

import { errors, successResponse } from '@/lib/api-response'
import { curriculumViewer } from '@/lib/curriculum/api'
import { signPieces } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  try { return successResponse(await signPieces((await params).id)) } catch (e) { return videoError(e) }
}
