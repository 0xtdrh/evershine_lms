/**
 * GET /api/places/[campusId]/rooms — a02 M1 batch 3: how this branch / partner place keeps rooms (NONE / FIXED / DAILY),
 *     its rooms, rooms per weekday, weekly use of each room, BRANCH sessions with no room yet.
 * PUT { roomMode, dayCounts?: number[7] } — change how rooms are kept.
 * POST { name, capacity, kind? } — add a room. Branch = campuses permission, partner place = partners permission.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errorResponse, errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { placeRooms, setRoomMode } from '@/lib/rooms/engine'
import { roomsGuard } from '@/lib/rooms/http'
import { ROOM_MODES } from '@/lib/rooms/rules'

type Ctx = { params: Promise<{ campusId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { campusId } = await params
  const g = await roomsGuard(campusId, 'read')
  if (g.err) return g.err
  return successResponse(await placeRooms(campusId))
}

const modeSchema = z.object({ roomMode: z.enum(ROOM_MODES), dayCounts: z.array(z.number().int().min(0).max(200)).length(7).optional() })

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { campusId } = await params
  const g = await roomsGuard(campusId, 'update')
  if (g.err) return g.err
  const parsed = modeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  await setRoomMode(campusId, parsed.data.roomMode!, parsed.data.dayCounts)
  return successResponse(await placeRooms(campusId), 'Saved · اتحفظ')
}

const roomSchema = z.object({ name: z.string().trim().min(1).max(80), capacity: z.number().int().min(1).max(500), kind: z.string().trim().max(40).nullish() })

export async function POST(request: NextRequest, { params }: Ctx) {
  const { campusId } = await params
  const g = await roomsGuard(campusId, 'update')
  if (g.err) return g.err
  const parsed = roomSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const taken = await prisma.room.findUnique({ where: { campusId_name: { campusId, name: parsed.data.name! } }, select: { id: true } })
  if (taken) return errorResponse('CONFLICT', 'A room with this name already exists here · فيه قاعة بالاسم ده هنا', 409)
  const room = await prisma.room.create({ data: { campusId, name: parsed.data.name!, capacity: parsed.data.capacity!, kind: parsed.data.kind || null } })
  return createdResponse(room, 'Room added · القاعة اتضافت')
}
