/**
 * a02 M3 One-to-One. GET ?campusId=&status=ALL — the list (one_to_one:read, places).
 * POST — book: { studentIds (1, or 2 siblings), campusId, levelId, plan, sessions?, slots, teacherId, payment?, teacherRate?, minutes?, force? }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { MODES } from '@/lib/delivery/modes'
import { book, listOneToOne, type BookInput } from '@/lib/one-to-one/engine'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { PLANS } from '@/lib/one-to-one/rules'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(2),
  campusId: z.string().min(1),
  levelId: z.string().min(1),
  plan: z.enum(PLANS),
  sessions: z.number().int().min(1).max(200).nullish(),
  slots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/), mode: z.enum(MODES).optional(), roomId: z.string().min(1).nullish() })).min(1).max(7),
  teacherId: z.string().min(1),
  payment: z.enum(['FULL', 'INSTALLMENTS']).optional(),
  teacherRate: z.number().min(0).nullish(),
  minutes: z.number().int().min(10).max(300).nullish(),
  force: z.boolean().optional(),
  fromGroupId: z.string().min(1).nullish(),
})

export async function GET(request: NextRequest) {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  return successResponse(await listOneToOne(u.user, { campusId: sp.get('campusId'), status: sp.get('status') }))
}

async function POST_(request: NextRequest) {
  const u = await oneToOneUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await book(u.user, parsed.data as BookInput)) } catch (e) { return oneToOneError(e) }
}

// a03: it makes invoices
export const POST = withMonthLock(POST_)
