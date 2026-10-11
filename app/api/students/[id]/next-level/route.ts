/** R2: POST { group } — the parent asks for the next level from the level report (a wish for the secretaries). */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { requestNextLevel } from '@/lib/reports/next-level'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  if ((await studentViewer(session.user, id)) !== 'PARENT') return errors.forbidden('Only the parent can ask for the next level')
  const body = (await request.json().catch(() => null)) as { group?: string } | null
  if (!body?.group) return errors.badRequest('group is required')
  const r = await requestNextLevel(id, body.group, session.user.id)
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound('Group') : errors.conflict(r.message ?? 'Cannot ask now')
  return successResponse({ via: r.via })
}
