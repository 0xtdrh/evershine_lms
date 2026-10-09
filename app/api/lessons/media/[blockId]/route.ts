/**
 * LMS L2: opens a lesson file for a student (?g=<groupId>): checks the lesson is open for them, logs it, then
 * redirects to a signed private Cloudinary link (images get the student's name burned in).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { curriculumMediaUrl } from '@/lib/cloudinary'
import { visibleTo } from '@/lib/curriculum/blocks'
import { logLessonView, studentLessonAccess } from '@/lib/lms/engine'
import { getLmsSettings } from '@/lib/lms/settings'
import { clientIp, portalLessonViewer } from '@/lib/lms/api'

export async function GET(request: NextRequest, { params }: { params: Promise<{ blockId: string }> }) {
  const { blockId } = await params
  const groupId = request.nextUrl.searchParams.get('g')
  const { v, err } = await portalLessonViewer(null)
  if (err) return err
  if (!groupId) return errors.badRequest('g (group) is required')
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId }, select: { id: true, sessionId: true, audience: true, data: true } })
  if (!b || !visibleTo(b.audience, 'STUDENT')) return errors.notFound('File')
  const access = await studentLessonAccess(v!.studentId, groupId, b.sessionId)
  if (!access.ok) return errors.forbidden(access.message)
  const m = (b.data as { media?: { publicId?: string; resourceType?: 'image' | 'video' | 'raw'; format?: string } })?.media
  if (!m?.publicId || !m.resourceType) return errors.notFound('File')
  await logLessonView({ userId: v!.userId, studentId: v!.studentId, classSectionId: groupId, sessionId: b.sessionId, blockId, kind: 'MEDIA', ip: clientIp(request), userAgent: request.headers.get('user-agent') })
  const settings = await getLmsSettings()
  let mark: string | undefined
  if (settings.watermark && m.resourceType === 'image') {
    const s = await prisma.student.findUnique({ where: { id: v!.studentId }, select: { firstName: true, lastName: true, registrationNumber: true } })
    mark = `${s?.firstName ?? ''} ${s?.lastName ?? ''} ${s?.registrationNumber ?? ''}`.trim()
  }
  const res = NextResponse.redirect(curriculumMediaUrl(m.publicId, m.resourceType, m.format, mark), 302)
  res.headers.set('Cache-Control', 'private, no-store')
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}
