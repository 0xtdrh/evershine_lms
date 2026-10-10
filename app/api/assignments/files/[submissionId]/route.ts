/**
 * LMS L3: opens one file of a hand-in (?i=<index>) for the student, their parents, or the people who run the group
 * (instructor / substitute / branch manager / admins), or — for an approved gallery project — anyone the gallery rule
 * allows. ?audio=1 = the instructor's voice note. Redirects to a signed private Cloudinary link.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { curriculumMediaUrl } from '@/lib/cloudinary'
import { canManageGroupLessons } from '@/lib/lms/engine'
import { canSeeGalleryItem, galleryViewer } from '@/lib/assignments/gallery'

export async function GET(request: NextRequest, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const s = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, select: { studentId: true, classSectionId: true, files: true, feedbackAudio: true, galleryStatus: true } })
  if (!s) return errors.notFound('File')
  const role = session.user.role
  let allowed = false
  if (role === 'STUDENT') allowed = (await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } }))?.id === s.studentId
  else if (role === 'PARENT' || role === 'GUARDIAN') allowed = await assertGuardianAccessToStudent(session.user.id, s.studentId)
  else allowed = await canManageGroupLessons({ id: session.user.id, role, campusId: session.user.campusId }, s.classSectionId)
  const audio = request.nextUrl.searchParams.get('audio') === '1'
  if (!allowed && !audio && s.galleryStatus === 'APPROVED') {
    const v = await galleryViewer({ id: session.user.id, role })
    allowed = !!v && (await canSeeGalleryItem(v, s))
  }
  if (!allowed) return errors.forbidden()
  const i = Number(request.nextUrl.searchParams.get('i') ?? 0)
  const f = audio
    ? (s.feedbackAudio as { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string } | null)
    : ((s.files as { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string }[] | null) ?? [])[i]
  if (!f) return errors.notFound('File')
  const res = NextResponse.redirect(curriculumMediaUrl(f.publicId, f.resourceType, f.format), 302)
  res.headers.set('Cache-Control', 'private, no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
