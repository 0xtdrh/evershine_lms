/** PATCH /api/places/[campusId]/rooms/[roomId] { name?, capacity?, kind?, isActive? } — a02 batch 3: change or stop a room. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { roomsGuard } from '@/lib/rooms/http'

const schema = z.object({ name: z.string().trim().min(1).max(80).optional(), capacity: z.number().int().min(1).max(500).optional(), kind: z.string().trim().max(40).nullish(), isActive: z.boolean().optional() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ campusId: string; roomId: string }> }) {
  const { campusId, roomId } = await params
  const g = await roomsGuard(campusId, 'update')
  if (g.err) return g.err
  if (!(await prisma.room.findFirst({ where: { id: roomId, campusId }, select: { id: true } }))) return errors.notFound('Room')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  return successResponse(await prisma.room.update({
    where: { id: roomId },
    data: { ...(d.name && { name: d.name }), ...(d.capacity && { capacity: d.capacity }), ...(d.kind !== undefined && { kind: d.kind || null }), ...(d.isActive !== undefined && { isActive: d.isActive }) },
  }), 'Saved · اتحفظ')
}
