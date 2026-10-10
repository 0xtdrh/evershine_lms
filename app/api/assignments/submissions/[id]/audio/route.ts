/** LMS L3 batch 2: signature for the instructor's voice note on one hand-in (private Cloudinary, its own folder). */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { generateAuthenticatedUploadSignature, sanitizeCloudinaryError } from '@/lib/cloudinary'
import { feedbackFolder } from '@/lib/assignments/engine'
import { canManageGroupLessons } from '@/lib/lms/engine'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const s = await prisma.assignmentSubmission.findUnique({ where: { id }, select: { classSectionId: true } })
  if (!s) return errors.notFound('Submission')
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, s.classSectionId))) return errors.forbidden()
  try {
    return successResponse(generateAuthenticatedUploadSignature(feedbackFolder(id), 'webm,ogg,mp3,m4a,wav,mp4'))
  } catch (e) {
    console.error('[FEEDBACK_AUDIO_SIGN]', sanitizeCloudinaryError(e))
    return errors.badRequest('File upload is not configured')
  }
}
