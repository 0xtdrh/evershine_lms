/** LMS L2: extra note / link for ONE group's session (instructor / managers). POST { sessionNumber, body, url? }, DELETE ?noteId=. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { canManageGroupLessons } from '@/lib/lms/engine'

type Ctx = { params: Promise<{ id: string }> }

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id))) return { err: errors.forbidden() }
  return { session }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    sessionNumber: z.number().int().min(1).max(500),
    body: z.string().trim().min(1).max(5000),
    url: z.string().trim().url().max(1000).refine((u) => u.startsWith('https://'), 'Link must start with https://').nullish(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const note = await prisma.groupLessonNote.create({ data: { classSectionId: id, sessionNumber: parsed.data.sessionNumber!, body: parsed.data.body!, url: parsed.data.url ?? null, createdById: g.session!.user.id } })
  return createdResponse(note, 'Note added')
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const noteId = request.nextUrl.searchParams.get('noteId')
  const note = noteId ? await prisma.groupLessonNote.findUnique({ where: { id: noteId }, select: { classSectionId: true } }) : null
  if (!note || note.classSectionId !== id) return errors.notFound('Note')
  await prisma.groupLessonNote.delete({ where: { id: noteId! } })
  return successResponse(null, 'Removed')
}
