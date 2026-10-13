/**
 * M0: places of one staff account. GET (users:read) / PUT { allLocations, campusIds (extra places), groupIds (single
 * groups) } (users:update). The primary place stays the one in the role profile. Changes apply within seconds.
 */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { forgetPlaces, loadPlaces } from '@/lib/places/server'

const STAFF = ['ADMIN', 'TEACHER', 'ACCOUNTANT', 'SECRETARY', 'BRANCH_MANAGER', 'MARKETING']

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'users', 'read')) return errors.forbidden()
  const { id } = await params
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, allLocations: true } })
  if (!u || !STAFF.includes(u.role)) return errors.notFound('User')
  const [extra, groups, places] = await Promise.all([
    prisma.userPlaceAccess.findMany({ where: { userId: id }, select: { campusId: true } }),
    prisma.userGroupAccess.findMany({ where: { userId: id }, select: { classSectionId: true } }),
    loadPlaces({ id, role: u.role }),
  ])
  return successResponse({ allLocations: u.allLocations, primary: places.primary, campusIds: extra.map((e) => e.campusId), groupIds: groups.map((g) => g.classSectionId) })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'users', 'update')) return errors.forbidden()
  const { id } = await params
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!u || !STAFF.includes(u.role)) return errors.notFound('User')
  const parsed = z.object({ allLocations: z.boolean(), campusIds: z.array(z.string()).max(100), groupIds: z.array(z.string()).max(300) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { allLocations: boolean; campusIds: string[]; groupIds: string[] }
  const [campuses, groups] = await Promise.all([
    prisma.campus.findMany({ where: { id: { in: d.campusIds } }, select: { id: true } }),
    prisma.classSection.findMany({ where: { id: { in: d.groupIds } }, select: { id: true } }),
  ])
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { allLocations: d.allLocations } }),
    prisma.userPlaceAccess.deleteMany({ where: { userId: id } }),
    prisma.userPlaceAccess.createMany({ data: campuses.map((c) => ({ userId: id, campusId: c.id, createdById: session.user.id })) }),
    prisma.userGroupAccess.deleteMany({ where: { userId: id } }),
    prisma.userGroupAccess.createMany({ data: groups.map((g) => ({ userId: id, classSectionId: g.id, createdById: session.user.id })) }),
  ])
  forgetPlaces(id)
  return successResponse({ saved: true })
}
