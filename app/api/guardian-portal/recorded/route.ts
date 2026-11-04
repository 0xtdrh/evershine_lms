/** a02 M4: parent. GET ?studentId= — this child's recorded courses. POST { studentId, groupId } — renew a subscription: makes the invoice; the days start when it is paid. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { portalLessonViewer } from '@/lib/lms/api'
import { recordedError } from '@/lib/recorded/http'
import { portalCourses, portalRenew } from '@/lib/recorded/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { v, err } = await portalLessonViewer(request.nextUrl.searchParams.get('studentId'))
  if (err) return err
  return successResponse(await portalCourses(v!.studentId))
}

async function POST_(request: NextRequest) {
  const parsed = z.object({ studentId: z.string().min(1), groupId: z.string().min(1) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { v, err } = await portalLessonViewer(parsed.data.studentId as string)
  if (err) return err
  if (!v!.asParent) return errors.forbidden('A parent renews the subscription')
  try { return successResponse(await portalRenew(v!.studentId, parsed.data.groupId as string, v!.userId)) } catch (e) { return recordedError(e) }
}

export const POST = withMonthLock(POST_)
