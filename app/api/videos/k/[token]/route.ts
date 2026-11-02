/** a02 M4 batch 3: the key for one viewing. Same person, live link, and the lesson must still be open for a student (a finished subscription gets nothing). */

import { requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { studentLessonAccess } from '@/lib/lms/engine'
import { keyFor } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  try {
    const key = await keyFor((await params).token, session.user.id, async (s) => {
      if (!s.studentId) return true
      if (!s.classSectionId) return false
      const b = await prisma.curriculumBlock.findUnique({ where: { id: s.blockId }, select: { sessionId: true } })
      return !!b && (await studentLessonAccess(s.studentId, s.classSectionId, b.sessionId)).ok
    })
    return new Response(new Uint8Array(key), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-store' } })
  } catch (e) { return videoError(e) }
}
