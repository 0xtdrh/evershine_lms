/**
 * a02 M4 batch 3: POST { blockId, g?, s?, device } — start watching. A student / parent needs the lesson open (subscription, gates, fees);
 * staff need to be able to read that curriculum version. Answers a short-lived link and the name to show on the picture.
 */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { curriculumViewer } from '@/lib/curriculum/api'
import { getSession } from '@/lib/curriculum/engine'
import { visibleTo } from '@/lib/curriculum/blocks'
import { clientIp, portalLessonViewer } from '@/lib/lms/api'
import { logLessonView, studentLessonAccess } from '@/lib/lms/engine'
import { openViewing, videoOfBlock } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

const schema = z.object({ blockId: z.string().min(1), g: z.string().nullish(), s: z.string().nullish(), device: z.string().min(4).max(64) })

export async function POST(request: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { blockId, g, s, device } = parsed.data
  const ip = clientIp(request), userAgent = request.headers.get('user-agent')
  try {
    const { block, videoId } = await videoOfBlock(blockId)
    const role = session.user.role
    if (role === 'STUDENT' || role === 'PARENT' || role === 'GUARDIAN') {
      const { v, err } = await portalLessonViewer(s ?? null)
      if (err) return err
      if (!g) return errors.badRequest('g (group) is required')
      if (!visibleTo(block.audience, 'STUDENT')) return errors.notFound('Video')
      const access = await studentLessonAccess(v!.studentId, g, block.sessionId)
      if (!access.ok) return errors.forbidden(access.message)
      const out = await openViewing(videoId, blockId, { userId: v!.userId, studentId: v!.studentId, groupId: g, device, ip, userAgent })
      await logLessonView({ userId: v!.userId, studentId: v!.studentId, classSectionId: g, sessionId: block.sessionId, blockId, kind: 'MEDIA', ip, userAgent })
      const st = await prisma.student.findUnique({ where: { id: v!.studentId }, select: { firstName: true, lastName: true, registrationNumber: true } })
      return successResponse({ ...out, name: `${st?.firstName ?? ''} ${st?.lastName ?? ''} · ${st?.registrationNumber ?? ''}`.trim() })
    }
    const { v, err } = await curriculumViewer()
    if (err) return err
    if (!(await getSession(v!, block.sessionId))) return errors.forbidden()
    const out = await openViewing(videoId, blockId, { userId: session.user.id, studentId: null, groupId: null, device, ip, userAgent })
    return successResponse({ ...out, name: session.user.name || session.user.email || 'Staff' })
  } catch (e) { return videoError(e) }
}
