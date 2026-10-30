import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { courseOffered, offeredMap } from '@/lib/delivery/catalog'
import { codeFromName, uniqueCode } from '@/lib/ids/auto-code'
import type { Role } from '@prisma/client'
import { z } from 'zod'

const createSubjectSchema = z.object({
  name: z.string().min(2),
  /** empty = made from the name (owner 2026-10-30: filled in automatically, can be changed) */
  code: z.string().max(20).toUpperCase().optional(),
  description: z.string().optional(),
  trackId: z.string().min(1).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'subject_offerings', 'read')
  if (denied) return denied

  const subjects = await prisma.academicSubject.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { track: { select: { id: true, name: true } }, _count: { select: { levels: true } } },
  })
  // a02: ?campusId= → only courses offered in that place
  const campusId = request.nextUrl.searchParams.get('campusId')
  if (campusId) {
    const m = await offeredMap()
    return successResponse(subjects.filter((c) => courseOffered(m, c, campusId)))
  }
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

  const taken = (await prisma.academicSubject.findMany({ select: { code: true } })).map((c) => c.code)
  const typed = parsed.data.code?.trim()
  if (typed && typed.length < 2) return errors.badRequest('The code needs at least 2 characters · الكود لازم حرفين على الأقل')
  if (typed && taken.some((c) => c.toUpperCase() === typed)) return errors.conflict(`The code ${typed} is used by another course · الكود ${typed} مستخدم في كورس تاني`)
  const code = typed || uniqueCode(codeFromName(parsed.data.name), taken)

  const subject = await prisma.academicSubject.create({
    data: {
      name: parsed.data.name,
      code,
      description: parsed.data.description,
      trackId: parsed.data.trackId ?? null,
    },
  })
  return createdResponse(subject)
}
