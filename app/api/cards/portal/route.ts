/**
 * GET /api/cards/portal?studentId — 2026-10-19 the digital ID card in the portal: a parent sees their child's card,
 * a student their own (each only when the card settings allow it).
 */

import { NextRequest } from 'next/server'
import { requireSession } from '@/lib/academic/api-helpers'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { portalCard } from '@/lib/cards/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role
  let studentId = request.nextUrl.searchParams.get('studentId')
  if (role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
    if (!s || (studentId && studentId !== s.id)) return errors.forbidden()
    studentId = s.id
  } else if (role === 'PARENT' || role === 'GUARDIAN') {
    if (!studentId || !(await assertGuardianAccessToStudent(session.user.id, studentId))) return errors.forbidden()
  } else return errors.forbidden()
  return successResponse(await portalCard({ id: session.user.id, role }, studentId!))
}
