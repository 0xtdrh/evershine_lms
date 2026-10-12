/** P1: GET — the passports this person can open: the student's own, or a parent's children. */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role
  if (role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true, firstName: true, lastName: true } })
    return successResponse(s ? [{ id: s.id, name: `${s.firstName} ${s.lastName}`.trim() }] : [])
  }
  if (role === 'PARENT' || role === 'GUARDIAN') {
    const kids = await prisma.student.findMany({ where: { guardians: { some: { userId: session.user.id } } }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } })
    return successResponse(kids.map((k) => ({ id: k.id, name: `${k.firstName} ${k.lastName}`.trim() })))
  }
  return successResponse([])
}
