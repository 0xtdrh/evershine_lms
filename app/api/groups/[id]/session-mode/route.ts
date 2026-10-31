/**
 * POST /api/groups/[id]/session-mode — a02 M1 batch 2:
 *   { date, mode | null, note? }              one session of the group taught another way (families are told); null = back to normal
 *   { date, mode | null, studentId }          one student attends that session another way (e.g. online while travelling)
 * class_sections:update + the group's place.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { canSeeGroup } from '@/lib/places/server'
import { MODES } from '@/lib/delivery/modes'
import { setSessionMode, setStudentSessionMode } from '@/lib/delivery/session-modes'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(MODES).nullable(),
  note: z.string().max(300).nullish(),
  studentId: z.string().min(1).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  if (!checkPermission(session.user.role, 'class_sections', 'update')) return errors.forbidden()
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { date, mode, note, studentId } = parsed.data
  const r = studentId
    ? await setStudentSessionMode(id, studentId, date!, mode ?? null, session.user.id)
    : await setSessionMode(id, date!, mode ?? null, session.user.id, note)
  if (!r.ok) {
    const f = r as { status: number; message: string }
    return errorResponse(f.status === 404 ? 'NOT_FOUND' : 'MODE_NOT_ALLOWED', f.message, f.status)
  }
  return successResponse({ date, mode }, 'Saved · اتحفظ')
}
