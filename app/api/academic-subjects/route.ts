import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'
import { z } from 'zod'

const createSubjectSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().optional(),
  trackId: z.string().min(1).optional().nullable(),
})

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'subject_offerings', 'read')
  if (denied) return denied

  const subjects = await prisma.academicSubject.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { track: { select: { id: true, name: true } }, _count: { select: { levels: true } } },
  })
  return successResponse(subjects)
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'subject_offerings', 'create')
  if (denied) return denied

  const parsed = createSubjectSchema.safeParse(await request.json())
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.trackId) {
    const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId }, select: { id: true } })
    if (!track) return errors.notFound('Track')
  }

  const subject = await prisma.academicSubject.create({
    data: {
      name: parsed.data.name,
      code: parsed.data.code,
      description: parsed.data.description,
      trackId: parsed.data.trackId ?? null,
    },
  })
  return createdResponse(subject)
}
