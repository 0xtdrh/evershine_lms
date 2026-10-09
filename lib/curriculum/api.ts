/** Shared bits of the /api/curriculum routes: the signed-in viewer + turning engine outcomes into responses. */

import { errors, errorResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { viewerFor, type Viewer, type Outcome } from './engine'

export async function curriculumViewer(): Promise<{ v?: Viewer; err?: Response }> {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  const v = await viewerFor({ id: session.user.id, role: session.user.role })
  if (!v.canRead && !v.canEdit) return { err: errors.forbidden() }
  return { v }
}

export function outcomeError(o: Outcome<unknown>) {
  if (o.code === 'FORBIDDEN') return errors.forbidden(o.message)
  if (o.code === 'NOT_FOUND') return errors.notFound(o.message?.replace(/ not found$/, '') || 'Item')
  if (o.code === 'LOCKED' || o.code === 'BAD_STATUS' || o.code === 'INCOMPLETE') return errorResponse(o.code, o.message ?? 'Not allowed', 409)
  return errors.badRequest(o.message ?? 'Invalid request')
}

export async function readJson(request: Request): Promise<{ body?: unknown; err?: Response }> {
  try { return { body: await request.json() } } catch { return { err: errors.badRequest('Invalid JSON') } }
}
