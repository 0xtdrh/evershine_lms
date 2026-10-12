/** L5: POST { groupId, s? } — Join the online session: logged as provisional attendance, returns the meeting link. */

import { errors, successResponse } from '@/lib/api-response'
import { onlineViewer } from '@/lib/online/viewer'
import { joinOnline } from '@/lib/online/engine'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { groupId?: string; s?: string } | null
  if (!body?.groupId) return errors.badRequest('groupId is required')
  const v = await onlineViewer(body.s ?? null)
  if (v.err) return v.err
  const r = await joinOnline(v.studentId!, body.groupId, v.userId!)
  if (!r.ok) return errors.conflict(r.message ?? 'Cannot join now')
  return successResponse({ url: r.url })
}
