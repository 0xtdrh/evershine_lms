/** Shared bits of the student / parent lesson APIs (LMS L2). */

import { prisma } from '@/lib/prisma'
import { errors, errorResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { isModuleOn } from '@/lib/platform/settings'

export interface PortalViewer { userId: string; role: string; studentId: string; asParent: boolean }

/**
 * Signed-in student (own lessons) or parent (a child, via ?s= / studentId). Lessons are off for the portal while the
 * `lms` module is switched off.
 */
export async function portalLessonViewer(studentIdParam?: string | null): Promise<{ v?: PortalViewer; err?: Response }> {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!(await isModuleOn('lms'))) return { err: errorResponse('MODULE_OFF', 'Lessons are not switched on yet', 403) }
  const role = session.user.role
  if (role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
    if (!s || (studentIdParam && studentIdParam !== s.id)) return { err: errors.forbidden() }
    return { v: { userId: session.user.id, role, studentId: s.id, asParent: false } }
  }
  if (role === 'PARENT' || role === 'GUARDIAN') {
    if (!studentIdParam || !(await assertGuardianAccessToStudent(session.user.id, studentIdParam))) return { err: errors.forbidden() }
    return { v: { userId: session.user.id, role, studentId: studentIdParam, asParent: true } }
  }
  return { err: errors.forbidden('Lessons are for students and parents') }
}

export const clientIp = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
