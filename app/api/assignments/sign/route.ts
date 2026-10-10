/**
 * LMS L3: signature for uploading homework files straight to Cloudinary — private (`authenticated`) and only into the
 * student's own folder, so a file can never be swapped for someone else's. POST { studentId? (parents) }.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { generateAuthenticatedUploadSignature, sanitizeCloudinaryError } from '@/lib/cloudinary'
import { submissionsFolder } from '@/lib/assignments/engine'
import { portalLessonViewer } from '@/lib/lms/api'

const SUBMISSION_FORMATS = 'jpg,jpeg,png,webp,heic,gif,pdf,mp4,webm,mov,mp3,m4a,wav,ogg,docx,pptx,xlsx,txt,zip,sb3,aia,ino,py,stl'

export async function POST(request: NextRequest) {
  let body: { studentId?: string } = {}
  try { body = await request.json() } catch { /* empty body = the student */ }
  const { v, err } = await portalLessonViewer(body.studentId ?? null)
  if (err) return err
  try {
    return successResponse(generateAuthenticatedUploadSignature(submissionsFolder(v!.studentId), SUBMISSION_FORMATS))
  } catch (e) {
    console.error('[ASSIGNMENT_SIGN]', sanitizeCloudinaryError(e))
    return errors.badRequest('File upload is not configured')
  }
}
