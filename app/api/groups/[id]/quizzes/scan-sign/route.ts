/** LMS L4: signature for uploading scans of a paper exam (private Cloudinary, this group's folder). */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { generateAuthenticatedUploadSignature, getBaseUploadFolder, sanitizeCloudinaryError } from '@/lib/cloudinary'
import { canManageGroupLessons } from '@/lib/lms/engine'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id))) return errors.forbidden()
  try {
    return successResponse(generateAuthenticatedUploadSignature(`${getBaseUploadFolder()}/quiz-scans/${id}`, 'jpg,jpeg,png,webp,heic,pdf'))
  } catch (e) {
    console.error('[QUIZ_SCAN_SIGN]', sanitizeCloudinaryError(e))
    return errors.badRequest('File upload is not configured')
  }
}
