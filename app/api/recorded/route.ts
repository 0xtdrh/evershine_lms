/** a02 M4 batch 1: recorded courses. GET ?campusId= — who is enrolled. POST { studentId, campusId, levelId, plan } — enrol (the invoice is made). RBAC recorded_courses, places. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { enrol, listEnrolled } from '@/lib/recorded/engine'
import { recordedError, recordedUser } from '@/lib/recorded/http'
import { ACCESS_PLANS, type AccessPlan } from '@/lib/recorded/rules'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({ studentId: z.string().min(1), campusId: z.string().min(1), levelId: z.string().min(1), plan: z.enum(ACCESS_PLANS) })

export async function GET(request: NextRequest) {
  const u = await recordedUser('read')
  if ('error' in u) return u.error
  return successResponse(await listEnrolled(u.user, { campusId: request.nextUrl.searchParams.get('campusId') }))
}

async function POST_(request: NextRequest) {
  const u = await recordedUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await enrol(u.user, parsed.data as { studentId: string; campusId: string; levelId: string; plan: AccessPlan })) } catch (e) { return recordedError(e) }
}

export const POST = withMonthLock(POST_)
