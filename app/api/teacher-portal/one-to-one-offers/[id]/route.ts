/** a02 M3 batch 2, instructor: POST { accept } — take the One-to-One (books it, invoices made) or pass it to the next instructor. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError } from '@/lib/one-to-one/http'
import { answerOffer } from '@/lib/one-to-one/requests'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.object({ accept: z.boolean() })

async function POST_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (session.user.role !== 'TEACHER') return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id } = await params
  try { return successResponse(await answerOffer(session.user.id, id, parsed.data.accept)) } catch (e) { return oneToOneError(e) }
}

export const POST = withMonthLock(POST_)
