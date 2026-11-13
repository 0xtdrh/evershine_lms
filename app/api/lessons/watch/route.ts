/**
 * Six phases 2: watch minutes.
 * POST /api/lessons/watch { blockId, groupId, ranges, position, duration, opened? } — the student's player reports what it played
 *      (also sent by sendBeacon when the page closes, so the body is read as text). Parents / staff are not tracked (204).
 * GET  /api/lessons/watch?blockId=&groupId= — where the student stopped (resume) and how much was watched.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { reportSchema } from '@/lib/videos/watch'
import { recordWatch, resumePoint, WatchError } from '@/lib/videos/watch-engine'

async function studentOf() {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  if (session.user.role !== 'STUDENT') return { skip: true }
  const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
  return s ? { studentId: s.id } : { error: errors.forbidden() }
}

export async function POST(request: NextRequest) {
  const who = await studentOf()
  if ('error' in who && who.error) return who.error
  if ('skip' in who) return new NextResponse(null, { status: 204 })
  const parsed = reportSchema.safeParse(await request.text().then((t) => JSON.parse(t)).catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    return successResponse(await recordWatch(who.studentId!, parsed.data))
  } catch (e) {
    if (e instanceof WatchError) return errorResponse('WATCH', e.message, e.status)
    console.error('[WATCH]', e)
    return errors.internal()
  }
}

export async function GET(request: NextRequest) {
  const who = await studentOf()
  if ('error' in who && who.error) return who.error
  if ('skip' in who) return successResponse({ lastPosition: 0, percent: 0, completed: false })
  const sp = request.nextUrl.searchParams
  return successResponse(await resumePoint(who.studentId!, sp.get('blockId') ?? '', sp.get('groupId') ?? ''))
}
