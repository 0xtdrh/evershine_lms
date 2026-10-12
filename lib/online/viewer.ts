/** L5: who presses Join — the student (own) or a parent (a child, ?s=). Server-only. */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors } from '@/lib/api-response'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'

/** Student (own) or parent (a child, ?s=). */
export async function onlineViewer(s: string | null) {
  const session = await auth()
  if (!session?.user) return { err: errors.unauthorized() }
  const role = session.user.role
  if (role === 'STUDENT') {
    const st = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
    if (!st || (s && s !== st.id)) return { err: errors.forbidden() }
    return { studentId: st.id, userId: session.user.id }
  }
  if ((role === 'PARENT' || role === 'GUARDIAN') && s && (await assertGuardianAccessToStudent(session.user.id, s))) return { studentId: s, userId: session.user.id }
  return { err: errors.forbidden() }
}
