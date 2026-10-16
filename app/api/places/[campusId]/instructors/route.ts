/**
 * Partners part 1-B2: instructors of a place.
 * GET — instructors who could be added (not serving this place yet); POST { teacherId } — let an instructor serve this
 * place (extra place); DELETE ?teacherId= — stop (not for the instructor's main place: change that on the instructor page).
 * RBAC teachers:update + the place must be one of the person's places.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { allowsCampus, forgetPlaces, loadPlaces, teacherWhere } from '@/lib/places/server'

type P = { params: Promise<{ campusId: string }> }

async function gate(user: { id: string; role: string }, campusId: string, action: 'read' | 'update') {
  const denied = requirePermission(user.role as Role, 'teachers', action)
  if (denied) return { denied }
  const places = await loadPlaces(user)
  if (!allowsCampus(places, campusId)) return { denied: errors.forbidden() }
  if (!(await prisma.campus.count({ where: { id: campusId } }))) return { denied: errors.notFound('Place') }
  return { places }
}

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { campusId } = await params
  const g = await gate(session.user, campusId, 'read')
  if (g.denied) return g.denied
  const rows = await prisma.teacher.findMany({
    where: { isActive: true, ...teacherWhere(g.places!), NOT: { OR: [{ campusId }, { user: { allLocations: true } }, { user: { placeAccess: { some: { campusId } } } }] } },
    orderBy: { firstName: 'asc' },
    select: { id: true, firstName: true, lastName: true, campus: { select: { name: true } } },
  })
  return successResponse(rows.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), primary: t.campus?.name ?? '' })))
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { campusId } = await params
  const g = await gate(session.user, campusId, 'update')
  if (g.denied) return g.denied
  const body = (await request.json().catch(() => null)) as { teacherId?: string } | null
  const t = body?.teacherId ? await prisma.teacher.findUnique({ where: { id: body.teacherId }, select: { userId: true, campusId: true } }) : null
  if (!t) return errors.notFound('Instructor')
  if (t.campusId !== campusId) {
    await prisma.userPlaceAccess.upsert({ where: { userId_campusId: { userId: t.userId, campusId } }, create: { userId: t.userId, campusId, createdById: session.user.id }, update: {} })
    forgetPlaces(t.userId)
  }
  return successResponse({ added: true }, 'The instructor now serves this place')
}

export async function DELETE(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { campusId } = await params
  const g = await gate(session.user, campusId, 'update')
  if (g.denied) return g.denied
  const teacherId = new URL(request.url).searchParams.get('teacherId') ?? ''
  const t = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { userId: true, campusId: true } })
  if (!t) return errors.notFound('Instructor')
  if (t.campusId === campusId) return errors.badRequest('This is the instructor’s main place — change it on the instructor page')
  await prisma.userPlaceAccess.deleteMany({ where: { userId: t.userId, campusId } })
  forgetPlaces(t.userId)
  return successResponse({ removed: true }, 'The instructor no longer serves this place')
}
