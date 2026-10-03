/**
 * GET /api/birthdays/me — phase C: is it the signed-in user's birthday today, or
 * (for parents) one of their children's? Drives the big greeting banner.
 */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { cairoYmd, isBirthdayOn, ageOn } from '@/lib/dates/cairo'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const today = cairoYmd()
  const role = session.user.role
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { dateOfBirth: true, displayName: true, student: { select: { id: true, firstName: true, dateOfBirth: true } }, teacher: { select: { firstName: true, dateOfBirth: true } }, guardian: { select: { firstName: true } } },
  })
  if (!u) return errors.notFound('User')
  let self: { name: string; turns: number; studentId?: string } | null = null
  if (u.student && isBirthdayOn(u.student.dateOfBirth, today)) self = { name: u.student.firstName, turns: ageOn(u.student.dateOfBirth, today), studentId: u.student.id }
  else if (u.teacher && isBirthdayOn(u.teacher.dateOfBirth, today)) self = { name: u.teacher.firstName, turns: ageOn(u.teacher.dateOfBirth, today) }
  else if (u.dateOfBirth && isBirthdayOn(u.dateOfBirth, today)) self = { name: u.guardian?.firstName ?? u.displayName ?? '', turns: ageOn(u.dateOfBirth, today) }

  let children: { studentId: string; name: string; turns: number }[] = []
  if (role === 'PARENT' || role === 'GUARDIAN') {
    const kids = await getChildrenForGuardianUser(session.user.id)
    const dobs = await prisma.student.findMany({ where: { id: { in: kids.map((k) => k.id) } }, select: { id: true, firstName: true, dateOfBirth: true } })
    children = dobs.filter((s) => isBirthdayOn(s.dateOfBirth, today)).map((s) => ({ studentId: s.id, name: s.firstName, turns: ageOn(s.dateOfBirth, today) }))
  }
  return successResponse({ self, children })
}
