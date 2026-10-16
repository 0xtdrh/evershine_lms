/** POST /api/announcements/[id]/follow-up — a call follow-up (due today) for every parent who did not read / confirm. */

import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { AnnouncementError, followUpUnread } from '@/lib/announcements/engine'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'contact_logs', 'create')) return errors.forbidden()
  const { id } = await params
  try {
    return successResponse({ added: await followUpUnread({ id: session.user.id, role: session.user.role }, id) })
  } catch (e) {
    if (e instanceof AnnouncementError) return errors.notFound('Announcement')
    throw e
  }
}
