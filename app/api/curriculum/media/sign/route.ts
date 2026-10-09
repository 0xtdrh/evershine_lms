/**
 * LMS L1: signature for uploading a curriculum file straight to Cloudinary (curriculum:update only).
 * Files are stored as `authenticated` (private) and opened only through signed links made by the server.
 */

import { errors, successResponse } from '@/lib/api-response'
import { generateCurriculumUploadSignature, sanitizeCloudinaryError } from '@/lib/cloudinary'
import { CURRICULUM_UPLOAD_FORMATS } from '@/lib/curriculum/blocks'
import { curriculumViewer } from '@/lib/curriculum/api'

export async function POST() {
  const { v, err } = await curriculumViewer()
  if (err) return err
  if (!v!.canEdit) return errors.forbidden()
  try {
    return successResponse(generateCurriculumUploadSignature(CURRICULUM_UPLOAD_FORMATS))
  } catch (e) {
    console.error('[CURRICULUM_SIGN]', sanitizeCloudinaryError(e))
    return errors.badRequest('File upload is not configured')
  }
}
