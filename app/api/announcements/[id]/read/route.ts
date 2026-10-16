/** POST /api/announcements/[id]/read { ack?: boolean } — the reader opened it (and pressed "I read it"). */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { markRead } from '@/lib/announcements/engine'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  let ack = false
  try { ack = !!((await request.json()) as { ack?: boolean })?.ack } catch { /* no body = just read */ }
  const ok = await markRead({ id: session.user.id, role: session.user.role }, id, ack)
  return ok ? successResponse({ id, ack }) : errors.notFound('Announcement')
}
