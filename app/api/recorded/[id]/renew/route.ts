/** a02 M4 batch 1: POST — one more subscription period: a new invoice; the days are added when it is paid. */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { renew } from '@/lib/recorded/engine'
import { recordedError, recordedUser } from '@/lib/recorded/http'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function POST_(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await recordedUser('update')
  if ('error' in u) return u.error
  const { id } = await params
  try { return successResponse(await renew(u.user, id)) } catch (e) { return recordedError(e) }
}

export const POST = withMonthLock(POST_)
