/**
 * POST /api/campuses/online — a02 M1 (2026-10-30): make the ONE "Online" place (Campus kind ONLINE) if it is not there
 * yet, so online students / groups have their own prices, managers, reports and month close. Super Admin only (like
 * adding a branch). Returns the place (existing or new).
 */

import { requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { forgetAllPlaces } from '@/lib/places/server'

export async function POST() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden()
  const existing = await prisma.campus.findFirst({ where: { kind: 'ONLINE' } })
  if (existing) {
    if (!existing.isActive) await prisma.campus.update({ where: { id: existing.id }, data: { isActive: true } })
    return successResponse(existing, 'The online place already exists · مكان الأونلاين موجود')
  }
  let code = 'ONL'
  for (let i = 2; await prisma.campus.findUnique({ where: { code }, select: { id: true } }); i++) code = `ONL${i}`
  const nameTaken = await prisma.campus.findUnique({ where: { name: 'Online' }, select: { id: true } })
  const campus = await prisma.campus.create({
    data: { name: nameTaken ? 'Online (TechNova)' : 'Online', code, kind: 'ONLINE', address: 'Online', phone: '-', email: 'online@technova.local', principalName: '-' },
  })
  forgetAllPlaces()
  return createdResponse(campus, 'Online place created · مكان الأونلاين اتعمل')
}
